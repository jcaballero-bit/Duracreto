/**
 * Control de despachos en horario extraordinario: cuánto volumen sale fuera del
 * horario normal, en qué plantas, con qué motoristas y cuánto cuesta ese sobretiempo
 * comparado con lo que la ficha de costos absorbe.
 *
 * Definiciones que usa TODO el reporte (para que las 8 secciones cuadren entre sí):
 *  · Universo: viajes con mixer que YA SALIERON DE PLANTA (`ESTADOS_DESPACHADO`), de
 *    pedidos activos, cuya SALIDA DE PLANTA efectiva cae en el rango. Incluye las
 *    adiciones de Despacho: se despacharon de verdad y su sobretiempo se pagó igual.
 *    Un viaje todavía en `Programado` o `En carga` NO se cuenta: no ha salido, así que
 *    no causó trabajo fuera de horario. Esto es lo que hace que el reporte diga
 *    "volumen despachado" y no "volumen programado" — antes se colaba el plan del día
 *    (un viaje sin despachar igual tiene `hora_salida_planta` programada) y el total
 *    quedaba muy por encima del volumen real de Gerencia Comercial.
 *  · Salida efectiva: `ts_salida_real`; si no existe, la programada
 *    `hora_salida_planta`, y ese viaje se marca como ESTIMADO.
 *  · Volumen: el REAL (`volumen_real_m3 ?? volumen_asignado_m3`), o sea lo que de
 *    verdad salió de la planta — no lo que el programa decía.
 *  · Un viaje se atribuye al DÍA de su salida efectiva (no al día del pedido): lo que
 *    se está midiendo son horas de trabajo, y la banda de recargo sale de ese instante.
 *  · Extraordinario = la salida cae fuera del horario normal de LA PLANTA donde cargó
 *    (`horario_normal_planta`), según el tipo de día de esa fecha.
 */
import { prisma } from "@/lib/prisma";
import { costoHorasExtra, sumarTotales, totalesCero, totalesDeFila } from "@/lib/planilla/costo";
import { etiquetaPuesto } from "@/lib/planilla/puestos";
import { redondearMonto } from "@/lib/planilla/salario";
import { leerBandas } from "@/lib/planilla/consulta";
import { ESTADOS_DESPACHADO } from "@/lib/motor/config";
import {
  esExtraordinario,
  horarioDe,
  minutosDelDia,
  porcentajeDeRecargo,
  textoHorario,
  type HorarioPlanta,
} from "./horario";
import type { TipoDia } from "@/lib/planilla/recargos";

export interface FiltroExtraordinario {
  desde: Date;
  /** Exclusivo. */
  hasta: Date;
  /** Planteles visibles (alcance del rol + filtro de la pantalla). Vacío = todos. */
  plantelIds?: number[];
}

export interface ResumenEjecutivo {
  volumenTotal: number;
  volumenNormal: number;
  volumenExtra: number;
  pctNormal: number;
  pctExtra: number;
  viajesTotal: number;
  viajesNormal: number;
  viajesExtra: number;
  motoristasActivos: number;
  diasConDespacho: number;
  promedioViajesDia: number;
  /** Viajes sin hora real de salida (se clasificaron con la programada). */
  viajesEstimados: number;
}

export interface FilaPlanta {
  plantaId: number;
  planta: string;
  plantel: string;
  viajes: number;
  volumen: number;
  volumenNormal: number;
  volumenExtra: number;
  pctExtra: number;
  viajesNormal: number;
  viajesExtra: number;
  /** Con qué horario se clasificó (Lun-Vie / Sábado / Domingo). */
  horarios: string;
}

export interface FilaDia {
  fechaISO: string;
  etiqueta: string;
  diaSemana: string;
  viajes: number;
  volumen: number;
  volumenNormal: number;
  volumenExtra: number;
  pctExtra: number;
}

export interface FilaMotorista {
  operadorId: number | null;
  nombre: string;
  viajes: number;
  volumen: number;
  diasTrabajados: number;
  promedioViajesDia: number;
  viajesExtra: number;
  plantas: string[];
}

export interface FilaHoraSalida {
  plantaId: number | null;
  planta: string;
  minMin: number | null;
  maxMin: number | null;
  promedioMin: number | null;
  medianaMin: number | null;
  conHora: number;
  sinHora: number;
}

export interface FilaHora {
  hora: number;
  etiqueta: string;
  viajes: number;
  volumen: number;
  viajesExtra: number;
  volumenExtra: number;
}

export interface BandaExtra {
  porcentaje: number;
  viajes: number;
  volumen: number;
}

export interface Absorcion {
  costoFicha: number;
  volumenTotal: number;
  consideradoEnFicha: number;
  pagoActual: number;
  diferencia: number;
  pctDesviacion: number | null;
  cobroCliente: number;
  diferenciaNeta: number;
  /** Horas extra del periodo por nivel de recargo (para auditar el pago). */
  horasExtraPorNivel: { porcentaje: number; horas: number }[];
  /** De dónde viene el sobretiempo, por puesto (el número de arriba no cambia). */
  pagoPorPuesto: { puesto: string; monto: number; personas: number }[];
  personasConSobretiempo: number;
  /**
   * Personal sin plantel asignado cuando el reporte está filtrado por plantel: su
   * sobretiempo NO entra en `pagoActual`, y se reporta para no esconder el faltante.
   */
  excluidoSinPlantel: { personas: number; monto: number } | null;
}

export interface ResumenExtraordinario {
  ejecutivo: ResumenEjecutivo;
  porPlanta: FilaPlanta[];
  porDia: FilaDia[];
  porMotorista: FilaMotorista[];
  horaSalida: FilaHoraSalida[];
  distribucion: FilaHora[];
  bandasExtra: BandaExtra[];
  absorcion: Absorcion;
  umbralPct: number;
}

const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
/** Totales y promedios del análisis por motorista (pie de la tabla). */
export interface ResumenMotoristas {
  motoristas: number;
  /** Totales de la columna. */
  viajes: number;
  volumen: number;
  dias: number;
  viajesExtra: number;
  /** Promedios POR MOTORISTA. */
  promViajes: number;
  promVolumen: number;
  promDias: number;
  promViajesExtra: number;
  /**
   * Viajes por día del conjunto = viajes TOTALES / días TOTALES.
   *
   * NO es el promedio de los promedios de cada fila: eso pesaría igual a quien trabajó un
   * día que a quien trabajó veinte, y daría un número que no corresponde a ningún
   * conjunto real de viajes y días.
   */
  viajesPorDia: number;
}

/**
 * Deriva el pie de la tabla de motoristas. Es puro y vive aquí —no en la pantalla— para
 * que el CSV y la vista usen la MISMA definición: son el mismo reporte por dos caminos.
 */
export function resumirMotoristas(filas: FilaMotorista[]): ResumenMotoristas {
  const n = filas.length;
  const viajes = filas.reduce((a, f) => a + f.viajes, 0);
  const volumen = filas.reduce((a, f) => a + f.volumen, 0);
  const dias = filas.reduce((a, f) => a + f.diasTrabajados, 0);
  const viajesExtra = filas.reduce((a, f) => a + f.viajesExtra, 0);
  const div = (x: number, y: number) => (y > 0 ? x / y : 0);
  return {
    motoristas: n,
    viajes,
    volumen: Math.round(volumen * 100) / 100,
    dias,
    viajesExtra,
    promViajes: div(viajes, n),
    promVolumen: div(volumen, n),
    promDias: div(dias, n),
    promViajesExtra: div(viajesExtra, n),
    viajesPorDia: div(viajes, dias),
  };
}

const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (parte: number, total: number) => (total > 0 ? r2((parte / total) * 100) : 0);

/** Config decimal/entera del reporte (editable en Administración). */
export const CLAVE_COSTO_FICHA = "costo_ficha_por_m3";
export const CLAVE_UMBRAL_EXTRA = "umbral_volumen_extra_pct";
export const COSTO_FICHA_DEFAULT = 30.78;
export const UMBRAL_EXTRA_DEFAULT = 30;

export async function leerCostoFicha(): Promise<number> {
  const f = await prisma.configuracion.findUnique({ where: { clave: CLAVE_COSTO_FICHA } });
  const v = f?.valor_float;
  return typeof v === "number" && v >= 0 ? v : COSTO_FICHA_DEFAULT;
}

export async function leerUmbralExtra(): Promise<number> {
  const f = await prisma.configuracion.findUnique({ where: { clave: CLAVE_UMBRAL_EXTRA } });
  const v = f?.valor_int;
  return typeof v === "number" && v >= 0 ? v : UMBRAL_EXTRA_DEFAULT;
}

/** Horarios normales de todas las plantas (o de las visibles). */
export async function leerHorariosNormales(plantelIds?: number[]): Promise<HorarioPlanta[]> {
  const filas = await prisma.horario_normal_planta.findMany({
    where:
      plantelIds && plantelIds.length > 0
        ? { planta: { plantel_id: { in: plantelIds } } }
        : {},
  });
  return filas.map((f) => ({
    plantaId: f.planta_id,
    tipoDia: f.tipo_dia as TipoDia,
    aperturaMin: f.hora_apertura_min,
    cierreMin: f.hora_cierre_min,
    activo: f.activo,
  }));
}

/** Mediana de una lista de números (null si está vacía). */
function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export async function calcularExtraordinario(
  filtro: FiltroExtraordinario,
): Promise<ResumenExtraordinario> {
  const { desde, hasta } = filtro;
  const plantelIds = filtro.plantelIds ?? [];
  const scopePlantel = plantelIds.length > 0 ? { plantel_id: { in: plantelIds } } : {};

  const [viajes, horarios, bandas, costoFicha, umbralPct] = await Promise.all([
    prisma.viajes.findMany({
      where: {
        mixer_id: { not: null },
        // Solo lo que de verdad salió de la planta. Un viaje Cancelado queda fuera por
        // no estar en la lista, igual que uno todavía Programado o En carga.
        estado: { in: [...ESTADOS_DESPACHADO] },
        pedido: { estado_pedido: "Activo", ...scopePlantel },
        // La salida EFECTIVA cae en el rango: la real si existe, si no la programada.
        OR: [
          { ts_salida_real: { gte: desde, lt: hasta } },
          {
            AND: [
              { ts_salida_real: null },
              { hora_salida_planta: { gte: desde, lt: hasta } },
            ],
          },
        ],
      },
      select: {
        id: true,
        ts_salida_real: true,
        hora_salida_planta: true,
        volumen_asignado_m3: true,
        volumen_real_m3: true,
        planta_id: true,
        operador_id: true,
        operador: { select: { nombre: true } },
        planta: { select: { id: true, nombre: true, plantel: { select: { nombre: true } } } },
        pedido: {
          select: {
            planta_id: true,
            planta: { select: { id: true, nombre: true, plantel: { select: { nombre: true } } } },
          },
        },
      },
    }),
    leerHorariosNormales(),
    leerBandas(),
    leerCostoFicha(),
    leerUmbralExtra(),
  ]);

  // ── Clasificación viaje por viaje ─────────────────────────────────────────
  interface ViajeClasificado {
    salida: Date;
    estimado: boolean;
    volumen: number;
    plantaId: number | null;
    planta: string;
    plantel: string;
    operadorId: number | null;
    operador: string;
    extra: boolean;
    porcentaje: number;
  }

  const clasificados: ViajeClasificado[] = viajes.map((v) => {
    const salida = v.ts_salida_real ?? v.hora_salida_planta!;
    // La planta del VIAJE manda (un pedido puede repartirse entre las 2 plantas del
    // plantel); la del pedido es el respaldo.
    const planta = v.planta ?? v.pedido.planta;
    const plantaId = v.planta_id ?? v.pedido.planta_id;
    const horario = plantaId != null ? horarioDe(plantaId, salida, horarios) : null;
    const extra = esExtraordinario(salida, horario);
    return {
      salida,
      estimado: v.ts_salida_real == null,
      volumen: v.volumen_real_m3 ?? v.volumen_asignado_m3,
      plantaId,
      planta: planta?.nombre ?? "Sin planta",
      plantel: planta?.plantel?.nombre ?? "—",
      operadorId: v.operador_id,
      operador: v.operador?.nombre ?? "Sin motorista",
      extra,
      // La banda de recargo solo se usa para desglosar el volumen EXTRAORDINARIO.
      porcentaje: extra ? porcentajeDeRecargo(salida, bandas) : 0,
    };
  });

  // ── B3. Resumen ejecutivo ─────────────────────────────────────────────────
  const volumenTotal = r2(clasificados.reduce((s, v) => s + v.volumen, 0));
  const volumenExtra = r2(clasificados.filter((v) => v.extra).reduce((s, v) => s + v.volumen, 0));
  const volumenNormal = r2(volumenTotal - volumenExtra);
  const diasSet = new Set(clasificados.map((v) => iso(v.salida)));
  const motoristas = new Set(
    clasificados.filter((v) => v.operadorId != null).map((v) => v.operadorId),
  );
  const ejecutivo: ResumenEjecutivo = {
    volumenTotal,
    volumenNormal,
    volumenExtra,
    pctNormal: pct(volumenNormal, volumenTotal),
    pctExtra: pct(volumenExtra, volumenTotal),
    viajesTotal: clasificados.length,
    viajesNormal: clasificados.filter((v) => !v.extra).length,
    viajesExtra: clasificados.filter((v) => v.extra).length,
    motoristasActivos: motoristas.size,
    diasConDespacho: diasSet.size,
    promedioViajesDia: diasSet.size > 0 ? r2(clasificados.length / diasSet.size) : 0,
    viajesEstimados: clasificados.filter((v) => v.estimado).length,
  };

  // ── B4. Resumen por planta ────────────────────────────────────────────────
  const porPlantaMapa = new Map<number | null, FilaPlanta>();
  for (const v of clasificados) {
    const clave = v.plantaId;
    let f = porPlantaMapa.get(clave);
    if (!f) {
      // Los tres horarios configurados de esa planta, para que se vea con qué se
      // clasificó (el domingo sin fila = "sin horario normal").
      const texto = (["LunVie", "Sabado", "Domingo"] as TipoDia[])
        .map((t) => {
          const h = horarios.find((x) => x.plantaId === clave && x.tipoDia === t && x.activo);
          const et = t === "LunVie" ? "L-V" : t === "Sabado" ? "Sáb" : "Dom";
          return `${et} ${textoHorario(h ?? null)}`;
        })
        .join(" · ");
      f = {
        plantaId: clave ?? -1,
        planta: v.planta,
        plantel: v.plantel,
        viajes: 0,
        volumen: 0,
        volumenNormal: 0,
        volumenExtra: 0,
        pctExtra: 0,
        viajesNormal: 0,
        viajesExtra: 0,
        horarios: texto,
      };
      porPlantaMapa.set(clave, f);
    }
    f.viajes += 1;
    f.volumen = r2(f.volumen + v.volumen);
    if (v.extra) {
      f.viajesExtra += 1;
      f.volumenExtra = r2(f.volumenExtra + v.volumen);
    } else {
      f.viajesNormal += 1;
      f.volumenNormal = r2(f.volumenNormal + v.volumen);
    }
  }
  const porPlanta = [...porPlantaMapa.values()]
    .map((f) => ({ ...f, pctExtra: pct(f.volumenExtra, f.volumen) }))
    .sort((a, b) => b.volumen - a.volumen);

  // ── B5. Tendencia diaria ──────────────────────────────────────────────────
  const porDiaMapa = new Map<string, FilaDia>();
  for (const v of clasificados) {
    const clave = iso(v.salida);
    let f = porDiaMapa.get(clave);
    if (!f) {
      f = {
        fechaISO: clave,
        etiqueta: `${pad(v.salida.getDate())}/${pad(v.salida.getMonth() + 1)}`,
        diaSemana: DIAS_SEMANA[v.salida.getDay()],
        viajes: 0,
        volumen: 0,
        volumenNormal: 0,
        volumenExtra: 0,
        pctExtra: 0,
      };
      porDiaMapa.set(clave, f);
    }
    f.viajes += 1;
    f.volumen = r2(f.volumen + v.volumen);
    if (v.extra) f.volumenExtra = r2(f.volumenExtra + v.volumen);
    else f.volumenNormal = r2(f.volumenNormal + v.volumen);
  }
  const porDia = [...porDiaMapa.values()]
    .map((f) => ({ ...f, pctExtra: pct(f.volumenExtra, f.volumen) }))
    .sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));

  // ── B6. Análisis por motorista (por operador_id, no por nombre escrito) ───
  const porMotoristaMapa = new Map<
    number | null,
    FilaMotorista & { dias: Set<string>; plantasSet: Set<string> }
  >();
  for (const v of clasificados) {
    let f = porMotoristaMapa.get(v.operadorId);
    if (!f) {
      f = {
        operadorId: v.operadorId,
        nombre: v.operador,
        viajes: 0,
        volumen: 0,
        diasTrabajados: 0,
        promedioViajesDia: 0,
        viajesExtra: 0,
        plantas: [],
        dias: new Set(),
        plantasSet: new Set(),
      };
      porMotoristaMapa.set(v.operadorId, f);
    }
    f.viajes += 1;
    f.volumen = r2(f.volumen + v.volumen);
    if (v.extra) f.viajesExtra += 1;
    f.dias.add(iso(v.salida));
    f.plantasSet.add(v.planta);
  }
  const porMotorista: FilaMotorista[] = [...porMotoristaMapa.values()]
    .map((f) => ({
      operadorId: f.operadorId,
      nombre: f.nombre,
      viajes: f.viajes,
      volumen: f.volumen,
      diasTrabajados: f.dias.size,
      promedioViajesDia: f.dias.size > 0 ? r2(f.viajes / f.dias.size) : 0,
      viajesExtra: f.viajesExtra,
      plantas: [...f.plantasSet].sort(),
    }))
    .sort((a, b) => b.viajes - a.viajes);

  // ── B7. Estadísticas de hora de salida por planta ─────────────────────────
  const horaMapa = new Map<number | null, { mins: number[]; sinHora: number; planta: string }>();
  for (const v of clasificados) {
    let f = horaMapa.get(v.plantaId);
    if (!f) {
      f = { mins: [], sinHora: 0, planta: v.planta };
      horaMapa.set(v.plantaId, f);
    }
    // Solo las salidas con hora REAL entran en las estadísticas; las estimadas se
    // cuentan aparte, porque son justo donde el registro operativo está fallando.
    if (v.estimado) f.sinHora += 1;
    else f.mins.push(minutosDelDia(v.salida));
  }
  const filaHora = (
    plantaId: number | null,
    planta: string,
    mins: number[],
    sinHora: number,
  ): FilaHoraSalida => ({
    plantaId,
    planta,
    minMin: mins.length ? Math.min(...mins) : null,
    maxMin: mins.length ? Math.max(...mins) : null,
    promedioMin: mins.length
      ? Math.round(mins.reduce((s, m) => s + m, 0) / mins.length)
      : null,
    medianaMin: mediana(mins),
    conHora: mins.length,
    sinHora,
  });
  const horaSalida = [...horaMapa.entries()]
    .map(([id, f]) => filaHora(id, f.planta, f.mins, f.sinHora))
    .sort((a, b) => b.conHora - a.conHora);
  const todosMins = clasificados.filter((v) => !v.estimado).map((v) => minutosDelDia(v.salida));
  horaSalida.push(
    filaHora(null, "GLOBAL", todosMins, clasificados.filter((v) => v.estimado).length),
  );

  // ── B8. Distribución horaria ──────────────────────────────────────────────
  const distMapa = new Map<number, FilaHora>();
  for (const v of clasificados) {
    const h = v.salida.getHours();
    let f = distMapa.get(h);
    if (!f) {
      f = {
        hora: h,
        etiqueta: `${pad(h)}:00-${pad(h)}:59`,
        viajes: 0,
        volumen: 0,
        viajesExtra: 0,
        volumenExtra: 0,
      };
      distMapa.set(h, f);
    }
    f.viajes += 1;
    f.volumen = r2(f.volumen + v.volumen);
    if (v.extra) {
      f.viajesExtra += 1;
      f.volumenExtra = r2(f.volumenExtra + v.volumen);
    }
  }
  // Franjas continuas desde la primera hasta la última con datos (una hora vacía en
  // medio se muestra en cero, para que el gráfico no la salte).
  const horasConDatos = [...distMapa.keys()].sort((a, b) => a - b);
  const distribucion: FilaHora[] = [];
  if (horasConDatos.length > 0) {
    for (let h = horasConDatos[0]; h <= horasConDatos[horasConDatos.length - 1]; h++) {
      distribucion.push(
        distMapa.get(h) ?? {
          hora: h,
          etiqueta: `${pad(h)}:00-${pad(h)}:59`,
          viajes: 0,
          volumen: 0,
          viajesExtra: 0,
          volumenExtra: 0,
        },
      );
    }
  }

  // ── B2 (desglose). Volumen extraordinario por banda de recargo ────────────
  const bandaMapa = new Map<number, BandaExtra>();
  for (const v of clasificados) {
    if (!v.extra) continue;
    const f = bandaMapa.get(v.porcentaje) ?? {
      porcentaje: v.porcentaje,
      viajes: 0,
      volumen: 0,
    };
    f.viajes += 1;
    f.volumen = r2(f.volumen + v.volumen);
    bandaMapa.set(v.porcentaje, f);
  }
  const bandasExtra = [...bandaMapa.values()].sort((a, b) => a.porcentaje - b.porcentaje);

  // ── B9. Absorción de costo ────────────────────────────────────────────────
  const absorcion = await calcularAbsorcion({
    desde,
    hasta,
    plantelIds,
    volumenTotal,
    costoFicha,
  });

  return {
    ejecutivo,
    porPlanta,
    porDia,
    porMotorista,
    horaSalida,
    distribucion,
    bandasExtra,
    absorcion,
    umbralPct,
  };
}

/**
 * Pago de sobretiempo del periodo, tomado del módulo de planilla.
 *
 * INTERPRETACIÓN ELEGIDA (decisión del usuario, ago-2026): incluye a TODO el personal
 * operativo (dosificadores, operadores de cargadora, de bomba, motoristas de camión y
 * de mixer), no solo los puestos atribuibles al despacho. La pantalla lo dice
 * explícitamente, porque cambia el número final: se compara el sobretiempo TOTAL de la
 * planta contra un costo por m³ que la ficha calculó para el despacho.
 *
 * Cuando el reporte está filtrado por plantel, el personal se acota por
 * `operadores.plantel_asignado_id`; el que no tiene plantel asignado queda FUERA y se
 * reporta aparte, para no esconder un faltante.
 */
async function calcularAbsorcion(a: {
  desde: Date;
  hasta: Date;
  plantelIds: number[];
  volumenTotal: number;
  costoFicha: number;
}): Promise<Absorcion> {
  // El personal se acota por plantel SOLO si el reporte cubre un subconjunto. Cuando
  // abarca todos los planteles del sistema (el caso del Administrador sin filtro), la
  // planilla entra completa: si no, el sobretiempo de quien no tiene plantel asignado
  // desaparecería del análisis nacional.
  const totalPlanteles = await prisma.planteles.count();
  const filtraPlantel = a.plantelIds.length > 0 && a.plantelIds.length < totalPlanteles;

  const asistencias = await prisma.asistencia_operativos.findMany({
    where: { fecha: { gte: a.desde, lt: a.hasta } },
    include: {
      persona: {
        select: { id: true, nombre: true, puesto: true, salario_mensual: true, plantel_asignado_id: true },
      },
    },
  });

  // Acumular horas por persona (una persona tiene una fila por día).
  const porPersona = new Map<
    number,
    {
      nombre: string;
      puesto: string;
      salario: number | null;
      plantelId: number | null;
      totales: ReturnType<typeof totalesCero>;
    }
  >();
  for (const asis of asistencias) {
    const p = asis.persona;
    const acum =
      porPersona.get(p.id) ??
      {
        nombre: p.nombre,
        puesto: p.puesto,
        salario: p.salario_mensual,
        plantelId: p.plantel_asignado_id,
        totales: totalesCero(),
      };
    acum.totales = sumarTotales(acum.totales, totalesDeFila(asis));
    porPersona.set(p.id, acum);
  }

  let pagoActual = 0;
  let personasConSobretiempo = 0;
  let excluidasPersonas = 0;
  let excluidoMonto = 0;
  const horasPorNivel = new Map<number, number>();
  const puestoMapa = new Map<string, { monto: number; personas: number }>();

  for (const p of porPersona.values()) {
    const costo = costoHorasExtra(p.totales, p.salario);
    const tieneExtra = Object.entries(p.totales.porRecargo).some(
      ([nivel, horas]) => Number(nivel) > 0 && horas > 0,
    );
    // Filtrado por plantel: quien no tiene plantel asignado no se puede atribuir.
    if (filtraPlantel && (p.plantelId == null || !a.plantelIds.includes(p.plantelId))) {
      if (p.plantelId == null && tieneExtra) {
        excluidasPersonas += 1;
        excluidoMonto += costo;
      }
      continue;
    }

    pagoActual += costo;
    if (tieneExtra) personasConSobretiempo += 1;
    for (const [nivel, horas] of Object.entries(p.totales.porRecargo)) {
      const n = Number(nivel);
      if (n <= 0 || horas <= 0) continue;
      horasPorNivel.set(n, r2((horasPorNivel.get(n) ?? 0) + horas));
    }
    if (costo > 0) {
      const et = etiquetaPuesto(p.puesto);
      const acum = puestoMapa.get(et) ?? { monto: 0, personas: 0 };
      acum.monto = redondearMonto(acum.monto + costo);
      acum.personas += 1;
      puestoMapa.set(et, acum);
    }
  }

  pagoActual = redondearMonto(pagoActual);
  const consideradoEnFicha = redondearMonto(a.costoFicha * a.volumenTotal);
  const diferencia = redondearMonto(consideradoEnFicha - pagoActual);

  // Cobro de sobretiempo que se le haya hecho a algún cliente en el rango.
  const cobros = await prisma.cobros_sobretiempo.findMany({
    where: { fecha: { gte: a.desde, lt: a.hasta } },
    select: { monto: true },
  });
  const cobroCliente = redondearMonto(cobros.reduce((s, c) => s + c.monto, 0));

  return {
    costoFicha: a.costoFicha,
    volumenTotal: a.volumenTotal,
    consideradoEnFicha,
    pagoActual,
    diferencia,
    pctDesviacion:
      consideradoEnFicha > 0 ? r2((diferencia / consideradoEnFicha) * 100) : null,
    cobroCliente,
    diferenciaNeta: redondearMonto(diferencia + cobroCliente),
    horasExtraPorNivel: [...horasPorNivel.entries()]
      .map(([porcentaje, horas]) => ({ porcentaje, horas }))
      .sort((x, y) => x.porcentaje - y.porcentaje),
    pagoPorPuesto: [...puestoMapa.entries()]
      .map(([puesto, v]) => ({ puesto, monto: v.monto, personas: v.personas }))
      .sort((x, y) => y.monto - x.monto),
    personasConSobretiempo,
    excluidoSinPlantel:
      filtraPlantel && excluidasPersonas > 0
        ? { personas: excluidasPersonas, monto: redondearMonto(excluidoMonto) }
        : null,
  };
}
