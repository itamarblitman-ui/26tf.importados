import type { Mat3, Vec3 } from './vec3';

/** Cuaternión [w, x, y, z]. Convención: rota vectores del cuerpo al marco de referencia. */
export type Quat = [number, number, number, number];

export const qIdentity = (): Quat => [1, 0, 0, 0];

export const qMul = (a: Quat, b: Quat): Quat => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

export const qNormalize = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};

export const qConj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]];

/** Rota v por q (cuerpo → referencia). */
export const qRotate = (q: Quat, v: Vec3): Vec3 => {
  const [w, x, y, z] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
};

/** Rota v por la inversa de q (referencia → cuerpo). */
export const qRotateInv = (q: Quat, v: Vec3): Vec3 => qRotate(qConj(q), v);

/** Integra la orientación con velocidad angular en ejes cuerpo (exacto para ω constante). */
export const qIntegrate = (q: Quat, omegaBody: Vec3, dt: number): Quat => {
  const wx = omegaBody[0], wy = omegaBody[1], wz = omegaBody[2];
  const mag = Math.hypot(wx, wy, wz);
  if (mag < 1e-12) return q;
  const half = 0.5 * mag * dt;
  const s = Math.sin(half) / mag;
  const dq: Quat = [Math.cos(half), wx * s, wy * s, wz * s];
  return qNormalize(qMul(q, dq));
};

/**
 * Cuaternión desde ángulos de Euler aeronáuticos (yaw ψ, pitch θ, roll φ),
 * secuencia Z-Y-X, rotando del cuerpo al marco NED local.
 */
export const qFromEuler = (yaw: number, pitch: number, roll: number): Quat => {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ];
};

/** Ángulos de Euler [yaw, pitch, roll] desde cuaternión cuerpo→NED. */
export const qToEuler = (q: Quat): Vec3 => {
  const [w, x, y, z] = q;
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const sinp = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const pitch = Math.asin(sinp);
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [yaw, pitch, roll];
};

/** Matriz de rotación (fila-mayor) equivalente a q. */
export const qToMat3 = (q: Quat): Mat3 => {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
};

/** Cuaternión desde matriz de rotación (fila-mayor). */
export const qFromMat3 = (m: Mat3): Quat => {
  const tr = m[0] + m[4] + m[8];
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [0.25 * s, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = [(m[7] - m[5]) / s, 0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s];
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = [(m[2] - m[6]) / s, (m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s];
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s];
  }
  return qNormalize(q);
};

export const qSlerp = (a: Quat, b: Quat, t: number): Quat => {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (cos < 0) { cos = -cos; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (cos > 0.9995) {
    return qNormalize([
      a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t,
      a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t,
    ]);
  }
  const th = Math.acos(cos), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
};
