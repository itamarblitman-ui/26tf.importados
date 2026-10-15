import * as Cesium from 'cesium';

interface MaskTile { west: number; south: number; east: number; north: number; mask: Uint8Array | null; size: number }

/**
 * Detecta si un punto está sobre agua usando la máscara de agua que viene con Cesium World Terrain
 * (cada tesela trae 1 byte = todo tierra/todo agua, o una grilla de 256×256). Las teselas se piden
 * de forma asíncrona y se cachean; mientras no hay dato, se asume tierra.
 */
export class WaterProbe {
  private cache = new Map<string, MaskTile | 'pending' | 'none'>();
  private level = 11;

  constructor(private provider: Cesium.TerrainProvider) {}

  get supported(): boolean {
    return !!this.provider && this.provider.hasWaterMask;
  }

  /** true = agua, false = tierra o desconocido */
  isWater(latDeg: number, lonDeg: number): boolean {
    if (!this.supported) return false;
    const scheme = this.provider.tilingScheme;
    const carto = Cesium.Cartographic.fromDegrees(lonDeg, latDeg);
    const xy = scheme.positionToTileXY(carto, this.level);
    if (!xy) return false;
    const key = `${this.level}/${xy.x}/${xy.y}`;
    const entry = this.cache.get(key);
    if (entry === undefined) { this.request(key, xy.x, xy.y, this.level); return false; }
    if (entry === 'pending' || entry === 'none' || !entry.mask) return false;
    const u = (carto.longitude - entry.west) / (entry.east - entry.west);
    const v = (entry.north - carto.latitude) / (entry.north - entry.south);
    if (entry.size === 1) return entry.mask[0] !== 0;
    const px = Math.min(entry.size - 1, Math.max(0, Math.floor(u * entry.size)));
    const py = Math.min(entry.size - 1, Math.max(0, Math.floor(v * entry.size)));
    return entry.mask[py * entry.size + px] !== 0;
  }

  private request(key: string, x: number, y: number, level: number) {
    const avail = this.provider.availability;
    if (avail && !avail.isTileAvailable(level, x, y)) {
      // Sin datos a este nivel: probamos uno menos detallado la próxima vez
      this.cache.set(key, 'none');
      if (this.level > 6) this.level--;
      return;
    }
    const promise = this.provider.requestTileGeometry(x, y, level);
    if (!promise) return; // limitado por el planificador de pedidos: se reintenta en la próxima muestra
    this.cache.set(key, 'pending');
    promise
      .then((data) => {
        const mask = (data as unknown as { waterMask?: Uint8Array }).waterMask;
        const rect = this.provider.tilingScheme.tileXYToRectangle(x, y, level);
        if (!mask) { this.cache.set(key, 'none'); return; }
        const size = mask.length === 1 ? 1 : Math.round(Math.sqrt(mask.length));
        this.cache.set(key, { west: rect.west, south: rect.south, east: rect.east, north: rect.north, mask, size });
        if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!);
      })
      .catch(() => this.cache.set(key, 'none'));
  }
}
