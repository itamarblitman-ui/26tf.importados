import type { GearLegConfig } from './AircraftConfig';
import { add, cross, dot, scale, sub, type Vec3 } from './math/vec3';
import { qRotate, qRotateInv, type Quat } from './math/quat';

/** Plano de suelo local en el marco de la simulación. */
export interface GroundPlane {
  /** Un punto del plano (marco NED de origen). */
  point: Vec3;
  /** Normal unitaria hacia arriba (marco NED de origen). */
  normal: Vec3;
  /** Coeficiente de fricción de rodadura de la superficie. */
  rolling: number;
  /** Fricción lateral/de frenado máxima (µ). */
  grip: number;
  kind: 'runway' | 'terrain' | 'water';
}

export interface GearInputs {
  /** -1..1, timón (nariz a la derecha +) */
  steering: number;
  brakeLeft: number;
  brakeRight: number;
  /** 0..1 */
  extension: number;
}

export interface LegResult {
  compression: number;
  /** Fuerza normal (N) */
  normalForce: number;
  /** Velocidad de compresión (m/s, + comprimiendo) */
  compressionRate: number;
  contact: boolean;
}

export interface GearOutput {
  force: Vec3; // cuerpo
  moment: Vec3; // cuerpo
  legs: LegResult[];
  /** Velocidad de compresión máxima de esta muestra (m/s) */
  maxImpactRate: number;
  /** Alguna pata superó su carrera máxima */
  bottomedOut: boolean;
  onGround: boolean;
}

/** Fricción suavizada: evita el chattering numérico alrededor de velocidad cero. */
const smoothSign = (v: number, vs: number) => Math.tanh(v / vs);

/**
 * Modelo de tren tipo resorte-amortiguador por pata, con fricción de rodadura, lateral y frenos.
 * @param pos posición del CG (marco sim), vel velocidad del CG (marco sim), q actitud cuerpo→sim, omega en cuerpo.
 */
export function computeGear(
  legs: GearLegConfig[], steeringMaxRad: number, inputs: GearInputs, ground: GroundPlane,
  pos: Vec3, vel: Vec3, q: Quat, omega: Vec3,
): GearOutput {
  const force: Vec3 = [0, 0, 0];
  const moment: Vec3 = [0, 0, 0];
  const results: LegResult[] = [];
  let maxImpactRate = 0, bottomedOut = false, onGround = false;
  const nBody = qRotateInv(q, ground.normal);

  for (const leg of legs) {
    // Con el tren retraído no hay contacto por las ruedas (sí por los puntos de choque).
    if (inputs.extension < 0.99) { results.push({ compression: 0, normalForce: 0, compressionRate: 0, contact: false }); continue; }
    const rWorld = qRotate(q, leg.position);
    const pWorld = add(pos, rWorld);
    const height = dot(sub(pWorld, ground.point), ground.normal);
    if (height >= 0) { results.push({ compression: 0, normalForce: 0, compressionRate: 0, contact: false }); continue; }

    const compression = -height;
    // Velocidad del punto de contacto: v + ω × r
    const vPointBody = add(qRotateInv(q, vel), cross(omega, leg.position));
    const vn = dot(vPointBody, nBody);
    const compressionRate = -vn;
    maxImpactRate = Math.max(maxImpactRate, compressionRate);
    if (compression > leg.maxCompression) bottomedOut = true;
    onGround = true;

    // Fuerza normal (sólo empuja). Endurecimiento progresivo cerca del final de carrera.
    const progressive = compression > leg.maxCompression ? (compression - leg.maxCompression) * leg.stiffness * 8 : 0;
    const N = Math.max(0, leg.stiffness * compression + leg.damping * compressionRate + progressive);

    // Ejes de la rueda sobre el plano del suelo (en cuerpo).
    const steer = leg.steerable ? inputs.steering * steeringMaxRad : 0;
    const heading: Vec3 = [Math.cos(steer), Math.sin(steer), 0];
    // Proyecta la dirección de rodadura sobre el plano del suelo.
    let fwd = sub(heading, scale(nBody, dot(heading, nBody)));
    const fl = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
    fwd = scale(fwd, 1 / fl);
    const side = cross(nBody, fwd); // apunta a la izquierda de la rueda… usamos signo explícito abajo
    const vLong = dot(vPointBody, fwd);
    const vSide = dot(vPointBody, side);

    const brake = leg.braked ? (leg.side < 0 ? inputs.brakeLeft : leg.side > 0 ? inputs.brakeRight : 0.5 * (inputs.brakeLeft + inputs.brakeRight)) : 0;
    const muLong = Math.min(ground.grip, ground.rolling + brake * ground.grip * 0.85);
    const fLong = -muLong * N * smoothSign(vLong, 0.15);
    const fSide = -ground.grip * N * smoothSign(vSide, 0.08);

    const f: Vec3 = add(add(scale(nBody, N), scale(fwd, fLong)), scale(side, fSide));
    // Punto de aplicación: contacto real (posición de la pata desplazada por la compresión).
    const contactPoint = sub(leg.position, scale(nBody, -compression));
    force[0] += f[0]; force[1] += f[1]; force[2] += f[2];
    const m = cross(contactPoint, f);
    moment[0] += m[0]; moment[1] += m[1]; moment[2] += m[2];
    results.push({ compression, normalForce: N, compressionRate, contact: true });
  }
  return { force, moment, legs: results, maxImpactRate, bottomedOut, onGround };
}

/** Altura mínima (m) de un conjunto de puntos del cuerpo sobre el plano de suelo. */
export function minPointHeight(points: Vec3[], ground: GroundPlane, pos: Vec3, q: Quat): number {
  let min = Infinity;
  for (const p of points) {
    const h = dot(sub(add(pos, qRotate(q, p)), ground.point), ground.normal);
    if (h < min) min = h;
  }
  return min;
}
