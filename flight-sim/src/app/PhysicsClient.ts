import type { AircraftConfig } from '../physics/AircraftConfig';
import { PHYSICS_DT } from '../physics/Simulation';
import { emptySnapshot, IDX, SNAPSHOT_SIZE, type Snapshot, FIELDS } from '../physics/snapshot';
import type { ControlInputs, EnvironmentSettings, GroundReport, InitialConditions } from '../physics/types';
import { qSlerp, type Quat } from '../physics/math/quat';
import type { FromPhysics, ToPhysics } from './protocol';

interface Sample { buf: Float64Array<ArrayBuffer>; time: number }

/** Campos que no se interpolan (estados discretos). */
const DISCRETE = new Set<string>([
  'onGround', 'stalled', 'crashed', 'crashReason', 'flapsIndex', 'parkingBrake',
  'gearContact0', 'gearContact1', 'gearContact2', 'gearContact3',
]);
const ANGLES = new Set<string>(['heading', 'roll']);

/**
 * Proxy del hilo principal hacia el worker de física. Guarda los últimos estados recibidos y
 * entrega uno interpolado para el instante de render, así el movimiento es suave aunque los
 * fps de render y los 120 Hz de física no coincidan.
 */
export class PhysicsClient {
  private worker: Worker;
  private samples: Sample[] = [];
  /** Offset estimado entre el reloj de la simulación y performance.now() (s). */
  private clockOffset: number | null = null;
  private out = emptySnapshot();
  private readyResolve!: () => void;
  readonly ready: Promise<void>;
  onError: (msg: string) => void = (m) => console.error('[física]', m);
  /** Último estado recibido (sin interpolar). */
  latest: Snapshot = emptySnapshot();

  constructor() {
    this.worker = new Worker(new URL('../physics/worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((r) => (this.readyResolve = r));
    this.worker.onmessage = (ev: MessageEvent<FromPhysics>) => this.onMessage(ev.data);
  }

  private send(msg: ToPhysics, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  private onMessage(msg: FromPhysics) {
    switch (msg.type) {
      case 'ready': this.readyResolve(); break;
      case 'error': this.onError(msg.message); break;
      case 'state': {
        const time = msg.buffer[IDX.time];
        const wall = performance.now() / 1000;
        // Si la simulación se reinició, el tiempo vuelve atrás: descartamos el historial.
        const last = this.samples[this.samples.length - 1];
        if (last && time < last.time) { this.samples = []; this.clockOffset = null; }
        const sampleOffset = time - wall;
        this.clockOffset = this.clockOffset === null || msg.steps === 0
          ? sampleOffset
          : this.clockOffset + (sampleOffset - this.clockOffset) * 0.05;
        this.samples.push({ buf: msg.buffer, time });
        while (this.samples.length > 6) {
          const old = this.samples.shift()!;
          this.send({ type: 'recycle', buffer: old.buf }, [old.buf.buffer]);
        }
        for (let i = 0; i < SNAPSHOT_SIZE; i++) this.latest[FIELDS[i]] = msg.buffer[i];
        break;
      }
    }
  }

  init(aircraft: AircraftConfig, initial: InitialConditions, env: EnvironmentSettings) {
    this.send({ type: 'init', aircraft, initial, env });
    return this.ready;
  }

  reset(initial: InitialConditions) { this.send({ type: 'reset', initial }); }
  setControls(controls: ControlInputs) { this.send({ type: 'controls', controls }); }
  setGround(ground: GroundReport) { this.send({ type: 'ground', ground }); }
  setEnvironment(env: Partial<EnvironmentSettings>) { this.send({ type: 'environment', env }); }
  setPaused(paused: boolean) { this.send({ type: 'pause', paused }); }

  /** Estado interpolado para el instante actual de render. */
  sample(): Snapshot {
    const s = this.samples;
    if (s.length === 0) return this.out;
    if (s.length === 1 || this.clockOffset === null) return this.copy(s[s.length - 1].buf);
    // Renderizamos con un retraso de ~1,5 pasos de física para siempre tener dos muestras que interpolar.
    const t = performance.now() / 1000 + this.clockOffset - 1.5 * PHYSICS_DT;
    let a = s[0], b = s[s.length - 1];
    if (t <= a.time) return this.copy(a.buf);
    if (t >= b.time) return this.copy(b.buf);
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i].time <= t && t <= s[i + 1].time) { a = s[i]; b = s[i + 1]; break; }
    }
    const k = (t - a.time) / Math.max(b.time - a.time, 1e-6);
    return this.interpolate(a.buf, b.buf, k);
  }

  private copy(buf: Float64Array): Snapshot {
    for (let i = 0; i < SNAPSHOT_SIZE; i++) this.out[FIELDS[i]] = buf[i];
    return this.out;
  }

  private interpolate(a: Float64Array, b: Float64Array, k: number): Snapshot {
    const o = this.out;
    for (let i = 0; i < SNAPSHOT_SIZE; i++) {
      const f = FIELDS[i];
      if (DISCRETE.has(f)) o[f] = b[i];
      else if (ANGLES.has(f)) {
        let d = b[i] - a[i];
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        o[f] = a[i] + d * k;
      } else o[f] = a[i] + (b[i] - a[i]) * k;
    }
    const qa: Quat = [a[IDX.qw], a[IDX.qx], a[IDX.qy], a[IDX.qz]];
    const qb: Quat = [b[IDX.qw], b[IDX.qx], b[IDX.qy], b[IDX.qz]];
    [o.qw, o.qx, o.qy, o.qz] = qSlerp(qa, qb, k);
    return o;
  }

  dispose() { this.worker.terminate(); }
}
