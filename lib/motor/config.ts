// ─────────────────────────────────────────────────────────────────────────────
// Parámetros configurables del motor de asignación.
//
// Todo lo "afinable" vive aquí, nunca disperso en la lógica. Ninguno de estos
// valores es un dato de flota (esos se leen de la BD): son parámetros de cálculo
// de tiempos y de la red de seguridad.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Margen mínimo (minutos) entre el regreso a planta de un viaje y el inicio de
 * carga del siguiente viaje del MISMO mixer o bomba. Si un cambio MANUAL deja
 * menos de esto, se emite una alerta NO bloqueante. Configurable.
 */
export const MARGEN_MINIMO_MIN = 10;

/**
 * Tiempos de viaje/regreso por defecto (minutos) cuando el cliente NO tiene una
 * ruta_estandar registrada. Los viajes calculados con estos valores se marcan
 * con `ruta_por_defecto = true` para resaltarlos visualmente.
 */
export const DEFAULT_TIEMPO_VIAJE_MIN = 30;
export const DEFAULT_TIEMPO_REGRESO_MIN = 30;

/**
 * Ritmo de descarga en minutos por m³, según el tipo de descarga.
 * Descarga directa (canaleta) es más rápida que por bombeo.
 */
export const MIN_DESCARGA_POR_M3: Record<string, number> = {
  "Canal directo": 1.5, // descarga por canaleta: la más rápida
  "Bomba estacionaria": 2.5, // por bombeo: más lenta
};
export const MIN_DESCARGA_POR_M3_DEFAULT = 2.0;

/** Tipos de descarga válidos (se usan en el formulario y validación). */
export const TIPOS_DESCARGA = ["Canal directo", "Bomba estacionaria"] as const;

/**
 * Minutos de preparación entre el fin de carga y la salida de planta
 * (revisión, papeleo). Se puede subir si el proceso real lo requiere.
 */
export const MIN_SALIDA_TRAS_CARGA = 0;

/**
 * Hora de apertura por defecto (0-23) para sugerir la hora solicitada de un
 * pedido cuando su planta no tiene nada programado ese día.
 */
export const HORA_APERTURA_POR_DEFECTO = 7;

/**
 * Umbral (minutos) para advertir al insertar un pedido en medio de una cola ya
 * programada: si el recálculo retrasa la llegada esperada de algún cliente ya
 * programado MÁS que esto, se pide confirmación antes de guardar. Configurable.
 */
export const UMBRAL_IMPACTO_INSERCION_MIN = 15;

/**
 * Hora (0-23) del DÍA ANTERIOR en que se "publica" (congela) el Programa DPCR-08
 * de un día. A partir de este instante el documento queda fijo: una cancelación
 * posterior YA NO saca al cliente del programa impreso (permanece como se publicó);
 * una cancelación ANTES de esta hora sí lo elimina del programa. Configurable.
 */
export const HORA_CIERRE_PROGRAMA = 16; // 4:00 PM del día anterior

/**
 * Instante de cierre/publicación del Programa DPCR-08 del día `fecha`: las
 * `HORA_CIERRE_PROGRAMA` horas del día ANTERIOR. Regla pura (sin BD) para decidir
 * si una cancelación debe o no retirar al cliente del documento congelado.
 */
export function cierreProgramaDe(fecha: Date): Date {
  return new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate() - 1,
    HORA_CIERRE_PROGRAMA,
    0,
    0,
    0,
  );
}

/** Estados que dejan a un mixer/bomba fuera del pool asignable. */
export const ESTADO_DISPONIBLE = "Disponible";

/** Estado de un viaje que ya no debe recalcularse. */
export const ESTADO_VIAJE_COMPLETADO = "Completado";

/**
 * Secuencia operativa de estados de un viaje (despacho en vivo). El despachador
 * avanza el viaje por esta cola; cada transición sella la hora real del hito.
 */
export const SECUENCIA_ESTADOS_VIAJE = [
  "Programado",
  "En carga",
  "En ruta",
  "Llegada", // el Laboratorista revisa el concreto en obra ANTES de autorizar descarga
  "Descargando",
  "Regresando",
  "Completado",
] as const;

/**
 * Umbrales (minutos) del semáforo de desvío real vs programado en Despacho.
 * A tiempo/adelantado ≤ VERDE → verde; ≤ AMARILLO → amarillo; mayor → rojo.
 */
export const DESVIO_VERDE_MAX_MIN = 5;
export const DESVIO_AMARILLO_MAX_MIN = 15;
