// Calificación del desempeño de cada LABORATORISTA — reglas puras.
//
// Mide las dos cosas que se le piden al laboratorista y que el sistema ya registra:
//
//  1. **Llenado de la información.** De los viajes que le tocaba medir, ¿capturó las
//     lecturas? Se cuenta por CAMPO, no por viaje: cada viaje medible espera dos
//     lecturas (revenimiento y temperatura), así que un viaje con revenimiento y sin
//     temperatura cuenta como medio, no como cero. Es más justo y, sobre todo, más
//     informativo: la tabla distingue las lecturas completas de las parciales.
//
//  2. **Finalización del control de calidad de cada cliente.** ¿Cerró el formulario
//     general (`control_calidad_general`) de cada programa que le asignaron? Sin él, el
//     reporte del cliente no se puede emitir, así que es un entregable duro.
//
// ── Qué se cuenta como "le tocaba medir" ────────────────────────────────────
// Solo lo que él pudo hacer, para no calificarlo por algo ajeno:
//
//  · en OBRA, los viajes de sus programas asignados que LLEGARON al proyecto
//    (`ts_llegada_real`): la muestra de obra se toma al llegar el mixer, así que un
//    viaje que no llegó no es un dato que él dejó de tomar;
//  · en PLANTA, los viajes que cargaron en la planta y el día en que estuvo asignado y
//    que ya terminaron de cargar (`ts_fin_carga_real`): la muestra de salida se toma
//    antes de que el mixer salga;
//  · un programa solo se puede FINALIZAR si algo se despachó; los programas sin
//    despacho no entran al denominador.
//
// ── Ausencia no es falla ────────────────────────────────────────────────────
// Un laboratorista sin asignaciones en el periodo NO saca 0 %: sale "sin asignaciones".
// Presentar la ausencia de trabajo como incumplimiento sería una lectura falsa, igual
// que en el reporte de descargas con los viajes sin timestamps.

/**
 * Peso de cada componente en la calificación.
 *
 * El llenado pesa más porque es el trabajo de todo el día y son muchos datos; la
 * finalización es una sola acción por cliente, pero es un entregable duro (sin ella no
 * hay reporte que entregar), así que no puede pesar poco. Están aquí, con nombre, para
 * que cambiarlos sea una línea y no una búsqueda por el código.
 */
export const PESOS = { llenado: 0.6, finalizacion: 0.4 } as const;

/** Cortes del semáforo de la calificación (%). */
export const CORTES_CALIFICACION = { bueno: 90, aceptable: 70 } as const;

export type TonoCalificacion = "ok" | "warn" | "danger" | "neutro";

/** Semáforo de un porcentaje. `null` (sin datos) no es rojo: es neutro. */
export function tonoPct(pct: number | null): TonoCalificacion {
  if (pct == null) return "neutro";
  if (pct >= CORTES_CALIFICACION.bueno) return "ok";
  if (pct >= CORTES_CALIFICACION.aceptable) return "warn";
  return "danger";
}

/** Lo que se cuenta de un laboratorista en el periodo, antes de calificar. */
export interface ConteosLaboratorista {
  laboratoristaId: string;
  nombre: string;
  correo: string;
  zona: string | null;

  // ── Papel de OBRA (asignado a programas) ──
  /** Programas (pedidos) que le asignaron en el periodo. */
  programasAsignados: number;
  /** De esos, los que tuvieron algún viaje despachado (los finalizables). */
  programasFinalizables: number;
  /** De los finalizables, los que tienen el formulario general cerrado. */
  programasFinalizados: number;
  /** Viajes de sus programas que LLEGARON a obra (los medibles en obra). */
  viajesEnObra: number;
  /** De esos, los que tienen revenimiento de obra. */
  revenimientoObra: number;
  /** De esos, los que tienen temperatura de obra. */
  temperaturaObra: number;

  // ── Papel de PLANTA (asignado a la salida de una planta, por día) ──
  /** Días-planta en que estuvo asignado a una planta. */
  turnosPlanta: number;
  /** Viajes que cargaron en su planta esos días (los medibles en planta). */
  viajesEnPlanta: number;
  revenimientoPlanta: number;
  temperaturaPlanta: number;

  // ── Contexto (no entra a la calificación) ──
  /** Muestras (testigos) que marcó. No es obligatorio, así que solo informa. */
  muestras: number;
  /**
   * Minutos entre el hecho (llegada a obra / fin de carga) y la captura de la lectura,
   * uno por lectura medida. Sirve para la mediana de oportunidad.
   */
  demorasMin: number[];
}

/** La calificación ya calculada, lista para la tabla. */
export interface Calificacion extends ConteosLaboratorista {
  /** Campos de lectura esperados (2 por viaje medible, obra + planta). */
  camposEsperados: number;
  /** Campos efectivamente capturados. */
  camposCapturados: number;
  /** % de llenado de la información. `null` si no tenía nada que medir. */
  llenadoPct: number | null;
  /** Viajes medibles con AMBAS lecturas. */
  lecturasCompletas: number;
  /** Viajes medibles con una sola de las dos. */
  lecturasParciales: number;
  /** Viajes medibles sin ninguna lectura. */
  lecturasFaltantes: number;
  /** % de programas finalizados. `null` si no tenía ninguno finalizable. */
  finalizacionPct: number | null;
  /** Programas con despacho que quedaron SIN finalizar (lo accionable). */
  sinFinalizar: number;
  /** Mediana de la demora en capturar (min). `null` si no hay lecturas medidas. */
  demoraMedianaMin: number | null;
  /**
   * Calificación 0–100: promedio ponderado de los componentes que TIENEN datos. Si
   * solo hay uno de los dos, ese vale por el total (no se penaliza por lo que no le
   * tocó). `null` = no tuvo asignaciones en el periodo.
   */
  calificacion: number | null;
  /** No tuvo nada asignado en el periodo: no se le puede calificar. */
  sinAsignaciones: boolean;
}

const pct = (parte: number, total: number): number | null =>
  total === 0 ? null : Math.round((parte / total) * 1000) / 10;

/** Mediana (no promedio): una captura olvidada de 8 h no debe mover el indicador. */
export function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  const v = o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
  return Math.round(v * 10) / 10;
}

/** Califica a un laboratorista a partir de sus conteos del periodo. */
export function calificar(c: ConteosLaboratorista): Calificacion {
  const viajesMedibles = c.viajesEnObra + c.viajesEnPlanta;
  const camposEsperados = viajesMedibles * 2;
  const camposCapturados =
    c.revenimientoObra + c.temperaturaObra + c.revenimientoPlanta + c.temperaturaPlanta;

  // Completas / parciales / faltantes, sumando los dos papeles. Se derivan de los
  // conteos por campo: min(rev, temp) tienen las dos, la diferencia tiene una sola.
  const completas =
    Math.min(c.revenimientoObra, c.temperaturaObra) +
    Math.min(c.revenimientoPlanta, c.temperaturaPlanta);
  const parciales =
    Math.abs(c.revenimientoObra - c.temperaturaObra) +
    Math.abs(c.revenimientoPlanta - c.temperaturaPlanta);

  const llenadoPct = pct(camposCapturados, camposEsperados);
  const finalizacionPct = pct(c.programasFinalizados, c.programasFinalizables);

  // Promedio ponderado de los componentes CON datos: a quien solo hizo trabajo de
  // planta (sin programas asignados) no se le baja la nota por una finalización que
  // nunca le tocó.
  const partes: { valor: number; peso: number }[] = [];
  if (llenadoPct != null) partes.push({ valor: llenadoPct, peso: PESOS.llenado });
  if (finalizacionPct != null) partes.push({ valor: finalizacionPct, peso: PESOS.finalizacion });
  const pesoTotal = partes.reduce((a, p) => a + p.peso, 0);
  const calificacion =
    pesoTotal === 0
      ? null
      : Math.round((partes.reduce((a, p) => a + p.valor * p.peso, 0) / pesoTotal) * 10) / 10;

  return {
    ...c,
    camposEsperados,
    camposCapturados,
    llenadoPct,
    lecturasCompletas: completas,
    lecturasParciales: parciales,
    lecturasFaltantes: viajesMedibles - completas - parciales,
    finalizacionPct,
    sinFinalizar: c.programasFinalizables - c.programasFinalizados,
    demoraMedianaMin: mediana(c.demorasMin),
    calificacion,
    // Ni programas asignados ni turnos de planta: no hubo trabajo que medir.
    sinAsignaciones: c.programasAsignados === 0 && c.turnosPlanta === 0,
  };
}

/**
 * Ordena la tabla: primero los que SÍ tienen calificación (de peor a mejor, porque lo
 * accionable está abajo del ranking), y al final los que no tuvieron asignaciones.
 */
export function ordenarCalificaciones(xs: Calificacion[]): Calificacion[] {
  return [...xs].sort((a, b) => {
    if (a.sinAsignaciones !== b.sinAsignaciones) return a.sinAsignaciones ? 1 : -1;
    if (a.calificacion == null && b.calificacion == null) return a.nombre.localeCompare(b.nombre);
    if (a.calificacion == null) return 1;
    if (b.calificacion == null) return -1;
    return a.calificacion - b.calificacion || a.nombre.localeCompare(b.nombre);
  });
}

/** Totales del equipo, para el encabezado. */
export interface ResumenEquipo {
  laboratoristas: number;
  /** Los que tuvieron algo asignado (sobre los que se puede hablar). */
  evaluados: number;
  llenadoPct: number | null;
  finalizacionPct: number | null;
  /** Programas con despacho que quedaron sin finalizar, en todo el equipo. */
  sinFinalizar: number;
  /** Viajes medibles sin ninguna lectura, en todo el equipo. */
  lecturasFaltantes: number;
  demoraMedianaMin: number | null;
}

/**
 * Resumen del equipo. Los porcentajes se calculan sobre los TOTALES (no como promedio
 * de los porcentajes de cada persona): así quien midió 80 viajes pesa más que quien
 * midió 2, que es lo que describe la operación real.
 */
export function resumirEquipo(xs: Calificacion[]): ResumenEquipo {
  const esperados = xs.reduce((a, x) => a + x.camposEsperados, 0);
  const capturados = xs.reduce((a, x) => a + x.camposCapturados, 0);
  const finalizables = xs.reduce((a, x) => a + x.programasFinalizables, 0);
  const finalizados = xs.reduce((a, x) => a + x.programasFinalizados, 0);
  return {
    laboratoristas: xs.length,
    evaluados: xs.filter((x) => !x.sinAsignaciones).length,
    llenadoPct: pct(capturados, esperados),
    finalizacionPct: pct(finalizados, finalizables),
    sinFinalizar: xs.reduce((a, x) => a + x.sinFinalizar, 0),
    lecturasFaltantes: xs.reduce((a, x) => a + x.lecturasFaltantes, 0),
    demoraMedianaMin: mediana(xs.flatMap((x) => x.demorasMin)),
  };
}
