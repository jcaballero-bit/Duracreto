// Lectura de la PRODUCCIÓN EJECUTADA para el calendario del Panel Principal.
//
// Definición de "producido", la MISMA que ya usa el resto del sistema para m³
// suministrados (ver `lib/comercial/metricas.ts`): la suma del volumen REAL cargado
// (`volumen_real_m3`, y si no se editó, el programado) de los viajes en estado
// **Completado**. No entra lo programado que aún no se completó, ni los pedidos
// cancelados.
//
// El día al que se atribuye un viaje es el día del PEDIDO (`hora_solicitada`), igual
// que en el Programa DPCR-08, para que el total de una fecha en el calendario cuadre
// exactamente con el programa de esa fecha.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { ESTADO_VIAJE_COMPLETADO } from "@/lib/motor/config";
import { ymdLocal } from "./calendario";

/** Volumen y viajes de una PLANTA dosificadora en un día (segundo nivel del desglose). */
export interface ProduccionPlanta {
  plantaId: number;
  nombre: string;
  m3: number;
  viajes: number;
}

/** Volumen y viajes de un plantel en un día (para el desglose al hacer clic). */
export interface ProduccionPlantel {
  plantelId: number;
  nombre: string;
  zona: string;
  m3: number;
  viajes: number;
  /**
   * Sus plantas dosificadoras, ordenadas de mayor a menor y sin las que no
   * despacharon. Un plantel de una sola planta trae una sola entrada (Santa Marta y
   * Tegucigalpa son los que tienen dos).
   */
  plantas: ProduccionPlanta[];
}

export interface ProduccionMes {
  /** Totales por día ("YYYY-MM-DD" → m³ y viajes). Un día ausente no tuvo producción. */
  porDia: Map<string, { m3: number; viajes: number }>;
  /**
   * Desglose por día y plantel, ya ordenado de mayor a menor volumen y sin planteles
   * en cero. Es la dimensión del desglose de hoy; cuando exista la clasificación por
   * LÍNEA DE VENTA se agrega otra lista por día al mismo nivel (`DesgloseDia`), sin
   * tocar la cuadrícula ni el resto del componente.
   */
  porDiaPlantel: Map<string, ProduccionPlantel[]>;
}

/**
 * Producción de un mes, respetando el alcance del usuario.
 *
 * `filtroPedido` es el `where` de zona/plantel que ya calcula `filtroPedidoPorZona`
 * (Admin → todo; Programador/Despachador → su zona; JefePlanta → solo los planteles
 * que tiene asignados). `zona` es el filtro adicional del selector de la pantalla.
 */
export async function produccionDelMes({
  anio,
  mes,
  filtroPedido = {},
  zona,
}: {
  anio: number;
  mes: number; // 1..12
  filtroPedido?: Record<string, unknown>;
  zona?: string;
}): Promise<ProduccionMes> {
  const desde = new Date(anio, mes - 1, 1);
  const hasta = new Date(anio, mes, 1);

  const viajes = await prisma.viajes.findMany({
    where: {
      estado: ESTADO_VIAJE_COMPLETADO,
      pedido: {
        hora_solicitada: { gte: desde, lt: hasta },
        estado_pedido: "Activo",
        ...(zona ? { plantel: { zona } } : {}),
        ...filtroPedido,
      },
    },
    select: {
      volumen_asignado_m3: true,
      volumen_real_m3: true,
      // Planta DOSIFICADORA del viaje (un pedido puede repartirse entre las 2 plantas
      // de un plantel, así que el dato va por viaje, no por pedido).
      planta_id: true,
      planta: { select: { nombre: true } },
      pedido: {
        select: {
          hora_solicitada: true,
          plantel_id: true,
          planta_id: true,
          planta: { select: { nombre: true } },
          plantel: { select: { nombre: true, zona: true } },
        },
      },
    },
  });

  const porDia = new Map<string, { m3: number; viajes: number }>();
  const porDiaPlantel = new Map<string, Map<number, ProduccionPlantel>>();
  // Tercer nivel del índice: día → plantel → planta.
  const porDiaPlanta = new Map<string, Map<number, Map<number, ProduccionPlanta>>>();

  for (const v of viajes) {
    const iso = ymdLocal(v.pedido.hora_solicitada);
    // Lo que se DESPACHO: el volumen real si el despachador lo corrigio.
    const m3 = v.volumen_real_m3 ?? v.volumen_asignado_m3;
    const dia = porDia.get(iso) ?? { m3: 0, viajes: 0 };
    dia.m3 += m3;
    dia.viajes += 1;
    porDia.set(iso, dia);

    const porPlantel = porDiaPlantel.get(iso) ?? new Map<number, ProduccionPlantel>();
    const p: ProduccionPlantel = porPlantel.get(v.pedido.plantel_id) ?? {
      plantelId: v.pedido.plantel_id,
      nombre: v.pedido.plantel.nombre,
      zona: v.pedido.plantel.zona,
      m3: 0,
      viajes: 0,
      plantas: [], // se llena al final, desde el indice por planta
    };
    p.m3 += m3;
    p.viajes += 1;
    porPlantel.set(v.pedido.plantel_id, p);
    porDiaPlantel.set(iso, porPlantel);

    // Planta del viaje; si faltara, la del pedido (y si no, queda sin identificar).
    const plantaId = v.planta_id ?? v.pedido.planta_id ?? 0;
    const plantaNombre = v.planta?.nombre ?? v.pedido.planta?.nombre ?? "Sin planta";
    const delDia = porDiaPlanta.get(iso) ?? new Map<number, Map<number, ProduccionPlanta>>();
    const delPlantel = delDia.get(v.pedido.plantel_id) ?? new Map<number, ProduccionPlanta>();
    const pa = delPlantel.get(plantaId) ?? { plantaId, nombre: plantaNombre, m3: 0, viajes: 0 };
    pa.m3 += m3;
    pa.viajes += 1;
    delPlantel.set(plantaId, pa);
    delDia.set(v.pedido.plantel_id, delPlantel);
    porDiaPlanta.set(iso, delDia);
  }

  // Redondeo a 1 decimal (sumar 11.75 + 9.5 + … arrastra cola binaria) y orden por
  // volumen descendente. Los planteles sin producción simplemente no están.
  const r1 = (n: number) => Math.round(n * 10) / 10;
  for (const [iso, d] of porDia) porDia.set(iso, { m3: r1(d.m3), viajes: d.viajes });

  const desglose = new Map<string, ProduccionPlantel[]>();
  for (const [iso, porPlantel] of porDiaPlantel) {
    desglose.set(
      iso,
      [...porPlantel.values()]
        .map((p) => ({
          ...p,
          m3: r1(p.m3),
          plantas: [...(porDiaPlanta.get(iso)?.get(p.plantelId)?.values() ?? [])]
            .map((pa) => ({ ...pa, m3: r1(pa.m3) }))
            .sort((a, b) => b.m3 - a.m3 || a.nombre.localeCompare(b.nombre)),
        }))
        .sort((a, b) => b.m3 - a.m3 || a.nombre.localeCompare(b.nombre)),
    );
  }

  return { porDia, porDiaPlantel: desglose };
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Gráfico de TENDENCIA: volumen por (periodo, plantel)
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Producción agrupada por periodo y plantel, para el gráfico de tendencia.
 *
 * MISMA definición de "producido" que el calendario, para que los números cuadren entre
 * las dos mitades del panel: viajes **Completado** de pedidos activos, volumen REAL
 * (`volumen_real_m3`, y si no se corrigió, el programado), atribuidos al día del PEDIDO.
 *
 * Se agrupa en SQL con `date_trunc` en vez de traer los viajes y sumarlos en memoria:
 * un año de operación son miles de viajes (cientos de KB) y el resultado agrupado son
 * como máximo 7 planteles × 12 periodos = 84 filas. El panel se abre muchas veces al día
 * y la base cobra por transferencia.
 *
 * Ojo con la semana: `date_trunc('week')` de Postgres empieza en LUNES, que es la misma
 * convención de `lunesDe`/`semanaIsoDe` y la del Programa Semana. La clave se arma con
 * `IYYY-IW` (año y semana ISO), no con el año calendario, porque la semana que cruza el
 * 1 de enero pertenece al año de su jueves.
 */
export async function produccionPorPeriodo({
  granularidad,
  desde,
  hasta,
  plantelIds,
}: {
  granularidad: "semana" | "mes" | "anio";
  desde: Date;
  /** EXCLUSIVO. */
  hasta: Date;
  /**
   * Planteles del ALCANCE del usuario (ya validados en el servidor). `null` = sin
   * límite (Administrador). Un arreglo VACÍO devolvería todo, así que quien no tenga
   * ninguno debe pasar `[-1]`.
   */
  plantelIds: number[] | null;
}): Promise<Map<string, Map<number, number>>> {
  const ids = plantelIds && plantelIds.length > 0 ? plantelIds : null;

  // El formato de la clave lo decide `claveDe` en el módulo puro; aquí solo se
  // reproduce en SQL. Es un fragmento de LISTA BLANCA (tres literales elegidos por un
  // switch, nunca texto del usuario), así el filtro de abajo vive en un solo lugar en
  // vez de duplicarse en tres consultas que podrían divergir.
  const FORMATO: Record<typeof granularidad, string> = {
    anio: "YYYY",
    mes: "YYYY-MM",
    // Año y semana ISO: la semana que cruza el 1 de enero pertenece al año de su jueves.
    semana: 'IYYY-"W"IW',
  };
  const clave = Prisma.raw(`to_char(p.hora_solicitada, '${FORMATO[granularidad]}')`);

  const filas = await prisma.$queryRaw<{ clave: string; plantel_id: number; m3: number }[]>`
    SELECT ${clave} AS clave,
           p.plantel_id AS plantel_id,
           sum(coalesce(v.volumen_real_m3, v.volumen_asignado_m3)) AS m3
      FROM viajes v
      JOIN pedidos p ON p.id = v.pedido_id
     WHERE v.estado = ${ESTADO_VIAJE_COMPLETADO}
       AND p.estado_pedido = 'Activo'
       AND p.hora_solicitada >= ${desde}
       AND p.hora_solicitada < ${hasta}
       AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))
     GROUP BY 1, 2`;

  const out = new Map<string, Map<number, number>>();
  for (const f of filas) {
    const porPlantel = out.get(f.clave) ?? new Map<number, number>();
    // `sum()` de Postgres vuelve como string o Decimal según el driver.
    porPlantel.set(f.plantel_id, (porPlantel.get(f.plantel_id) ?? 0) + Number(f.m3));
    out.set(f.clave, porPlantel);
  }
  return out;
}

/** Primer y último año con producción registrada (para el eje del modo Año). */
export async function anosConProduccion(
  plantelIds: number[] | null,
): Promise<{ desde: number; hasta: number } | null> {
  const ids = plantelIds && plantelIds.length > 0 ? plantelIds : null;
  const filas = await prisma.$queryRaw<{ min: Date | null; max: Date | null }[]>`
    SELECT min(p.hora_solicitada) AS min, max(p.hora_solicitada) AS max
      FROM viajes v
      JOIN pedidos p ON p.id = v.pedido_id
     WHERE v.estado = ${ESTADO_VIAJE_COMPLETADO}
       AND p.estado_pedido = 'Activo'
       AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))`;
  const min = filas[0]?.min;
  const max = filas[0]?.max;
  if (!min || !max) return null;
  return { desde: new Date(min).getFullYear(), hasta: new Date(max).getFullYear() };
}
