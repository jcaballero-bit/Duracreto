// Periodos del gráfico de tendencia de producción (módulo PURO).
//
// El gráfico grafica la MISMA producción que el calendario del Panel Principal (viajes
// Completado, atribuidos al día del pedido), pero agrupada por semana, mes o año. Aquí
// solo vive la parte que no toca la base: qué periodos entran en el eje, cómo se
// etiquetan y cuáles son FUTURO.
//
// Dos reglas que distinguen este gráfico del calendario:
//
//  1. **Un periodo sin producción se grafica como CERO.** En el calendario un día vacío
//     se deja en blanco (no se sabe si no se produjo o no se ha capturado); en una línea
//     de tendencia el cero es información: la línea baja y eso es lo que hay que ver.
//
//  2. **Un periodo FUTURO no se grafica.** No es un cero, es "todavía no ocurre", y
//     dibujarlo como cero haría que toda tendencia terminara cayéndose a la nada. La
//     línea se corta en el último periodo que ya empezó. El periodo EN CURSO sí se
//     grafica, con lo que va acumulado: es un dato real, aunque parcial.

/** Granularidad del eje horizontal. */
export type Granularidad = "semana" | "mes" | "anio";

export const GRANULARIDADES: { valor: Granularidad; etiqueta: string }[] = [
  { valor: "semana", etiqueta: "Semana" },
  { valor: "mes", etiqueta: "Mes" },
  { valor: "anio", etiqueta: "Año" },
];

export function esGranularidad(v: unknown): v is Granularidad {
  return v === "semana" || v === "mes" || v === "anio";
}

export interface Periodo {
  /** Inicio, inclusive (medianoche local). */
  desdeMs: number;
  /** Fin, EXCLUSIVO. */
  hastaMs: number;
  /** Clave estable del periodo, la que devuelve la consulta ("2026-W34", "2026-08"). */
  clave: string;
  /** Etiqueta corta del eje ("S34", "ago", "2026"). */
  etiqueta: string;
  /** Etiqueta larga del tooltip ("Semana 34 · 17–23 ago", "agosto de 2026"). */
  etiquetaLarga: string;
  /** El periodo aún no ha empezado: no se grafica (ni como cero). */
  futuro: boolean;
}

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Medianoche local del lunes de la semana que contiene `fecha`. */
export function lunesDe(fecha: Date): Date {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const dow = d.getDay() === 0 ? 7 : d.getDay(); // lunes=1 … domingo=7
  d.setDate(d.getDate() - (dow - 1));
  return d;
}

/**
 * Número y año ISO-8601 de la semana de una fecha. El año ISO puede no coincidir con el
 * año calendario a fin de diciembre / principio de enero (la semana pertenece al año de
 * su jueves), y por eso la clave lleva los dos.
 */
export function semanaIsoDe(fecha: Date): { anio: number; semana: number } {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dow); // al jueves de esa semana
  const anio = d.getUTCFullYear();
  const inicio = Date.UTC(anio, 0, 1);
  const semana = Math.ceil(((d.getTime() - inicio) / 86400000 + 1) / 7);
  return { anio, semana };
}

/**
 * Las semanas ISO del MES indicado, recortadas al mes.
 *
 * Por qué acotado al mes y no "las últimas 12 semanas": el gráfico está al lado del
 * calendario, que muestra un mes; ver semanas de otros meses en la mitad derecha mientras
 * la izquierda muestra agosto no dejaba comparar nada. La navegación en este modo mueve
 * el MES, no un bloque de semanas.
 *
 * **Las semanas del borde se RECORTAN al mes.** Una semana que va del 27 de julio al 2 de
 * agosto aparece bajo agosto contando solo el 1 y el 2. Así la suma de las semanas
 * mostradas es EXACTAMENTE el total del mes — el invariante que se puede verificar contra
 * la otra mitad del panel — y el encabezado no miente diciendo "agosto" sobre volumen de
 * julio. El tooltip dice el rango de días que de verdad se contó, así que un punto bajo
 * en el borde queda explicado en vez de parecer una caída.
 *
 * Ojo con una diferencia que NO es un error: la cuadrícula del calendario va de domingo a
 * sábado y etiqueta cada fila con la semana ISO de su jueves, mientras que la semana ISO
 * real va de lunes a domingo (la convención del resto del sistema: `lunesDe`, Programa
 * Semana). Por eso el total de una fila del calendario y el punto de "esa" semana en el
 * gráfico pueden diferir en un día de volumen; lo que sí cuadra siempre es el total del
 * mes.
 */
export function periodosSemanaDelMes(anio: number, mes: number, ahoraMs: number): Periodo[] {
  const inicioMes = new Date(anio, mes - 1, 1);
  const finMes = new Date(anio, mes, 1); // exclusivo
  const out: Periodo[] = [];

  // Se recorre semana por semana desde el lunes de la semana del día 1.
  let cursor = lunesDe(inicioMes);
  while (cursor.getTime() < finMes.getTime()) {
    const finSemana = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    // Recorte al mes.
    const desde = new Date(Math.max(cursor.getTime(), inicioMes.getTime()));
    const hasta = new Date(Math.min(finSemana.getTime(), finMes.getTime()));
    const { anio: anioIso, semana } = semanaIsoDe(cursor);
    const ultimoDia = new Date(hasta.getTime() - 86400000);
    const parcial = cursor.getTime() < inicioMes.getTime() || finSemana.getTime() > finMes.getTime();
    out.push({
      desdeMs: desde.getTime(),
      hastaMs: hasta.getTime(),
      clave: `${anioIso}-W${String(semana).padStart(2, "0")}`,
      etiqueta: `S${semana}`,
      etiquetaLarga:
        `Semana ${semana} · ${desde.getDate()}` +
        (desde.getMonth() !== ultimoDia.getMonth() ? ` ${MESES_CORTOS[desde.getMonth()]}` : "") +
        ` – ${ultimoDia.getDate()} ${MESES_CORTOS[ultimoDia.getMonth()]}` +
        (parcial ? " (parte de la semana cae en otro mes)" : ""),
      futuro: desde.getTime() > ahoraMs,
    });
    cursor = finSemana;
  }
  return out;
}

/** Los 12 meses de un año calendario. */
export function periodosMes(anio: number, ahoraMs: number): Periodo[] {
  const out: Periodo[] = [];
  for (let m = 0; m < 12; m++) {
    const desde = new Date(anio, m, 1);
    const hasta = new Date(anio, m + 1, 1);
    out.push({
      desdeMs: desde.getTime(),
      hastaMs: hasta.getTime(),
      clave: `${anio}-${String(m + 1).padStart(2, "0")}`,
      etiqueta: MESES_CORTOS[m],
      etiquetaLarga: `${MESES_LARGOS[m]} de ${anio}`,
      futuro: desde.getTime() > ahoraMs,
    });
  }
  return out;
}

/** Un punto por año, de `desdeAnio` a `hastaAnio` inclusive. */
export function periodosAnio(desdeAnio: number, hastaAnio: number, ahoraMs: number): Periodo[] {
  const out: Periodo[] = [];
  for (let a = desdeAnio; a <= hastaAnio; a++) {
    const desde = new Date(a, 0, 1);
    out.push({
      desdeMs: desde.getTime(),
      hastaMs: new Date(a + 1, 0, 1).getTime(),
      clave: String(a),
      etiqueta: String(a),
      etiquetaLarga: `Año ${a}`,
      futuro: desde.getTime() > ahoraMs,
    });
  }
  return out;
}

/** Clave del periodo al que pertenece una fecha, según la granularidad. */
export function claveDe(fecha: Date, g: Granularidad): string {
  if (g === "anio") return String(fecha.getFullYear());
  if (g === "mes") return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
  const { anio, semana } = semanaIsoDe(fecha);
  return `${anio}-W${String(semana).padStart(2, "0")}`;
}

/** Una línea del gráfico: un plantel, o el total agregado. */
export interface Serie {
  /** id del plantel, o `null` para la línea de total. */
  plantelId: number | null;
  nombre: string;
  color: string;
  /** Un valor por periodo, en el mismo orden. `null` = periodo futuro (corta la línea). */
  valores: (number | null)[];
}

/**
 * Arma las series a partir de los volúmenes por (periodo, plantel).
 *
 * `porPeriodoPlantel` viene de la consulta: clave de periodo → id de plantel → m³. Un
 * periodo que no está en el mapa se rellena con 0 (no se produjo), salvo que sea futuro,
 * donde queda `null` para que la línea se corte.
 *
 * Si `plantelIds` es `null` se devuelve UNA sola serie con la suma de todo lo que trae
 * el mapa (el "total" de su alcance). Nunca se mezcla la línea de total con las de
 * plantel: el total aplastaría visualmente a las demás al compartir la escala.
 */
export function armarSeries(
  periodos: Periodo[],
  porPeriodoPlantel: Map<string, Map<number, number>>,
  plantelIds: number[] | null,
  nombrePlantel: (id: number) => string,
  colorPlantel: (id: number) => string,
  etiquetaTotal: string,
  colorTotal: string,
): Serie[] {
  const r1 = (n: number) => Math.round(n * 10) / 10;

  if (plantelIds === null) {
    return [
      {
        plantelId: null,
        nombre: etiquetaTotal,
        color: colorTotal,
        valores: periodos.map((p) => {
          if (p.futuro) return null;
          let s = 0;
          for (const m3 of porPeriodoPlantel.get(p.clave)?.values() ?? []) s += m3;
          return r1(s);
        }),
      },
    ];
  }

  return plantelIds.map((id) => ({
    plantelId: id,
    nombre: nombrePlantel(id),
    color: colorPlantel(id),
    valores: periodos.map((p) =>
      p.futuro ? null : r1(porPeriodoPlantel.get(p.clave)?.get(id) ?? 0),
    ),
  }));
}

/**
 * Máximo de los valores visibles, para escalar el eje vertical al dato y no a un techo
 * fijo. Devuelve al menos 1 para que un periodo entero en cero no divida por cero.
 */
export function maximoVisible(series: Serie[]): number {
  let max = 0;
  for (const s of series) {
    for (const v of s.valores) if (v != null && v > max) max = v;
  }
  return max > 0 ? max : 1;
}

/**
 * Cortes "redondos" del eje vertical (0, …, techo). Se elige un paso de 1/2/5 × 10^n
 * para que las etiquetas sean números legibles en vez de 137.4 / 274.8 / 412.2.
 */
export function cortesEjeY(max: number, divisiones = 4): number[] {
  const crudo = max / divisiones;
  const exp = Math.pow(10, Math.floor(Math.log10(crudo)));
  const norm = crudo / exp;
  const paso = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * exp;
  const out: number[] = [];
  for (let v = 0; v <= max + paso * 0.001; v += paso) out.push(Math.round(v * 100) / 100);
  // Siempre al menos 0 y un techo por encima del máximo.
  if (out[out.length - 1] < max) out.push(Math.round((out[out.length - 1] + paso) * 100) / 100);
  return out;
}

/** Cuántas líneas hacen ilegible el gráfico (se avisa, no se bloquea). */
export const LINEAS_COMODAS = 5;

/**
 * Cookie de preferencia del gráfico (granularidad + selección de planteles). Vive aquí y
 * no en el módulo de la server action porque un archivo `"use server"` solo puede
 * exportar funciones async: una constante o un tipo ahí rompen el build (y `tsc` no lo
 * detecta).
 */
export const COOKIE_TENDENCIA = "tendenciaProd";

/** Lo que la pantalla necesita para dibujar el gráfico. */
export interface DatosTendencia {
  granularidad: Granularidad;
  /** Etiquetas del eje y del tooltip, en orden. */
  periodos: {
    clave: string;
    etiqueta: string;
    etiquetaLarga: string;
    futuro: boolean;
    /** El volumen incluye una carga histórica (se dibuja punteado y se dice en el tooltip). */
    historico?: boolean;
  }[];
  series: Serie[];
  /** Ancla de navegación con la que se pidió (ms del modo Semana, año en los otros). */
  refMs: number;
  anio: number;
  /** Texto del periodo mostrado ("2026", "18 may – 9 ago"). */
  titulo: string;
  /** false = ya no hay más historia hacia atrás / adelante (deshabilita el botón). */
  hayAnterior: boolean;
  haySiguiente: boolean;
}

/** Preferencia guardada en la cookie. Se valida al leerla: viene del navegador. */
export interface PreferenciaTendencia {
  g: Granularidad;
  sel: number[] | null;
}

/** Lee la preferencia de la cookie con tolerancia total a basura. */
export function leerPreferencia(crudo: string | undefined): PreferenciaTendencia {
  const porDefecto: PreferenciaTendencia = { g: "mes", sel: null };
  if (!crudo) return porDefecto;
  try {
    const v = JSON.parse(crudo) as unknown;
    if (typeof v !== "object" || v === null) return porDefecto;
    const o = v as Record<string, unknown>;
    const g = esGranularidad(o.g) ? o.g : "mes";
    const sel =
      Array.isArray(o.sel) && o.sel.every((x) => typeof x === "number" && Number.isInteger(x))
        ? (o.sel as number[])
        : null;
    return { g, sel: sel && sel.length ? sel : null };
  } catch {
    return porDefecto;
  }
}
