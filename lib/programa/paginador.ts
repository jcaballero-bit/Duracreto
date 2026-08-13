// PAGINADOR del Programa DPCR-08. Módulo PURO (sin BD, sin React): recibe el
// snapshot del documento y devuelve las HOJAS ya resueltas, con el alto de cada fila.
//
// Por qué existe: antes el corte de página lo decidía el navegador al imprimir, y el
// resultado cambiaba según la máquina (hojas con huecos, bloques empujados). Aquí el
// corte lo decide el sistema: se calcula el alto REAL de cada fila según su contenido
// (un nombre de motorista largo ocupa 2 líneas) y se llena la hoja hasta el alto útil.
// El PDF luego RENDERIZA esos altos de forma explícita, así que lo que este módulo
// calcula es exactamente lo que se imprime: la aritmética no se puede desalinear del
// dibujo. Por ser puro, se prueba con casos de mesa (tests/programa-paginador.test.ts).

import type { FilaSnap, PedidoSnap, SnapshotPrograma } from "./snapshot";

// ── Geometría de la hoja (Carta vertical, en puntos PDF: 1 pt = 1/72") ───────
// CALIBRABLE en un solo lugar. Si se cambia el encabezado ISO del PDF hay que
// ajustar `ALTO_ENCABEZADO_FIJO` para que el alto útil siga cuadrando.
export const PAGINA = { ancho: 612, alto: 792 } as const; // LETTER portrait
export const MARGEN = 18;
/**
 * Alto que consume en cada hoja el bloque repetido (encabezado ISO + franja de
 * fecha/zona + fila de bombas + títulos de columna). Ver `pdf-doc.tsx`.
 *
 * MEDIDO, no calculado: el encabezado dibuja 132 pt, pero la librería consume 140 en
 * la hoja. El valor se obtuvo probando cuántas filas de 14 pt caben antes de que el
 * documento pase a dos hojas (616 pt de cuerpo → 140 de encabezado). Si se cambia el
 * encabezado hay que volver a medirlo: si queda corto, el último bloque de cada hoja
 * se pierde; si queda largo, sobra espacio al pie. La prueba de integración
 * `tests/programa-pdf.test.ts` avisa si se desalinea (compara hojas calculadas contra
 * hojas realmente impresas).
 */
export const ALTO_ENCABEZADO_FIJO = 140;

/**
 * Ancho de cada columna del documento (suman el ancho útil de la hoja: 576 pt).
 * Calibrado con los datos REALES más largos, para que nada se corte:
 * identificador de mixer de 9 caracteres ("23MI50-54"), hora "10:59 a.m.",
 * cliente de 20 caracteres, motorista de 19 y totales de plantel de 3 dígitos.
 * Si se cambia alguno, la suma debe seguir dando 576 (lo verifica una prueba).
 */
export const COLUMNAS = {
  cliente: 112,
  viaje: 20,
  motorista: 82,
  mixer: 46,
  carga: 45,
  llegada: 45,
  finaliza: 45,
  regreso: 45,
  tipo: 91,
  vol: 45,
} as const;

/** Ancho útil de la hoja (lo que suman las columnas). */
export const ANCHO_UTIL = PAGINA.ancho - 2 * MARGEN;

/** Geometría vertical: altos de línea y de cada tipo de fila. */
export interface Geometria {
  /** Alto disponible para el CUERPO en cada hoja. */
  altoUtil: number;
  /** Alto de una línea de texto del cuerpo. */
  altoLinea: number;
  /** Relleno vertical (arriba + abajo) de una celda. */
  padCelda: number;
  /** Alto de la banda "PLANTA: SANY". */
  altoBanda: number;
  altoTituloPlantel: number;
  altoTotalPlantel: number;
  altoSinPedidos: number;
  altoSeparadorCliente: number;
  altoSeparadorPlantel: number;
  altoTotalZona: number;
  /** Caracteres por línea (estimación conservadora) de las celdas que envuelven. */
  charsMotorista: number;
  charsCliente: number;
  charsTipo: number;
}

export const GEOMETRIA: Geometria = {
  altoUtil: PAGINA.alto - 2 * MARGEN - ALTO_ENCABEZADO_FIJO,
  altoLinea: 10,
  padCelda: 4,
  altoBanda: 13,
  altoTituloPlantel: 18,
  altoTotalPlantel: 16,
  altoSinPedidos: 16,
  altoSeparadorCliente: 6,
  altoSeparadorPlantel: 10,
  altoTotalZona: 22,
  // Estimación de caracteres por línea: Helvetica tiene un ancho medio ≈ 0.5em, así
  // que a 8 pt son ~4 pt por carácter. Se redondea a la BAJA (menos caracteres de los
  // que caben) para que el cálculo prefiera dar una línea de más antes que desbordar.
  charsMotorista: 18,
  charsCliente: 25,
  charsTipo: 20,
};

// ── Qué puede ir en una hoja ─────────────────────────────────────────────────

/** Sub-bloque del pedido de un cliente que cabe en UNA hoja. */
export interface BloqueCliente {
  tipo: "bloqueCliente";
  pedidoId: number;
  pedido: PedidoSnap;
  /** Filas (viajes / bandas de planta) que van en esta hoja. */
  filas: FilaSnap[];
  /** Alto de cada fila de `filas`, en el mismo orden (el PDF los aplica tal cual). */
  altosFila: number[];
  /** true del 2º sub-bloque en adelante: la celda de cliente dice "(continuación)". */
  continuacion: boolean;
  /** true solo en el ÚLTIMO sub-bloque: ahí va el "Total" del cliente. */
  conTotal: boolean;
  alto: number;
}

export type ItemPagina =
  | { tipo: "tituloPlantel"; nombre: string; alto: number }
  | { tipo: "sinPedidos"; alto: number }
  | BloqueCliente
  | { tipo: "totalPlantel"; nombre: string; totalM3: number; alto: number }
  | { tipo: "separador"; alto: number }
  | { tipo: "totalZona"; zona: string; totalM3: number; alto: number };

export interface PaginaPrograma {
  items: ItemPagina[];
  /** Alto ocupado por los items (para diagnóstico y para las pruebas). */
  altoUsado: number;
}

// ── Cálculo de altos ─────────────────────────────────────────────────────────

/** Líneas que ocupa un texto en una celda de `chars` caracteres por línea. */
export function lineasDeTexto(texto: string, chars: number): number {
  const t = (texto ?? "").trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / chars));
}

/** Alto de una fila del cuerpo: una fila de viaje crece si el nombre del motorista
 *  no cabe en una línea (es el caso real que descuadraba la impresión del navegador). */
export function altoDeFila(fila: FilaSnap, g: Geometria = GEOMETRIA): number {
  if (fila.tipo === "planta") return g.altoBanda;
  const lineas = Math.max(1, lineasDeTexto(fila.motorista, g.charsMotorista));
  return lineas * g.altoLinea + g.padCelda;
}

/** Alto que necesita la celda combinada de CLIENTE (nombre, proyecto, elemento,
 *  planta y asesor). En un sub-bloque de continuación es solo la línea del nombre. */
export function altoCeldaCliente(
  p: PedidoSnap,
  continuacion: boolean,
  g: Geometria = GEOMETRIA,
): number {
  if (continuacion) {
    const lineas = lineasDeTexto(`${p.cliente} (continuación)`, g.charsCliente);
    return lineas * g.altoLinea + g.padCelda;
  }
  let lineas = lineasDeTexto(p.cliente, g.charsCliente);
  if (p.proyecto) lineas += lineasDeTexto(p.proyecto, g.charsCliente);
  if (p.elemento) lineas += lineasDeTexto(`Elemento: ${p.elemento}`, g.charsCliente);
  if (p.mostrarPlanta) lineas += 1; // etiqueta "Planta: X"
  if (p.asesor) lineas += lineasDeTexto(p.asesor, g.charsCliente);
  return lineas * g.altoLinea + g.padCelda;
}

/** Alto que necesita la celda combinada de TIPO DE CONCRETO (diseño, control de
 *  temperatura, revenimiento, total del pedido y bomba si aplica). */
export function altoCeldaTipo(
  p: PedidoSnap,
  conTotal: boolean,
  g: Geometria = GEOMETRIA,
): number {
  let lineas = lineasDeTexto(p.resistencia, g.charsTipo);
  lineas += lineasDeTexto(p.hielo, g.charsTipo);
  if (p.revenimiento) lineas += 1;
  if (conTotal) lineas += 1;
  if (p.bombaCodigo) lineas += 1;
  return lineas * g.altoLinea + g.padCelda;
}

/**
 * Alto de un sub-bloque: el MÁXIMO entre la suma de sus filas y lo que necesitan sus
 * celdas combinadas. Un cliente de un solo viaje ocupa el alto de su celda de datos,
 * no el de una fila — ignorarlo era otra fuente de descuadre al paginar.
 */
export function altoDeBloque(
  p: PedidoSnap,
  altosFila: number[],
  continuacion: boolean,
  conTotal: boolean,
  g: Geometria = GEOMETRIA,
): number {
  const filas = altosFila.reduce((s, h) => s + h, 0);
  return Math.max(filas, altoCeldaCliente(p, continuacion, g), altoCeldaTipo(p, conTotal, g));
}

// ── Paginación ───────────────────────────────────────────────────────────────

/**
 * Reparte el snapshot en hojas. Reglas:
 *  · Se llena cada hoja hasta el alto útil; el contenido arranca pegado al
 *    encabezado (ninguna hoja queda con espacio en blanco al inicio).
 *  · El título de un plantel nunca queda huérfano al pie: si no cabe con al menos
 *    una fila de contenido, pasa a la hoja siguiente.
 *  · Si el bloque de un cliente no cabe completo, se PARTE: los sub-bloques
 *    siguientes repiten la celda de cliente con "(continuación)" y la numeración de
 *    viaje sigue corrida (los números ya vienen asignados en el snapshot).
 *  · El "Total" del cliente aparece solo al cerrar su último sub-bloque.
 *  · Una banda de planta no queda sola al pie de una hoja (baja con sus viajes).
 */
export function paginarPrograma(
  snap: SnapshotPrograma,
  g: Geometria = GEOMETRIA,
): PaginaPrograma[] {
  const paginas: PaginaPrograma[] = [];
  let actual: ItemPagina[] = [];
  let usado = 0;

  const nuevaHoja = () => {
    paginas.push({ items: actual, altoUsado: usado });
    actual = [];
    usado = 0;
  };
  const libre = () => g.altoUtil - usado;
  /** Reserva espacio para `alto`; si no cabe, abre hoja nueva (salvo hoja vacía). */
  const asegurar = (alto: number) => {
    if (actual.length > 0 && alto > libre()) nuevaHoja();
  };
  const agregar = (item: ItemPagina) => {
    actual.push(item);
    usado += item.alto;
  };

  snap.planteles.forEach((pl, plIdx) => {
    // El título del plantel necesita espacio para él MÁS algo de contenido debajo.
    asegurar(g.altoTituloPlantel + g.altoSinPedidos);
    agregar({ tipo: "tituloPlantel", nombre: pl.nombre, alto: g.altoTituloPlantel });

    if (pl.pedidos.length === 0) {
      // Plantel sin pedidos: aparece igual, con su total en 0.00 m³.
      asegurar(g.altoSinPedidos);
      agregar({ tipo: "sinPedidos", alto: g.altoSinPedidos });
    } else {
      pl.pedidos.forEach((p, idx) => {
        paginarPedido(p, g, { libre, nuevaHoja, agregar, hojaVacia: () => actual.length === 0 });
        // Línea en blanco entre cliente y cliente (no tras el último).
        if (idx < pl.pedidos.length - 1 && g.altoSeparadorCliente <= libre()) {
          agregar({ tipo: "separador", alto: g.altoSeparadorCliente });
        }
      });
    }

    asegurar(g.altoTotalPlantel);
    agregar({
      tipo: "totalPlantel",
      nombre: pl.nombre,
      totalM3: pl.totalM3,
      alto: g.altoTotalPlantel,
    });

    if (plIdx < snap.planteles.length - 1 && g.altoSeparadorPlantel <= libre()) {
      agregar({ tipo: "separador", alto: g.altoSeparadorPlantel });
    }
  });

  // Total de la zona al final del documento.
  asegurar(g.altoTotalZona);
  agregar({
    tipo: "totalZona",
    zona: snap.zona,
    totalM3: snap.totalZona,
    alto: g.altoTotalZona,
  });

  nuevaHoja();
  return paginas;
}

/** Reparte las filas de UN pedido entre las hojas disponibles (ver reglas arriba). */
function paginarPedido(
  p: PedidoSnap,
  g: Geometria,
  hoja: {
    libre: () => number;
    nuevaHoja: () => void;
    agregar: (item: ItemPagina) => void;
    hojaVacia: () => boolean;
  },
): void {
  const altos = p.filas.map((f) => altoDeFila(f, g));
  let i = 0;
  let continuacion = false;

  while (i < p.filas.length) {
    // ¿Cuántas filas caben en lo que queda de la hoja? Se prueba creciendo, porque el
    // alto del bloque no es la simple suma (las celdas combinadas imponen un mínimo).
    let k = 0;
    while (i + k < p.filas.length) {
      const cand = altos.slice(i, i + k + 1);
      const esUltimo = i + k + 1 >= p.filas.length;
      const alto = altoDeBloque(p, cand, continuacion, esUltimo, g);
      if (alto > hoja.libre()) break;
      k += 1;
    }

    // No cabe ni una fila: hoja nueva y se reintenta (si la hoja ya estaba vacía, se
    // fuerza al menos una fila para no ciclar — no puede pasar con la geometría real,
    // pero deja el algoritmo a prueba de configuraciones absurdas).
    if (k === 0) {
      if (!hoja.hojaVacia()) {
        hoja.nuevaHoja();
        continue;
      }
      k = 1;
    }

    // Una banda de planta no se queda sola al pie: si el corte cae justo después de
    // ella, se baja con sus viajes a la hoja siguiente.
    if (k > 1 && i + k < p.filas.length && p.filas[i + k - 1].tipo === "planta") k -= 1;

    const filas = p.filas.slice(i, i + k);
    const altosFila = altos.slice(i, i + k);
    const esUltimo = i + k >= p.filas.length;
    hoja.agregar({
      tipo: "bloqueCliente",
      pedidoId: p.id,
      pedido: p,
      filas,
      altosFila,
      continuacion,
      conTotal: esUltimo, // el Total va SOLO al cerrar el último sub-bloque
      alto: altoDeBloque(p, altosFila, continuacion, esUltimo, g),
    });

    i += k;
    continuacion = true;
    if (i < p.filas.length) hoja.nuevaHoja(); // queda contenido → sigue en otra hoja
  }
}
