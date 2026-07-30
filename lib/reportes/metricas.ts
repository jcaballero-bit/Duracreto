// Indicadores operativos (Hito 7 / panel de reportes). Cálculo directo sobre los
// pedidos+viajes del periodo. La definición de "suministrado/despachado" es
// consistente con el resto: viajes en estado `Completado`.
import { prisma } from "@/lib/prisma";
import { DESVIO_AMARILLO_MAX_MIN } from "@/lib/motor/config";

/** Jornada operativa estándar (horas) para estimar la utilización de flota.
 *  Aproximación documentada: no hay reloj de turno por plantel. */
const JORNADA_HORAS = 10;

export interface FiltroReportes {
  desde: Date;
  hasta: Date; // exclusivo
  plantelId: number | null; // null = todos los planteles permitidos
}

export interface BarraDia {
  fechaMs: number;
  label: string; // "dd/mm"
  m3: number;
}
export interface CicloPlantel {
  plantel: string;
  realMin: number | null; // ciclo real promedio (min)
  refMin: number | null; // ciclo de referencia del motor (min)
  viajes: number;
}
export interface ResumenReportes {
  llegadasATiempoPct: number | null;
  llegadasTotal: number;
  cargasEnFormaPct: number | null;
  cargasTotal: number;
  volumenM3: number;
  cumplimientoPct: number | null;
  pedidosTotal: number;
  pedidosCompletados: number;
  pedidosCancelados: number;
  utilizacionPct: number | null;
  volumenPorDia: BarraDia[];
  cicloPorPlantel: CicloPlantel[];
}

const redondear = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pad = (n: number) => String(n).padStart(2, "0");

export async function calcularReportes(f: FiltroReportes): Promise<ResumenReportes> {
  const pedidos = await prisma.pedidos.findMany({
    where: {
      hora_solicitada: { gte: f.desde, lt: f.hasta },
      ...(f.plantelId != null ? { plantel_id: f.plantelId } : {}),
    },
    select: {
      hora_solicitada: true,
      estado_pedido: true,
      plantel: { select: { nombre: true } },
      planta: { select: { capacidad_m3h: true, tiempo_alistamiento_min: true } },
      viajes: {
        select: {
          estado: true,
          volumen_asignado_m3: true,
          hora_inicio_carga: true,
          hora_llegada_proyecto: true,
          hora_regreso_planta: true,
          ts_inicio_carga_real: true,
          ts_fin_carga_real: true,
          ts_llegada_real: true,
          ts_regreso_real: true,
        },
      },
    },
  });

  let volumenM3 = 0;
  const porDia = new Map<number, number>();
  let llegAT = 0;
  let llegTot = 0;
  let cargaOK = 0;
  let cargaTot = 0;
  const ciclo = new Map<string, { realSum: number; realN: number; refSum: number; refN: number; viajes: number }>();
  let pedTotal = 0;
  let pedCancel = 0;
  let pedCompletados = 0;
  let ocupadoMs = 0;

  const diaMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  for (const p of pedidos) {
    pedTotal += 1;
    if (p.estado_pedido === "Cancelado") pedCancel += 1;

    const conMixer = p.viajes;
    const esPedidoCompletado =
      p.estado_pedido !== "Cancelado" &&
      conMixer.length > 0 &&
      conMixer.every((v) => v.estado === "Completado");
    if (esPedidoCompletado) pedCompletados += 1;

    const nom = p.plantel.nombre;
    let c = ciclo.get(nom);
    if (!c) {
      c = { realSum: 0, realN: 0, refSum: 0, refN: 0, viajes: 0 };
      ciclo.set(nom, c);
    }

    for (const v of conMixer) {
      if (v.estado === "Completado") {
        volumenM3 += v.volumen_asignado_m3;
        const k = diaMs(p.hora_solicitada);
        porDia.set(k, (porDia.get(k) ?? 0) + v.volumen_asignado_m3);
        c.viajes += 1;
      }
      // Llegadas a tiempo (real vs programado de llegada).
      if (v.ts_llegada_real && v.hora_llegada_proyecto) {
        llegTot += 1;
        const desvio = Math.abs(
          (v.ts_llegada_real.getTime() - v.hora_llegada_proyecto.getTime()) / 60000,
        );
        if (desvio <= DESVIO_AMARILLO_MAX_MIN) llegAT += 1;
      }
      // Cargas en tiempo y forma (duración real vs esperada de la planta).
      if (v.ts_inicio_carga_real && v.ts_fin_carga_real) {
        cargaTot += 1;
        const realMin = (v.ts_fin_carga_real.getTime() - v.ts_inicio_carga_real.getTime()) / 60000;
        const esperadoMin =
          p.planta.tiempo_alistamiento_min +
          (v.volumen_asignado_m3 / p.planta.capacidad_m3h) * 60;
        if (realMin <= esperadoMin + DESVIO_AMARILLO_MAX_MIN) cargaOK += 1;
      }
      // Tiempo ocupado real (para utilización).
      if (v.ts_inicio_carga_real && v.ts_regreso_real) {
        ocupadoMs += v.ts_regreso_real.getTime() - v.ts_inicio_carga_real.getTime();
      }
      // Ciclo real y de referencia.
      if (v.ts_inicio_carga_real && v.ts_regreso_real) {
        c.realSum += (v.ts_regreso_real.getTime() - v.ts_inicio_carga_real.getTime()) / 60000;
        c.realN += 1;
      }
      if (v.hora_inicio_carga && v.hora_regreso_planta) {
        c.refSum += (v.hora_regreso_planta.getTime() - v.hora_inicio_carga.getTime()) / 60000;
        c.refN += 1;
      }
    }
  }

  // Serie por día (todos los días del rango, con 0 donde no hubo).
  const volumenPorDia: BarraDia[] = [];
  for (let t = diaMs(f.desde); t < f.hasta.getTime(); ) {
    const d = new Date(t);
    volumenPorDia.push({
      fechaMs: t,
      label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
      m3: redondear(porDia.get(t) ?? 0),
    });
    d.setDate(d.getDate() + 1);
    t = d.getTime();
  }

  // Utilización: ocupado real / (mixers del alcance × días × jornada).
  const dias = Math.max(1, volumenPorDia.length);
  const mixers = await prisma.mixers.count({
    where: {
      estado: "Disponible",
      ...(f.plantelId != null ? { plantel_base_id: f.plantelId } : {}),
    },
  });
  const disponibleHoras = mixers * dias * JORNADA_HORAS;
  const utilizacionPct =
    disponibleHoras > 0
      ? redondear(Math.min(100, (ocupadoMs / 3_600_000 / disponibleHoras) * 100))
      : null;

  const cicloPorPlantel: CicloPlantel[] = [...ciclo.entries()]
    .map(([plantel, c]) => ({
      plantel,
      realMin: c.realN > 0 ? redondear(c.realSum / c.realN, 0) : null,
      refMin: c.refN > 0 ? redondear(c.refSum / c.refN, 0) : null,
      viajes: c.viajes,
    }))
    .filter((c) => c.viajes > 0 || c.realMin != null || c.refMin != null)
    .sort((a, b) => a.plantel.localeCompare(b.plantel));

  return {
    llegadasATiempoPct: llegTot > 0 ? redondear((llegAT / llegTot) * 100, 0) : null,
    llegadasTotal: llegTot,
    cargasEnFormaPct: cargaTot > 0 ? redondear((cargaOK / cargaTot) * 100, 0) : null,
    cargasTotal: cargaTot,
    volumenM3: redondear(volumenM3),
    cumplimientoPct: pedTotal > 0 ? redondear((pedCompletados / pedTotal) * 100, 0) : null,
    pedidosTotal: pedTotal,
    pedidosCompletados: pedCompletados,
    pedidosCancelados: pedCancel,
    utilizacionPct,
    volumenPorDia,
    cicloPorPlantel,
  };
}
