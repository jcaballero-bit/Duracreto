// Métricas del dashboard comercial. Cálculo directo (no hay vistas materializadas
// en este stack). Atribución por el ASESOR DUEÑO DEL CLIENTE (cliente.asesor_id).
import { prisma } from "@/lib/prisma";

export interface FiltroComercial {
  anio: number;
  mes: number; // 1-12
  zona: string | null; // null = todas
}

/** Desempeño de un asesor en UNA semana del mes (Lun–Dom, como Programa Semana). */
export interface SemanaDesempeno {
  label: string; // "13/07 – 19/07"
  m3Vendidos: number;
  precisionPct: number | null;
  confirmacionPct: number | null;
}

export interface DesempenoAsesor {
  asesorId: number;
  nombre: string;
  m3Vendidos: number;
  metaM3: number | null; // null = sin meta configurada
  cumplimientoPct: number | null;
  precisionPct: number | null;
  confirmacionPct: number | null;
  pedidos: number;
  adicionesM3: number; // m³ agregados en el día (nuevos 100% + excesos de volumen)
  adicionesCount: number; // # de pedidos con adición
  cancelacionesCount: number;
  cancelacionesM3: number; // m³ programados que se cancelaron
  semanas: SemanaDesempeno[]; // desglose por semana del mes (solo con actividad)
}

/** Un evento de cancelación (para el REGISTRO del dashboard comercial). */
export interface EventoCancelacion {
  fechaMs: number;
  cliente: string;
  asesorNombre: string;
  motivo: string;
  detalle: string | null;
  m3: number;
}

/** Un evento de adición del día (para el REGISTRO del dashboard comercial). */
export interface EventoAdicion {
  fechaMs: number; // día del suministro (hora_solicitada)
  cliente: string;
  asesorNombre: string;
  tipo: "Nuevo (100%)" | "Volumen"; // suministro nuevo del día vs. exceso sobre lo programado
  m3: number; // m³ adicionados
}

export interface ResumenComercial {
  m3VendidosTotal: number;
  metaTotal: number;
  cumplimientoPct: number | null;
  precisionPct: number | null;
  confirmacionPct: number | null;
  adicionesM3Total: number;
  cancelacionesTotal: number;
  cancelacionesM3Total: number;
  cancelacionesPorMotivo: Record<string, number>;
  asesores: DesempenoAsesor[];
  registroCancelaciones: EventoCancelacion[];
  registroAdiciones: EventoAdicion[];
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Lunes (00:00) de la semana que contiene el timestamp (semana Lun–Dom). */
function lunesMs(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Dom … 6=Sáb
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.getTime();
}

/** Etiqueta "d/m – d/m" de la semana que empieza en `inicioMs`. */
function etiquetaSemana(inicioMs: number): string {
  const ini = new Date(inicioMs);
  const fin = new Date(inicioMs);
  fin.setDate(fin.getDate() + 6);
  const f = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `${f(ini)} – ${f(fin)}`;
}

/** Precisión de proyección: 100% = exacta; baja según la desviación relativa. */
function precision(proyectado: number, real: number): number | null {
  if (proyectado <= 0) return null;
  const desv = Math.abs(real - proyectado) / proyectado;
  return redondear(Math.max(0, 1 - desv) * 100);
}

/** Volumen realmente DESPACHADO de un pedido: suma del volumen de los viajes ya
 *  Completado (entregados). NO cuenta lo programado/pendiente — si aún no se
 *  completa ningún viaje, el pedido aporta 0 (todavía no se ha vendido/despachado). */
function volumenDespachado(
  viajes: { estado: string; volumen_asignado_m3: number }[],
): number {
  return viajes
    .filter((v) => v.estado === "Completado")
    .reduce((s, v) => s + v.volumen_asignado_m3, 0);
}

export async function calcularDesempeno(f: FiltroComercial): Promise<ResumenComercial> {
  const ini = new Date(f.anio, f.mes - 1, 1);
  const fin = new Date(f.anio, f.mes, 1);

  const [asesores, pedidos, metas] = await Promise.all([
    prisma.asesores.findMany({ orderBy: { nombre: "asc" } }),
    prisma.pedidos.findMany({
      where: {
        hora_solicitada: { gte: ini, lt: fin },
        ...(f.zona ? { plantel: { zona: f.zona } } : {}),
      },
      select: {
        volumen_total_m3: true,
        volumen_programado: true,
        hora_solicitada: true,
        creado_en: true,
        estado_pedido: true,
        motivo_cancelacion: true,
        detalle_cancelacion: true,
        fecha_cancelacion: true,
        cliente: { select: { asesor_id: true, empresa: true } },
        viajes: {
          select: {
            estado: true,
            volumen_asignado_m3: true,
            motivo_asignacion: true,
            estado_confirmacion: true,
            fecha_hora_confirmacion: true,
            mixer_id: true,
          },
        },
        solicitud: { select: { volumen_estimado_m3: true } },
      },
    }),
    prisma.metas_asesor.findMany({ where: { anio: f.anio, mes: f.mes } }),
  ]);

  const metaPorAsesor = new Map<number, number>();
  for (const m of metas) metaPorAsesor.set(m.asesor_id, m.meta_m3);
  const nombreAsesor = new Map<number, string>();
  for (const as of asesores) nombreAsesor.set(as.id, as.nombre);

  // Acumuladores. Cada asesor lleva su total mensual y un desglose por SEMANA
  // (lunes de la semana → acumulador), con la misma semana Lun–Dom de Programa Semana.
  interface Acc {
    m3: number;
    proyectado: number;
    real: number;
    pedidos: number;
    confirmadosATiempo: number;
    adicionesM3: number;
    adicionesCount: number;
    cancelacionesCount: number;
    cancelacionesM3: number;
  }
  const nuevoAcc = (): Acc => ({
    m3: 0, proyectado: 0, real: 0, pedidos: 0, confirmadosATiempo: 0,
    adicionesM3: 0, adicionesCount: 0, cancelacionesCount: 0, cancelacionesM3: 0,
  });
  const acc = new Map<number, { mensual: Acc; semanas: Map<number, Acc> }>();
  const get = (id: number) => {
    let a = acc.get(id);
    if (!a) {
      a = { mensual: nuevoAcc(), semanas: new Map() };
      acc.set(id, a);
    }
    return a;
  };

  // Registros (log de eventos) + agregado de cancelaciones por motivo.
  const registroCancelaciones: EventoCancelacion[] = [];
  const registroAdiciones: EventoAdicion[] = [];
  const cancelacionesPorMotivo: Record<string, number> = {};

  // ¿`a` y `b` caen el mismo día calendario? (para "adición 100%" = creado el día).
  const mismoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  for (const p of pedidos) {
    const asesorId = p.cliente.asesor_id;
    if (asesorId == null) continue; // pedido sin asesor: no se atribuye
    const a = get(asesorId);

    // Pedido CANCELADO: cuenta solo como cancelación (no en ventas/precisión).
    if (p.estado_pedido === "Cancelado") {
      const m3Cancelado = p.volumen_programado ?? p.volumen_total_m3;
      a.mensual.cancelacionesCount += 1;
      a.mensual.cancelacionesM3 += m3Cancelado;
      const motivo = p.motivo_cancelacion ?? "Sin motivo";
      cancelacionesPorMotivo[motivo] = (cancelacionesPorMotivo[motivo] ?? 0) + 1;
      registroCancelaciones.push({
        fechaMs: (p.fecha_cancelacion ?? p.hora_solicitada).getTime(),
        cliente: p.cliente.empresa,
        asesorNombre: nombreAsesor.get(asesorId) ?? "—",
        motivo,
        detalle: p.detalle_cancelacion,
        m3: redondear(m3Cancelado),
      });
      continue;
    }

    // Adiciones del día (pedidos activos): nuevo suministro del día (100%) o
    // volumen despachado/asignado por encima de lo programado.
    const volActual = p.viajes
      .filter((v) => v.estado !== "Cancelado" && v.motivo_asignacion !== "Sin cubrir")
      .reduce((s, v) => s + v.volumen_asignado_m3, 0);
    const programado = p.volumen_programado ?? p.volumen_total_m3;
    const esNuevoDelDia = mismoDia(p.creado_en, p.hora_solicitada);
    let adicion = 0;
    let tipoAdicion: EventoAdicion["tipo"] | null = null;
    if (esNuevoDelDia) {
      adicion = volActual || p.volumen_total_m3;
      tipoAdicion = "Nuevo (100%)";
    } else if (volActual - programado > 0.01) {
      adicion = volActual - programado;
      tipoAdicion = "Volumen";
    }
    if (adicion > 0 && tipoAdicion) {
      a.mensual.adicionesM3 += adicion;
      a.mensual.adicionesCount += 1;
      registroAdiciones.push({
        fechaMs: p.hora_solicitada.getTime(),
        cliente: p.cliente.empresa,
        asesorNombre: nombreAsesor.get(asesorId) ?? "—",
        tipo: tipoAdicion,
        m3: redondear(adicion),
      });
    }

    const semanaMs = lunesMs(p.hora_solicitada.getTime());
    if (!a.semanas.has(semanaMs)) a.semanas.set(semanaMs, nuevoAcc());
    const sem = a.semanas.get(semanaMs)!;

    // Contribuciones de este pedido (se suman al total mensual y a su semana).
    const m3 = volumenDespachado(p.viajes);
    const proj = p.solicitud?.volumen_estimado_m3 ?? 0;
    const real = p.solicitud?.volumen_estimado_m3 != null ? p.volumen_total_m3 : 0;
    const reales = p.viajes.filter((v) => v.mixer_id != null);
    const todosConfirmados =
      reales.length > 0 && reales.every((v) => v.estado_confirmacion === "Confirmado");
    let aTiempo = 0;
    if (todosConfirmados) {
      const fechas = reales
        .map((v) => v.fecha_hora_confirmacion?.getTime())
        .filter((t): t is number => t != null);
      const ultima = fechas.length ? Math.max(...fechas) : null;
      if (ultima != null && ultima <= p.hora_solicitada.getTime()) aTiempo = 1;
    }

    for (const bucket of [a.mensual, sem]) {
      bucket.m3 += m3;
      bucket.proyectado += proj;
      bucket.real += real;
      bucket.pedidos += 1;
      bucket.confirmadosATiempo += aTiempo;
    }
  }

  const filas: DesempenoAsesor[] = asesores.map((as) => {
    const a = acc.get(as.id);
    const m = a?.mensual;
    const m3 = redondear(m?.m3 ?? 0);
    const meta = metaPorAsesor.get(as.id) ?? null;
    // Desglose por semana (solo semanas con actividad, orden cronológico).
    const semanas: SemanaDesempeno[] = a
      ? [...a.semanas.entries()]
          .sort((x, y) => x[0] - y[0])
          .map(([ms, s]) => ({
            label: etiquetaSemana(ms),
            m3Vendidos: redondear(s.m3),
            precisionPct: precision(s.proyectado, s.real),
            confirmacionPct: s.pedidos > 0 ? redondear((s.confirmadosATiempo / s.pedidos) * 100) : null,
          }))
      : [];
    return {
      asesorId: as.id,
      nombre: as.nombre,
      m3Vendidos: m3,
      metaM3: meta,
      cumplimientoPct: meta && meta > 0 ? redondear((m3 / meta) * 100) : null,
      precisionPct: m ? precision(m.proyectado, m.real) : null,
      confirmacionPct: m && m.pedidos > 0 ? redondear((m.confirmadosATiempo / m.pedidos) * 100) : null,
      pedidos: m?.pedidos ?? 0,
      adicionesM3: redondear(m?.adicionesM3 ?? 0),
      adicionesCount: m?.adicionesCount ?? 0,
      cancelacionesCount: m?.cancelacionesCount ?? 0,
      cancelacionesM3: redondear(m?.cancelacionesM3 ?? 0),
      semanas,
    };
  });

  // Totales/agregados (mensuales, para las tarjetas de arriba).
  const mensuales = [...acc.values()].map((a) => a.mensual);
  const m3VendidosTotal = redondear(filas.reduce((s, r) => s + r.m3Vendidos, 0));
  const metaTotal = redondear(
    [...metaPorAsesor.values()].reduce((s, v) => s + v, 0),
  );
  const proyectadoTotal = mensuales.reduce((s, a) => s + a.proyectado, 0);
  const realTotal = mensuales.reduce((s, a) => s + a.real, 0);
  const pedidosTotal = mensuales.reduce((s, a) => s + a.pedidos, 0);
  const aTiempoTotal = mensuales.reduce((s, a) => s + a.confirmadosATiempo, 0);

  const adicionesM3Total = redondear(mensuales.reduce((s, a) => s + a.adicionesM3, 0));
  const cancelacionesTotal = mensuales.reduce((s, a) => s + a.cancelacionesCount, 0);
  const cancelacionesM3Total = redondear(mensuales.reduce((s, a) => s + a.cancelacionesM3, 0));

  // Registros ordenados por fecha descendente (lo más reciente arriba).
  registroCancelaciones.sort((x, y) => y.fechaMs - x.fechaMs);
  registroAdiciones.sort((x, y) => y.fechaMs - x.fechaMs);

  return {
    m3VendidosTotal,
    metaTotal,
    cumplimientoPct: metaTotal > 0 ? redondear((m3VendidosTotal / metaTotal) * 100) : null,
    precisionPct: precision(proyectadoTotal, realTotal),
    confirmacionPct: pedidosTotal > 0 ? redondear((aTiempoTotal / pedidosTotal) * 100) : null,
    adicionesM3Total,
    cancelacionesTotal,
    cancelacionesM3Total,
    cancelacionesPorMotivo,
    asesores: filas,
    registroCancelaciones,
    registroAdiciones,
  };
}

// ── Mapa de cobertura: clientes ATENDIDOS (con concreto entregado) ───────────
// Un cliente cuenta como atendido si tuvo ≥1 pedido con ≥1 viaje `Completado` en
// el periodo/filtros (misma definición de "suministrado" que m³ vendidos). Se
// agrega UNA vez por cliente aunque haya recibido varias veces.

export interface ClienteMapa {
  clienteId: number;
  empresa: string;
  proyecto: string;
  asesorId: number | null;
  asesorNombre: string;
  lat: number;
  lng: number;
  m3: number; // Σ volumen_asignado de viajes Completado en el periodo
  pedidosCompletados: number; // # de pedidos con ≥1 viaje Completado
  ultimoSuministroMs: number; // fecha del suministro más reciente en el periodo
}
export interface CoberturaComercial {
  clientes: ClienteMapa[]; // atendidos CON ubicación (van al mapa)
  sinUbicacion: number; // atendidos SIN coordenadas (no se pueden ubicar)
}

export interface FiltroCobertura {
  anio: number;
  mes: number;
  zona: string | null; // null = todas
  asesorId: number | null; // null = todos
}

export async function clientesAtendidos(f: FiltroCobertura): Promise<CoberturaComercial> {
  const ini = new Date(f.anio, f.mes - 1, 1);
  const fin = new Date(f.anio, f.mes, 1);

  const pedidos = await prisma.pedidos.findMany({
    where: {
      hora_solicitada: { gte: ini, lt: fin },
      ...(f.zona ? { plantel: { zona: f.zona } } : {}),
      ...(f.asesorId != null ? { cliente: { asesor_id: f.asesorId } } : {}),
      // Al menos un viaje entregado (concreto suministrado de verdad). Los pedidos
      // cancelados no tienen viajes Completado → quedan excluidos naturalmente.
      viajes: { some: { estado: "Completado" } },
    },
    select: {
      hora_solicitada: true,
      cliente: {
        select: {
          id: true,
          empresa: true,
          proyecto: true,
          latitud: true,
          longitud: true,
          asesor_id: true,
          asesor: { select: { nombre: true } },
        },
      },
      viajes: {
        where: { estado: "Completado" },
        select: { volumen_asignado_m3: true },
      },
    },
  });

  const porCliente = new Map<number, ClienteMapa>();
  const sinUbic = new Set<number>();

  for (const p of pedidos) {
    const c = p.cliente;
    const m3 = p.viajes.reduce((s, v) => s + v.volumen_asignado_m3, 0);
    if (m3 <= 0) continue; // sin volumen entregado real
    if (c.latitud == null || c.longitud == null) {
      sinUbic.add(c.id); // atendido pero sin coordenadas → no va al mapa
      continue;
    }
    let e = porCliente.get(c.id);
    if (!e) {
      e = {
        clienteId: c.id,
        empresa: c.empresa,
        proyecto: c.proyecto ?? "",
        asesorId: c.asesor_id,
        asesorNombre: c.asesor?.nombre ?? "Sin asesor",
        lat: c.latitud,
        lng: c.longitud,
        m3: 0,
        pedidosCompletados: 0,
        ultimoSuministroMs: 0,
      };
      porCliente.set(c.id, e);
    }
    e.m3 += m3;
    e.pedidosCompletados += 1;
    e.ultimoSuministroMs = Math.max(e.ultimoSuministroMs, p.hora_solicitada.getTime());
  }

  const clientes = [...porCliente.values()].map((e) => ({
    ...e,
    m3: redondear(e.m3),
  }));
  return { clientes, sinUbicacion: sinUbic.size };
}

// ── Registro mensual de adiciones/cancelaciones POR ASESOR ───────────────────
// Para el detalle del asesor (/comercial/asesor/[id]): la misma detección que
// arriba, pero de TODO el historial del asesor, tabulado por mes con subtotales.

export interface EventoRegistro {
  fechaMs: number;
  cliente: string;
  m3: number;
  motivo?: string | null; // solo cancelaciones
  detalle?: string | null; // solo cancelaciones
  tipo?: "Nuevo (100%)" | "Volumen"; // solo adiciones
}
export interface MesRegistro {
  clave: string; // "2026-07"
  label: string; // "julio 2026"
  adiciones: EventoRegistro[];
  cancelaciones: EventoRegistro[];
  totalAdicionadoM3: number;
  totalCanceladoM3: number;
}
export interface RegistroAsesor {
  meses: MesRegistro[]; // orden descendente (mes más reciente arriba)
  totalAdicionadoM3: number;
  totalCanceladoM3: number;
}

const mismoDiaCal = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Historial (todas las fechas) de adiciones y cancelaciones de UN asesor,
 * tabulado por mes con subtotales y totales generales. Se usa en el detalle del
 * asesor, debajo de su cuadrícula de programación.
 */
export async function registroAdicionesCancelaciones(
  asesorId: number,
): Promise<RegistroAsesor> {
  const pedidos = await prisma.pedidos.findMany({
    where: { cliente: { asesor_id: asesorId } },
    select: {
      volumen_total_m3: true,
      volumen_programado: true,
      hora_solicitada: true,
      creado_en: true,
      estado_pedido: true,
      motivo_cancelacion: true,
      detalle_cancelacion: true,
      fecha_cancelacion: true,
      cliente: { select: { empresa: true } },
      viajes: {
        select: { estado: true, volumen_asignado_m3: true, motivo_asignacion: true },
      },
    },
  });

  const buckets = new Map<string, MesRegistro>();
  const bucketDe = (d: Date): MesRegistro => {
    const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let b = buckets.get(clave);
    if (!b) {
      b = {
        clave,
        label: new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("es-HN", {
          month: "long",
          year: "numeric",
        }),
        adiciones: [],
        cancelaciones: [],
        totalAdicionadoM3: 0,
        totalCanceladoM3: 0,
      };
      buckets.set(clave, b);
    }
    return b;
  };

  for (const p of pedidos) {
    if (p.estado_pedido === "Cancelado") {
      const m3 = p.volumen_programado ?? p.volumen_total_m3;
      const fecha = p.fecha_cancelacion ?? p.hora_solicitada;
      const b = bucketDe(fecha);
      b.cancelaciones.push({
        fechaMs: fecha.getTime(),
        cliente: p.cliente.empresa,
        m3: redondear(m3),
        motivo: p.motivo_cancelacion ?? "Sin motivo",
        detalle: p.detalle_cancelacion,
      });
      b.totalCanceladoM3 += m3;
      continue;
    }

    const volActual = p.viajes
      .filter((v) => v.estado !== "Cancelado" && v.motivo_asignacion !== "Sin cubrir")
      .reduce((s, v) => s + v.volumen_asignado_m3, 0);
    const programado = p.volumen_programado ?? p.volumen_total_m3;
    let adicion = 0;
    let tipo: EventoRegistro["tipo"] | undefined;
    if (mismoDiaCal(p.creado_en, p.hora_solicitada)) {
      adicion = volActual || p.volumen_total_m3;
      tipo = "Nuevo (100%)";
    } else if (volActual - programado > 0.01) {
      adicion = volActual - programado;
      tipo = "Volumen";
    }
    if (adicion > 0 && tipo) {
      const b = bucketDe(p.hora_solicitada);
      b.adiciones.push({
        fechaMs: p.hora_solicitada.getTime(),
        cliente: p.cliente.empresa,
        m3: redondear(adicion),
        tipo,
      });
      b.totalAdicionadoM3 += adicion;
    }
  }

  const meses = [...buckets.values()].sort((a, b) => b.clave.localeCompare(a.clave));
  for (const m of meses) {
    m.adiciones.sort((x, y) => y.fechaMs - x.fechaMs);
    m.cancelaciones.sort((x, y) => y.fechaMs - x.fechaMs);
    m.totalAdicionadoM3 = redondear(m.totalAdicionadoM3);
    m.totalCanceladoM3 = redondear(m.totalCanceladoM3);
  }
  return {
    meses,
    totalAdicionadoM3: redondear(meses.reduce((s, m) => s + m.totalAdicionadoM3, 0)),
    totalCanceladoM3: redondear(meses.reduce((s, m) => s + m.totalCanceladoM3, 0)),
  };
}
