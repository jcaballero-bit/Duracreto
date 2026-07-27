// Tipos compartidos del motor de asignación.

/** De dónde salió el mixer asignado a un viaje. Se muestra en la interfaz. */
export type Origen =
  | "Flota propia"
  | "Préstamo de zona"
  | "Refuerzo excepcional"
  | "Sin cubrir";

/**
 * Un viaje del plan de capacidad: SOLO capacidad + volumen. El planificador ya
 * NO elige el mixer físico (eso lo hace el agendador, que reutiliza mixers por
 * horario y reparte el desgaste). Solo decide cuántos viajes de cada capacidad.
 */
export interface PlanViaje {
  capacidad: number; // capacidad del mixer que hará este viaje (7 | 9 | 11)
  volumen: number; // volumen real de este viaje (puede ser carga parcial)
}

/** Resultado del planificador de combinación de capacidades para un volumen. */
export interface PlanCombinacion {
  viajes: PlanViaje[];
  volumenSinCubrir: number; // > 0 solo si NO hay ninguna capacidad disponible
}

/** Una sugerencia de refuerzo excepcional (Paso 3, requiere confirmación). */
export interface SugerenciaRefuerzo {
  mixerId: number;
  identificador: string | null;
  capacidad: number;
  plantelId: number;
  plantelNombre: string;
  holguraPlantel: number; // flota libre menos demanda restante del día
  minutosSinViaje: number; // idle: desempate (más = mejor candidato)
}

/** Alerta de margen insuficiente entre viajes consecutivos de una unidad. */
export interface AlertaMargen {
  tipoUnidad: "mixer" | "bomba";
  unidadId: number;
  viajeAnteriorId: number;
  viajeSiguienteId: number;
  margenMin: number; // margen real encontrado (< MARGEN_MINIMO_MIN)
}
