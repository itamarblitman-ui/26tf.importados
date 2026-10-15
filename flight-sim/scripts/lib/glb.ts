/**
 * Mini generador de glTF binario (.glb) a partir de geometría procedural.
 * Todas las coordenadas de entrada están en EJES CUERPO del avión (x adelante, y derecha, z abajo)
 * y se convierten a la convención glTF (+Y arriba, +Z adelante, +X izquierda).
 */
export type V3 = [number, number, number];

export interface Material {
  name: string;
  color: [number, number, number, number];
  metallic?: number;
  roughness?: number;
}

export class MeshBuilder {
  /** triángulos agrupados por material */
  readonly groups = new Map<string, number[]>();

  tri(mat: string, a: V3, b: V3, c: V3) {
    let arr = this.groups.get(mat);
    if (!arr) this.groups.set(mat, (arr = []));
    arr.push(...a, ...b, ...c);
  }

  quad(mat: string, a: V3, b: V3, c: V3, d: V3) {
    this.tri(mat, a, b, c);
    this.tri(mat, a, c, d);
  }

  /** Une dos anillos (mismo número de vértices) con quads. */
  bridge(mat: string, r0: V3[], r1: V3[], closed = true) {
    const n = r0.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      this.quad(mat, r0[i], r0[j], r1[j], r1[i]);
    }
  }

  /** Tapa un anillo convexo con un abanico. */
  cap(mat: string, ring: V3[]) {
    for (let i = 1; i < ring.length - 1; i++) this.tri(mat, ring[0], ring[i], ring[i + 1]);
  }

  /** Caja alineada a ejes (centro, tamaño). */
  box(mat: string, c: V3, s: V3) {
    const [x, y, z] = c, [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
    const p = (i: number, j: number, k: number): V3 => [x + i * hx, y + j * hy, z + k * hz];
    this.quad(mat, p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1));
    this.quad(mat, p(-1, -1, 1), p(-1, 1, 1), p(1, 1, 1), p(1, -1, 1));
    this.quad(mat, p(-1, -1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, -1, -1));
    this.quad(mat, p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1));
    this.quad(mat, p(-1, -1, -1), p(-1, 1, -1), p(-1, 1, 1), p(-1, -1, 1));
    this.quad(mat, p(1, -1, -1), p(1, -1, 1), p(1, 1, 1), p(1, 1, -1));
  }

  /** Cilindro entre dos puntos. */
  cylinder(mat: string, a: V3, b: V3, r0: number, r1 = r0, seg = 10, caps = true) {
    const axis = norm(sub(b, a));
    const ref: V3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm(cross(axis, ref)), v = cross(axis, u);
    const ring = (c: V3, r: number) =>
      Array.from({ length: seg }, (_, i) => {
        const t = (i / seg) * Math.PI * 2;
        return add(c, add(scale(u, Math.cos(t) * r), scale(v, Math.sin(t) * r)));
      });
    const ra = ring(a, r0), rb = ring(b, r1);
    this.bridge(mat, ra, rb);
    if (caps) {
      if (r0 > 0) this.cap(mat, ra);
      if (r1 > 0) this.cap(mat, rb);
    }
  }
}

export interface NodeDef {
  name: string;
  /** Posición del pivote en ejes cuerpo; la malla se expresa relativa a este punto. */
  pivot?: V3;
  mesh?: MeshBuilder;
  children?: NodeDef[];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export { add, sub, scale, cross, norm };

/** cuerpo (x adelante, y der, z abajo) → glTF (X izq, Y arriba, Z adelante) */
const toGltf = (p: V3): V3 => [-p[1], -p[2], p[0]];

export function buildGlb(root: NodeDef, materials: Material[]): Uint8Array {
  const matIndex = new Map(materials.map((m, i) => [m.name, i]));
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const nodes: object[] = [];
  let byteOffset = 0;
  const chunks: ArrayBuffer[] = [];

  const pushFloat = (data: Float32Array, target: number) => {
    const len = data.byteLength;
    chunks.push(data.buffer.slice(data.byteOffset, data.byteOffset + len) as ArrayBuffer);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: len, target });
    byteOffset += len; // múltiplo de 4 siempre
    return bufferViews.length - 1;
  };

  const addMesh = (mb: MeshBuilder, pivot: V3, name: string) => {
    const primitives: object[] = [];
    for (const [mat, tris] of mb.groups) {
      const n = tris.length / 3;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let t = 0; t < n; t += 3) {
        const pts: V3[] = [0, 1, 2].map((k) => {
          const i = (t + k) * 3;
          return toGltf(sub([tris[i], tris[i + 1], tris[i + 2]], pivot));
        });
        // La conversión de ejes es una rotación propia (det = +1): se conserva el sentido de giro.
        const [a, b, c] = pts;
        const nrm = norm(cross(sub(b, a), sub(c, a)));
        [a, b, c].forEach((p, k) => {
          pos.set(p, (t + k) * 3);
          nor.set(nrm, (t + k) * 3);
          for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d], p[d]); max[d] = Math.max(max[d], p[d]); }
        });
      }
      const pv = pushFloat(pos, 34962);
      accessors.push({ bufferView: pv, componentType: 5126, count: n, type: 'VEC3', min, max });
      const pa = accessors.length - 1;
      const nv = pushFloat(nor, 34962);
      accessors.push({ bufferView: nv, componentType: 5126, count: n, type: 'VEC3' });
      const na = accessors.length - 1;
      primitives.push({ attributes: { POSITION: pa, NORMAL: na }, material: matIndex.get(mat) ?? 0, mode: 4 });
    }
    meshes.push({ name, primitives });
    return meshes.length - 1;
  };

  const addNode = (def: NodeDef, parentPivot: V3): number => {
    const pivot = def.pivot ?? parentPivot;
    const node: Record<string, unknown> = { name: def.name };
    const t = toGltf(sub(pivot, parentPivot));
    if (t.some((v) => Math.abs(v) > 1e-9)) node.translation = t;
    if (def.mesh) node.mesh = addMesh(def.mesh, pivot, def.name);
    nodes.push(node);
    const idx = nodes.length - 1;
    if (def.children?.length) node.children = def.children.map((c) => addNode(c, pivot));
    return idx;
  };

  const rootIdx = addNode(root, [0, 0, 0]);

  const gltf = {
    asset: { version: '2.0', generator: 'cielo-abierto build-models' },
    scene: 0,
    scenes: [{ nodes: [rootIdx] }],
    nodes,
    meshes,
    materials: materials.map((m) => ({
      name: m.name,
      doubleSided: true,
      alphaMode: m.color[3] < 1 ? 'BLEND' : 'OPAQUE',
      pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: m.metallic ?? 0.1, roughnessFactor: m.roughness ?? 0.6 },
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };

  const enc = new TextEncoder();
  let json = enc.encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) { const j = new Uint8Array(json.length + jsonPad); j.set(json); j.fill(0x20, json.length); json = j; }
  const binLen = byteOffset;
  const total = 12 + 8 + json.length + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(json, 20);
  let o = 20 + json.length;
  dv.setUint32(o, binLen, true);
  dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  o += 8;
  for (const c of chunks) { out.set(new Uint8Array(c), o); o += c.byteLength; }
  return out;
}
