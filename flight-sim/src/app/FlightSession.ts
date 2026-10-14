import * as Cesium from 'cesium';
import { validateAircraftConfig, type AircraftConfig } from '../physics/AircraftConfig';
import type { Snapshot } from '../physics/snapshot';
import { defaultEnvironment, type EnvironmentSettings, type InitialConditions } from '../physics/types';
import { InputManager } from '../input/InputManager';
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
  paused = false;
  private lastFrame = performance.now();
  private lastProbe = 0;
  private lastUi = 0;
  private crashShown = false;
  private current: Snapshot | null = null;

  constructor(private container: HTMLElement, private opts: SessionOptions) {
    this.overlay = new Overlay(container);
    this.overlay.onRestart(() => this.reset());
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
    this.world.viewer.clock.currentTime = Cesium.JulianDate.now();
    this.world.viewer.clock.shouldAnimate = true;

    this.overlay.setLoading('Cargando aeropuertos y aeronave…');
    const [airports, cfg] = await Promise.all([loadAirports(), loadAircraftConfig(this.opts.aircraft)]);
    this.cfg = cfg;
    this.input.flapDetents = cfg.flaps.detents.length;
    this.input.sync({ trim: cfg.controls.takeoffTrim ?? 0 });
    const airport = findAirport(airports, this.opts.airport);
    if (!airport) throw new Error(`Aeropuerto ${this.opts.airport} no encontrado`);
    this.airport = airport;
    this.runway = this.pickRunway(airport, this.opts.runwayEnd);
    if (this.opts.localHour !== undefined) this.setLocalSolarTime(this.opts.localHour);

    this.aircraft = new AircraftEntity(this.world.scene);
    await this.aircraft.load(`${import.meta.env.BASE_URL}${cfg.model}`);
    this.probe = new GroundProbe(this.world, airports);
    this.probe.exclude = [this.aircraft.model];

    this.overlay.setLoading(`Midiendo la pista ${this.runway.le.ident}/${this.runway.he.ident} de ${airport.ident}…`);
    const surface = await this.probe.measureRunway(this.runway);
    const end = this.startEnd();
    const lineUp = lineUpPoint(this.runway, end);
    const height = this.probe.runwayHeightAt(this.runway, lineUp.lat, lineUp.lon) ?? surface.hLe;
    const fieldElevation = this.runway[end].elevation ?? airport.elevation;
    // Ondulación del geoide ≈ altura elipsoidal medida − elevación publicada (MSL).
    const thresholdH = end === 'le' ? surface.hLe : surface.hHe;
    const geoid = thresholdH - fieldElevation;
    this.env.geoidOffset = Math.abs(geoid) < 120 ? geoid : 0;
    this.initial = { lat: lineUp.lat, lon: lineUp.lon, height, headingDeg: lineUp.heading, onGround: true };

    // Cámaras: la torre se ubica al costado del punto medio de la pista.
    this.cameras = new Cameras(this.world.scene, this.aircraft, cfg.geometry.pilotEye);
    const mid = { lat: (this.runway.le.lat + this.runway.he.lat) / 2, lon: (this.runway.le.lon + this.runway.he.lon) / 2 };
    const side = ((this.runway.le.heading + 90) * Math.PI) / 180;
    const offset = Math.max(180, this.runway.width * 4);
    this.cameras.setTowerLocation(
      mid.lat + (Math.cos(side) * offset) / 111_320,
      mid.lon + (Math.sin(side) * offset) / (111_320 * Math.cos((mid.lat * Math.PI) / 180)),
      height + 30,
    );
    this.cameras.setMode(this.opts.camera ?? 'orbit');

    this.overlay.setLoading('Iniciando la física…');
    await this.physics.init(cfg, this.initial, this.env);
    this.physics.setPaused(true);

    // Posicionamos todo una vez para que los tiles empiecen a cargar en el lugar correcto.
    const first = this.physics.sample();
    this.aircraft.update(first, 0);
    this.cameras.update(first);

    this.world.scene.preUpdate.addEventListener(() => this.frame());
    this.bindVisibility();

    this.overlay.setLoading('Cargando terreno…');
    await this.waitForTiles(12_000);
    this.overlay.setLoading(null);
    this.physics.setPaused(false);
    this.overlay.notify(`${airport.name} (${airport.ident}) — pista ${this.runway[end].ident}. F10 o ? para ver los controles.`, 6000);

    (window as unknown as Record<string, unknown>).__sim = this;
  }

  /** Fija la hora solar local en la posición del aeropuerto (hoy). */
  setLocalSolarTime(hour: number) {
    const now = new Date();
    const utcHours = hour - this.airport.lon / 15;
    const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + utcHours * 3600_000;
    this.world.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(d));
  }

  private pickRunway(a: Airport, endIdent?: string): Runway {
    if (endIdent) {
      const r = a.runways.find((rw) => rw.le.ident === endIdent || rw.he.ident === endIdent);
      if (r) return r;
    }
    return mainRunway(a);
  }

  private startEnd(): 'le' | 'he' {
    return this.opts.runwayEnd && this.runway.he.ident === this.opts.runwayEnd ? 'he' : 'le';
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

    if (now - this.lastUi > 80) {
      this.lastUi = now;
      this.overlay.update(s, this.cameras.mode, this.cfg.flaps.detents);
    }
    if (s.crashed && !this.crashShown) {
      this.crashShown = true;
      this.overlay.showCrash(s.crashReason);
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
      case 'hud': this.overlay.toggleStrip(); break;
      case 'help': this.overlay.toggleHelp(); break;
    }
  }

  get state(): Snapshot | null {
    return this.current;
  }
}
