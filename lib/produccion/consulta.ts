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
import {
  combinarDiario,
  combinarPorPeriodo,
  esGranularidadHistorica,
  type FilaHistorica,
  type PeriodoRango,
} from "./historica";

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
  /** Días cuyo volumen vino de la carga histórica (para marcarlos en la cuadrícula). */
  diasHistoricos?: Set<string>;
  /**
   * El mes solo tiene cargas MENSUALES: no hay detalle diario que mostrar. La pantalla lo
   * explica en vez de aparecer vacía.
   */
  soloMensual?: boolean;
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
  plantelesHistorico,
}: {
  anio: number;
  mes: number; // 1..12
  filtroPedido?: Record<string, unknown>;
  zona?: string;
  /**
   * Planteles cuya PRODUCCION HISTORICA se debe combinar: `null` = todos, un arreglo =
   * esos. **Omitirlo (undefined) desactiva por completo la carga historica**, que es el
   * comportamiento de siempre — asi una pantalla que no la contemple no cambia en nada.
   * El Asesor lo omite a proposito: su alcance es por cliente y la tabla historica solo
   * tiene volumen por plantel.
   */
  plantelesHistorico?: number[] | null;
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

  // ── Produccion HISTORICA ────────────────────────────────────────────────
  // Se combina aqui, no se mezcla en la tabla de viajes. El sistema tiene precedencia:
  // un dia con viajes completados usa SIEMPRE el dato del sistema y la fila historica de
  // ese dia queda archivada sin graficarse. Nunca se suman las dos fuentes.
  //
  // Si `plantelesHistorico` viene `undefined`, o si no hay filas cargadas, nada de esto
  // hace nada y el resultado es exactamente el de antes.
  const origenHistoricoPorDia = new Map<string, Set<number>>();
  let soloMensual = false;
  if (plantelesHistorico !== undefined) {
    const historicas = await historicaEnRango(desde, hasta, plantelesHistorico);
    if (historicas.length > 0) {
      // El calendario es diario: una fila Mensual no se reparte entre dias. Se detecta
      // para que la pantalla lo DIGA en vez de mostrarse vacia sin explicacion.
      soloMensual =
        historicas.some((f) => f.granularidad === "Mensual") &&
        !historicas.some((f) => f.granularidad === "Diaria");

      // Indice de lo que aporto el sistema, por dia y plantel.
      const sistema = new Map<string, Map<number, number>>();
      for (const [iso, porPlantel] of porDiaPlantel) {
        sistema.set(iso, new Map([...porPlantel].map(([id, p]) => [id, p.m3])));
      }
      const { origenHistorico } = combinarDiario(sistema, historicas);

      // Las combinaciones que si entran se agregan a los indices que ya se venian
      // llenando, con `viajes: 0` (un dato historico es volumen, no tiene viajes).
      const nombre = new Map<number, { nombre: string; zona: string }>();
      if (origenHistorico.size > 0) {
        for (const pl of await prisma.planteles.findMany({
          where: { id: { in: [...new Set([...origenHistorico.values()].flatMap((s2) => [...s2]))] } },
          select: { id: true, nombre: true, zona: true },
        })) {
          nombre.set(pl.id, { nombre: pl.nombre, zona: pl.zona });
        }
      }
      for (const f of historicas) {
        if (f.granularidad !== "Diaria") continue;
        const iso = ymdLocal(new Date(f.fechaMs));
        if (!origenHistorico.get(iso)?.has(f.plantelId)) continue; // gano el sistema
        const meta = nombre.get(f.plantelId);
        if (!meta) continue;

        const dia = porDia.get(iso) ?? { m3: 0, viajes: 0 };
        dia.m3 += f.m3;
        porDia.set(iso, dia);

        const porPlantel = porDiaPlantel.get(iso) ?? new Map<number, ProduccionPlantel>();
        const actual = porPlantel.get(f.plantelId) ?? {
          plantelId: f.plantelId,
          nombre: meta.nombre,
          zona: meta.zona,
          m3: 0,
          viajes: 0,
          plantas: [],
        };
        actual.m3 += f.m3;
        porPlantel.set(f.plantelId, actual);
        porDiaPlantel.set(iso, porPlantel);

        // Si la carga vino con el detalle por PLANTA, alimenta el segundo nivel del
        // desglose igual que un viaje (con `viajes: 0`: un dato historico es volumen).
        // Una fila del plantel completo no aporta nada aqui: no se sabe de que planta
        // salio, y repartirla seria inventarse el dato.
        if (f.plantaId != null) {
          const delDia = porDiaPlanta.get(iso) ?? new Map<number, Map<number, ProduccionPlanta>>();
          const delPlantel = delDia.get(f.plantelId) ?? new Map<number, ProduccionPlanta>();
          const pa = delPlantel.get(f.plantaId) ?? {
            plantaId: f.plantaId,
            nombre: f.plantaNombre ?? "Planta",
            m3: 0,
            viajes: 0,
          };
          pa.m3 += f.m3;
          delPlantel.set(f.plantaId, pa);
          delDia.set(f.plantelId, delPlantel);
          porDiaPlanta.set(iso, delDia);
        }

        const marcados = origenHistoricoPorDia.get(iso) ?? new Set<number>();
        marcados.add(f.plantelId);
        origenHistoricoPorDia.set(iso, marcados);
      }
    }
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

  return {
    porDia,
    porDiaPlantel: desglose,
    // Dias cuyo volumen (de algun plantel) salio de la carga historica: la celda del
    // calendario lleva una marca discreta y el tooltip lo dice.
    diasHistoricos: new Set(origenHistoricoPorDia.keys()),
    soloMensual,
  };
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

/**
 * Primer y último año con producción (para el eje del modo Año).
 *
 * Considera las DOS fuentes: si un año solo tiene carga histórica, tiene que aparecer en
 * el eje — si no, el dato cargado no se podría ver en ninguna parte.
 */
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
  const hist = await prisma.produccion_historica.aggregate({
    where: ids ? { plantel_id: { in: ids } } : {},
    _min: { fecha: true },
    _max: { fecha: true },
  });

  const anios = [filas[0]?.min, filas[0]?.max, hist._min.fecha, hist._max.fecha]
    .filter((d): d is Date => d != null)
    .map((d) => new Date(d).getFullYear());
  if (anios.length === 0) return null;
  return { desde: Math.min(...anios), hasta: Math.max(...anios) };
}

// ─────────────────────────────────────────────────────────────────────────────────────
// PRODUCCION HISTORICA
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Filas de `produccion_historica` de un rango. Devuelve `[]` cuando la tabla esta vacia,
 * que es el caso normal: sin cargas historicas, todo lo de arriba se comporta identico a
 * como se comportaba antes de que existiera esta tabla.
 */
export async function historicaEnRango(
  desde: Date,
  hasta: Date,
  plantelIds: number[] | null,
): Promise<FilaHistorica[]> {
  const filas = await prisma.produccion_historica.findMany({
    where: {
      fecha: { gte: desde, lt: hasta },
      ...(plantelIds && plantelIds.length > 0 ? { plantel_id: { in: plantelIds } } : {}),
    },
    select: {
      fecha: true,
      plantel_id: true,
      planta_id: true,
      planta: { select: { nombre: true } },
      volumen_m3: true,
      granularidad: true,
    },
  });
  return filas
    .filter((f) => esGranularidadHistorica(f.granularidad))
    .map((f) => ({
      fechaMs: f.fecha.getTime(),
      plantelId: f.plantel_id,
      plantaId: f.planta_id,
      plantaNombre: f.planta?.nombre ?? null,
      m3: f.volumen_m3,
      granularidad: f.granularidad as FilaHistorica["granularidad"],
    }));
}

/**
 * Indices de lo que el SISTEMA aporto en un rango: por dia y por mes, con los planteles
 * que tuvieron volumen. Es lo que alimenta la regla de precedencia (el sistema gana) sin
 * tener que recorrer los viajes otra vez desde las reglas puras.
 */
export async function cobertura(
  desde: Date,
  hasta: Date,
  plantelIds: number[] | null,
): Promise<{ dias: Map<string, Set<number>>; meses: Map<string, Set<number>> }> {
  const ids = plantelIds && plantelIds.length > 0 ? plantelIds : null;
  // El dia se arma como TEXTO en SQL, no con `date_trunc` + `new Date(...)`. La columna
  // es `timestamp` SIN zona y guarda la hora local; el driver la devuelve como si fuera
  // UTC, asi que renderizarla en America/Tegucigalpa (UTC-6) retrocede un dia: un viaje
  // del 3 de agosto se reportaba como del 2, y con eso la precedencia del sistema fallaba
  // justo en el dia que tenia que proteger. `to_char` no convierte nada.
  const filas = await prisma.$queryRaw<{ dia: string; mes: string; plantel_id: number }[]>`
    SELECT DISTINCT to_char(p.hora_solicitada, 'YYYY-MM-DD') AS dia,
                    to_char(p.hora_solicitada, 'YYYY-MM') AS mes,
                    p.plantel_id
      FROM viajes v
      JOIN pedidos p ON p.id = v.pedido_id
     WHERE v.estado = ${ESTADO_VIAJE_COMPLETADO}
       AND p.estado_pedido = 'Activo'
       AND p.hora_solicitada >= ${desde}
       AND p.hora_solicitada < ${hasta}
       AND (${ids}::int[] IS NULL OR p.plantel_id = ANY(${ids}::int[]))`;

  const dias = new Map<string, Set<number>>();
  const meses = new Map<string, Set<number>>();
  for (const f of filas) {
    (dias.get(f.dia) ?? dias.set(f.dia, new Set()).get(f.dia)!).add(f.plantel_id);
    (meses.get(f.mes) ?? meses.set(f.mes, new Set()).get(f.mes)!).add(f.plantel_id);
  }
  return { dias, meses };
}

export { combinarDiario, combinarPorPeriodo };
export type { PeriodoRango };
