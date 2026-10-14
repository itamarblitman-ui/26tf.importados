/** Estado del teclado: teclas presionadas y eventos de pulsación (flanco). */
export class Keyboard {
  private down = new Set<string>();
  private pressed: string[] = [];
  /** Teclas cuyo comportamiento por defecto del navegador bloqueamos (F1 = ayuda, F3 = buscar, flechas = scroll…). */
  private static readonly BLOCK = new Set([
    'F1', 'F2', 'F3', 'F4', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End',
  ]);

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (Keyboard.BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.push(this.chord(e));
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  private isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private chord(e: KeyboardEvent) {
    return `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${e.code}`;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  anyDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** Devuelve y vacía la lista de pulsaciones desde la última llamada (con modificadores, p.ej. "Shift+KeyB"). */
  consumePressed(): string[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }
}
