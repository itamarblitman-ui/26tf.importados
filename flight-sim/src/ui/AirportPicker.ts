import { type Airport, type Runway } from '../world/airports';

const TILE = 256;
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TYPE_LABEL = { small: 'pequeño', medium: 'mediano', large: 'grande' } as const;
const FT = 3.28084;

export interface PickResult { airport: Airport; runwayEnd: string }

const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

/** Proyección Web Mercator: grados → píxeles del mundo en el zoom z. */
const project = (lat: number, lon: number, z: number) => {
  const s = TILE * 2 ** z;
  const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
};
const unproject = (x: number, y: number, z: number) => {
  const s = TILE * 2 ** z;
  const lon = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon };
};

/**
 * Mapa para elegir aeropuerto y cabecera: Canvas 2D con teselas de OpenStreetMap, sin dependencias.
 * Arrastrar = mover, rueda = zoom, clic en un punto = elegir. Búsqueda por OACI, IATA, nombre o ciudad.
 */
export class AirportPicker {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private info: HTMLElement;
  private results: HTMLElement;
  private search: HTMLInputElement;
  private center = { lat: -34.56, lon: -58.42 };
  private zoom = 9;
  private tiles = new Map<string, HTMLImageElement>();
  private selected: Airport | null = null;
  private dpr = 1;
  private resolve: ((r: PickResult | null) => void) | null = null;
  private drawQueued = false;
  private airports: Airport[] = [];

  constructor(parent: HTMLElement) {
    this.root = el(`
      <div class="picker hidden">
        <div class="picker-box">
          <div class="picker-head">
            <h2>Elegir aeropuerto</h2>
            <input type="search" placeholder="Buscar: SABE, AEP, Ezeiza, Córdoba…" spellcheck="false" />
            <button class="close" title="Cerrar (Esc)">✕</button>
          </div>
          <div class="picker-body">
            <div class="picker-map"><canvas></canvas><div class="attrib">© OpenStreetMap contributors · datos: OurAirports</div></div>
            <div class="picker-side"><div class="results"></div><div class="info"><p class="muted">Tocá un punto del mapa o buscá un aeropuerto.</p></div></div>
          </div>
        </div>
      </div>`);
    parent.append(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.info = this.root.querySelector('.info')!;
    this.results = this.root.querySelector('.results')!;
    this.search = this.root.querySelector('input')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.close(null));
    this.root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(null); e.stopPropagation(); });
    this.search.addEventListener('input', () => this.runSearch());
    this.bindMap();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement!);
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }

  /** Abre el selector centrado en una posición. Resuelve con la elección o null si se cancela. */
  open(airports: Airport[], lat: number, lon: number): Promise<PickResult | null> {
    this.airports = airports;
    this.center = { lat, lon };
    this.zoom = 9;
    this.selected = null;
    this.info.innerHTML = '<p class="muted">Tocá un punto del mapa o buscá un aeropuerto.</p>';
    this.results.innerHTML = '';
    this.search.value = '';
    this.root.classList.remove('hidden');
    this.resize();
    setTimeout(() => this.search.focus(), 50);
    return new Promise((r) => (this.resolve = r));
  }

  private close(r: PickResult | null) {
    this.root.classList.add('hidden');
    this.resolve?.(r);
    this.resolve = null;
  }

  private resize() {
    const box = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(box.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(box.height * this.dpr));
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    this.queueDraw();
  }

  private bindMap() {
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      drag.x = e.clientX; drag.y = e.clientY;
      const p = project(this.center.lat, this.center.lon, this.zoom);
      this.center = unproject(p.x - dx, p.y - dy, this.zoom);
      this.queueDraw();
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.clickAt(e.offsetX, e.offsetY);
      drag = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const nz = Math.max(2, Math.min(15, this.zoom + (e.deltaY < 0 ? 1 : -1)));
      if (nz === this.zoom) return;
      // Zoom alrededor del cursor
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2, my = e.clientY - rect.top - rect.height / 2;
      const p = project(this.center.lat, this.center.lon, this.zoom);
      const under = unproject(p.x + mx, p.y + my, this.zoom);
      const q = project(under.lat, under.lon, nz);
      this.zoom = nz;
      this.center = unproject(q.x - mx, q.y - my, nz);
      this.queueDraw();
    }, { passive: false });
  }

  private screenOf(lat: number, lon: number) {
    const W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr;
    const c = project(this.center.lat, this.center.lon, this.zoom);
    const p = project(lat, lon, this.zoom);
    return { x: p.x - c.x + W / 2, y: p.y - c.y + H / 2 };
  }

  private visibleAirport(a: Airport) {
    return this.zoom >= 8 || a.type === 'large' || (this.zoom >= 6 && a.type === 'medium');
  }

  private clickAt(x: number, y: number) {
    let best: Airport | null = null, bestD = 14 * 14;
    for (const a of this.airports) {
      if (!this.visibleAirport(a)) continue;
      const p = this.screenOf(a.lat, a.lon);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) this.select(best);
  }

  private select(a: Airport, recenter = false) {
    this.selected = a;
    if (recenter) { this.center = { lat: a.lat, lon: a.lon }; this.zoom = Math.max(this.zoom, 11); }
    const rwButtons = a.runways.filter((r) => r.surface !== 'water').flatMap((r: Runway) => [r.le, r.he].map((e) => {
      const surf = r.surface === 'hard' ? 'pavimento' : 'tierra/pasto';
      return `<button class="rw" data-end="${e.ident}">Pista ${e.ident} <small>${Math.round(r.length)} m · ${surf} · rumbo ${Math.round(e.heading)}°</small></button>`;
    })).join('');
    this.info.innerHTML = `
      <h3>${a.ident}${a.iata ? ` · ${a.iata}` : ''}</h3>
      <p>${a.name}<br><span class="muted">${a.municipality || ''} ${a.country} · aeropuerto ${TYPE_LABEL[a.type]} · ${Math.round(a.elevation * FT)} ft</span></p>
      <div class="rw-list">${rwButtons || '<p class="muted">Sin pistas utilizables.</p>'}</div>`;
    this.info.querySelectorAll<HTMLButtonElement>('button.rw').forEach((b) =>
      b.addEventListener('click', () => this.close({ airport: a, runwayEnd: b.dataset.end! })));
    this.queueDraw();
  }

  private runSearch() {
    const q = this.search.value.trim().toLowerCase();
    if (q.length < 2) { this.results.innerHTML = ''; return; }
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const nq = norm(q);
    const rank = (a: Airport) =>
      a.ident.toLowerCase() === q || a.iata.toLowerCase() === q ? 0
        : a.ident.toLowerCase().startsWith(q) ? 1
          : norm(a.name).includes(nq) || norm(a.municipality).includes(nq) ? 2 + (2 - ['small', 'medium', 'large'].indexOf(a.type)) * 0.1 : 9;
    const list = this.airports.map((a) => ({ a, r: rank(a) })).filter((x) => x.r < 9).sort((x, y) => x.r - y.r).slice(0, 12);
    this.results.innerHTML = list.map(({ a }, i) =>
      `<button data-i="${i}"><b>${a.ident}</b> ${a.name}<small>${a.municipality || ''} ${a.country}</small></button>`).join('')
      || '<p class="muted">Sin resultados.</p>';
    this.results.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => this.select(list[Number(b.dataset.i)].a, true)));
  }

  private queueDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.draw(); });
  }

  private tile(z: number, x: number, y: number): HTMLImageElement | null {
    const n = 2 ** z;
    if (y < 0 || y >= n) return null;
    const xx = ((x % n) + n) % n;
    const key = `${z}/${xx}/${y}`;
    let img = this.tiles.get(key);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => this.queueDraw();
      img.src = TILE_URL(z, xx, y);
      this.tiles.set(key, img);
      if (this.tiles.size > 300) this.tiles.delete(this.tiles.keys().next().value!);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  private draw() {
    if (!this.isOpen) return;
    const c = this.ctx;
    const W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#1a2633';
    c.fillRect(0, 0, W, H);
    const z = this.zoom;
    const ctr = project(this.center.lat, this.center.lon, z);
    const x0 = ctr.x - W / 2, y0 = ctr.y - H / 2;
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty++) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++) {
        const img = this.tile(z, tx, ty);
        if (img) c.drawImage(img, tx * TILE - x0, ty * TILE - y0, TILE, TILE);
      }
    }
    // Atenuamos el mapa para que resalten los aeropuertos
    c.fillStyle = 'rgba(10,16,24,0.25)';
    c.fillRect(0, 0, W, H);

    const colors = { large: '#ff9d2e', medium: '#5fb4e8', small: '#9fd18b' };
    const sizes = { large: 5, medium: 4, small: 3 };
    for (const a of this.airports) {
      if (!this.visibleAirport(a)) continue;
      const p = this.screenOf(a.lat, a.lon);
      if (p.x < -10 || p.y < -10 || p.x > W + 10 || p.y > H + 10) continue;
      if (z >= 12) {
        // Pistas a escala
        c.strokeStyle = '#222'; c.lineCap = 'butt';
        for (const r of a.runways) {
          const p1 = this.screenOf(r.le.lat, r.le.lon), p2 = this.screenOf(r.he.lat, r.he.lon);
          const mPerPx = (40075016 * Math.cos((a.lat * Math.PI) / 180)) / (TILE * 2 ** z);
          c.lineWidth = Math.max(2, r.width / mPerPx);
          c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
        }
      }
      c.fillStyle = colors[a.type];
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1;
      c.beginPath(); c.arc(p.x, p.y, sizes[a.type], 0, Math.PI * 2); c.fill(); c.stroke();
      if (z >= 9 || (a.type === 'large' && z >= 6)) {
        c.font = '600 11px system-ui, sans-serif';
        c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 3;
        c.strokeText(a.ident, p.x + 7, p.y - 6); c.fillText(a.ident, p.x + 7, p.y - 6);
      }
    }
    if (this.selected) {
      const p = this.screenOf(this.selected.lat, this.selected.lon);
      c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.arc(p.x, p.y, 11, 0, Math.PI * 2); c.stroke();
    }
  }
}
