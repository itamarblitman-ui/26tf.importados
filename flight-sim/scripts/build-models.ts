/**
 * Genera los modelos 3D originales (low-poly) de las aeronaves en public/models/.
 * Uso: npm run build:models
 *
 * Todo se modela en ejes cuerpo (x adelante, y derecha, z abajo; origen en el CG) con las mismas
 * cotas que usa el JSON de la física, así las ruedas del modelo coinciden con el tren simulado.
 * Nodos con nombre fijo que anima la app: propeller, propdisc, aileron_l, aileron_r, flap_l, flap_r,
 * elevator, rudder (y gear_* para trenes retráctiles).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGlb, MeshBuilder, type Material, type NodeDef, type V3 } from './lib/glb';

const OUT = resolve(import.meta.dirname, '../public/models');

/** Sección octogonal de fuselaje (ancho w, alto h, centro vertical zc) en la estación x. */
function octSection(x: number, w: number, h: number, zc: number, bevel = 0.3): V3[] {
  const hw = w / 2, hh = h / 2, bw = hw * (1 - bevel), bh = hh * (1 - bevel);
  return [
    [x, -bw, zc - hh], [x, bw, zc - hh], [x, hw, zc - bh], [x, hw, zc + bh],
    [x, bw, zc + hh], [x, -bw, zc + hh], [x, -hw, zc + bh], [x, -hw, zc - bh],
  ];
}

function loft(mb: MeshBuilder, mat: string, stations: [number, number, number, number][], capEnds = true) {
  const rings = stations.map(([x, w, h, zc]) => octSection(x, w, h, zc));
  for (let i = 0; i < rings.length - 1; i++) mb.bridge(mat, rings[i], rings[i + 1]);
  if (capEnds) { mb.cap(mat, rings[0]); mb.cap(mat, rings[rings.length - 1]); }
}

/** Perfil alar simplificado (hexágono) en el plano x-z para una estación y. */
function airfoil(y: number, xLe: number, chord: number, z: number, t: number): V3[] {
  const xTe = xLe - chord;
  return [
    [xLe, y, z], [xLe - chord * 0.25, y, z - t * 0.75], [xLe - chord * 0.6, y, z - t * 0.55],
    [xTe, y, z - t * 0.05], [xLe - chord * 0.6, y, z + t * 0.12], [xLe - chord * 0.25, y, z + t * 0.2],
  ];
}

/** Panel de superficie (ala, estabilizador) entre dos estaciones. */
function panel(mb: MeshBuilder, mat: string, y0: number, y1: number, le0: number, c0: number, le1: number, c1: number,
  z0: number, z1: number, t0: number, t1: number) {
  const a = airfoil(y0, le0, c0, z0, t0), b = airfoil(y1, le1, c1, z1, t1);
  mb.bridge(mat, a, b);
  mb.cap(mat, a);
  mb.cap(mat, b);
}

/** Superficie de control: placa en cuña con charnela en x = hinge. */
function controlSurface(mb: MeshBuilder, mat: string, y0: number, y1: number, hinge: number, chord: number, z: number, t: number) {
  const sec = (y: number): V3[] => [[hinge, y, z - t / 2], [hinge - chord, y, z], [hinge, y, z + t / 2]];
  const a = sec(y0), b = sec(y1);
  mb.bridge(mat, a, b);
  mb.cap(mat, a);
  mb.cap(mat, b);
}

const materials: Material[] = [
  { name: 'white', color: [0.93, 0.93, 0.9, 1], roughness: 0.45 },
  { name: 'celeste', color: [0.35, 0.68, 0.9, 1], roughness: 0.5 },
  { name: 'terracota', color: [0.72, 0.36, 0.2, 1], roughness: 0.55 },
  { name: 'glass', color: [0.08, 0.12, 0.16, 1], metallic: 0.6, roughness: 0.15 },
  { name: 'dark', color: [0.12, 0.12, 0.13, 1], roughness: 0.8 },
  { name: 'metal', color: [0.6, 0.6, 0.62, 1], metallic: 0.8, roughness: 0.35 },
  { name: 'tire', color: [0.06, 0.06, 0.06, 1], roughness: 0.95 },
  { name: 'disc', color: [0.15, 0.15, 0.15, 0.18], roughness: 0.9 },
];

/** Monomotor de ala alta "Hornero H-160". */
function hornero(): NodeDef {
  const body = new MeshBuilder();
  // Fuselaje: [x, ancho, alto, centro z]
  loft(body, 'white', [
    [2.2, 0.75, 0.7, -0.08],
    [1.9, 1.0, 0.9, -0.08],
    [1.3, 1.12, 1.1, -0.15],
    [0.9, 1.16, 1.3, -0.2],
    [-0.9, 1.14, 1.28, -0.22],
    [-1.6, 0.95, 1.0, -0.3],
    [-3.2, 0.55, 0.62, -0.35],
    [-5.0, 0.24, 0.38, -0.4],
    [-5.45, 0.14, 0.28, -0.42],
  ]);
  // Franjas: celeste (superior) y terracota (inferior) a lo largo del fuselaje.
  for (const side of [-1, 1]) {
    const y = side * 0.585;
    body.quad('celeste', [1.9, side * 0.505, -0.02], [-1.6, side * 0.48, -0.12], [-1.6, side * 0.48, -0.03], [1.9, side * 0.505, 0.07]);
    body.quad('terracota', [1.3, y * 0.97, 0.12], [-1.4, y * 0.92, 0.05], [-1.4, y * 0.92, 0.12], [1.3, y * 0.97, 0.19]);
    body.quad('celeste', [-1.6, side * 0.48, -0.12], [-5.0, side * 0.125, -0.38], [-5.0, side * 0.125, -0.33], [-1.6, side * 0.48, -0.03]);
    // Ventanillas laterales
    body.quad('glass', [0.85, side * 0.59, -0.75], [-0.85, side * 0.585, -0.75], [-0.85, side * 0.585, -0.32], [0.85, side * 0.59, -0.32]);
    body.quad('glass', [-0.95, side * 0.575, -0.7], [-1.5, side * 0.5, -0.66], [-1.5, side * 0.5, -0.38], [-0.95, side * 0.575, -0.38]);
  }
  // Parabrisas inclinado
  body.quad('glass', [1.28, -0.5, -0.62], [1.28, 0.5, -0.62], [0.88, 0.52, -0.86], [0.88, -0.52, -0.86]);
  // Toma de aire / carenado inferior del motor
  body.box('dark', [2.0, 0, 0.22], [0.25, 0.4, 0.12]);
  // Escape
  body.cylinder('metal', [1.55, 0.25, 0.32], [1.3, 0.25, 0.38], 0.04);

  // Ala alta: raíz y punta. Borde de ataque x=0.35, cuerda 1.5 (raíz) → 1.25 (punta). Diedro leve.
  const wingZ = -0.9;
  for (const s of [-1, 1]) {
    // Parte fija del ala: hasta la charnela de flaps/alerones (x = -0.8)
    panel(body, 'white', s * 0.55, s * 5.5, 0.35, 1.15, 0.3, 0.95, wingZ, wingZ - 0.12, 0.17, 0.11);
    // Puntera celeste
    panel(body, 'celeste', s * 5.5, s * 5.6, 0.3, 1.25, 0.26, 1.15, wingZ - 0.12, wingZ - 0.12, 0.1, 0.05);
    // Montantes
    body.cylinder('metal', [-0.1, s * 0.55, 0.3], [-0.15, s * 2.7, wingZ + 0.03], 0.035, 0.035, 6);
    // Tren principal: pata de ballesta + rueda + carenado
    body.cylinder('metal', [-0.42, s * 0.45, 0.45], [-0.5, s * 1.25, 0.93], 0.04, 0.035, 6);
    body.cylinder('tire', [-0.5, s * 1.17, 0.93], [-0.5, s * 1.33, 0.93], 0.22, 0.22, 14);
  }
  // Carenados de rueda, desplazados a cada lado
  const pants = new MeshBuilder();
  for (const s of [-1, 1]) {
    const st: [number, number, number, number][] = [
      [-0.1, 0.12, 0.14, 0.88], [-0.3, 0.24, 0.44, 0.88], [-0.75, 0.24, 0.4, 0.88], [-0.95, 0.08, 0.12, 0.86],
    ];
    const rings = st.map(([x, w, h, zc]) => octSection(x, w, h, zc).map(([px, py, pz]) => [px, py + s * 1.25, pz] as V3));
    for (let i = 0; i < rings.length - 1; i++) pants.bridge('celeste', rings[i], rings[i + 1]);
    pants.cap('celeste', rings[0]);
    pants.cap('celeste', rings[rings.length - 1]);
  }
  // Tren de nariz
  body.cylinder('metal', [1.45, 0, 0.3], [1.5, 0, 0.95], 0.045, 0.04, 6);
  body.cylinder('tire', [1.5, -0.07, 0.95], [1.5, 0.07, 0.95], 0.2, 0.2, 14);
  body.box('metal', [1.5, 0, 0.78], [0.08, 0.2, 0.06]);

  // Estabilizador horizontal fijo y deriva
  for (const s of [-1, 1]) panel(body, 'white', s * 0.12, s * 1.75, -4.45, 0.6, -4.6, 0.45, -0.3, -0.3, 0.09, 0.06);
  const fin = new MeshBuilder();
  {
    const t = 0.05;
    const prof = (y: number): V3[] => [[-4.1, y, -0.55], [-4.95, y, -1.85], [-5.15, y, -1.85], [-5.15, y, -0.5]];
    const a = prof(-t), b = prof(t);
    fin.bridge('white', a, b);
    fin.cap('white', a);
    fin.cap('white', b);
    // Detalle celeste en la punta
    fin.box('celeste', [-5.03, 0, -1.8], [0.3, 0.11, 0.1]);
  }

  // Superficies móviles (nodo con pivote en la charnela)
  const ail = (s: number) => {
    const m = new MeshBuilder();
    controlSurface(m, 'white', s * 3.3, s * 5.4, -0.8 + 0.0, 0.32, wingZ - 0.08, 0.07);
    return m;
  };
  const flap = (s: number) => {
    const m = new MeshBuilder();
    controlSurface(m, 'white', s * 0.6, s * 3.25, -0.8, 0.38, wingZ - 0.03, 0.08);
    return m;
  };
  const elev = new MeshBuilder();
  for (const s of [-1, 1]) controlSurface(elev, 'white', s * 0.1, s * 1.75, -5.03, 0.38, -0.3, 0.06);
  const rud = new MeshBuilder();
  {
    const sec = (z: number): V3[] => [[-5.15, -0.04, z], [-5.55, 0, z], [-5.15, 0.04, z]];
    const a = sec(-0.45), b = sec(-1.85);
    rud.bridge('white', a, b); rud.cap('white', a); rud.cap('white', b);
    // franja terracota del timón
    const c = sec(-1.3), d = sec(-1.55);
    for (const r of [c, d]) for (const p of r) p[1] *= 1.15;
    rud.bridge('terracota', c, d);
  }

  // Hélice bipala + spinner + disco de hélice para RPM altas
  const propX = 2.3, propZ = -0.15;
  const prop = new MeshBuilder();
  prop.cylinder('white', [propX - 0.05, 0, propZ], [propX + 0.28, 0, propZ], 0.16, 0.0, 12, true);
  for (const s of [-1, 1]) {
    prop.quad('dark', [propX, s * 0.12, propZ - 0.06], [propX, s * 0.95, propZ - 0.035], [propX + 0.02, s * 0.95, propZ + 0.035], [propX + 0.02, s * 0.12, propZ + 0.06]);
    prop.quad('metal', [propX - 0.001, s * 0.85, propZ - 0.04], [propX - 0.001, s * 0.95, propZ - 0.035], [propX + 0.021, s * 0.95, propZ + 0.035], [propX + 0.021, s * 0.85, propZ + 0.04]);
  }
  const disc = new MeshBuilder();
  disc.cylinder('disc', [propX - 0.01, 0, propZ], [propX + 0.01, 0, propZ], 0.95, 0.95, 28, true);

  return {
    name: 'hornero',
    children: [
      { name: 'body', mesh: body },
      { name: 'pants', mesh: pants },
      { name: 'fin', mesh: fin },
      { name: 'aileron_l', pivot: [-0.8, -3.3, wingZ - 0.08], mesh: ail(-1) },
      { name: 'aileron_r', pivot: [-0.8, 3.3, wingZ - 0.08], mesh: ail(1) },
      { name: 'flap_l', pivot: [-0.8, -0.6, wingZ - 0.03], mesh: flap(-1) },
      { name: 'flap_r', pivot: [-0.8, 0.6, wingZ - 0.03], mesh: flap(1) },
      { name: 'elevator', pivot: [-5.03, 0, -0.3], mesh: elev },
      { name: 'rudder', pivot: [-5.15, 0, -1.0], mesh: rud },
      { name: 'propeller', pivot: [propX, 0, propZ], mesh: prop },
      { name: 'propdisc', pivot: [propX, 0, propZ], mesh: disc },
    ],
  };
}

mkdirSync(OUT, { recursive: true });
const models: Record<string, () => NodeDef> = { 'hornero-h160': hornero };
for (const [id, make] of Object.entries(models)) {
  const glb = buildGlb(make(), materials);
  writeFileSync(resolve(OUT, `${id}.glb`), glb);
  console.log(`✔ ${id}.glb (${(glb.length / 1024).toFixed(1)} KB)`);
}
