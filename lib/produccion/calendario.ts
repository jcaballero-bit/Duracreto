// Calendario de PRODUCCIÓN EJECUTADA: la cuadrícula mensual del Panel Principal.
//
// Reemplaza el cuadro que se llevaba a mano en Excel (semanas en filas, días de la
// semana en columnas). Muestra SOLO lo que realmente se despachó —el volumen de los
// viajes en estado Completado— así que no es una vista de planificación: un día futuro
// o sin producción va VACÍO, nunca "0.00 m³" (una columna de ceros repetidos hace
// ruido y esconde el dato que sí importa).
//
// Módulo PURO (sin BD ni React) para poder probar la aritmética del calendario: qué
// semanas cubre el mes, dónde cae cada día, el número de semana ISO, los cortes de la
// escala de color y el promedio por día CON producción.

/** Producción de un día concreto (ya agregada). */
export interface DiaProduccion {
  /** "YYYY-MM-DD" (día local). */
  iso: string;
  /** Día del mes (1..31). */
  dia: number;
  /** m³ despachados (viajes Completado). 0 = sin producción → la celda va vacía. */
  m3: number;
  /** Viajes completados ese día. */
  viajes: number;
  /** false para las celdas de relleno del inicio/fin de la cuadrícula (otro mes). */
  delMes: boolean;
}

/** Una fila del calendario: la semana completa (domingo→sábado) más su total. */
export interface SemanaCalendario {
  /** Número de semana ISO-8601 (la etiqueta "Sem 33" de la izquierda). */
  semanaIso: number;
  /** Siempre 7 celdas, de domingo a sábado. */
  dias: DiaProduccion[];
  /** Total de la semana, contando SOLO los días del mes visible. */
  totalM3: number;
}

/** Etiquetas de columna en minúscula, como las pidió el usuario. */
export const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;

export const MESES = [
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
] as const;

/** "YYYY-MM-DD" de una fecha local (sin pasar por UTC, que correría el día). */
export function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Número de semana ISO-8601: las semanas empiezan en LUNES y la semana 1 es la que
 * contiene el primer jueves del año. Se calcula sobre una copia en UTC para que el
 * horario de verano no desplace la cuenta.
 */
export function semanaIso(fecha: Date): number {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  // Día de la semana con lunes=1 … domingo=7.
  const diaSemana = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Al jueves de esa semana: ese jueves define a qué año ISO pertenece la semana.
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana);
  const inicioAnio = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - inicioAnio) / 86400000 + 1) / 7);
}

/**
 * Arma las filas del calendario de un mes: de la semana que contiene el día 1 hasta
 * la que contiene el último día, con las columnas domingo→sábado. Los huecos del
 * inicio y del final son celdas de otro mes (`delMes: false`), que se dibujan vacías.
 *
 * `porDia` es lo que devolvió la base de datos, indexado por "YYYY-MM-DD"; un día que
 * no esté en el mapa no tuvo producción.
 */
export function armarSemanas(
  anio: number,
  mes: number, // 1..12
  porDia: Map<string, { m3: number; viajes: number }>,
): SemanaCalendario[] {
  const primero = new Date(anio, mes - 1, 1);
  const ultimo = new Date(anio, mes, 0);
  // Retroceder al domingo de la primera semana y avanzar hasta el sábado de la última.
  const desde = new Date(anio, mes - 1, 1 - primero.getDay());
  const hasta = new Date(anio, mes - 1, ultimo.getDate() + (6 - ultimo.getDay()));

  const semanas: SemanaCalendario[] = [];
  const cursor = new Date(desde);
  while (cursor <= hasta) {
    const dias: DiaProduccion[] = [];
    let jueves = new Date(cursor);
    for (let i = 0; i < 7; i++) {
      const iso = ymdLocal(cursor);
      const dato = porDia.get(iso);
      const delMes = cursor.getMonth() === mes - 1 && cursor.getFullYear() === anio;
      if (i === 4) jueves = new Date(cursor); // 5ª columna = jueves (dom…jue)
      dias.push({
        iso,
        dia: cursor.getDate(),
        m3: delMes ? (dato?.m3 ?? 0) : 0,
        viajes: delMes ? (dato?.viajes ?? 0) : 0,
        delMes,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    // La etiqueta de la fila sale del JUEVES: la cuadrícula va domingo→sábado, así que
    // el domingo pertenece a la semana ISO anterior; el jueves siempre cae en la
    // semana ISO que cubre el resto de la fila.
    semanas.push({
      semanaIso: semanaIso(jueves),
      dias,
      totalM3: redondear(dias.reduce((s, d) => s + d.m3, 0)),
    });
  }
  return semanas;
}

/** 1 decimal, sin la cola de coma flotante de sumar valores como 11.75. */
export function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Cortes de la escala de color, calculados sobre el rango REAL del mes visible (no
 * con umbrales fijos: un mes flojo y un mes fuerte deben usar toda la escala). Se
 * reparten por cuantiles sobre los días CON producción, así un solo día excepcional
 * no aplasta al resto en el nivel más claro.
 *
 * Devuelve `niveles - 1` cortes: un valor cae en el nivel i si es <= cortes[i].
 */
export function cortesEscala(valores: number[], niveles = 5): number[] {
  const conDato = valores.filter((v) => v > 0).sort((a, b) => a - b);
  if (conDato.length === 0) return [];
  if (conDato.length === 1) return Array.from({ length: niveles - 1 }, () => conDato[0]);
  const cortes: number[] = [];
  for (let i = 1; i < niveles; i++) {
    const pos = (conDato.length - 1) * (i / niveles);
    const bajo = Math.floor(pos);
    const alto = Math.ceil(pos);
    // Interpolación lineal entre las dos observaciones que rodean el cuantil.
    cortes.push(conDato[bajo] + (conDato[alto] - conDato[bajo]) * (pos - bajo));
  }
  return cortes;
}

/**
 * Nivel de intensidad (1..niveles) de un volumen dentro de la escala. 0 = sin
 * producción: la celda no se colorea ni imprime número.
 */
export function nivelDeVolumen(m3: number, cortes: number[]): number {
  if (!(m3 > 0)) return 0;
  let nivel = 1;
  for (const corte of cortes) {
    if (m3 > corte) nivel++;
  }
  return Math.min(nivel, cortes.length + 1);
}

/**
 * Resumen del mes. El promedio se calcula sobre los días CON producción: un mes con
 * 12 días de despacho no se promedia entre 31 (daría un número que no significa nada
 * para quien planea la operación).
 */
export function resumenMes(semanas: SemanaCalendario[]): {
  totalM3: number;
  diasConProduccion: number;
  promedioPorDia: number;
  maximo: { iso: string; m3: number } | null;
} {
  const dias = semanas.flatMap((s) => s.dias).filter((d) => d.delMes && d.m3 > 0);
  const total = dias.reduce((s, d) => s + d.m3, 0);
  const maximo = dias.reduce<{ iso: string; m3: number } | null>(
    (mejor, d) => (!mejor || d.m3 > mejor.m3 ? { iso: d.iso, m3: d.m3 } : mejor),
    null,
  );
  return {
    totalM3: redondear(total),
    diasConProduccion: dias.length,
    promedioPorDia: dias.length ? redondear(total / dias.length) : 0,
    maximo,
  };
}

/** Mes anterior / siguiente en formato "YYYY-MM" (para la navegación). */
export function mesDesplazado(anio: number, mes: number, delta: number): string {
  const d = new Date(anio, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Lee "YYYY-MM" (el parámetro de la URL); si viene mal, cae al mes en curso. */
export function parsearMes(valor: string | undefined, hoy = new Date()): { anio: number; mes: number } {
  const m = /^(\d{4})-(\d{2})$/.exec((valor ?? "").trim());
  if (m) {
    const anio = Number(m[1]);
    const mes = Number(m[2]);
    if (mes >= 1 && mes <= 12) return { anio, mes };
  }
  return { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
}
