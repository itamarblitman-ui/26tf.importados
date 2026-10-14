import type { AircraftConfig } from '../physics/AircraftConfig';
import type { ControlInputs, EnvironmentSettings, GroundReport, InitialConditions } from '../physics/types';

/** Mensajes hilo principal → worker de física. */
export type ToPhysics =
  | { type: 'init'; aircraft: AircraftConfig; initial: InitialConditions; env: EnvironmentSettings }
  | { type: 'reset'; initial: InitialConditions }
  | { type: 'controls'; controls: ControlInputs }
  | { type: 'ground'; ground: GroundReport }
  | { type: 'environment'; env: Partial<EnvironmentSettings> }
  | { type: 'pause'; paused: boolean }
  /** Devuelve un buffer ya consumido para reutilizarlo (evita basura). */
  | { type: 'recycle'; buffer: Float64Array<ArrayBuffer> };

/** Mensajes worker → hilo principal. */
export type FromPhysics =
  | { type: 'ready' }
  | { type: 'state'; buffer: Float64Array<ArrayBuffer>; steps: number }
  | { type: 'error'; message: string };
