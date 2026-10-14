import type { Snapshot } from '../physics/snapshot';

export type Listener = 'cockpit' | 'external';

/**
 * Sonido 100 % sintetizado con Web Audio (sin muestras grabadas):
 * - Motor: osciladores en la frecuencia de explosiones (4 cilindros, 4 tiempos → 2 por vuelta)
 *   y sus armónicos, más ruido modulado en amplitud a esa frecuencia (el "traqueteo"), con un
 *   filtro que se abre con el acelerador.
 * - Hélice: zumbido en la frecuencia de paso de pala.
 * - Viento: ruido rosa filtrado cuyo volumen y brillo crecen con la velocidad.
 * - Rodadura en tierra y bocina de pérdida.
 * Los parámetros se actualizan con setTargetAtTime (sin clics, sin recrear nodos).
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private cabinFilter!: BiquadFilterNode;
  private engine!: { oscs: OscillatorNode[]; gains: GainNode[]; filter: BiquadFilterNode; out: GainNode; am: OscillatorNode; amDepth: GainNode; noiseGain: GainNode };
  private prop!: { osc: OscillatorNode; gain: GainNode };
  private wind!: { filter: BiquadFilterNode; gain: GainNode };
  private rumble!: { filter: BiquadFilterNode; gain: GainNode };
  private horn!: { osc: OscillatorNode; gain: GainNode };
  muted = false;
  volume = 0.7;
  private cylinders: number;
  private blades: number;
  /** α (rad) a partir del cual suena la bocina de pérdida. */
  stallWarnAlpha = (13 * Math.PI) / 180;

  constructor(cylinders = 4, blades = 2) {
    this.cylinders = cylinders;
    this.blades = blades;
  }

  get started() { return this.ctx !== null && this.ctx.state === 'running'; }

  /** Debe llamarse desde un gesto del usuario (política de autoplay de los navegadores). */
  async start(): Promise<void> {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    // Filtro de "cabina": en el interior el sonido llega más apagado
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 2200;
    this.cabinFilter.connect(this.master);
    this.master.connect(ctx.destination);

    const noise = this.noiseBuffer(ctx);
    const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); return s; };

    // Motor
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 0.8;
    const out = ctx.createGain(); out.gain.value = 0;
    filter.connect(out); out.connect(this.cabinFilter);
    const types: OscillatorType[] = ['sawtooth', 'square', 'sawtooth', 'triangle'];
    const levels = [0.5, 0.25, 0.18, 0.35];
    const oscs: OscillatorNode[] = [], gains: GainNode[] = [];
    types.forEach((t, i) => {
      const o = ctx.createOscillator(); o.type = t; o.frequency.value = 40;
      const g = ctx.createGain(); g.gain.value = levels[i];
      o.connect(g); g.connect(filter); o.start();
      oscs.push(o); gains.push(g);
    });
    // Ruido modulado a la frecuencia de explosiones
    const nGain = ctx.createGain(); nGain.gain.value = 0.0;
    const amDepth = ctx.createGain(); amDepth.gain.value = 0.0;
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 40;
    am.connect(amDepth); amDepth.connect(nGain.gain); am.start();
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 600; nf.Q.value = 0.7;
    noiseSrc().connect(nf); nf.connect(nGain); nGain.connect(filter);
    this.engine = { oscs, gains, filter, out, am, amDepth, noiseGain: nGain };

    // Hélice
    const po = ctx.createOscillator(); po.type = 'triangle'; po.frequency.value = 40;
    const pg = ctx.createGain(); pg.gain.value = 0;
    po.connect(pg); pg.connect(this.cabinFilter); po.start();
    this.prop = { osc: po, gain: pg };

    // Viento
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0;
    noiseSrc().connect(wf); wf.connect(wg); wg.connect(this.master);
    this.wind = { filter: wf, gain: wg };

    // Rodadura
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 180;
    const rg = ctx.createGain(); rg.gain.value = 0;
    noiseSrc().connect(rf); rf.connect(rg); rg.connect(this.master);
    this.rumble = { filter: rf, gain: rg };

    // Bocina de pérdida
    const ho = ctx.createOscillator(); ho.type = 'square'; ho.frequency.value = 1650;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1650; hf.Q.value = 4;
    const hg = ctx.createGain(); hg.gain.value = 0;
    ho.connect(hf); hf.connect(hg); hg.connect(this.master); ho.start();
    this.horn = { osc: ho, gain: hg };
  }

  /** Ruido rosa (algoritmo de Paul Kellet) de 2 s en bucle. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /**
   * @param s estado actual
   * @param listener cabina o exterior
   * @param distance distancia de la cámara al avión (m), para atenuar en vistas externas
   * @param paused silencia todo salvo el viento residual
   */
  update(s: Snapshot, listener: Listener, distance: number, paused: boolean) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, k = 0.06;
    const set = (p: AudioParam, v: number, tc = k) => p.setTargetAtTime(v, t, tc);

    const rpm = paused || s.crashed ? 0 : s.rpm0;
    const firing = Math.max((rpm / 60) * (this.cylinders / 2), 1);
    const running = rpm > 300;
    const load = s.throttle;
    const e = this.engine;
    // Fundamental, sub-armónico (irregularidad de un 4 cilindros), 2º armónico y armónico de árbol
    set(e.oscs[0].frequency, firing);
    set(e.oscs[1].frequency, firing / 2);
    set(e.oscs[2].frequency, firing * 2);
    set(e.oscs[3].frequency, firing * 0.25 + 8);
    set(e.am.frequency, firing);
    set(e.filter.frequency, 220 + load * 900 + rpm * 0.12);
    const engineVol = running ? 0.22 + 0.45 * load + (rpm / 2700) * 0.15 : rpm > 30 ? 0.08 * (rpm / 300) : 0;
    set(e.noiseGain.gain, running ? 0.25 + load * 0.4 : 0);
    set(e.amDepth.gain, running ? 0.25 + load * 0.35 : 0);

    const bladePass = (rpm / 60) * this.blades;
    set(this.prop.osc.frequency, Math.max(bladePass, 1));

    // Atenuación por distancia (vistas externas) y "efecto cabina"
    const att = listener === 'cockpit' ? 1 : Math.min(1, 30 / Math.max(distance, 15)) ** 1.1;
    set(this.cabinFilter.frequency, listener === 'cockpit' ? 1800 : 6000);
    set(e.out.gain, engineVol * att);
    set(this.prop.gain.gain, (rpm > 200 ? 0.04 + 0.08 * (rpm / 2700) : 0) * att);

    // Viento: crece con el cuadrado de la velocidad
    const tas = paused ? 0 : s.tas;
    const windLevel = Math.min(1, (tas / 70) ** 2);
    set(this.wind.gain.gain, windLevel * (listener === 'cockpit' ? 0.22 : 0.35) * (0.6 + 0.4 * att), 0.2);
    set(this.wind.filter.frequency, 300 + tas * 25, 0.2);

    // Rodadura sobre la pista
    const roll = s.onGround && !paused ? Math.min(1, s.groundSpeed / 25) : 0;
    set(this.rumble.gain.gain, roll * 0.35 * att, 0.1);
    set(this.rumble.filter.frequency, 90 + s.groundSpeed * 6, 0.1);

    // Bocina de pérdida: suena un poco antes del ángulo crítico (como la real)
    const nearStall = !s.onGround && !paused && !s.crashed && (s.stalled || s.alpha > this.stallWarnAlpha) && s.ias > 8;
    set(this.horn.gain.gain, nearStall && listener === 'cockpit' ? 0.07 : nearStall ? 0.02 : 0, 0.03);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
