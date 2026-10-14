import type { Vec3 } from './math/vec3';
import type { Table1D } from './math/table';

/**
 * Definición completa de una aeronave. Todo lo que diferencia un avión de otro vive acá
 * (y en el JSON correspondiente en public/aircraft/). La física no tiene casos especiales.
 *
 * Ejes cuerpo: x adelante, y ala derecha, z abajo. Origen = centro de gravedad. Unidades SI.
 * Ángulos de las tablas en grados; derivadas de estabilidad por radián (adimensionales).
 * Las derivadas de control están expresadas por unidad de comando del piloto (-1..1):
 * elevador +1 = tirar (nariz arriba), alerón +1 = alabeo a la derecha, timón +1 = nariz a la derecha.
 */
export interface AircraftConfig {
  id: string;
  name: string;
  description?: string;
  /** Ruta (relativa a public/) del modelo glTF. */
  model: string;

  mass: {
    /** kg */
    empty: number;
    /** kg, masa de despegue usada por defecto */
    default: number;
    /** Inercias en ejes cuerpo, kg·m² */
    inertia: { ixx: number; iyy: number; izz: number; ixz: number };
  };

  geometry: {
    /** Superficie alar m² */
    wingArea: number;
    /** Envergadura m */
    span: number;
    /** Cuerda media aerodinámica m */
    chord: number;
    /** Factor de Oswald */
    oswald: number;
    /** Posición del ojo del piloto (cuerpo, m) */
    pilotEye: Vec3;
  };

  aero: {
    /** CL limpio vs α (grados), incluye la pérdida. Fuera de rango se usa placa plana. */
    clAlpha: Table1D;
    /** Resistencia extra por separación vs |α| (grados). */
    cdSeparation: Table1D;
    /** Ángulo de pérdida (grados) para la indicación de pérdida. */
    stallAlphaDeg: number;
    cd0: number;
    /** Por radián */
    clQ: number;
    clElevator: number;
    cyBeta: number;
    cyRudder: number;
    cm0: number;
    cmAlpha: number;
    cmQ: number;
    cmAlphaDot: number;
    cmElevator: number;
    cmTrim: number;
    cmFlaps: number;
    /** Momento de picado adicional en pérdida ("quiebre de cabeceo"). */
    cmStallBreak?: number;
    /** Reglaje de fábrica (alabeo/guiñada) que compensa el torque de la hélice en crucero. */
    cl0?: number;
    cn0?: number;
    clBeta: number; // momento de alabeo (Cl, "rolling")
    clP: number;
    clR: number;
    clAileron: number;
    clRudder: number;
    cnBeta: number;
    cnP: number;
    cnR: number;
    cnAileron: number;
    cnRudder: number;
    /** Fracción de la presión dinámica del soplado de hélice que llega a la cola. */
    propwashOnTail: number;
  };

  flaps: {
    /** Posiciones disponibles en grados. */
    detents: number[];
    maxDeg: number;
    /** grados/s */
    rate: number;
    /** ΔCL a flap máximo */
    deltaCl: number;
    /** ΔCD a flap máximo */
    deltaCd: number;
    /** Velocidad máxima con flaps (IAS m/s) — sólo informativa. */
    vfe: number;
  };

  controls: {
    /** Velocidades de deflexión (unidades de comando por segundo) de las superficies. */
    surfaceRate: number;
    /** Velocidad del compensador (unidades por segundo). */
    trimRate: number;
    /** Posición de compensador para el despegue (lista de chequeo). */
    takeoffTrim?: number;
  };

  engines: EngineConfig[];

  gear: {
    retractable: boolean;
    /** segundos para subir/bajar */
    transitTime: number;
    /** ΔCD con el tren abajo (sólo si es retráctil; el fijo va en cd0) */
    deltaCd: number;
    /** Ángulo máximo de la rueda de nariz (grados) */
    steeringDeg: number;
    legs: GearLegConfig[];
  };

  /** Puntos de la estructura que, si tocan el suelo, cuentan como choque (hélice, nariz, panza…). */
  crashPoints: Vec3[];
  /**
   * Puntos que pueden rozar el suelo sin destruir el avión (cola, punteras): generan contacto con
   * fricción y sólo cuentan como choque si el impacto es violento.
   */
  skidPoints?: Vec3[];

  limits: {
    /** Velocidad vertical máxima de contacto antes de romper el tren (m/s). */
    maxTouchdownSpeed: number;
    /** Velocidad nunca exceder (IAS m/s). */
    vne: number;
    /** Velocidad máxima estructural de crucero (IAS m/s); por defecto 0,79·Vne. */
    vno?: number;
    /** Velocidad de pérdida limpia aprox (IAS m/s). */
    vs: number;
    /** Velocidad de rotación (IAS m/s). */
    vr: number;
    /** Velocidad de crucero (IAS m/s). */
    vcruise: number;
  };
}

export interface EngineConfig {
  /** Posición del disco de la hélice (cuerpo, m). */
  position: Vec3;
  /** Potencia máxima al nivel del mar, W. */
  maxPowerW: number;
  /** RPM a potencia máxima. */
  maxRpm: number;
  /** Fracción de torque al ralentí. */
  idleTorqueFraction: number;
  /** Inercia rotacional motor + hélice, kg·m². */
  inertia: number;
  /** Fricción interna: Q = c0 + c1·ω (N·m). */
  frictionC0: number;
  frictionC1: number;
  /** +1 si la hélice gira en sentido horario visto desde la cabina. */
  rotation: 1 | -1;
  /**
   * Fracción de la reacción al torque de la hélice que llega como alabeo neto (el resto lo compensan
   * el reglaje del ala y la deriva). 1 = sin compensación.
   */
  torqueFactor?: number;
  propeller: {
    diameter: number;
    /** Coeficiente de empuje vs relación de avance J */
    ct: Table1D;
    /** Coeficiente de potencia vs J */
    cp: Table1D;
  };
}

export interface GearLegConfig {
  name: string;
  /** Punto de contacto con el amortiguador extendido (cuerpo, m). */
  position: Vec3;
  /** N/m */
  stiffness: number;
  /** N·s/m */
  damping: number;
  /** Carrera máxima (m) */
  maxCompression: number;
  steerable: boolean;
  /** Recibe freno */
  braked: boolean;
  /** Lado para frenos diferenciales: -1 izq, 0 centro, +1 der */
  side: -1 | 0 | 1;
}

export function validateAircraftConfig(c: AircraftConfig): AircraftConfig {
  const fail = (m: string) => { throw new Error(`Configuración de aeronave "${c?.id}": ${m}`); };
  if (!c || typeof c !== 'object') fail('no es un objeto');
  if (!(c.mass?.default > 0)) fail('mass.default inválido');
  if (!(c.geometry?.wingArea > 0)) fail('geometry.wingArea inválido');
  if (!Array.isArray(c.aero?.clAlpha) || c.aero.clAlpha.length < 3) fail('aero.clAlpha inválido');
  for (let i = 1; i < c.aero.clAlpha.length; i++)
    if (c.aero.clAlpha[i][0] <= c.aero.clAlpha[i - 1][0]) fail('aero.clAlpha debe tener α creciente');
  if (!Array.isArray(c.engines) || c.engines.length === 0) fail('se necesita al menos un motor');
  if (!Array.isArray(c.gear?.legs) || c.gear.legs.length < 3) fail('se necesitan al menos 3 patas de tren');
  if (!Array.isArray(c.flaps?.detents) || c.flaps.detents.length === 0) fail('flaps.detents vacío');
  return c;
}
