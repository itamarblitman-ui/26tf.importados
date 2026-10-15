import * as Cesium from 'cesium';
import type { GroundReport } from '../physics/types';
import { airportsNear, type Airport, type Runway } from './airports';
import type { World } from './Globe';
import { WaterProbe } from './WaterProbe';

const R_EARTH = 6371008.8;
const toRad = Math.PI / 180;

interface RunwaySurface {
  rw: Runway;
  /** Altura elipsoidal medida en cada umbral */
  hLe: number;
  hHe: number;
}

/**
 * Le provee a la física el plano de suelo bajo el avión:
 * - sobre una pista conocida usa un plano exacto entre las alturas medidas en sus umbrales
 *   (la fotogrametría y el terreno tienen irregularidades que arruinarían el carreteo);
 * - fuera de pista usa el terreno de Cesium (3 muestras → altura + normal).
 * Corre en el hilo principal a ~15 Hz; las consultas pesadas son asíncronas.
 */
export class GroundProbe {
  private surfaces = new Map<Runway, RunwaySurface>();
  private pending = new Set<Runway>();
  private last: GroundReport | null = null;
  private lastNearbyCheck = { lat: 999, lon: 999 };
  private asyncBusy = false;
  private asyncResult: { lat: number; lon: number; h: number; normal: [number, number, number] } | null = null;
  private lastAsyncAt = 0;
  /** Objetos a excluir de las consultas de altura sobre 3D Tiles (el propio avión). */
  exclude: object[] = [];

  private water: WaterProbe | null = null;

  constructor(private world: World, private airports: Airport[]) {
    if (world.hasTerrain) this.water = new WaterProbe(world.scene.terrainProvider);
  }

  /** Marca la superficie como agua si la máscara del terreno lo indica. */
  private withWater(r: GroundReport | null): GroundReport | null {
    if (r && r.kind === 'terrain' && this.water?.isWater(r.lat, r.lon)) return { ...r, kind: 'water' };
    return r;
  }

  /** Mide (asíncrono) las alturas de los umbrales de una pista. */
  async measureRunway(rw: Runway): Promise<RunwaySurface> {
    const existing = this.surfaces.get(rw);
    if (existing) return existing;
    const pts = [Cesium.Cartographic.fromDegrees(rw.le.lon, rw.le.lat), Cesium.Cartographic.fromDegrees(rw.he.lon, rw.he.lat)];
    let heights: (number | undefined)[] = [undefined, undefined];
    const { scene, mode, hasTerrain } = this.world;
    try {
      if (mode === 'photoreal' && this.world.tileset) {
        const r = await scene.sampleHeightMostDetailed(pts.map((p) => p.clone()), this.exclude);
        heights = r.map((c) => c?.height);
      }
      if (hasTerrain && heights.some((h) => h === undefined || !Number.isFinite(h))) {
        const r = await Cesium.sampleTerrainMostDetailed(scene.terrainProvider, pts.map((p) => p.clone()));
        heights = heights.map((h, i) => (h !== undefined && Number.isFinite(h) ? h : r[i].height));
      }
    } catch (e) {
      console.warn('No se pudo medir la pista', rw.le.ident, e);
    }
    const fallback = 0;
    const s: RunwaySurface = {
      rw,
      hLe: heights[0] ?? heights[1] ?? fallback,
      hHe: heights[1] ?? heights[0] ?? fallback,
    };
    this.surfaces.set(rw, s);
    return s;
  }

  /** Altura de una pista medida en un punto a lo largo de su eje (0 = le, 1 = he). */
  runwayHeightAt(rw: Runway, lat: number, lon: number): number | null {
    const s = this.surfaces.get(rw);
    if (!s) return null;
    const { along } = this.runwayCoords(rw, lat, lon);
    const t = Math.min(Math.max(along / rw.length, 0), 1);
    return s.hLe + (s.hHe - s.hLe) * t;
  }

  /** Coordenadas del punto en el sistema de la pista: a lo largo del eje desde le, y lateral. */
  private runwayCoords(rw: Runway, lat: number, lon: number) {
    const cosLat = Math.cos(rw.le.lat * toRad);
    const x = (lon - rw.le.lon) * toRad * R_EARTH * cosLat; // este
    const y = (lat - rw.le.lat) * toRad * R_EARTH; // norte
    const hx = Math.sin(rw.le.heading * toRad), hy = Math.cos(rw.le.heading * toRad);
    return { along: x * hx + y * hy, cross: -x * hy + y * hx };
  }

  /** Busca pistas cercanas cada tanto y dispara su medición. */
  private refreshNearby(lat: number, lon: number) {
    if (Math.abs(lat - this.lastNearbyCheck.lat) < 0.02 && Math.abs(lon - this.lastNearbyCheck.lon) < 0.02) return;
    this.lastNearbyCheck = { lat, lon };
    for (const a of airportsNear(this.airports, lat, lon, 12_000)) {
      for (const rw of a.runways) {
        if (rw.surface === 'water' || this.surfaces.has(rw) || this.pending.has(rw)) continue;
        this.pending.add(rw);
        void this.measureRunway(rw).finally(() => this.pending.delete(rw));
      }
    }
  }

  private onRunway(lat: number, lon: number): GroundReport | null {
    for (const s of this.surfaces.values()) {
      const { rw } = s;
      const { along, cross } = this.runwayCoords(rw, lat, lon);
      if (along < -60 || along > rw.length + 60 || Math.abs(cross) > rw.width / 2 + 12) continue;
      const t = Math.min(Math.max(along / rw.length, 0), 1);
      const h = s.hLe + (s.hHe - s.hLe) * t;
      const slope = (s.hHe - s.hLe) / Math.max(rw.length, 1);
      const hx = Math.sin(rw.le.heading * toRad), hy = Math.cos(rw.le.heading * toRad);
      const n = [-slope * hx, -slope * hy, 1];
      const l = Math.hypot(n[0], n[1], n[2]);
      return { lat, lon, height: h, normalEnu: [n[0] / l, n[1] / l, n[2] / l], kind: rw.surface === 'hard' ? 'runway' : 'terrain' };
    }
    return null;
  }

  /** Muestra de terreno síncrona usando los tiles ya cargados del globo. */
  private sampleGlobe(lat: number, lon: number): GroundReport | null {
    const globe = this.world.scene.globe;
    if (!globe.show || !this.world.hasTerrain) return null;
    const d = 8; // m
    const dLat = d / R_EARTH / toRad;
    const dLon = dLat / Math.cos(lat * toRad);
    const h0 = globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat));
    const hn = globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat + dLat));
    const he = globe.getHeight(Cesium.Cartographic.fromDegrees(lon + dLon, lat));
    if (h0 === undefined) return null;
    const n = [-((he ?? h0) - h0) / d, -((hn ?? h0) - h0) / d, 1];
    const l = Math.hypot(n[0], n[1], n[2]);
    return { lat, lon, height: h0, normalEnu: [n[0] / l, n[1] / l, n[2] / l], kind: 'terrain' };
  }

  /** Muestra asíncrona (terreno más detallado o 3D Tiles fotorrealistas). */
  private sampleAsync(lat: number, lon: number, agl: number) {
    const now = performance.now();
    if (this.asyncBusy || now - this.lastAsyncAt < (agl < 200 ? 200 : 800)) return;
    this.asyncBusy = true;
    this.lastAsyncAt = now;
    const d = 8;
    const dLat = d / R_EARTH / toRad, dLon = dLat / Math.cos(lat * toRad);
    const pts = [
      Cesium.Cartographic.fromDegrees(lon, lat),
      Cesium.Cartographic.fromDegrees(lon, lat + dLat),
      Cesium.Cartographic.fromDegrees(lon + dLon, lat),
    ];
    const { scene, mode, tileset, hasTerrain } = this.world;
    const job = async () => {
      let hs: (number | undefined)[] = [];
      if (mode === 'photoreal' && tileset && agl < 400) {
        const r = await scene.sampleHeightMostDetailed(pts.map((p) => p.clone()), this.exclude);
        hs = r.map((c) => c?.height);
      }
      if (hasTerrain && (hs.length === 0 || hs.some((h) => h === undefined))) {
        const r = await Cesium.sampleTerrainMostDetailed(scene.terrainProvider, pts.map((p) => p.clone()));
        hs = r.map((c, i) => hs[i] ?? c.height);
      }
      if (hs[0] === undefined) return;
      const h0 = hs[0]!;
      const n = [-((hs[2] ?? h0) - h0) / d, -((hs[1] ?? h0) - h0) / d, 1];
      const l = Math.hypot(n[0], n[1], n[2]);
      this.asyncResult = { lat, lon, h: h0, normal: [n[0] / l, n[1] / l, n[2] / l] };
    };
    job().catch(() => {}).finally(() => { this.asyncBusy = false; });
  }

  /** Devuelve el reporte de suelo para la posición actual del avión. */
  sample(lat: number, lon: number, agl: number): GroundReport | null {
    this.refreshNearby(lat, lon);
    const runway = this.onRunway(lat, lon);
    if (runway) return (this.last = runway);

    if (!this.world.hasTerrain) {
      return (this.last = { lat, lon, height: 0, normalEnu: [0, 0, 1], kind: 'terrain' });
    }
    const g = this.withWater(this.sampleGlobe(lat, lon));
    if (g && this.world.mode !== 'photoreal') return (this.last = g);

    this.sampleAsync(lat, lon, agl);
    if (this.asyncResult) {
      const r = this.asyncResult;
      return (this.last = this.withWater({ lat: r.lat, lon: r.lon, height: r.h, normalEnu: r.normal, kind: 'terrain' }));
    }
    return g ?? this.last;
  }
}
