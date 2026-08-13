// SNAPSHOT del Programa DPCR-08: los datos del documento ya RESUELTOS y FORMATEADOS
// como JSON plano (sin objetos Date ni relaciones Prisma).
//
// Es la fuente única de la que se alimentan:
//  1. el PDF generado en el servidor (`lib/programa/pdf-doc.tsx`),
//  2. la vista previa en pantalla (`/programa`),
//  3. el archivo histórico (`programas_dpcr08.snapshot_json`), que permite volver a
//     generar el MISMO documento después, aunque la programación ya haya cambiado.
//
// Por eso todo aquí es serializable y el formato de cada texto se decide UNA vez:
// dos renders del mismo snapshot producen el mismo documento.

import { prisma } from "@/lib/prisma";
import { textoResistencia } from "@/lib/formato";
import { compararPlanteles } from "@/lib/planteles-orden";
import { cierreProgramaDe } from "@/lib/motor/config";

/** Versión del FORMATO del snapshot. Si algún día cambia la forma de los datos, se
 *  sube este número y el lector puede seguir entendiendo los snapshots viejos. */
export const VERSION_SNAPSHOT = 1;

/** Datos fijos del encabezado ISO (documento controlado). Son etiquetas por CARGO,
 *  parte del formato: NO se reemplazan por el nombre de quien genera el PDF. */
export const DOC = {
  codigo: "DPCR-08",
  titulo: "PROGRAMA DE ENTREGA DE CONCRETO",
  elaboradoPor: "Jefe de Producción de Concreto",
  aprobadoPor: "Gestor de Calidad",
  edicion: "01",
  fechaEdicion: "1 Junio 2016",
} as const;

/** Paleta ejecutiva (sobria) para diferenciar las bombas: franja + etiqueta. */
export const PALETA_BOMBA = [
  "#1F4E79",
  "#2F6F4E",
  "#B0730D",
  "#5B4B8A",
  "#1C6E7D",
  "#8A3B3B",
];

// ── Forma del snapshot ───────────────────────────────────────────────────────

/** Una fila de viaje del documento (las 8 columnas centrales, ya formateadas). */
export interface ViajeSnap {
  tipo: "viaje";
  /** Número de viaje dentro del pedido, CONTINUO (también cuando se reparte en 2 plantas). */
  num: number | null;
  motorista: string;
  mixer: string;
  carga: string;
  llegada: string;
  finaliza: string;
  regreso: string;
  volumen: string;
}
/** Banda "PLANTA: SANY" cuando un pedido reparte sus viajes entre las 2 plantas. */
export interface BandaPlantaSnap {
  tipo: "planta";
  nombre: string;
}
export type FilaSnap = ViajeSnap | BandaPlantaSnap;

export interface PedidoSnap {
  id: number;
  cliente: string;
  proyecto: string;
  elemento: string;
  /** Nombre de la planta para la etiqueta "Planta: X" (solo en planteles de 2+ plantas). */
  planta: string;
  mostrarPlanta: boolean;
  asesor: string;
  /** "4,000 3/4 C/B" — resistencia + agregado + código de descarga. */
  resistencia: string;
  hielo: string;
  revenimiento: string;
  /** Total del pedido (línea base congelada del programa). */
  totalM3: number;
  bombaCodigo: string | null;
  bombaColor: string | null;
  filas: FilaSnap[];
}

export interface PlantelSnap {
  id: number;
  nombre: string;
  totalM3: number;
  pedidos: PedidoSnap[];
}

export interface SnapshotPrograma {
  formato: number;
  /** "YYYY-MM-DD" */
  fecha: string;
  /** "jueves, 13 de agosto de 2026" */
  fechaLarga: string;
  zona: string;
  doc: typeof DOC;
  /** Bombas que aparecen en el programa del día (código + color de su franja). */
  bombas: { codigo: string; color: string }[];
  planteles: PlantelSnap[];
  totalZona: number;
}

// ── Helpers de formato (deciden el texto UNA vez, al armar el snapshot) ──────

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Hora en formato local del documento: "7:15 a.m.". */
export function hhmm(d: Date | null): string {
  if (!d) return "-";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suf = h < 12 ? "a.m." : "p.m.";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suf}`;
}

/** "Viernes 14 de agosto de 2026" — solo la primera letra en mayúscula (en español
 *  los meses y los "de" van en minúscula; poner cada palabra en mayúscula se lee mal
 *  en un documento formal). */
export function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const txt = new Date(y, m - 1, d).toLocaleDateString("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/** "YYYY-MM-DD" → Date local a medianoche. */
export function diaDesdeIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// ── Construcción del snapshot desde la base de datos ─────────────────────────

// Pedido con sus relaciones (include). Firma laxa para no repetir el tipo Prisma.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PedidoDoc = any;

/** Hora de llegada del PRIMER viaje del pedido (la más temprana), en ms. */
function primeraLlegadaMs(p: PedidoDoc): number {
  const llegadas = p.viajes
    .filter(
      (v: { mixer_id: number | null; hora_llegada_proyecto: Date | null }) =>
        v.mixer_id != null && v.hora_llegada_proyecto != null,
    )
    .map((v: { hora_llegada_proyecto: Date }) => v.hora_llegada_proyecto.getTime());
  return llegadas.length ? Math.min(...llegadas) : 0;
}

/**
 * Arma el snapshot del Programa DPCR-08 de un día y una zona.
 *
 * Reglas de negocio del documento controlado (idénticas a las que ya regían):
 *  · Solo pedidos de PROGRAMA (`es_adicion = false`): las adiciones de Despacho no
 *    forman parte del documento.
 *  · Congelamiento: se incluye el pedido si sigue Activo, o si se canceló DESPUÉS
 *    del cierre (4:00 p.m. del día anterior) — ya estaba publicado.
 *  · Los viajes de adición tampoco aparecen, y el total usa `volumen_programado`.
 *  · Todos los planteles de la zona aparecen, incluso sin pedidos (total 0.00 m³).
 *
 * `filtroExtra` es el filtro por rol (Laboratorista / AsesorRestringido) que viene
 * de `lib/programa/acceso.ts`.
 */
export async function construirSnapshot({
  fecha,
  zona,
  filtroExtra = {},
}: {
  fecha: string;
  zona: string;
  filtroExtra?: Record<string, unknown>;
}): Promise<SnapshotPrograma> {
  const ini = diaDesdeIso(fecha);
  const fin = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 1);
  const cierrePrograma = cierreProgramaDe(ini);

  const [planteles, pedidos] = await Promise.all([
    prisma.planteles.findMany({
      where: { zona },
      include: { plantas: { select: { id: true } } },
    }),
    prisma.pedidos.findMany({
      where: {
        hora_solicitada: { gte: ini, lt: fin },
        plantel: { zona },
        ...filtroExtra,
        es_adicion: false,
        OR: [
          { estado_pedido: "Activo" },
          { estado_pedido: "Cancelado", fecha_cancelacion: { gte: cierrePrograma } },
        ],
      },
      include: {
        cliente: { include: { asesor: { select: { nombre: true } } } },
        diseno: true,
        planta: { select: { nombre: true } },
        bomba: { select: { identificador: true } },
        viajes: {
          where: { es_adicion: false },
          include: {
            mixer: { select: { identificador: true } },
            operador: { select: { nombre: true } },
            planta: { select: { nombre: true } },
          },
          orderBy: { hora_inicio_carga: "asc" },
        },
      },
      orderBy: [{ orden_dia: "asc" }, { hora_solicitada: "asc" }],
    }),
  ]);

  // Color por bomba (una tonalidad por bomba en toda la zona/día).
  const colorBomba = new Map<number, string>();
  const codigoBomba = new Map<number, string>();
  for (const p of pedidos) {
    if (p.bomba_id != null && !colorBomba.has(p.bomba_id)) {
      colorBomba.set(p.bomba_id, PALETA_BOMBA[colorBomba.size % PALETA_BOMBA.length]);
      codigoBomba.set(p.bomba_id, p.bomba?.identificador ?? `#${p.bomba_id}`);
    }
  }

  const plantelesOrd = [...planteles].sort((a, b) => compararPlanteles(a.nombre, b.nombre));

  const plantelesSnap: PlantelSnap[] = plantelesOrd.map((pl) => {
    const suyos = pedidos.filter((p) => p.plantel_id === pl.id);
    const totalM3 = suyos.reduce(
      (s, p) => s + (p.volumen_programado ?? p.volumen_total_m3),
      0,
    );
    // Dentro del plantel, los pedidos van por hora de llegada a obra del primer viaje.
    const ordenados = [...suyos].sort((a, b) => primeraLlegadaMs(a) - primeraLlegadaMs(b));
    const mostrarPlanta = pl.plantas.length >= 2;
    return {
      id: pl.id,
      nombre: pl.nombre,
      totalM3,
      pedidos: ordenados.map((p) => pedidoASnap(p, mostrarPlanta, colorBomba, codigoBomba)),
    };
  });

  return {
    formato: VERSION_SNAPSHOT,
    fecha,
    fechaLarga: fechaLarga(fecha),
    zona,
    doc: DOC,
    bombas: [...colorBomba.entries()].map(([id, color]) => ({
      codigo: codigoBomba.get(id) ?? `#${id}`,
      color,
    })),
    planteles: plantelesSnap,
    totalZona: pedidos.reduce(
      (s, p) => s + (p.volumen_programado ?? p.volumen_total_m3),
      0,
    ),
  };
}

/** Convierte un pedido de BD en su forma de documento (textos ya formateados). */
function pedidoASnap(
  p: PedidoDoc,
  mostrarPlanta: boolean,
  colorBomba: Map<number, string>,
  codigoBomba: Map<number, string>,
): PedidoSnap {
  type ViajeDoc = {
    volumen_asignado_m3: number;
    operador: { nombre: string } | null;
    mixer: { identificador: string | null } | null;
    planta: { nombre: string } | null;
    hora_inicio_carga: Date | null;
    hora_llegada_proyecto: Date | null;
    hora_fin_descarga: Date | null;
    hora_regreso_planta: Date | null;
  };

  const trips: ViajeDoc[] = p.viajes.filter((v: { mixer_id: number | null }) => v.mixer_id != null);
  const codigoDescarga = p.tipo_descarga === "Canal directo" ? "C/C" : "C/B";
  const resistencia = `${textoResistencia(p.diseno)} ${p.diseno.tamano_agregado ?? ""} ${codigoDescarga}`
    .replace(/\s+/g, " ")
    .trim();

  const viajeASnap = (v: ViajeDoc, num: number): ViajeSnap => ({
    tipo: "viaje",
    num,
    motorista: v.operador?.nombre ?? "-",
    mixer: v.mixer?.identificador ?? "-",
    carga: hhmm(v.hora_inicio_carga),
    llegada: hhmm(v.hora_llegada_proyecto),
    finaliza: hhmm(v.hora_fin_descarga),
    regreso: hhmm(v.hora_regreso_planta),
    volumen: `${v.volumen_asignado_m3.toFixed(2)} m³`,
  });

  // ¿Se reparte entre 2+ plantas? Solo entonces se agrupa con banda de planta. En
  // planteles de 1 planta (o si todos cargan en la misma) va plano: la etiqueta
  // "Planta: X" de la celda de cliente ya lo dice.
  const plantasDistintas = new Set(
    trips.map((v) => v.planta?.nombre ?? p.planta?.nombre ?? "-"),
  );
  const agrupar = mostrarPlanta && trips.length > 0 && plantasDistintas.size >= 2;

  const filas: FilaSnap[] = [];
  if (trips.length === 0) {
    // Pedido sin viajes asignados: una fila vacía para que el cliente igual aparezca.
    filas.push({
      tipo: "viaje",
      num: null,
      motorista: "-",
      mixer: "-",
      carga: "-",
      llegada: "-",
      finaliza: "-",
      regreso: "-",
      volumen: "-",
    });
  } else if (!agrupar) {
    trips.forEach((v, i) => filas.push(viajeASnap(v, i + 1)));
  } else {
    // Agrupado por planta, con numeración de viaje CONTINUA entre plantas.
    const porPlanta = new Map<string, ViajeDoc[]>();
    for (const v of trips) {
      const nombre = v.planta?.nombre ?? p.planta?.nombre ?? "-";
      const arr = porPlanta.get(nombre);
      if (arr) arr.push(v);
      else porPlanta.set(nombre, [v]);
    }
    const grupos = [...porPlanta.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let num = 0;
    for (const [nombrePlanta, vs] of grupos) {
      filas.push({ tipo: "planta", nombre: nombrePlanta });
      for (const v of vs) filas.push(viajeASnap(v, ++num));
    }
  }

  return {
    id: p.id,
    cliente: p.cliente.empresa,
    proyecto: p.cliente.proyecto ?? "",
    elemento: p.elemento ?? "",
    planta: p.planta?.nombre ?? "-",
    mostrarPlanta,
    asesor: p.cliente.asesor?.nombre ?? "",
    resistencia,
    hielo:
      p.sacos_hielo_por_m3 > 0
        ? `Temp: ${p.sacos_hielo_por_m3} sacos/m³`
        : "Sin control temp.",
    revenimiento: p.revenimiento || p.diseno.revenimiento || "",
    totalM3: p.volumen_programado ?? p.volumen_total_m3,
    bombaCodigo: p.bomba_id != null ? (codigoBomba.get(p.bomba_id) ?? null) : null,
    bombaColor: p.bomba_id != null ? (colorBomba.get(p.bomba_id) ?? null) : null,
    filas,
  };
}
