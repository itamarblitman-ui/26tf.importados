import type { AutopilotSettings } from '../physics/Autopilot';

const FT = 3.28084, KT = 1.943844;
const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

export type ApCommand =
  | 'toggle' | 'hdg' | 'alt' | 'spd' | 'hdg+' | 'hdg-' | 'alt+' | 'alt-' | 'spd+' | 'spd-';

/** Recuadro del piloto automático: estado de los modos y referencias, con botones clicables. */
export class AutopilotPanel {
  readonly root: HTMLElement;
  onCommand: (c: ApCommand) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el(`
      <div class="ap-box">
        <button class="ap-master" data-c="toggle" title="Piloto automático (F5)">AP</button>
        <div class="ap-mode" data-mode="hdg"><button data-c="hdg" title="Mantener rumbo (F6)">HDG</button>
          <button class="adj" data-c="hdg-">−</button><b class="v hdg">---</b><button class="adj" data-c="hdg+">+</button></div>
        <div class="ap-mode" data-mode="alt"><button data-c="alt" title="Mantener altitud (F7)">ALT</button>
          <button class="adj" data-c="alt-">−</button><b class="v alt">---</b><button class="adj" data-c="alt+">+</button></div>
        <div class="ap-mode" data-mode="spd"><button data-c="spd" title="Mantener velocidad (F8)">SPD</button>
          <button class="adj" data-c="spd-">−</button><b class="v spd">---</b><button class="adj" data-c="spd+">+</button></div>
      </div>`);
    parent.append(this.root);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.c) this.onCommand(b.dataset.c as ApCommand);
    });
  }

  set bottomOffset(px: number) { this.root.style.bottom = `${px + 12}px`; }

  update(ap: AutopilotSettings, engaged: boolean) {
    this.root.classList.toggle('on', engaged);
    const set = (mode: string, active: boolean, text: string) => {
      const m = this.root.querySelector<HTMLElement>(`[data-mode="${mode}"]`)!;
      m.classList.toggle('active', active && engaged);
      m.classList.toggle('armed', active && !engaged);
      m.querySelector('.v')!.textContent = text;
    };
    set('hdg', ap.hdgHold, `${String(Math.round(ap.heading) % 360).padStart(3, '0')}°`);
    set('alt', ap.altHold, `${Math.round((ap.altitude * FT) / 10) * 10} ft`);
    set('spd', ap.spdHold, `${Math.round(ap.speed * KT)} kt`);
  }
}
