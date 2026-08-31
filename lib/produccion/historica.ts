// Reglas de la PRODUCCION HISTORICA (modulo PURO).
//
// El calendario y el grafico se alimentan de los viajes en estado Completado. Ese
// mecanismo no cambia. La produccion historica —el volumen de periodos anteriores al uso
// del sistema— vive en su propia tabla y se COMBINA aqui, al graficar.
//
// ── Las dos reglas que sostienen la confianza en los numeros ─────────────────────────
//
// 1. **El sistema siempre gana.** Si hay viajes completados para una fecha y plantel, se
//    usa ese dato; la fila historica de ese mismo periodo queda archivada pero no se
//    grafica. NUNCA se suman las dos fuentes: sumarlas duplicaria el volumen, que es
//    exactamente el error que este modulo existe para impedir.
//
// 2. **Un total mensual no se reparte entre dias.** Una fila `Mensual` alimenta solo las
//    vistas de Mes y Ano. No entra al calendario diario ni a la vista de Semana, porque
//    no hay forma honesta de decidir cuanto de ese total cayo cada dia. Cuando eso pasa,
//    la pantalla lo DICE en vez de mostrarse vacia sin explicacion.
//
// 3. **Por PLANTEL o por PLANTA, nunca las dos en el mismo periodo.** Un archivo viejo a
//    veces trae el total del plantel y otras el detalle por planta dosificadora (STALO /
//    SANY). Se admiten los dos, pero cargar el total del plantel Y el de sus plantas para
//    la misma fecha seria contar el mismo volumen dos veces, asi que se RECHAZA al
//    guardar (`conflictoDeAlcance`). Al graficar, las filas por planta se SUMAN a su
//    plantel: el eje de la tendencia y el total del calendario siguen siendo por plantel,
//    y el detalle por planta alimenta el segundo nivel del desglose del calendario.

/** Granularidad con la que se cargo un dato historico. */
export type GranularidadHistorica = "Diaria" | "Mensual";

export const GRANULARIDADES_HISTORICAS: {
  valor: GranularidadHistorica;
  etiqueta: string;
  ayuda: string;
}[] = [
  {
    valor: "Diaria",
    etiqueta: "Diaria",
    ayuda: "Una fila por dia y plantel. Alimenta el calendario y el grafico.",
  },
  {
    valor: "Mensual",
    etiqueta: "Mensual",
    ayuda:
      "Una fila por mes y plantel. Solo alimenta el grafico en Mes y Ano: un total mensual no se puede repartir entre dias.",
  },
];

export function esGranularidadHistorica(v: unknown): v is GranularidadHistorica {
  return v === "Diaria" || v === "Mensual";
}

/** De donde salio un volumen que se esta mostrando. */
export type OrigenDato = "sistema" | "historico";

export const ETIQUETA_ORIGEN: Record<OrigenDato, string> = {
  sistema: "registrado por el sistema",
  historico: "carga historica",
};

/** Una fila de `produccion_historica`, en la forma minima que necesitan las reglas. */
export interface FilaHistorica {
  /** Dia, o primer dia del mes si la granularidad es Mensual. */
  fechaMs: number;
  plantelId: number;
  /**
   * Planta dosificadora, o `null` si la fila es del plantel completo. Las reglas de
   * precedencia trabajan siempre a nivel de PLANTEL (ver `combinarDiario`); la planta
   * solo sirve para el desglose.
   */
  plantaId?: number | null;
  plantaNombre?: string | null;
  m3: number;
  granularidad: GranularidadHistorica;
}

/** "YYYY-MM-DD" en hora LOCAL (la misma convencion del resto del modulo de produccion). */
export function ymd(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}

/** "YYYY-MM" del mes al que pertenece una fecha. */
export function ym(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Combina el volumen DIARIO de las dos fuentes, dia por dia y plantel por plantel.
 *
 * `sistema` es el volumen que ya calcula el sistema (iso -> plantelId -> m3). Solo se
 * agregan los dias y planteles donde el sistema NO tiene nada: ahi manda la regla 1.
 *
 * La precedencia se decide **por PLANTEL**, aunque la fila historica sea de una planta.
 * Es a proposito: si el sistema ya tiene viajes de ese plantel ese dia, no hay forma de
 * saber si el archivo viejo cubria la misma produccion, y sumar seria duplicar. Varias
 * filas del mismo plantel (sus plantas) se suman entre si con normalidad.
 *
 * Devuelve el mapa combinado y, aparte, que combinaciones vinieron de la carga historica,
 * para que la pantalla pueda marcarlas.
 */
export function combinarDiario(
  sistema: Map<string, Map<number, number>>,
  historicas: FilaHistorica[],
): {
  combinado: Map<string, Map<number, number>>;
  /** iso -> planteles cuyo volumen de ese dia salio de la carga historica. */
  origenHistorico: Map<string, Set<number>>;
} {
  // Copia: no se muta lo que calculo el sistema.
  const combinado = new Map<string, Map<number, number>>();
  for (const [iso, porPlantel] of sistema) combinado.set(iso, new Map(porPlantel));
  const origenHistorico = new Map<string, Set<number>>();

  for (const f of historicas) {
    // Regla 2: un total mensual no se reparte entre dias.
    if (f.granularidad !== "Diaria") continue;
    const iso = ymd(new Date(f.fechaMs));
    // Regla 1: si el sistema tiene algo ese dia para ese plantel, gana el sistema.
    if ((sistema.get(iso)?.get(f.plantelId) ?? 0) > 0) continue;

    const porPlantel = combinado.get(iso) ?? new Map<number, number>();
    porPlantel.set(f.plantelId, (porPlantel.get(f.plantelId) ?? 0) + f.m3);
    combinado.set(iso, porPlantel);

    const marcados = origenHistorico.get(iso) ?? new Set<number>();
    marcados.add(f.plantelId);
    origenHistorico.set(iso, marcados);
  }
  return { combinado, origenHistorico };
}

/** Un periodo del eje del grafico, en lo minimo que necesitan las reglas. */
export interface PeriodoRango {
  clave: string;
  desdeMs: number;
  /** EXCLUSIVO. */
  hastaMs: number;
}

/**
 * Combina el volumen por PERIODO del grafico de tendencia.
 *
 * `sistema` viene ya agregado por el sistema (clave de periodo -> plantelId -> m3).
 *
 *  · Las filas `Diaria` se suman al periodo que contiene su dia, salvo los dias donde el
 *    sistema ya tiene volumen de ese plantel (regla 1, aplicada dia por dia).
 *  · Las filas `Mensual` solo entran si `permiteMensual` — o sea, en las vistas de Mes y
 *    Ano — y solo cuando el sistema NO tiene NADA de ese plantel en ese MES: si tuviera
 *    aunque sea un dia, sumar el total del mes duplicaria esos dias.
 *
 * `diasConSistema` dice, por mes y plantel, si el sistema aporto algo; se calcula fuera
 * porque el periodo del grafico puede ser una semana o un ano y hace falta el mes.
 */
export function combinarPorPeriodo(
  periodos: PeriodoRango[],
  sistema: Map<string, Map<number, number>>,
  historicas: FilaHistorica[],
  opciones: {
    permiteMensual: boolean;
    /** "YYYY-MM" -> planteles con volumen del sistema en ese mes. */
    mesesConSistema: Map<string, Set<number>>;
    /** iso -> planteles con volumen del sistema ese dia. */
    diasConSistema: Map<string, Set<number>>;
  },
): {
  combinado: Map<string, Map<number, number>>;
  /** Claves de periodo cuyo volumen incluye algo de la carga historica. */
  periodosHistoricos: Set<string>;
} {
  const combinado = new Map<string, Map<number, number>>();
  for (const [clave, porPlantel] of sistema) combinado.set(clave, new Map(porPlantel));
  const periodosHistoricos = new Set<string>();

  const sumar = (clave: string, plantelId: number, m3: number) => {
    const porPlantel = combinado.get(clave) ?? new Map<number, number>();
    porPlantel.set(plantelId, (porPlantel.get(plantelId) ?? 0) + m3);
    combinado.set(clave, porPlantel);
    periodosHistoricos.add(clave);
  };

  /** Periodo del eje que contiene esta fecha (los periodos no se traslapan). */
  const periodoDe = (ms: number) =>
    periodos.find((p) => ms >= p.desdeMs && ms < p.hastaMs)?.clave ?? null;

  for (const f of historicas) {
    const fecha = new Date(f.fechaMs);
    if (f.granularidad === "Diaria") {
      if (opciones.diasConSistema.get(ymd(fecha))?.has(f.plantelId)) continue; // regla 1
      const clave = periodoDe(f.fechaMs);
      if (clave) sumar(clave, f.plantelId, f.m3);
      continue;
    }
    // Mensual.
    if (!opciones.permiteMensual) continue; // regla 2
    if (opciones.mesesConSistema.get(ym(fecha))?.has(f.plantelId)) continue; // regla 1
    const clave = periodoDe(f.fechaMs);
    if (clave) sumar(clave, f.plantelId, f.m3);
  }
  return { combinado, periodosHistoricos };
}

/**
 * ¿Choca esta carga con datos del sistema? Se usa para AVISAR antes de guardar: la fila se
 * puede guardar igual (queda archivada), pero no se va a graficar.
 */
export function chocaConSistema(
  fila: { fechaMs: number; plantelId: number; granularidad: GranularidadHistorica },
  diasConSistema: Map<string, Set<number>>,
  mesesConSistema: Map<string, Set<number>>,
): boolean {
  const fecha = new Date(fila.fechaMs);
  return fila.granularidad === "Diaria"
    ? (diasConSistema.get(ymd(fecha))?.has(fila.plantelId) ?? false)
    : (mesesConSistema.get(ym(fecha))?.has(fila.plantelId) ?? false);
}

/**
 * Regla 3: no se puede mezclar el total del PLANTEL con el detalle de sus PLANTAS en el
 * mismo periodo, porque el total ya incluye a las plantas y sumarlos duplicaria.
 *
 * `plantasCargadas` son las plantas que ya tienen fila para esa misma fecha, plantel y
 * granularidad (`null` dentro del conjunto = ya hay una fila del plantel completo).
 * Devuelve el motivo del rechazo, o `null` si la fila se puede guardar.
 */
export function conflictoDeAlcance(
  plantaId: number | null,
  plantasCargadas: (number | null)[],
): string | null {
  const hayDelPlantel = plantasCargadas.some((p) => p == null);
  const plantas = plantasCargadas.filter((p): p is number => p != null);

  if (plantaId == null) {
    // Se quiere cargar el total del plantel y ya hay detalle por planta.
    if (plantas.length > 0) {
      return (
        "Ya hay volumen cargado por PLANTA para esa fecha y plantel. Cargar tambien el " +
        "total del plantel contaria el mismo volumen dos veces: elimina el detalle por " +
        "planta o carga solo las plantas."
      );
    }
    return null;
  }
  // Se quiere cargar una planta y ya hay total del plantel.
  if (hayDelPlantel) {
    return (
      "Ya hay volumen cargado para el PLANTEL completo en esa fecha. Cargar tambien una " +
      "planta contaria el mismo volumen dos veces: elimina la fila del plantel o carga " +
      "solo el total."
    );
  }
  return null;
}

/**
 * Normaliza el nombre de un plantel tal como viene en un archivo historico, para poder
 * buscarlo entre los alias recordados: sin acentos, sin mayusculas y sin espacios de mas.
 */
export function normalizarAlias(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
