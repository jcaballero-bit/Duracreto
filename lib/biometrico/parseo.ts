/**
 * Interpretación del contenido del archivo del reloj biométrico.
 *
 * Módulo PURO (sin BD): recibe la matriz de texto que devolvió `leerHojaBiff` y produce
 * los registros de asistencia, el resumen y los problemas por fila. Todo lo que decide
 * "qué dice el archivo" vive aquí; lo que decide "qué se guarda" vive en `importar.ts`.
 *
 * Reglas que NO se negocian:
 *  · La fecha viene como `d/M/yyyy` (día primero). Se parsea explícitamente, nunca con
 *    un parser genérico: si se leyera al estilo estadounidense, "8/9/2026" se guardaría
 *    como 8 de septiembre en vez del 9 de agosto — un error silencioso que corrompe el
 *    periodo completo.
 *  · Los cálculos del propio reloj (`Tiempo HE`, `Tiempo Real`, `Jornada Trabajada`…)
 *    se IGNORAN: su lógica no aplica las bandas de recargo de Honduras ni desglosa por
 *    porcentaje. Solo se usan las marcas de entrada y salida, y las horas se calculan
 *    con `calcularHorasTurno` (la misma función que usa la captura manual).
 *  · Si la marca de salida es anterior o igual a la de entrada, el turno cruzó la
 *    medianoche y la salida pertenece al día siguiente.
 */

/** Columnas del archivo (índice desde 0), tal como las exporta el reloj. */
export const COLUMNAS = {
  codigoInterno: 0,
  codigo: 1,
  referencia: 2,
  nombre: 3,
  fecha: 5,
  periodo: 6,
  entradaEsperada: 7,
  salidaEsperada: 8,
  marcaEntrada: 9,
  marcaSalida: 10,
  ausente: 15,
  tiempoHE: 16,
  departamento: 21,
} as const;

/** Encabezados esperados en las columnas que se usan (fila 1 del archivo). */
const ENCABEZADOS_ESPERADOS: [number, string][] = [
  [COLUMNAS.codigo, "Código"],
  [COLUMNAS.nombre, "Nombre"],
  [COLUMNAS.fecha, "Fecha"],
  [COLUMNAS.marcaEntrada, "Marca/Ent."],
  [COLUMNAS.marcaSalida, "Marca/Sal."],
  [COLUMNAS.ausente, "Ausente"],
  [COLUMNAS.departamento, "Departamento"],
];

export type MotivoProblema =
  | "sin_codigo"
  | "fecha_invalida"
  | "hora_invalida"
  | "marca_incompleta"
  | "duplicada";

export interface ProblemaFila {
  /** Número de fila como se ve en Excel (1 = encabezados). */
  fila: number;
  codigo: string;
  nombre: string;
  motivo: MotivoProblema;
  detalle: string;
}

export interface RegistroReloj {
  /** Número de fila del archivo (para poder señalarla en el reporte). */
  fila: number;
  codigo: string;
  nombreReloj: string;
  departamento: string;
  /** Día de la asistencia, a medianoche local. */
  fecha: Date;
  entrada: Date | null;
  salida: Date | null;
  ausente: boolean;
  /** La salida quedó en el día siguiente. */
  cruzaMedianoche: boolean;
  /** Tiene una sola marca: hay que corregirla a mano. */
  incompleta: boolean;
  /** La fila completa del archivo, para trazabilidad. */
  crudo: Record<string, string>;
}

export interface PersonaReloj {
  codigo: string;
  nombreReloj: string;
  departamentos: string[];
  registros: number;
  conMarcas: number;
  ausencias: number;
}

export interface ResumenArchivo {
  filasDatos: number;
  registros: RegistroReloj[];
  problemas: ProblemaFila[];
  personas: PersonaReloj[];
  departamentos: string[];
  /** Rango de fechas DETECTADO en los datos (nunca del nombre del archivo). */
  desde: Date | null;
  hasta: Date | null;
  fechas: string[];
  conMarcas: number;
  ausencias: number;
  incompletas: number;
  crucesMedianoche: number;
  /** Encabezados que no coincidieron con el formato conocido. */
  encabezadosInesperados: string[];
}

// Marcas de acento como clase de caracteres explicita (igual que en columnas.ts):
// escribir el rango literal en el archivo lo deja a merced de la codificacion.
const DIACRITICOS = new RegExp("[\u0300-\u036f]", "g");

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Quita tildes y baja a minúsculas, para comparar encabezados con tolerancia. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fecha en formato `d/M/yyyy` (día primero), a medianoche local. Devuelve null si no
 * calza EXACTAMENTE con ese formato o si el día no existe (p. ej. 31/2/2026).
 */
export function parsearFechaDMY(texto: string): Date | null {
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(anio, mes - 1, dia, 0, 0, 0, 0);
  // Rebote de mes (31/2 se convertiría en 3 de marzo): se rechaza.
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return d;
}

/** Hora `HH:mm` (o `HH:mm:ss`) a minutos del día. Null si no se entiende. */
export function parsearHoraHM(texto: string): number | null {
  const m = texto.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** `True`/`Verdadero`/`1`/`Sí` del reloj → booleano. */
export function esVerdadero(texto: string): boolean {
  const t = normalizar(texto);
  return t === "true" || t === "verdadero" || t === "1" || t === "si" || t === "x";
}

/** Marca de tiempo sobre un día, a partir de minutos del día. */
function enDia(dia: Date, minutos: number, sumarDias = 0): Date {
  return new Date(
    dia.getFullYear(),
    dia.getMonth(),
    dia.getDate() + sumarDias,
    Math.floor(minutos / 60),
    minutos % 60,
    0,
    0,
  );
}

/**
 * Interpreta la hoja completa. Nunca lanza: los problemas se acumulan por fila para
 * que la previsualización los muestre y quien captura decida.
 */
export function interpretarArchivo(filas: string[][]): ResumenArchivo {
  const encabezados = filas[0] ?? [];
  const encabezadosInesperados: string[] = [];
  for (const [idx, esperado] of ENCABEZADOS_ESPERADOS) {
    const real = encabezados[idx] ?? "";
    if (normalizar(real) !== normalizar(esperado)) {
      encabezadosInesperados.push(
        `columna ${idx + 1}: se esperaba "${esperado}" y trae "${real || "(vacía)"}"`,
      );
    }
  }

  const registros: RegistroReloj[] = [];
  const problemas: ProblemaFila[] = [];
  const vistos = new Set<string>();
  const porPersona = new Map<string, PersonaReloj>();
  const departamentos = new Set<string>();
  const fechas = new Set<string>();

  const cel = (fila: string[], i: number) => (fila[i] ?? "").trim();

  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    if (!fila || fila.every((c) => (c ?? "").trim() === "")) continue;
    const numFila = f + 1; // como se ve en Excel

    const codigo = cel(fila, COLUMNAS.codigo);
    const nombreReloj = cel(fila, COLUMNAS.nombre);
    const departamento = cel(fila, COLUMNAS.departamento);
    const textoFecha = cel(fila, COLUMNAS.fecha);

    if (codigo === "") {
      problemas.push({
        fila: numFila,
        codigo: "",
        nombre: nombreReloj,
        motivo: "sin_codigo",
        detalle: "La fila no trae código de empleado, así que no se puede vincular.",
      });
      continue;
    }

    const fecha = parsearFechaDMY(textoFecha);
    if (!fecha) {
      problemas.push({
        fila: numFila,
        codigo,
        nombre: nombreReloj,
        motivo: "fecha_invalida",
        detalle: `La fecha "${textoFecha}" no tiene el formato d/M/yyyy.`,
      });
      continue;
    }

    const clave = `${codigo}|${iso(fecha)}`;
    if (vistos.has(clave)) {
      problemas.push({
        fila: numFila,
        codigo,
        nombre: nombreReloj,
        motivo: "duplicada",
        detalle: `El archivo trae otra fila para el mismo código y el ${iso(fecha)}; se usa la primera.`,
      });
      continue;
    }

    const ausente = esVerdadero(cel(fila, COLUMNAS.ausente));
    const textoEntrada = cel(fila, COLUMNAS.marcaEntrada);
    const textoSalida = cel(fila, COLUMNAS.marcaSalida);
    const minEntrada = textoEntrada === "" ? null : parsearHoraHM(textoEntrada);
    const minSalida = textoSalida === "" ? null : parsearHoraHM(textoSalida);

    if ((textoEntrada !== "" && minEntrada == null) || (textoSalida !== "" && minSalida == null)) {
      problemas.push({
        fila: numFila,
        codigo,
        nombre: nombreReloj,
        motivo: "hora_invalida",
        detalle: `Marca no entendida (entrada "${textoEntrada}", salida "${textoSalida}").`,
      });
      continue;
    }

    const entrada: Date | null = minEntrada == null ? null : enDia(fecha, minEntrada);
    let salida: Date | null = minSalida == null ? null : enDia(fecha, minSalida);
    let cruzaMedianoche = false;

    // Turno nocturno: la salida es anterior o igual a la entrada, así que cayó el día
    // siguiente. Sin esto el cálculo daría horas negativas.
    if (entrada && salida && salida.getTime() <= entrada.getTime()) {
      salida = enDia(fecha, minSalida!, 1);
      cruzaMedianoche = true;
    }

    // Una sola marca: se importa la que existe y la fila queda señalada. NO se inventa
    // la que falta.
    const incompleta = !ausente && ((entrada && !salida) || (!entrada && salida)) ? true : false;
    if (incompleta) {
      problemas.push({
        fila: numFila,
        codigo,
        nombre: nombreReloj,
        motivo: "marca_incompleta",
        detalle: entrada
          ? `Marcó entrada (${textoEntrada}) y no salida: corrígela a mano.`
          : `Marcó salida (${textoSalida}) y no entrada: corrígela a mano.`,
      });
    }

    const crudo: Record<string, string> = {};
    for (let c = 0; c < fila.length; c++) {
      const nombre = (encabezados[c] ?? `col${c + 1}`).trim() || `col${c + 1}`;
      const valor = cel(fila, c);
      if (valor !== "") crudo[nombre] = valor;
    }

    vistos.add(clave);
    fechas.add(iso(fecha));
    if (departamento !== "") departamentos.add(departamento);

    registros.push({
      fila: numFila,
      codigo,
      nombreReloj,
      departamento,
      fecha,
      entrada,
      salida,
      ausente,
      cruzaMedianoche,
      incompleta,
      crudo,
    });

    const p =
      porPersona.get(codigo) ??
      {
        codigo,
        nombreReloj,
        departamentos: [] as string[],
        registros: 0,
        conMarcas: 0,
        ausencias: 0,
      };
    p.registros += 1;
    if (ausente) p.ausencias += 1;
    else if (entrada || salida) p.conMarcas += 1;
    if (departamento !== "" && !p.departamentos.includes(departamento)) {
      p.departamentos.push(departamento);
    }
    if (p.nombreReloj === "" && nombreReloj !== "") p.nombreReloj = nombreReloj;
    porPersona.set(codigo, p);
  }

  const ordenadas = [...fechas].sort();
  const aFecha = (s: string) => {
    const [a, m, d] = s.split("-").map(Number);
    return new Date(a, m - 1, d);
  };

  return {
    filasDatos: Math.max(0, filas.length - 1),
    registros,
    problemas,
    personas: [...porPersona.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)),
    departamentos: [...departamentos].sort(),
    desde: ordenadas.length ? aFecha(ordenadas[0]) : null,
    hasta: ordenadas.length ? aFecha(ordenadas[ordenadas.length - 1]) : null,
    fechas: ordenadas,
    conMarcas: registros.filter((r) => !r.ausente && (r.entrada || r.salida)).length,
    ausencias: registros.filter((r) => r.ausente).length,
    incompletas: registros.filter((r) => r.incompleta).length,
    crucesMedianoche: registros.filter((r) => r.cruzaMedianoche).length,
    encabezadosInesperados,
  };
}
