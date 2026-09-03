// Reporte de TIEMPOS DE DESCARGA Y ESPERAS EN OBRA — reglas puras.
//
// Mide, con los timestamps reales que ya registra el despacho, tres cosas distintas
// que se confunden con facilidad:
//
//  1. **Descarga real vs. programada.** Cuánto tardó el mixer en vaciar, contra el
//     tiempo que se pactó. El tiempo pactado es el mismo campo que la frecuencia
//     entre camiones (`pedidos.frecuencia_entre_camiones_min`): si se prometió un
//     mixer cada 15 min, cada uno tiene 15 min para descargar.
//
//  2. **Espera en obra** (`ts_llegada_real` → `ts_inicio_descarga_real`): el mixer
//     parado en el proyecto, cargado, sin poder descargar. Es desperdicio puro y
//     normalmente la causa está del lado del cliente (cuadrilla no lista, acceso
//     bloqueado, bomba sin montar), así que es un dato negociable y una base objetiva
//     para cobros por demora. Además el concreto sigue envejeciendo en el tambor.
//
//  3. **Cumplimiento del intervalo entre camiones.** No basta con cuánto tarda cada
//     descarga: importa si los camiones LLEGARON al ritmo comprometido. La cifra
//     clave no es el promedio sino la VARIABILIDAD — un promedio de 15 min con
//     intervalos de 5, 25, 8 y 22 es mucho peor operativamente que 18 min constantes.
//
// ── Datos incompletos ────────────────────────────────────────────────────────
// Muchos viajes no tienen todos los `ts_*_real` capturados. NO se excluyen en
// silencio ni se cuentan como cero: cada viaje declara qué le falta, los promedios se
// calculan solo sobre los completos y el resumen dice cuántos son. Un reporte basado
// en el 40 % de los viajes engaña si no se sabe que es el 40 %.

/** Umbrales configurables del reporte (viven en `configuracion`, no en el código). */
export interface UmbralesDescarga {
  /** Espera en obra (min) desde la que un viaje se marca como espera relevante. */
  esperaMin: number;
  /**
   * Variabilidad del intervalo entre llegadas (min) desde la que un pedido se marca.
   * Es el rango máx−mín, no la desviación estándar: es lo que la gente de planta lee
   * sin explicación ("llegaron entre 5 y 25 minutos").
   */
  variabilidadMin: number;
  /**
   * Tolerancia sobre la descarga programada antes de pintar en ámbar (fracción).
   * 0.25 = hasta +25 % se considera aceptable.
   */
  toleranciaPct: number;
}

export const UMBRALES_DESCARGA_DEFAULT: UmbralesDescarga = {
  esperaMin: 15,
  variabilidadMin: 10,
  toleranciaPct: 0.25,
};

/** Un viaje tal como lo necesita el cálculo (sin tipos de Prisma). */
export interface ViajeEntrada {
  viajeId: number;
  pedidoId: number;
  clienteId: number;
  cliente: string;
  proyecto: string | null;
  plantelId: number;
  plantel: string;
  /** Día al que se atribuye (el del pedido, como en el DPCR-08). */
  diaMs: number;
  numero: number; // "viaje N" del cliente ese día
  totalDelPedido: number;
  mixer: string;
  volumen: number;
  llegadaMs: number | null;
  inicioDescargaMs: number | null;
  finDescargaMs: number | null;
  /** Descarga programada (min) = frecuencia entre camiones del pedido. */
  programadaMin: number | null;
}

/** Semáforo de la desviación de descarga. */
export type Tono = "ok" | "warn" | "danger" | "neutro";

/** Un viaje ya analizado, listo para la tabla. */
export interface ViajeAnalizado extends ViajeEntrada {
  /** Duración real de la descarga (min), o null si falta un timestamp. */
  realMin: number | null;
  /** Real − programada (min). Positivo = tardó más de lo pactado. */
  desviacionMin: number | null;
  desviacionPct: number | null;
  tono: Tono;
  /** Llegada → inicio de descarga (min). El mixer parado en obra. */
  esperaMin: number | null;
  /** Espera por encima del umbral configurado. */
  esperaExcesiva: boolean;
  /** Qué le falta a este viaje para poder medirlo (vacío = completo). */
  faltantes: string[];
  /** Tiene los tres timestamps y la descarga programada. */
  completo: boolean;
}

const min = (aMs: number, bMs: number) => (bMs - aMs) / 60000;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Tono de la desviación: verde dentro de lo programado, ámbar hasta la tolerancia
 * (+25 % por defecto), rojo por encima. Sin dato programado no hay semáforo.
 */
export function tonoDesviacion(
  realMin: number | null,
  programadaMin: number | null,
  toleranciaPct: number,
): Tono {
  if (realMin == null || programadaMin == null || programadaMin <= 0) return "neutro";
  if (realMin <= programadaMin) return "ok";
  return realMin <= programadaMin * (1 + toleranciaPct) ? "warn" : "danger";
}

/** Analiza un viaje: duración real, desviación, espera y qué datos le faltan. */
export function analizarViaje(v: ViajeEntrada, u: UmbralesDescarga): ViajeAnalizado {
  const faltantes: string[] = [];
  if (v.llegadaMs == null) faltantes.push("llegada a obra");
  if (v.inicioDescargaMs == null) faltantes.push("inicio de descarga");
  if (v.finDescargaMs == null) faltantes.push("fin de descarga");
  if (v.programadaMin == null || v.programadaMin <= 0) faltantes.push("descarga programada");

  // Cada medida se calcula si TIENE sus dos extremos, aunque al viaje le falte otro
  // dato: un viaje sin fin de descarga igual puede aportar su espera en obra.
  const realMin =
    v.inicioDescargaMs != null && v.finDescargaMs != null
      ? r1(min(v.inicioDescargaMs, v.finDescargaMs))
      : null;
  const esperaMin =
    v.llegadaMs != null && v.inicioDescargaMs != null
      ? r1(min(v.llegadaMs, v.inicioDescargaMs))
      : null;

  const prog = v.programadaMin != null && v.programadaMin > 0 ? v.programadaMin : null;
  const desviacionMin = realMin != null && prog != null ? r1(realMin - prog) : null;
  const desviacionPct =
    realMin != null && prog != null ? Math.round(((realMin - prog) / prog) * 100) : null;

  return {
    ...v,
    realMin,
    desviacionMin,
    desviacionPct,
    tono: tonoDesviacion(realMin, prog, u.toleranciaPct),
    esperaMin,
    // Una espera negativa (inicio antes de la llegada) es un error de captura, no una
    // espera: no se marca como excesiva ni se promedia como si fuera válida.
    esperaExcesiva: esperaMin != null && esperaMin >= u.esperaMin,
    faltantes,
    completo: faltantes.length === 0,
  };
}

/** Fila del resumen por cliente. */
export interface ResumenCliente {
  clienteId: number;
  cliente: string;
  proyecto: string | null;
  viajes: number;
  /** Viajes con los datos completos: sobre estos se calculan los promedios. */
  viajesMedidos: number;
  programadaProm: number | null;
  realProm: number | null;
  desviacionProm: number | null;
  /** Viajes cuya descarga real excedió la programada. */
  fueraDeProgramado: number;
  /** Suma de los minutos que se pasaron de lo programado (solo los que excedieron). */
  minutosExcedidos: number;
  // ── Espera en obra ──
  /** Viajes con espera medible (llegada + inicio de descarga capturados). */
  viajesConEspera: number;
  esperaProm: number | null;
  esperaMax: number | null;
  esperaTotalMin: number;
  esperasSobreUmbral: number;
}

const promedio = (xs: number[]): number | null =>
  xs.length === 0 ? null : r1(xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Resumen por cliente, ordenado por MINUTOS EXCEDIDOS descendente: arriba quedan los
 * proyectos que más capacidad de flota están consumiendo de más.
 */
export function resumirPorCliente(viajes: ViajeAnalizado[]): ResumenCliente[] {
  const porCliente = new Map<number, ViajeAnalizado[]>();
  for (const v of viajes) {
    const arr = porCliente.get(v.clienteId);
    if (arr) arr.push(v);
    else porCliente.set(v.clienteId, [v]);
  }

  const filas: ResumenCliente[] = [];
  for (const [clienteId, vs] of porCliente) {
    const medidos = vs.filter((v) => v.completo);
    // Una espera negativa es error de captura: no entra a los promedios de espera.
    const esperas = vs.map((v) => v.esperaMin).filter((e): e is number => e != null && e >= 0);
    const excedidos = medidos.filter((v) => (v.desviacionMin ?? 0) > 0);

    filas.push({
      clienteId,
      cliente: vs[0].cliente,
      proyecto: vs[0].proyecto,
      viajes: vs.length,
      viajesMedidos: medidos.length,
      programadaProm: promedio(medidos.map((v) => v.programadaMin!)),
      realProm: promedio(medidos.map((v) => v.realMin!)),
      desviacionProm: promedio(medidos.map((v) => v.desviacionMin!)),
      fueraDeProgramado: excedidos.length,
      minutosExcedidos: r1(excedidos.reduce((a, v) => a + (v.desviacionMin ?? 0), 0)),
      viajesConEspera: esperas.length,
      esperaProm: promedio(esperas),
      esperaMax: esperas.length === 0 ? null : r1(Math.max(...esperas)),
      esperaTotalMin: r1(esperas.reduce((a, b) => a + b, 0)),
      esperasSobreUmbral: vs.filter((v) => v.esperaExcesiva).length,
    });
  }
  return filas.sort(
    (a, b) => b.minutosExcedidos - a.minutosExcedidos || a.cliente.localeCompare(b.cliente),
  );
}

/** Cumplimiento del intervalo entre camiones de UN pedido (B5). */
export interface IntervaloPedido {
  pedidoId: number;
  cliente: string;
  proyecto: string | null;
  diaMs: number;
  /** Intervalo configurado en el pedido (min). */
  solicitadoMin: number | null;
  /** Llegadas reales usadas para el cálculo. */
  llegadas: number;
  /** Promedio de los huecos entre llegadas consecutivas (min). */
  realPromMin: number | null;
  minMin: number | null;
  maxMin: number | null;
  /** Rango máx−mín: la cifra que dice si el ritmo fue parejo. */
  variabilidadMin: number | null;
  /** Desviación estándar de los huecos (min), para quien la quiera. */
  desviacionEstandarMin: number | null;
  /** La variabilidad supera el umbral configurado. */
  irregular: boolean;
}

/**
 * Analiza el ritmo real de llegadas de un pedido. Solo tiene sentido con **más de un
 * viaje** con llegada capturada: con una sola llegada no hay intervalo que medir.
 *
 * Se usa el RANGO (máx−mín) como cifra principal y no la desviación estándar porque
 * es la que se lee sin explicación: "llegaron entre 5 y 25 minutos" describe el
 * problema mejor que "σ = 8.4".
 */
export function analizarIntervalos(
  pedido: {
    pedidoId: number;
    cliente: string;
    proyecto: string | null;
    diaMs: number;
    solicitadoMin: number | null;
  },
  llegadasMs: number[],
  u: UmbralesDescarga,
): IntervaloPedido | null {
  const orden = [...llegadasMs].sort((a, b) => a - b);
  if (orden.length < 2) return null;

  const huecos: number[] = [];
  for (let i = 1; i < orden.length; i++) huecos.push(r1(min(orden[i - 1], orden[i])));

  const prom = promedio(huecos)!;
  const mn = r1(Math.min(...huecos));
  const mx = r1(Math.max(...huecos));
  const varianza = huecos.reduce((a, h) => a + (h - prom) ** 2, 0) / huecos.length;

  return {
    ...pedido,
    llegadas: orden.length,
    realPromMin: prom,
    minMin: mn,
    maxMin: mx,
    variabilidadMin: r1(mx - mn),
    desviacionEstandarMin: r1(Math.sqrt(varianza)),
    irregular: mx - mn >= u.variabilidadMin,
  };
}

/** Totales del periodo, con la contabilidad de datos incompletos (B6). */
export interface ResumenPeriodo {
  viajes: number;
  /** Con los tres timestamps y la descarga programada. */
  viajesMedidos: number;
  viajesIncompletos: number;
  /** % de viajes sobre los que se pudo medir. */
  coberturaPct: number;
  programadaProm: number | null;
  realProm: number | null;
  /** Viajes que excedieron lo programado, y su % sobre los medidos. */
  excedieron: number;
  excedieronPct: number | null;
  minutosExcedidos: number;
  /** Cliente con mayor desviación acumulada (null si no hay ninguno que exceda). */
  peorCliente: { cliente: string; minutos: number } | null;
  // ── Espera en obra ──
  viajesConEspera: number;
  esperaProm: number | null;
  esperaTotalMin: number;
  esperasSobreUmbral: number;
  /** Horas-mixer perdidas en espera. */
  horasMixerEspera: number;
  /** Ciclo promedio real del periodo (min), base de la equivalencia. */
  cicloPromMin: number | null;
  /**
   * Equivalencia comprensible: cuántos viajes se habrían podido hacer con las horas
   * perdidas en espera, al ciclo promedio del periodo. `null` si no hay ciclo medible.
   */
  viajesEquivalentes: number | null;
}

/**
 * Totales del periodo. `ciclosMin` son las duraciones de ciclo completo (carga →
 * regreso) medidas en el periodo; se usan para traducir las horas de espera a "viajes
 * que no se pudieron hacer".
 *
 * No recibe los umbrales a proposito: la marca de espera excesiva ya viene decidida
 * viaje por viaje desde `analizarViaje`, asi que aqui solo se cuenta.
 */
export function resumirPeriodo(
  viajes: ViajeAnalizado[],
  porCliente: ResumenCliente[],
  ciclosMin: number[],
): ResumenPeriodo {
  const medidos = viajes.filter((v) => v.completo);
  const esperas = viajes.map((v) => v.esperaMin).filter((e): e is number => e != null && e >= 0);
  const excedieron = medidos.filter((v) => (v.desviacionMin ?? 0) > 0);
  const esperaTotal = r1(esperas.reduce((a, b) => a + b, 0));
  const cicloProm = promedio(ciclosMin);
  const peor = porCliente.find((c) => c.minutosExcedidos > 0);

  return {
    viajes: viajes.length,
    viajesMedidos: medidos.length,
    viajesIncompletos: viajes.length - medidos.length,
    coberturaPct: viajes.length === 0 ? 0 : Math.round((medidos.length / viajes.length) * 100),
    programadaProm: promedio(medidos.map((v) => v.programadaMin!)),
    realProm: promedio(medidos.map((v) => v.realMin!)),
    excedieron: excedieron.length,
    excedieronPct:
      medidos.length === 0 ? null : Math.round((excedieron.length / medidos.length) * 100),
    minutosExcedidos: r1(excedieron.reduce((a, v) => a + (v.desviacionMin ?? 0), 0)),
    peorCliente: peor ? { cliente: peor.cliente, minutos: peor.minutosExcedidos } : null,
    viajesConEspera: esperas.length,
    esperaProm: promedio(esperas),
    esperaTotalMin: esperaTotal,
    esperasSobreUmbral: viajes.filter((v) => v.esperaExcesiva).length,
    horasMixerEspera: r1(esperaTotal / 60),
    cicloPromMin: cicloProm,
    viajesEquivalentes:
      cicloProm != null && cicloProm > 0 ? Math.floor(esperaTotal / cicloProm) : null,
  };
}

/** Columnas por las que se puede ordenar la tabla de detalle. */
export const COLUMNAS_DETALLE = [
  "fecha",
  "cliente",
  "numero",
  "mixer",
  "volumen",
  "llegada",
  "inicioDescarga",
  "finDescarga",
  "programada",
  "real",
  "desviacion",
  "espera",
] as const;

export type ColumnaDetalle = (typeof COLUMNAS_DETALLE)[number];

export function esColumnaDetalle(v: unknown): v is ColumnaDetalle {
  return typeof v === "string" && (COLUMNAS_DETALLE as readonly string[]).includes(v);
}

/**
 * Ordena el detalle por una columna. Los valores ausentes van SIEMPRE al final (en
 * ambas direcciones): un viaje sin dato no debe encabezar el reporte por tener null.
 */
export function ordenarDetalle(
  viajes: ViajeAnalizado[],
  columna: ColumnaDetalle,
  desc: boolean,
): ViajeAnalizado[] {
  const num = (v: ViajeAnalizado): number | null => {
    switch (columna) {
      case "fecha":
        return v.diaMs;
      case "numero":
        return v.numero;
      case "volumen":
        return v.volumen;
      case "llegada":
        return v.llegadaMs;
      case "inicioDescarga":
        return v.inicioDescargaMs;
      case "finDescarga":
        return v.finDescargaMs;
      case "programada":
        return v.programadaMin;
      case "real":
        return v.realMin;
      case "desviacion":
        return v.desviacionMin;
      case "espera":
        return v.esperaMin;
      default:
        return null;
    }
  };
  const texto = (v: ViajeAnalizado) => (columna === "cliente" ? v.cliente : v.mixer);

  return [...viajes].sort((a, b) => {
    if (columna === "cliente" || columna === "mixer") {
      const c = texto(a).localeCompare(texto(b));
      return desc ? -c : c;
    }
    const x = num(a);
    const y = num(b);
    if (x == null && y == null) return a.viajeId - b.viajeId;
    if (x == null) return 1; // los ausentes, al final en las dos direcciones
    if (y == null) return -1;
    return desc ? y - x : x - y;
  });
}
