import * as Cesium from 'cesium';
import { validateAircraftConfig, type AircraftConfig } from '../physics/AircraftConfig';
import type { Snapshot } from '../physics/snapshot';
import { defaultEnvironment, type EnvironmentSettings, type InitialConditions } from '../physics/types';
import { EngineSound } from '../audio/EngineSound';
import { InputManager } from '../input/InputManager';
import { Panel } from '../instruments/Panel';
import { Hud } from '../ui/Hud';
import { AirportPicker } from '../ui/AirportPicker';
import { AutopilotPanel, type ApCommand } from '../ui/AutopilotPanel';
import { WeatherPanel } from '../ui/WeatherPanel';
import { Environment } from '../world/Environment';
import { localSolarHour } from '../world/sun';
import { defaultWeather, toPhysicsEnvironment, windText, type WeatherSettings } from './weather';
import { Overlay } from '../ui/Overlay';
import { AircraftEntity } from '../world/AircraftEntity';
import { findAirport, lineUpPoint, loadAirports, mainRunway, type Airport, type Runway } from '../world/airports';
import { Cameras, type CameraMode } from '../world/Cameras';
import { createWorld, readKeys, type SceneryMode, type World } from '../world/Globe';
import { GroundProbe } from '../world/GroundProbe';
import { PhysicsClient } from './PhysicsClient';

export interface SessionOptions {
  airport: string;
  /** Identificador de cabecera (p. ej. "13"); por defecto, la primera de la pista principal */
  runwayEnd?: string;
  aircraft: string;
  scenery: SceneryMode;
  camera?: CameraMode;
  /** Hora solar local (0-24). Si no se indica, se usa la hora real. */
  localHour?: number;
  weather?: Partial<WeatherSettings>;
}

export async function loadAircraftConfig(id: string): Promise<AircraftConfig> {
  const r = await fetch(`${import.meta.env.BASE_URL}aircraft/${id}.json`);
  if (!r.ok) throw new Error(`No se encontró la aeronave "${id}"`);
  return validateAircraftConfig(await r.json());
}

/**
 * Orquesta una sesión de vuelo: mundo (Cesium), física (worker), entrada, cámaras y UI.
 * El render de Cesium marca el ritmo del frame; la física corre independiente en su worker.
 */
export class FlightSession {
  world!: World;
  physics = new PhysicsClient();
  input = new InputManager();
  overlay: Overlay;
  aircraft!: AircraftEntity;
  cameras!: Cameras;
  probe!: GroundProbe;
  cfg!: AircraftConfig;
  airport!: Airport;
  runway!: Runway;
  initial!: InitialConditions;
  env: EnvironmentSettings = defaultEnvironment();
  airports: Airport[] = [];
  environment!: Environment;
  weatherPanel!: WeatherPanel;
  picker!: AirportPicker;
  weather: WeatherSettings = defaultWeather();
  private relocating = false;
  apPanel!: AutopilotPanel;
  private lastApDisconnects = 0;
  /** Se llama cuando el usuario pide volver al menú inicial (Esc). */
  onExitToMenu: (() => void) | null = null;
  panel!: Panel;
  hud!: Hud;
  sound = new EngineSound();
  /** Preferencia de tablero por tipo de vista */
  private panelPref = { cockpit: true, external: false };
  paused = false;
  private lastFrame = performance.now();
  private lastProbe = 0;
  private lastUi = 0;
  private crashShown = false;
  private current: Snapshot | null = null;

  constructor(private container: HTMLElement, private opts: SessionOptions) {
    this.overlay = new Overlay(container);
    this.overlay.onRestart(() => this.reset());
    this.overlay.onPickAirport(() => void this.openPicker());
    this.physics.onError = (m) => this.overlay.notify(`Error de física: ${m}`, 6000);
  }

  async start(): Promise<void> {
    const keys = readKeys();
    const globeEl = document.createElement('div');
    globeEl.className = 'globe';
    this.container.prepend(globeEl);

    this.overlay.setLoading('Creando el mundo…');
    this.world = await createWorld(globeEl, { mode: this.opts.scenery, ...keys });
    if (this.world.mode !== this.opts.scenery) {
      this.overlay.notify('Sin CESIUM_ION_TOKEN: modo sin conexión (sin terreno ni edificios). Ver README.', 8000);
    }

    this.overlay.setLoading('Cargando aeropuertos y aeronave…');
    const [airports, cfg] = await Promise.all([loadAirports(), loadAircraftConfig(this.opts.aircraft)]);
    this.airports = airports;
    this.cfg = cfg;
    this.input.flapDetents = cfg.flaps.detents.length;
    this.input.sync({ trim: cfg.controls.takeoffTrim ?? 0 });

    this.aircraft = new AircraftEntity(this.world.scene);
    await this.aircraft.load(`${import.meta.env.BASE_URL}${cfg.model}`);
    this.aircraft.setupLights(cfg.lights);
    this.aircraft.rotations = cfg.engines.map((e) => e.rotation);
    this.probe = new GroundProbe(this.world, airports);
    this.probe.exclude = [this.aircraft.model];

    // Clima y hora
    if (this.opts.localHour !== undefined) this.weather = { ...this.weather, timeMode: 'fixed', localHour: this.opts.localHour };
    if (this.opts.weather) this.weather = { ...this.weather, ...this.opts.weather };
    this.environment = new Environment(this.world, this.weather);
    this.weatherPanel = new WeatherPanel(this.container, this.weather);
    this.weatherPanel.onChange = (w, timeChanged) => this.applyWeather(w, timeChanged);
    this.picker = new AirportPicker(this.container);
    this.apPanel = new AutopilotPanel(this.container);
    this.apPanel.onCommand = (c) => this.autopilotCommand(c);
    Object.assign(this.env, toPhysicsEnvironment(this.weather));

    this.cameras = new Cameras(this.world.scene, this.aircraft, cfg.geometry.pilotEye);
    this.panel = new Panel(this.container, cfg);
    this.hud = new Hud(this.container);
    this.sound.stallWarnAlpha = ((cfg.aero.stallAlphaDeg - 3) * Math.PI) / 180;
    this.cameras.onModeChange = () => this.applyPanelLayout();
    this.cameras.setMode(this.opts.camera ?? 'orbit');
    this.bindAudioUnlock();

    this.overlay.setLoading('Iniciando la física…');
    const start = await this.prepareStart(this.opts.airport, this.opts.runwayEnd);
    await this.physics.init(cfg, this.initial, this.env);
    this.physics.setPaused(true);
    this.environment.setTime(this.weather, this.airport.lon);

    this.world.scene.preUpdate.addEventListener(() => this.frame());
    this.bindVisibility();
    await this.finishPlacement(start);
    (window as unknown as Record<string, unknown>).__sim = this;
  }

  /**
   * Calcula el punto de partida en una cabecera: mide la pista, estima la ondulación del geoide y
   * ubica la cámara de torre. No toca la física.
   */
  private async prepareStart(ident: string, runwayEnd?: string) {
    const airport = findAirport(this.airports, ident);
    if (!airport) throw new Error(`Aeropuerto ${ident} no encontrado`);
    this.airport = airport;
    this.runway = this.pickRunway(airport, runwayEnd);
    const end: 'le' | 'he' = runwayEnd && this.runway.he.ident === runwayEnd ? 'he' : 'le';

    this.overlay.setLoading(`Midiendo la pista ${this.runway[end].ident} de ${airport.ident}…`);
    const surface = await this.probe.measureRunway(this.runway);
    const lineUp = lineUpPoint(this.runway, end);
    const height = this.probe.runwayHeightAt(this.runway, lineUp.lat, lineUp.lon) ?? surface.hLe;
    const fieldElevation = this.runway[end].elevation ?? airport.elevation;
    // Ondulación del geoide ≈ altura elipsoidal medida − elevación publicada (MSL).
    // Sin terreno real (modo sin conexión) el suelo es el elipsoide: la diferencia es toda la elevación.
    const geoid = (end === 'le' ? surface.hLe : surface.hHe) - fieldElevation;
    this.env.geoidOffset = !this.world.hasTerrain || Math.abs(geoid) < 120 ? geoid : 0;
    this.initial = { lat: lineUp.lat, lon: lineUp.lon, height, headingDeg: lineUp.heading, onGround: true };

    // Torre al costado del punto medio de la pista
    const mid = { lat: (this.runway.le.lat + this.runway.he.lat) / 2, lon: (this.runway.le.lon + this.runway.he.lon) / 2 };
    const side = ((this.runway.le.heading + 90) * Math.PI) / 180;
    const offset = Math.max(180, this.runway.width * 4);
    this.cameras.setTowerLocation(
      mid.lat + (Math.cos(side) * offset) / 111_320,
      mid.lon + (Math.sin(side) * offset) / (111_320 * Math.cos((mid.lat * Math.PI) / 180)),
      height + 30,
    );
    return { airport, end };
  }

  /** Muestra el avión en el nuevo lugar, espera los tiles y libera la física. */
  private async finishPlacement({ airport, end }: { airport: Airport; end: 'le' | 'he' }) {
    const first = this.physics.sample();
    this.aircraft.update(first, 0);
    this.cameras.update(first);
    this.overlay.setLoading('Cargando terreno…');
    await this.waitForTiles(12_000);
    this.overlay.setLoading(null);
    this.physics.setPaused(this.paused);
    this.overlay.notify(`${airport.name} (${airport.ident}) — pista ${this.runway[end].ident}. F10 o ? para ver los controles.`, 6000);
  }

  /** Traslada el avión a otro aeropuerto/cabecera sin recargar la página. */
  async relocate(ident: string, runwayEnd?: string) {
    this.physics.setPaused(true);
    this.relocating = true;
    try {
      const start = await this.prepareStart(ident, runwayEnd);
      this.physics.setEnvironment({ geoidOffset: this.env.geoidOffset });
      this.reset();
      this.physics.setPaused(true);
      if (this.weather.timeMode === 'fixed') this.environment.setTime(this.weather, this.airport.lon);
      // Esperamos a que llegue el estado reiniciado antes de posicionar cámaras
      await new Promise((r) => setTimeout(r, 120));
      await this.finishPlacement(start);
    } catch (e) {
      this.overlay.setLoading(null);
      this.overlay.notify(`No se pudo trasladar: ${e instanceof Error ? e.message : e}`, 6000);
      this.physics.setPaused(this.paused);
    } finally {
      this.relocating = false;
    }
  }

  async openPicker() {
    if (this.picker.isOpen) return;
    const s = this.current;
    const wasPaused = this.paused;
    if (!wasPaused) this.togglePause();
    const pick = await this.picker.open(this.airports, s?.lat ?? this.airport.lat, s?.lon ?? this.airport.lon);
    if (pick) {
      if (this.paused) this.togglePause();
      await this.relocate(pick.airport.ident, pick.runwayEnd);
    } else if (!wasPaused && this.paused) this.togglePause();
  }

  private applyWeather(w: WeatherSettings, timeChanged: boolean) {
    this.weather = w;
    this.environment.apply(w);
    const env = toPhysicsEnvironment(w);
    Object.assign(this.env, env);
    this.physics.setEnvironment(env);
    if (timeChanged) this.environment.setTime(w, this.current?.lon ?? this.airport.lon);
  }

  private pickRunway(a: Airport, endIdent?: string): Runway {
    if (endIdent) {
      const r = a.runways.find((rw) => rw.le.ident === endIdent || rw.he.ident === endIdent);
      if (r) return r;
    }
    return mainRunway(a);
  }

  private waitForTiles(timeout: number): Promise<void> {
    const scene = this.world.scene;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        const tilesOk = scene.globe.tilesLoaded && (!this.world.tileset || this.world.tileset.tilesLoaded);
        if (tilesOk || performance.now() - t0 > timeout) resolve();
        else setTimeout(check, 200);
      };
      setTimeout(check, 500);
    });
  }

  private applyPanelLayout() {
    const cockpit = this.cameras.mode === 'cockpit';
    const show = cockpit ? this.panelPref.cockpit : this.panelPref.external;
    this.panel.setLayout(show ? (cockpit ? 'cockpit' : 'compact') : 'hidden');
  }

  /** Los navegadores sólo permiten audio después de un gesto del usuario. */
  private bindAudioUnlock() {
    const unlock = () => {
      void this.sound.start();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  private bindVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.paused) this.togglePause();
    });
  }

  togglePause() {
    this.paused = !this.paused;
    this.physics.setPaused(this.paused);
    this.overlay.setPaused(this.paused);
  }

  reset() {
    this.physics.reset(this.initial);
    this.input.sync({
      throttle: 0, flapsIndex: 0, trim: this.cfg.controls.takeoffTrim ?? 0, parkingBrake: false, gearDown: true, engineRunning: true,
      engineOn: [], autopilot: { ...this.input.controls.autopilot, engaged: false, session: this.input.controls.autopilot.session + 1 },
    });
    this.crashShown = false;
    this.overlay.showCrash(null);
    if (this.paused) this.togglePause();
  }

  /** Se ejecuta en cada frame de render (antes de actualizar las primitivas de Cesium). */
  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.25);
    this.lastFrame = now;

    const { controls, actions, look } = this.input.update(dt);
    for (const a of actions) this.handleAction(a);
    if (!this.paused) this.physics.setControls(controls);
    this.cameras.pan(look.yaw, look.pitch);

    const s = this.physics.sample();
    this.current = s;
    this.aircraft.update(s, this.paused ? 0 : dt);
    this.cameras.update(s);

    // Suelo para la física (~15 Hz)
    if (now - this.lastProbe > 66) {
      this.lastProbe = now;
      const g = this.probe.sample(s.lat, s.lon, s.agl);
      if (g) this.physics.setGround(g);
    }

    this.environment.update(s.lat, s.lon, s.altMsl);
    this.aircraft.navLightsOn = this.environment.sunElevationDeg < 6;
    this.aircraft.setDaylight(this.environment.daylight);
    const cockpit = this.cameras.mode === 'cockpit';
    const ap = this.input.controls.autopilot;
    // La física puede desconectar el automático (intervención del piloto, pérdida, tierra)
    if (s.apDisconnects !== this.lastApDisconnects) {
      this.lastApDisconnects = s.apDisconnects;
      if (ap.engaged) {
        this.input.controls.autopilot = { ...ap, engaged: false };
        this.sound.apDisconnect();
        this.overlay.notify('Piloto automático desconectado', 2500);
      }
    }
    this.panel.headingBug = ap.hdgHold ? ap.heading : null;
    this.panel.update(s, this.paused ? 0 : dt);
    const lookNow = this.cameras.lookAngles;
    this.hud.update(s, cockpit, this.cameras.verticalFov, lookNow.yaw, lookNow.pitch,
      this.panel.layout === 'cockpit' ? this.panel.cockpitHeight : 0);
    const camDist = Cesium.Cartesian3.distance(this.world.scene.camera.positionWC, this.aircraft.position);
    this.sound.update(s, cockpit ? 'cockpit' : 'external', camDist, this.paused);

    if (now - this.lastUi > 80) {
      this.lastUi = now;
      this.overlay.update(s, this.cameras.mode, this.cfg.flaps.detents, windText(this.weather));
      this.apPanel.update(this.input.controls.autopilot, s.apEngaged === 1);
      this.apPanel.bottomOffset = this.panel.layout === 'cockpit' ? this.panel.cockpitHeight : this.panel.layout === 'compact' ? 0 : 0;
      if (this.weatherPanel.visible) this.weatherPanel.showHour(localSolarHour(this.environment.currentDate(), s.lon));
    }
    if (s.crashed && !this.crashShown && !this.relocating) {
      this.crashShown = true;
      this.overlay.showCrash(s.crashReason, { ias: s.ias, vs: -s.vD, nz: s.nz });
      if (this.cameras.mode === 'cockpit') this.cameras.setMode('orbit');
    }
  }

  private handleAction(a: string) {
    switch (a) {
      case 'camera': this.cameras.next(); break;
      case 'cameraCockpit': this.cameras.setMode('cockpit'); break;
      case 'cameraOrbit': this.cameras.setMode('orbit'); break;
      case 'cameraTower': this.cameras.setMode('tower'); break;
      case 'pause': this.togglePause(); break;
      case 'reset': this.reset(); break;
      case 'hud': this.hud.toggle(); break;
      case 'strip': this.overlay.toggleStrip(); break;
      case 'panel': {
        const key = this.cameras.mode === 'cockpit' ? 'cockpit' : 'external';
        this.panelPref[key] = !this.panelPref[key];
        this.applyPanelLayout();
        break;
      }
      case 'sound':
        this.sound.setMuted(!this.sound.muted);
        this.overlay.notify(this.sound.muted ? 'Sonido desactivado' : 'Sonido activado', 1200);
        break;
      case 'kollsmanUp': this.panel.model.adjustKollsman(1); this.notifyKollsman(); break;
      case 'kollsmanDown': this.panel.model.adjustKollsman(-1); this.notifyKollsman(); break;
      case 'help': this.overlay.toggleHelp(); break;
      case 'weather': this.weatherPanel.toggle(); break;
      case 'menu':
        if (this.picker.isOpen) break;
        if (this.onExitToMenu && confirm('¿Volver al menú inicial? Se pierde el vuelo actual.')) this.onExitToMenu();
        break;
      case 'airports': void this.openPicker(); break;
      default:
        if (a.startsWith('ap:')) this.autopilotCommand(a.slice(3) as ApCommand);
    }
  }

  /** Comandos del piloto automático (teclado o botones). */
  autopilotCommand(c: ApCommand) {
    const s = this.current;
    const ap = { ...this.input.controls.autopilot };
    const FT = 0.3048, KT = 0.514444;
    const capture = () => {
      if (!s) return;
      ap.heading = Math.round(((s.heading * 180) / Math.PI + 360) % 360);
      ap.altitude = Math.round((s.altMsl / FT) / 100) * 100 * FT;
      ap.speed = Math.round((s.ias / KT) / 5) * 5 * KT;
    };
    switch (c) {
      case 'toggle':
        if (ap.engaged) { ap.engaged = false; this.sound.apDisconnect(); break; }
        if (s?.onGround) { this.overlay.notify('El piloto automático sólo se conecta en vuelo', 2500); return; }
        capture();
        ap.engaged = true;
        ap.session++;
        if (!ap.hdgHold && !ap.altHold) { ap.hdgHold = true; ap.altHold = true; }
        break;
      case 'hdg': ap.hdgHold = !ap.hdgHold; if (ap.hdgHold && s && !ap.engaged) capture(); break;
      case 'alt': ap.altHold = !ap.altHold; if (ap.altHold && s && !ap.engaged) capture(); break;
      case 'spd':
        ap.spdHold = !ap.spdHold;
        if (ap.spdHold && s) ap.speed = Math.round((s.ias / KT) / 5) * 5 * KT;
        // Al soltar el control de velocidad, el acelerador vuelve a la posición en la que quedó
        if (!ap.spdHold && s) this.input.controls.throttle = s.throttle;
        break;
      case 'hdg+': ap.heading = (ap.heading + 5) % 360; break;
      case 'hdg-': ap.heading = (ap.heading + 355) % 360; break;
      case 'alt+': ap.altitude += 100 * FT; break;
      case 'alt-': ap.altitude = Math.max(0, ap.altitude - 100 * FT); break;
      case 'spd+': ap.speed += 5 * KT; break;
      case 'spd-': ap.speed = Math.max(20 * KT, ap.speed - 5 * KT); break;
    }
    this.input.controls.autopilot = ap;
  }

  private notifyKollsman() {
    this.overlay.notify(`Altímetro: ${this.panel.model.r.kollsman.toFixed(0)} hPa`, 1200);
  }

  get state(): Snapshot | null {
    return this.current;
  }
}
