// Estados MOMENTÁNEOS de una unidad (mixer/bomba/camión/pickup), para el cambio
// rápido día a día en /flota. "Disponible" es el ÚNICO asignable por el motor; los
// demás dejan la unidad fuera de asignación mientras estén activos. La baja por un
// RANGO de días (mantenimiento programado) sigue en `disponibilidad_flota`.
export const ESTADOS_UNIDAD = [
  "Disponible",
  "En mantenimiento",
  "Fuera de servicio",
  "Dañado",
] as const;

export type EstadoUnidad = (typeof ESTADOS_UNIDAD)[number];
