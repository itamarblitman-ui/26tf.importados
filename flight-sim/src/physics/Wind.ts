import type { Vec3 } from './math/vec3';
import type { EnvironmentSettings } from './types';

/** Generador pseudoaleatorio determinista (mulberry32) para que los tests sean reproducibles. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Viento medio + ráfagas + turbulencia. Las ráfagas son ruido blanco filtrado por un pasabajos de
 * primer orden (aproximación de Dryden), con escala de longitud que depende de la altura.
 */
export class WindModel {
  private gust: Vec3 = [0, 0, 0];
  private gustEnvelope = 0;
  private gustTimer = 0;
  private readonly rand: () => number;

  constructor(seed = 1) {
    this.rand = rng(seed);
  }

  private gauss(): number {
    // Box-Muller
    const u = Math.max(this.rand(), 1e-12), v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Avanza el modelo y devuelve el viento (hacia donde sopla) en NED local.
   * @param agl altura sobre el suelo (m), para el perfil de capa límite
   * @param airspeed velocidad aerodinámica (m/s), para la escala temporal de la turbulencia
   */
  sample(env: EnvironmentSettings, agl: number, airspeed: number, dt: number): Vec3 {
    // Perfil logarítmico: el viento informado es a 10 m; z0 = 0.05 m (pasto/pista).
    const z = Math.max(agl, 0.5);
    const profile = Math.min(1.6, Math.log(z / 0.05) / Math.log(10 / 0.05));
    const from = (env.windFromDeg * Math.PI) / 180;
    const mean: Vec3 = [-Math.cos(from) * env.windSpeed * profile, -Math.sin(from) * env.windSpeed * profile, 0];

    // Ráfagas discretas: cada tanto aparece una racha que sube y baja suavemente.
    this.gustTimer -= dt;
    if (env.gustIntensity > 0 && this.gustTimer <= 0) {
      this.gustTimer = 4 + this.rand() * 10;
      this.gustEnvelope = env.gustIntensity * (0.6 + this.rand() * 0.8);
    }
    const gustPhase = Math.max(0, this.gustTimer);
    const gustFactor = this.gustEnvelope * Math.max(0, Math.sin(Math.min(gustPhase, 3) * Math.PI / 3));

    // Turbulencia de Dryden simplificada.
    const L = Math.max(30, Math.min(530, agl > 300 ? 530 : 30 + agl));
    const V = Math.max(airspeed, 10);
    const tau = L / V;
    const sigma = env.turbulence * (agl < 300 ? 2.5 : 1.5) + 0.15 * env.gustIntensity;
    const k = Math.exp(-dt / tau);
    const s = sigma * Math.sqrt(1 - k * k);
    this.gust = [
      this.gust[0] * k + s * this.gauss(),
      this.gust[1] * k + s * this.gauss(),
      this.gust[2] * k + s * 0.6 * this.gauss(),
    ];
    const dirN = env.windSpeed > 0.1 ? mean[0] / (env.windSpeed * profile) : 0;
    const dirE = env.windSpeed > 0.1 ? mean[1] / (env.windSpeed * profile) : 0;
    return [
      mean[0] + dirN * gustFactor + this.gust[0],
      mean[1] + dirE * gustFactor + this.gust[1],
      this.gust[2] * Math.min(1, agl / 50),
    ];
  }
}
