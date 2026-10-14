import { defaultAutopilot, type AutopilotSettings } from './Autopilot';

/** Comandos del piloto que recibe la física (ya fusionados teclado + joystick + piloto automático). */
export interface ControlInputs {
  /** -1..1, + tirar (nariz arriba) */
  elevator: number;
  /** -1..1, + alabeo derecha */
  aileron: number;
  /** -1..1, + nariz a la derecha */
  rudder: number;
  /** 0..1 */
  throttle: number;
  /** -1..1, + nariz arriba */
  trim: number;
  /** Índice de posición de flaps */
  flapsIndex: number;
  gearDown: boolean;
  /** 0..1 */
  brakeLeft: number;
  brakeRight: number;
  parkingBrake: boolean;
  engineRunning: boolean;
  /** Encendido individual de cada motor (además del general). Vacío = todos encendidos. */
  engineOn: boolean[];
  autopilot: AutopilotSettings;
}

export const neutralControls = (): ControlInputs => ({
  elevator: 0, aileron: 0, rudder: 0, throttle: 0, trim: 0, flapsIndex: 0, gearDown: true,
  brakeLeft: 0, brakeRight: 0, parkingBrake: false, engineRunning: true, engineOn: [], autopilot: defaultAutopilot(),
});

/** Muestra del terreno que el hilo de render le pasa a la física. */
export interface GroundReport {
  /** grados */
  lat: number;
  lon: number;
  /** Altura elipsoidal del suelo (m) */
  height: number;
  /** Normal en ENU local (unitaria, hacia arriba). */
  normalEnu: [number, number, number];
  kind: 'runway' | 'terrain' | 'water';
}

export interface EnvironmentSettings {
  /** Viento medio: dirección DESDE la que sopla (grados verdaderos) y velocidad (m/s). */
  windFromDeg: number;
  windSpeed: number;
  /** Intensidad de ráfagas (m/s, desvío típico). */
  gustIntensity: number;
  /** Turbulencia 0..1 */
  turbulence: number;
  /** Desvío de temperatura ISA (K) */
  isaDeltaT: number;
  /** Presión al nivel del mar (Pa) */
  qnh: number;
  /** Diferencia entre altura elipsoidal y nivel medio del mar (ondulación del geoide, m). */
  geoidOffset: number;
}

export const defaultEnvironment = (): EnvironmentSettings => ({
  windFromDeg: 0, windSpeed: 0, gustIntensity: 0, turbulence: 0, isaDeltaT: 0, qnh: 101325, geoidOffset: 0,
});

export interface InitialConditions {
  /** grados */
  lat: number;
  lon: number;
  /** Altura elipsoidal del suelo en el punto de inicio (si onGround) o del avión (si en vuelo). */
  height: number;
  /** Rumbo verdadero (grados) */
  headingDeg: number;
  onGround: boolean;
  /** Velocidad aerodinámica inicial (m/s) si arranca en vuelo */
  airspeed?: number;
}

export const CrashReason = {
  None: 0,
  Structure: 1,
  HardLanding: 2,
  Water: 3,
  Overspeed: 4,
  Overstress: 5,
} as const;
export type CrashReason = (typeof CrashReason)[keyof typeof CrashReason];

export const crashReasonText: Record<number, string> = {
  0: '',
  1: 'Impacto contra el terreno',
  2: 'Aterrizaje demasiado duro: colapsó el tren',
  3: 'Amerizaje',
  4: 'Falla estructural por exceso de velocidad',
  5: 'Falla estructural por exceso de carga G',
};
