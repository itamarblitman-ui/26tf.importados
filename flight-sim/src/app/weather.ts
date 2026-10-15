import type { EnvironmentSettings } from '../physics/types';
import type { CloudCover } from '../world/cloudField';

const KT = 0.514444;

/** Configuración de clima y hora tal como la ve el usuario (unidades aeronáuticas). */
export interface WeatherSettings {
  /** Dirección DESDE la que sopla (°) */
  windFromDeg: number;
  windKt: number;
  /** Ráfagas por encima del viento medio (kt) */
  gustKt: number;
  /** 0..1 */
  turbulence: number;
  cover: CloudCover;
  cloudBaseFt: number;
  /** Visibilidad (km); ≥ 50 = ilimitada */
  visibilityKm: number;
  /** Desvío de temperatura respecto de ISA (°C) */
  isaDeltaC: number;
  qnhHpa: number;
  /** Hora real o fija (hora solar local) */
  timeMode: 'real' | 'fixed';
  localHour: number;
  shadows: boolean;
}

export const defaultWeather = (): WeatherSettings => ({
  windFromDeg: 0, windKt: 0, gustKt: 0, turbulence: 0, cover: 'few', cloudBaseFt: 3500, visibilityKm: 60,
  isaDeltaC: 0, qnhHpa: 1013, timeMode: 'real', localHour: 12, shadows: true,
});

export const WEATHER_PRESETS: Record<string, Partial<WeatherSettings>> = {
  Despejado: { windKt: 0, gustKt: 0, turbulence: 0, cover: 'clear', visibilityKm: 60, qnhHpa: 1018 },
  'Buen tiempo': { windFromDeg: 120, windKt: 8, gustKt: 0, turbulence: 0.1, cover: 'few', cloudBaseFt: 4000, visibilityKm: 60, qnhHpa: 1015 },
  'Ventoso con ráfagas': { windFromDeg: 220, windKt: 18, gustKt: 12, turbulence: 0.45, cover: 'scattered', cloudBaseFt: 3000, visibilityKm: 30, qnhHpa: 1008 },
  Nublado: { windFromDeg: 90, windKt: 10, gustKt: 4, turbulence: 0.2, cover: 'broken', cloudBaseFt: 2000, visibilityKm: 15, qnhHpa: 1006 },
  Niebla: { windKt: 2, gustKt: 0, turbulence: 0, cover: 'overcast', cloudBaseFt: 400, visibilityKm: 0.8, qnhHpa: 1016 },
  Tormenta: { windFromDeg: 160, windKt: 25, gustKt: 18, turbulence: 0.9, cover: 'overcast', cloudBaseFt: 1500, visibilityKm: 4, qnhHpa: 997 },
};

/** Traduce la configuración del usuario a parámetros de la física. */
export function toPhysicsEnvironment(w: WeatherSettings): Partial<EnvironmentSettings> {
  return {
    windFromDeg: w.windFromDeg,
    windSpeed: w.windKt * KT,
    gustIntensity: w.gustKt * KT,
    turbulence: w.turbulence,
    isaDeltaT: w.isaDeltaC,
    qnh: w.qnhHpa * 100,
  };
}

/** Texto estilo METAR del viento, p. ej. "220°/18G30 kt". */
export function windText(w: WeatherSettings): string {
  if (w.windKt < 1) return 'Calma';
  const dir = String(Math.round(w.windFromDeg) % 360).padStart(3, '0');
  return `${dir}°/${Math.round(w.windKt)}${w.gustKt >= 1 ? `G${Math.round(w.windKt + w.gustKt)}` : ''} kt`;
}
