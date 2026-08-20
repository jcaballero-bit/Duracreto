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
