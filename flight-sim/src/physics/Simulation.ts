import { computeAero, type AeroOutput } from './Aerodynamics';
import type { AircraftConfig } from './AircraftConfig';
import { isaAtmosphere, type AirState } from './Atmosphere';
import { deg2rad, gravity, LocalFrame, type Geodetic } from './geodesy';
import { computeGear, minPointHeight, type GearOutput, type GroundPlane } from './LandingGear';
import type { GearLegConfig } from './AircraftConfig';
import { approach, clamp } from './math/table';
import { add, cross, dot, invert3, mulMat3TVec, mulMat3Vec, scale, sub, type Mat3, type Vec3 } from './math/vec3';
import { qFromEuler, qFromMat3, qIntegrate, qMul, qRotate, qRotateInv, qToEuler, type Quat } from './math/quat';
import { engineForceMoment, propellerLoads, steadyOmega, stepEngine, type EngineOutput, type EngineState } from './Propulsion';
import { emptySnapshot, type Snapshot } from './snapshot';
import {
  CrashReason, defaultEnvironment, neutralControls,
  type ControlInputs, type EnvironmentSettings, type GroundReport, type InitialConditions,
} from './types';
import { WindModel } from './Wind';

export const PHYSICS_HZ = 120;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
/** Distancia al origen del marco local a partir de la cual se re-ancla (m). */
const REBASE_DISTANCE = 50_000;

interface Loads {
  forceFrame: Vec3; // N, marco sim, incluye gravedad
  momentBody: Vec3;
  specificForceBody: Vec3; // m/s², sin gravedad
  aero: AeroOutput;
  gear: GearOutput;
  skid: GearOutput;
  engines: EngineOutput[];
  air: AirState;
  geo: Geodetic;
  windFrame: Vec3;
  windLocal: Vec3;
  toLocal: Mat3;
}

/**
 * Simulación 6DOF de cuerpo rígido. TypeScript puro: corre en un Web Worker o en Node (tests).
 * Integra con paso fijo; quien la usa es responsable del acumulador de tiempo.
 */
export class Simulation {
  readonly cfg: AircraftConfig;
  private frame!: LocalFrame;
  pos: Vec3 = [0, 0, 0];
  vel: Vec3 = [0, 0, 0];
  q: Quat = [1, 0, 0, 0];
  omega: Vec3 = [0, 0, 0];
  engines: EngineState[];
  mass: number;
  private inertia: Mat3;
  private inertiaInv: Mat3;

  controls: ControlInputs = neutralControls();
  env: EnvironmentSettings = defaultEnvironment();
  /** Viento fijo opcional (NED local) que reemplaza al modelo; útil en tests. */
  windOverride: Vec3 | null = null;
  private wind = new WindModel(7);
  private ground!: GroundPlane;
  private groundReport: GroundReport | null = null;

  // Superficies reales (siguen a los comandos con su velocidad de actuación).
  elevator = 0; aileron = 0; rudder = 0; trim = 0; flapDeg = 0; gearExtension = 1;
  private prevAlpha = 0;
  private alphaDot = 0;
  time = 0;
  crashed: CrashReason = CrashReason.None;
  private last: Loads | null = null;
  private skidLegs: GearLegConfig[];

  constructor(cfg: AircraftConfig) {
    this.cfg = cfg;
    this.mass = cfg.mass.default;
    const I = cfg.mass.inertia;
    this.inertia = [I.ixx, 0, -I.ixz, 0, I.iyy, 0, -I.ixz, 0, I.izz];
    this.inertiaInv = invert3(this.inertia);
    this.engines = cfg.engines.map(() => ({ omega: 0, running: true }));
    this.skidLegs = (cfg.skidPoints ?? []).map((p, i) => ({
      name: `roce ${i}`, position: p, stiffness: 80000, damping: 6000, maxCompression: 0.25,
      steerable: false, braked: false, side: 0 as const,
    }));
  }

  // ───────────────────────── Inicialización ─────────────────────────

  reset(ic: InitialConditions): void {
    const lat = deg2rad(ic.lat), lon = deg2rad(ic.lon);
    this.frame = new LocalFrame({ lat, lon, h: 0 });
    this.crashed = CrashReason.None;
    this.time = 0;
    this.omega = [0, 0, 0];
    this.alphaDot = 0;
    this.wind = new WindModel(7);
    const yaw = deg2rad(ic.headingDeg);

    // Suelo inicial: plano horizontal a la altura indicada.
    this.setGround({ lat: ic.lat, lon: ic.lon, height: ic.onGround ? ic.height : -1e4, normalEnu: [0, 0, 1], kind: 'runway' });

    if (ic.onGround) {
      // CG a la altura en la que el tren queda con su compresión estática.
      const legs = this.cfg.gear.legs;
      const kTot = legs.reduce((s, l) => s + l.stiffness, 0);
      const staticCompression = (this.mass * 9.81) / kTot;
      const legZ = Math.max(...legs.map((l) => l.position[2]));
      this.setLocalState(lat, lon, ic.height + legZ - staticCompression, yaw, 0, 0, [0, 0, 0]);
      const takeoffTrim = this.cfg.controls.takeoffTrim ?? 0;
      this.controls = { ...neutralControls(), trim: takeoffTrim };
      this.elevator = this.aileron = this.rudder = 0;
      this.trim = takeoffTrim;
      this.flapDeg = 0;
      this.gearExtension = 1;
      const rho = isaAtmosphere(ic.height - this.env.geoidOffset, this.env.isaDeltaT).density;
      this.engines.forEach((e, i) => { e.running = true; e.omega = steadyOmega(this.cfg.engines[i], 0, 0, rho); });
    } else {
      const V = ic.airspeed ?? this.cfg.limits.vcruise;
      const trim = trimLevelFlight(this.cfg, V, ic.height - this.env.geoidOffset, this.mass, this.env.isaDeltaT);
      const vBody: Vec3 = [
        V * Math.cos(trim.alpha) * Math.cos(trim.beta), V * Math.sin(trim.beta), V * Math.sin(trim.alpha) * Math.cos(trim.beta),
      ];
      this.setLocalState(lat, lon, ic.height, yaw, trim.alpha, 0, vBody);
      this.controls = {
        ...neutralControls(), throttle: clamp(trim.throttle, 0, 1), trim: trim.trim,
        aileron: trim.aileron, rudder: trim.rudder, gearDown: !this.cfg.gear.retractable,
      };
      this.elevator = 0; this.aileron = trim.aileron; this.rudder = trim.rudder; this.trim = trim.trim; this.flapDeg = 0;
      this.gearExtension = this.cfg.gear.retractable ? 0 : 1;
      const rho = isaAtmosphere(ic.height - this.env.geoidOffset, this.env.isaDeltaT).density;
      this.engines.forEach((e, i) => { e.running = true; e.omega = steadyOmega(this.cfg.engines[i], trim.throttle, vBody[0], rho); });
    }
    this.prevAlpha = Math.atan2(this.bodyAirVelocity()[2], this.bodyAirVelocity()[0]);
    this.last = null;
  }

  /** Coloca el avión en una posición geodésica con actitud (respecto del NED local) y velocidad en cuerpo. */
  private setLocalState(lat: number, lon: number, h: number, yaw: number, pitch: number, roll: number, vBody: Vec3) {
    const qLocal = qFromEuler(yaw, pitch, roll);
    this.pos = this.frame.fromGeodetic({ lat, lon, h });
    // q_frame = R(local→frame) * q_local
    const toLocal = this.frame.originToLocalNed(lat, lon);
    const toFrame: Mat3 = [toLocal[0], toLocal[3], toLocal[6], toLocal[1], toLocal[4], toLocal[7], toLocal[2], toLocal[5], toLocal[8]];
    this.q = qMul(qFromMat3(toFrame), qLocal);
    this.vel = qRotate(this.q, vBody);
  }

  setControls(c: Partial<ControlInputs>): void {
    this.controls = { ...this.controls, ...c };
  }

  setEnvironment(e: Partial<EnvironmentSettings>): void {
    this.env = { ...this.env, ...e };
  }

  /** Recibe una muestra de terreno del hilo de render y la convierte al marco de la simulación. */
  setGround(r: GroundReport): void {
    this.groundReport = r;
    const lat = deg2rad(r.lat), lon = deg2rad(r.lon);
    const point = this.frame.fromGeodetic({ lat, lon, h: r.height });
    const [e, n, u] = r.normalEnu;
    // Normal (hacia arriba) ENU → NED local → marco
    const localNed: Vec3 = [n, e, -u];
    const toLocal = this.frame.originToLocalNed(lat, lon);
    const normal = mulMat3TVec(toLocal, localNed);
    const fixedNormal: Vec3 = dot(normal, this.frame.dirFromEcef(this.upEcef(lat, lon))) > 0 ? normal : scale(normal, -1);
    const surfaces = { runway: { rolling: 0.02, grip: 0.8 }, terrain: { rolling: 0.08, grip: 0.6 }, water: { rolling: 0.5, grip: 0.3 } };
    this.ground = { point, normal: fixedNormal, ...surfaces[r.kind], kind: r.kind };
  }

  private upEcef(lat: number, lon: number): Vec3 {
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  }

  // ───────────────────────── Dinámica ─────────────────────────

  private bodyAirVelocity(wind: Vec3 = [0, 0, 0]): Vec3 {
    return qRotateInv(this.q, sub(this.vel, wind));
  }

  /** Calcula todas las cargas para el estado actual (no integra). */
  private computeLoads(dt: number, advanceWind: boolean): Loads {
    const cfg = this.cfg;
    const geo = this.frame.toGeodetic(this.pos);
    const toLocal = this.frame.originToLocalNed(geo.lat, geo.lon);
    const altMsl = geo.h - this.env.geoidOffset;
    const air = isaAtmosphere(altMsl, this.env.isaDeltaT);
    // Ajuste por QNH: escala la presión estática y la densidad proporcionalmente.
    const qnhRatio = this.env.qnh / 101325;
    air.pressure *= qnhRatio;
    air.density *= qnhRatio;

    const groundHeight = dot(sub(this.pos, this.ground.point), this.ground.normal);
    const airspeedGuess = this.last ? this.last.aero.airspeed : Math.hypot(...this.vel);
    let windLocal: Vec3;
    if (this.windOverride) windLocal = this.windOverride;
    else if (advanceWind) windLocal = this.wind.sample(this.env, Math.max(0, groundHeight), airspeedGuess, dt);
    else windLocal = this.last?.windLocal ?? [0, 0, 0];
    const windFrame = mulMat3TVec(toLocal, windLocal);
    const vAir = this.bodyAirVelocity(windFrame);

    // Motores
    const engineOuts: EngineOutput[] = [];
    let force: Vec3 = [0, 0, 0];
    let moment: Vec3 = [0, 0, 0];
    let propwashQ = 0;
    cfg.engines.forEach((ec, i) => {
      const st = this.engines[i];
      const loads = propellerLoads(ec, st.omega, vAir[0], air.density);
      const out: EngineOutput = {
        thrust: loads.thrust, propTorque: loads.torque, engineTorque: 0, shaftPower: 0,
        rpm: (st.omega * 60) / (2 * Math.PI), slipstreamQ: Math.max(0, loads.thrust) / ((Math.PI * ec.propeller.diameter ** 2) / 4),
        advanceRatio: loads.J,
      };
      engineOuts.push(out);
      const fm = engineForceMoment(ec, out, this.omega, st.omega);
      force = add(force, fm.force);
      moment = add(moment, fm.moment);
      propwashQ += out.slipstreamQ * (cfg.engines.length === 1 ? 1 : 0.35);
    });

    const aero = computeAero(cfg, {
      vAir, omega: this.omega, rho: air.density,
      elevator: this.elevator, aileron: this.aileron, rudder: this.rudder, trim: this.trim,
      flapDeg: this.flapDeg, gearDown: this.gearExtension,
      propwashQ: propwashQ * cfg.aero.propwashOnTail,
      heightAboveGround: groundHeight, alphaDot: this.alphaDot,
    });
    force = add(force, aero.force);
    moment = add(moment, aero.moment);

    const brake = this.controls.parkingBrake ? 1 : 0;
    const gear = computeGear(
      cfg.gear.legs, deg2rad(cfg.gear.steeringDeg),
      {
        steering: this.controls.rudder,
        brakeLeft: Math.max(brake, this.controls.brakeLeft),
        brakeRight: Math.max(brake, this.controls.brakeRight),
        extension: this.gearExtension,
      },
      this.ground, this.pos, this.vel, this.q, this.omega,
    );
    force = add(force, gear.force);
    moment = add(moment, gear.moment);

    // Roces de estructura (cola, punteras): contacto rígido con mucha fricción.
    const skid = computeGear(
      this.skidLegs, 0, { steering: 0, brakeLeft: 0, brakeRight: 0, extension: 1 },
      { ...this.ground, rolling: 0.45 }, this.pos, this.vel, this.q, this.omega,
    );
    force = add(force, skid.force);
    moment = add(moment, skid.moment);

    const g = gravity(geo.lat, geo.h);
    const downFrame = mulMat3TVec(toLocal, [0, 0, 1]);
    const forceFrame = add(qRotate(this.q, force), scale(downFrame, this.mass * g));
    return {
      forceFrame, momentBody: moment, specificForceBody: scale(force, 1 / this.mass),
      aero, gear, skid, engines: engineOuts, air, geo, windFrame, windLocal, toLocal,
    };
  }

  /** Avanza la simulación un paso fijo. */
  step(dt = PHYSICS_DT): void {
    if (this.crashed !== CrashReason.None) return;
    const cfg = this.cfg;
    const c = this.controls;

    // Actuadores
    const sr = cfg.controls.surfaceRate;
    this.elevator = approach(this.elevator, clamp(c.elevator, -1, 1), sr, dt);
    this.aileron = approach(this.aileron, clamp(c.aileron, -1, 1), sr, dt);
    this.rudder = approach(this.rudder, clamp(c.rudder, -1, 1), sr, dt);
    this.trim = approach(this.trim, clamp(c.trim, -1, 1), cfg.controls.trimRate * 4, dt);
    const detents = cfg.flaps.detents;
    const flapTarget = detents[clamp(Math.round(c.flapsIndex), 0, detents.length - 1)];
    this.flapDeg = approach(this.flapDeg, flapTarget, cfg.flaps.rate, dt);
    if (cfg.gear.retractable) {
      // No se puede retraer el tren con peso sobre las ruedas.
      const wantDown = c.gearDown || (this.last?.gear.onGround ?? false);
      this.gearExtension = approach(this.gearExtension, wantDown ? 1 : 0, 1 / cfg.gear.transitTime, dt);
    }
    this.engines.forEach((e) => { e.running = c.engineRunning; });

    const L = this.computeLoads(dt, true);
    this.last = L;

    // Motores: integra la velocidad del eje
    const vAir = this.bodyAirVelocity(L.windFrame);
    cfg.engines.forEach((ec, i) => {
      stepEngine(ec, this.engines[i], c.throttle, vAir[0], L.air.density, dt);
    });

    // Traslación (Euler semi-implícito)
    const acc = scale(L.forceFrame, 1 / this.mass);
    this.vel = add(this.vel, scale(acc, dt));
    this.pos = add(this.pos, scale(this.vel, dt));

    // Rotación: I·ω̇ = M − ω × (I·ω)
    const Iw = mulMat3Vec(this.inertia, this.omega);
    const omegaDot = mulMat3Vec(this.inertiaInv, sub(L.momentBody, cross(this.omega, Iw)));
    this.omega = add(this.omega, scale(omegaDot, dt));
    this.q = qIntegrate(this.q, this.omega, dt);

    // dα/dt filtrado
    const a = L.aero.alpha;
    const rawAlphaDot = (a - this.prevAlpha) / dt;
    this.alphaDot += (clamp(rawAlphaDot, -5, 5) - this.alphaDot) * Math.min(1, dt * 20);
    this.prevAlpha = a;

    this.time += dt;
    this.checkCrash(L);
    if (Math.hypot(this.pos[0], this.pos[1]) > REBASE_DISTANCE) this.rebase();
  }

  private checkCrash(L: Loads): void {
    const cfg = this.cfg;
    if (minPointHeight(cfg.crashPoints, this.ground, this.pos, this.q) < -0.02) {
      this.crashed = CrashReason.Structure;
    } else if (L.gear.onGround && this.ground.kind === 'water') {
      this.crashed = CrashReason.Water;
    } else if (L.skid.maxImpactRate > 2.5 || L.skid.bottomedOut) {
      this.crashed = CrashReason.Structure;
    } else if (L.gear.maxImpactRate > cfg.limits.maxTouchdownSpeed) {
      this.crashed = CrashReason.HardLanding;
    } else if (L.aero.airspeed > cfg.limits.vne * 1.25) {
      this.crashed = CrashReason.Overspeed;
    } else if (!L.gear.onGround && (-L.specificForceBody[2] / 9.81 > 6.5 || -L.specificForceBody[2] / 9.81 < -3.5)) {
      this.crashed = CrashReason.Overstress;
    }
  }

  /** Re-ancla el marco local en la posición actual (conserva el estado físico exacto). */
  private rebase(): void {
    const geo = this.frame.toGeodetic(this.pos);
    const old = this.frame;
    const next = new LocalFrame({ lat: geo.lat, lon: geo.lon, h: 0 });
    const conv = (v: Vec3) => next.dirFromEcef(old.dirToEcef(v));
    this.pos = next.fromEcef(old.toEcef(this.pos));
    this.vel = conv(this.vel);
    // q_new = R(old→new) * q_old
    const ex = conv([1, 0, 0]), ey = conv([0, 1, 0]), ez = conv([0, 0, 1]);
    const R: Mat3 = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
    this.q = qMul(qFromMat3(R), this.q);
    this.frame = next;
    if (this.groundReport) this.setGround(this.groundReport);
  }

  // ───────────────────────── Salida ─────────────────────────

  geodetic(): Geodetic {
    return this.frame.toGeodetic(this.pos);
  }

  snapshot(out: Snapshot = emptySnapshot()): Snapshot {
    const L = this.last ?? this.computeLoads(0, false);
    const geo = L.geo;
    const R = L.toLocal;
    // Actitud respecto del NED local en la posición del avión
    const qLocal = qMul(qFromMat3(R), this.q);
    const [yaw, pitch, roll] = qToEuler(qLocal);
    const vLocal = mulMat3Vec(R, this.vel);
    const [p, q, r] = this.omega;
    const cosT = Math.cos(pitch);
    const rho0 = 1.225;
    const legs = L.gear.legs;

    out.time = this.time;
    out.lat = (geo.lat * 180) / Math.PI;
    out.lon = (geo.lon * 180) / Math.PI;
    out.height = geo.h;
    out.altMsl = geo.h - this.env.geoidOffset;
    const lowestGear = Math.min(
      ...this.cfg.gear.legs.map((l) => dot(sub(add(this.pos, qRotate(this.q, l.position)), this.ground.point), this.ground.normal)),
    );
    out.agl = Math.max(0, lowestGear);
    out.heading = (yaw + 2 * Math.PI) % (2 * Math.PI);
    out.pitch = pitch;
    out.roll = roll;
    [out.qw, out.qx, out.qy, out.qz] = qLocal;
    [out.vN, out.vE, out.vD] = vLocal;
    out.p = p; out.q = q; out.r = r;
    out.turnRate = Math.abs(cosT) > 1e-3 ? (q * Math.sin(roll) + r * Math.cos(roll)) / cosT : 0;
    out.tas = L.aero.airspeed;
    out.ias = Math.sqrt((2 * L.aero.qbar) / rho0) * Math.sign(this.bodyAirVelocity(L.windFrame)[0] || 1);
    out.groundSpeed = Math.hypot(vLocal[0], vLocal[1]);
    out.mach = L.aero.airspeed / L.air.speedOfSound;
    out.alpha = L.aero.alpha;
    out.beta = L.aero.beta;
    out.nx = L.specificForceBody[0] / 9.80665;
    out.ny = L.specificForceBody[1] / 9.80665;
    out.nz = -L.specificForceBody[2] / 9.80665;
    out.rpm0 = L.engines[0]?.rpm ?? 0;
    out.rpm1 = L.engines[1]?.rpm ?? 0;
    out.thrust = L.engines.reduce((s, e) => s + e.thrust, 0);
    out.power = L.engines.reduce((s, e) => s + e.propTorque * ((e.rpm * Math.PI) / 30), 0);
    out.throttle = this.controls.throttle;
    out.elevator = this.elevator;
    out.aileron = this.aileron;
    out.rudder = this.rudder;
    out.trim = this.trim;
    out.flapDeg = this.flapDeg;
    out.flapsIndex = this.controls.flapsIndex;
    out.gearExtension = this.gearExtension;
    out.brakeLeft = this.controls.parkingBrake ? 1 : this.controls.brakeLeft;
    out.brakeRight = this.controls.parkingBrake ? 1 : this.controls.brakeRight;
    out.parkingBrake = this.controls.parkingBrake ? 1 : 0;
    out.onGround = L.gear.onGround ? 1 : 0;
    out.stalled = L.aero.stalled ? 1 : 0;
    out.stallFraction = L.aero.stallFraction;
    out.crashed = this.crashed !== CrashReason.None ? 1 : 0;
    out.crashReason = this.crashed;
    out.gearContact0 = legs[0]?.contact ? 1 : 0;
    out.gearContact1 = legs[1]?.contact ? 1 : 0;
    out.gearContact2 = legs[2]?.contact ? 1 : 0;
    out.gearContact3 = legs[3]?.contact ? 1 : 0;
    [out.windN, out.windE, out.windD] = L.windLocal;
    out.staticPressure = L.air.pressure;
    out.oat = L.air.temperature;
    out.density = L.air.density;
    out.qnh = this.env.qnh;
    out.cl = L.aero.cl;
    out.qbar = L.aero.qbar;
    return out;
  }

  /** Acceso de solo lectura a la última evaluación (tests / depuración). */
  get lastLoads(): Readonly<Loads> | null {
    return this.last;
  }
}

// ───────────────────────── Trimado ─────────────────────────

export interface TrimResult {
  alpha: number;
  beta: number;
  throttle: number;
  trim: number;
  aileron: number;
  rudder: number;
  converged: boolean;
}

/** Resuelve A·x = b por eliminación gaussiana con pivoteo parcial. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let acc = M[r][n];
    for (let k = r + 1; k < n; k++) acc -= M[r][k] * x[k];
    x[r] = acc / M[r][r];
  }
  return x;
}

/**
 * Busca la condición de vuelo recto y nivelado, alas niveladas, a una velocidad y altitud dadas
 * (elevador centrado, flaps arriba): α, β, acelerador, compensador, alerón y timón que anulan
 * las seis ecuaciones de fuerzas y momentos. Newton-Raphson con jacobiano numérico sobre el modelo real.
 */
export function trimLevelFlight(
  cfg: AircraftConfig, airspeed: number, altitudeMsl: number, mass = cfg.mass.default, isaDeltaT = 0,
): TrimResult {
  const sim = new Simulation(cfg);
  sim.mass = mass;
  sim.setEnvironment({ isaDeltaT });
  sim.windOverride = [0, 0, 0];
  sim.reset({ lat: 0, lon: 0, height: -1e4, headingDeg: 0, onGround: true });
  const rho = isaAtmosphere(altitudeMsl, isaDeltaT).density;
  const W = mass * 9.81;

  type X = [number, number, number, number, number, number]; // α, β, acelerador, compensador, alerón, timón
  const residual = (x: X): number[] => {
    const [alpha, beta, throttle, trim, aileron, rudder] = x;
    sim['frame'] = new LocalFrame({ lat: 0, lon: 0, h: 0 });
    sim.pos = [0, 0, -altitudeMsl];
    sim.q = qFromEuler(0, alpha, 0);
    const vBody: Vec3 = [
      airspeed * Math.cos(alpha) * Math.cos(beta), airspeed * Math.sin(beta), airspeed * Math.sin(alpha) * Math.cos(beta),
    ];
    sim.vel = qRotate(sim.q, vBody);
    sim.omega = [0, 0, 0];
    sim.elevator = 0; sim.aileron = aileron; sim.rudder = rudder; sim.trim = trim; sim.flapDeg = 0;
    sim.gearExtension = cfg.gear.retractable ? 0 : 1;
    cfg.engines.forEach((ec, i) => { sim.engines[i].omega = steadyOmega(ec, throttle, vBody[0], rho); });
    const L = sim['computeLoads'](0, false) as Loads;
    const fb = qRotateInv(sim.q, L.forceFrame);
    const m = L.momentBody;
    const { span: b, chord: c } = cfg.geometry;
    return [fb[0] / W, fb[1] / W, fb[2] / W, m[0] / (W * b), m[1] / (W * c), m[2] / (W * b)];
  };

  let x: X = [0.05, 0, 0.6, 0, 0, 0];
  let converged = false;
  const step = [0.05, 0.05, 0.5, 0.5, 0.5, 0.5];
  for (let it = 0; it < 60; it++) {
    const f = residual(x);
    if (Math.hypot(...f) < 1e-7) { converged = true; break; }
    const J: number[][] = f.map(() => new Array(6).fill(0));
    for (let j = 0; j < 6; j++) {
      const xp = [...x] as X;
      xp[j] += 1e-5;
      const fp = residual(xp);
      for (let i = 0; i < 6; i++) J[i][j] = (fp[i] - f[i]) / 1e-5;
    }
    const dx = solveLinear(J, f);
    if (!dx) break; // mando saturado: no hay equilibrio
    x = x.map((v, i) => v - clamp(dx[i], -step[i], step[i])) as X;
    x[2] = clamp(x[2], 0, 1.2);
  }
  const [alpha, beta, throttle, trim, aileron, rudder] = x;
  return { alpha, beta, throttle, trim, aileron, rudder, converged: converged && throttle <= 1 };
}
