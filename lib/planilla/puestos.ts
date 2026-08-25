/**
 * Puestos del personal operativo.
 *
 * La tabla se llama `operadores` por historia (la referencian
 * `mixers.operador_asignado_id`, `viajes.operador_id` y el framework de catálogos),
 * pero ya no guarda solo motoristas de mixer: guarda a todo el personal operativo
 * cuyas horas entran a la planilla. El puesto es el que agrupa la planilla y el que
 * decide quién puede ir como motorista de un viaje.
 */
export const PUESTOS = [
  "Dosificador",
  "Operador_Cargadora",
  "Operador_Bomba",
  "Motorista_Camion",
  "Motorista_Mixer",
  "Otro",
] as const;

export type Puesto = (typeof PUESTOS)[number];

/** Etiqueta legible (los guiones bajos son del dato, no de la pantalla). */
export const ETIQUETA_PUESTO: Record<Puesto, string> = {
  Dosificador: "Dosificadores",
  Operador_Cargadora: "Operadores de cargadora",
  Operador_Bomba: "Operadores de bomba",
  Motorista_Camion: "Motoristas de camión",
  Motorista_Mixer: "Motoristas de mixer",
  Otro: "Otros",
};

/** Etiqueta en singular (formularios y columnas). */
export const ETIQUETA_PUESTO_SINGULAR: Record<Puesto, string> = {
  Dosificador: "Dosificador",
  Operador_Cargadora: "Operador de cargadora",
  Operador_Bomba: "Operador de bomba",
  Motorista_Camion: "Motorista de camión",
  Motorista_Mixer: "Motorista de mixer",
  Otro: "Otro",
};

/** Orden de presentación de los grupos en la planilla. */
export const ORDEN_PUESTOS: Puesto[] = [
  "Motorista_Mixer",
  "Motorista_Camion",
  "Dosificador",
  "Operador_Cargadora",
  "Operador_Bomba",
  "Otro",
];

export function esPuesto(v: string): v is Puesto {
  return (PUESTOS as readonly string[]).includes(v);
}

/** Etiqueta segura para un valor que viene de la BD (puede ser un puesto viejo). */
export function etiquetaPuesto(v: string): string {
  return esPuesto(v) ? ETIQUETA_PUESTO[v] : v;
}

/**
 * Puestos que pueden ir como MOTORISTA de un viaje de mixer. Se usa para que, al
 * generalizar la tabla, los dosificadores y operadores de cargadora no aparezcan en
 * el desplegable de motorista de Despacho.
 */
export const PUESTOS_MOTORISTA_MIXER: Puesto[] = ["Motorista_Mixer", "Otro"];
