// ─────────────────────────────────────────────────────────────────────────────
// Orquestador del motor de asignación (con acceso a BD).
//
// Junta las piezas puras (planificador, tiempos) con los datos reales:
//   · Paso 1 — flota propia del plantel
//   · Paso 2 — préstamo automático del hub de zona
//   · Paso 3 — sugerencias de refuerzo de otros planteles (requiere confirmar)
//   · Cascada de horarios por planta y por mixer
//   · Resolución de traslapes (un mixer no puede estar en dos lugares a la vez)
//   · Reasignación manual y alerta de margen insuficiente
//
// Cada regla de negocio es una función con nombre propio; nada de lógica
// enredada en una sola función gigante.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import {
  capacidadPlaneacion,
  cargaSeguraMixer,
  cierreProgramaDe,
  DEFAULT_TIEMPO_REGRESO_MIN,
  DEFAULT_TIEMPO_VIAJE_MIN,
  ESTADO_DISPONIBLE,
  ESTADO_VIAJE_COMPLETADO,
  HORA_APERTURA_POR_DEFECTO,
  MARGEN_MINIMO_MIN,
  MIN_SALIDA_TRAS_CARGA,
  PERMITIR_HORA_CARGA_MANUAL,
  SECUENCIA_ESTADOS_VIAJE,
} from "./config";
import { planificarCombinacion, unidadLibreEnVentana } from "./planificador";
import type { VentanaViaje } from "./planificador";
import { analizarFrecuencia, type ResultadoFrecuencia } from "./frecuencia";
import { planificarSerie } from "./serie";
import { leerMargenHueco } from "./config-runtime";
import { calcularHuecos, planificarDosPasadas, type Hueco, type PedidoOrg } from "./organizador";
import {
  diferenciaMinutos,
  finDelDia,
  inicioDelDia,
  minutosDeCarga,
  minutosDeDescarga,
  mismoDia,
  sumarMinutos,
  tiemposDeViaje,
} from "./tiempos";
import type { AlertaMargen, Origen, SugerenciaRefuerzo } from "./tipos";

// ── Entrada / salida públicas ────────────────────────────────────────────────

export interface EntradaPedido {
  cliente_id: number;
  diseno_id: number;
  volumen_total_m3: number;
  hora_solicitada: Date;
  plantel_id: number;
  planta_id: number;
  bomba_id?: number | null;
  tipo_descarga: string; // "Canal directo" | "Bomba estacionaria" | "Bomba pluma"
  revenimiento?: string | null; // rango de asentamiento (editable), null = usa el del diseño
  tipo_servicio?: string | null; // "Normal" | "Servicio de Construcción" (filtra diseños)
  sacos_hielo_por_m3?: number; // 0 = sin control; 1-10
  asesor_id?: number | null; // asesor que gestiona el pedido (precargado del cliente)
  hora_bloqueada?: boolean; // true = hora de llegada fija (no reprogramar)
  usar_ambas_plantas?: boolean; // true = repartir viajes entre las 2 plantas del plantel
  carga_simultanea?: boolean; // true = forzar carga a la vez en ambas plantas
  carga_reducida?: boolean; // true = usar capacidad efectiva reducida (acceso difícil)
  es_adicion?: boolean; // true = adición desde Despacho (fuera del programa/DPCR-08)
  frecuencia_entre_camiones_min?: number | null; // min entre llegadas de camión
  tiempo_transporte_min?: number | null; // override de transporte (ida); null = usa el del cliente
  elemento?: string | null;
  ubicacion_detalle?: string | null;
  creado_por: string;
}

export interface ResultadoProgramacion {
  pedidoId: number;
  viajes: ViajeResumen[];
  volumenSinCubrir: number;
  sugerenciasRefuerzo: SugerenciaRefuerzo[];
  alertasMargen: AlertaMargen[];
  viajesRecalculados: number[]; // ids de viajes cuyos horarios cambiaron
  // Carga simultánea: si el pedido la pidió pero una planta no pudo arrancar a la vez
  // (estaba ocupada), avisa cuál planta arrancó más tarde y por cuántos minutos. El
  // Programador decide si espera o continúa sin simultaneidad. null = arrancaron juntas.
  avisoSimultaneidad?: { plantaTarde: string; minutosDiferencia: number } | null;
}

export interface ViajeResumen {
  id: number;
  mixerId: number | null;
  mixerLabel: string | null; // identificador del mixer (nunca el id interno)
  flota: string | null; // nombre del plantel base del mixer
  flotaPropia: boolean;
  capacidad: number;
  volumen: number;
  origen: Origen;
  rutaPorDefecto: boolean;
  hora_inicio_carga: Date | null;
  hora_regreso_planta: Date | null;
}

// ── Helpers de disponibilidad ────────────────────────────────────────────────

/** Ventana de ocupación [inicio_carga, regreso_planta] de un viaje ya calculado. */
function ventanaDeViaje(v: {
  hora_inicio_carga: Date | null;
  hora_regreso_planta: Date | null;
}): VentanaViaje | null {
  if (!v.hora_inicio_carga || !v.hora_regreso_planta) return null;
  return { inicio: v.hora_inicio_carga, fin: v.hora_regreso_planta };
}

/**
 * Ventana de OCUPACIÓN física del mixer para un viaje: usa las horas REALES cuando
 * existen (`ts_inicio_carga_real` → `ts_regreso_real`) y cae a las programadas si
 * no. Un viaje ya ejecutado/completado libera el mixer según lo que pasó de verdad,
 * no según lo programado — así al reasignar no hay falsos traslapes (p. ej. un viaje
 * Completado cuyo regreso real ya pasó no bloquea otro que carga más tarde).
 */
function ventanaOcupacion(v: {
  ts_inicio_carga_real: Date | null;
  ts_regreso_real: Date | null;
  hora_inicio_carga: Date | null;
  hora_regreso_planta: Date | null;
}): VentanaViaje | null {
  const inicio = v.ts_inicio_carga_real ?? v.hora_inicio_carga;
  let fin = v.ts_regreso_real ?? v.hora_regreso_planta;
  if (!inicio || !fin) return null;
  if (fin < inicio) fin = inicio; // guardia contra ventana degenerada (viaje muy demorado)
  return { inicio, fin };
}

/** Metadatos de un mixer usados por el agendador. */
interface MetaMixer {
  id: number;
  capacidad_m3: number;
  plantel_base_id: number;
  operador_asignado_id: number | null;
}

/**
 * Candidatos de mixer para abastecer una planta: flota propia del plantel +
 * (si el plantel tiene hub distinto) la flota del hub de zona. Solo mixers
 * Disponible. El agendador escoge de aquí el mixer concreto de cada viaje.
 */
// ── Mantenimiento / disponibilidad de flota (Hito 6) ─────────────────────────
export type UnidadTipo = "Mixer" | "Bomba" | "Camion" | "Pickup";

/** IDs de unidades de un tipo con mantenimiento/baja ACTIVO (Programado/En_curso)
 *  cuyo rango de fechas cubre el DÍA de `fecha`. El motor las trata como no
 *  disponibles ese día (igual que si su estado fuera "Fuera de servicio"). */
export async function unidadesEnMantenimiento(
  unidadTipo: UnidadTipo,
  fecha: Date,
): Promise<Set<number>> {
  const dia = inicioDelDia(fecha);
  const regs = await prisma.disponibilidad_flota.findMany({
    where: {
      unidad_tipo: unidadTipo,
      estado: { in: ["Programado", "En_curso"] },
      fecha_inicio: { lte: dia },
      fecha_fin: { gte: dia },
    },
    select: { unidad_id: true },
  });
  return new Set(regs.map((r) => r.unidad_id));
}

/** Registro de mantenimiento/baja activo de UNA unidad el DÍA de `fecha` (o null).
 *  Sirve para rechazar una asignación manual con un mensaje claro del rango. */
export async function mantenimientoDeUnidad(
  unidadTipo: UnidadTipo,
  unidadId: number,
  fecha: Date,
) {
  const dia = inicioDelDia(fecha);
  return prisma.disponibilidad_flota.findFirst({
    where: {
      unidad_tipo: unidadTipo,
      unidad_id: unidadId,
      estado: { in: ["Programado", "En_curso"] },
      fecha_inicio: { lte: dia },
      fecha_fin: { gte: dia },
    },
  });
}

/** Mapa capacidad_nominal_m3 → capacidad_efectiva_m3 (config `capacidades_reducidas`).
 *  Lo usan los pedidos con `carga_reducida` para planear con la carga efectiva. */
async function cargarCapacidadesReducidas(): Promise<Map<number, number>> {
  const filas = await prisma.capacidades_reducidas.findMany({
    select: { capacidad_nominal_m3: true, capacidad_efectiva_m3: true },
  });
  return new Map(filas.map((f) => [f.capacidad_nominal_m3, f.capacidad_efectiva_m3]));
}

async function candidatosDePlanta(
  plantelId: number,
  hubId: number | null,
  dia: Date,
): Promise<MetaMixer[]> {
  const plantelesFuente =
    hubId != null && hubId !== plantelId ? [plantelId, hubId] : [plantelId];
  const [mixers, enMantenimiento] = await Promise.all([
    prisma.mixers.findMany({
      where: {
        estado: ESTADO_DISPONIBLE,
        plantel_base_id: { in: plantelesFuente },
      },
      select: {
        id: true,
        capacidad_m3: true,
        plantel_base_id: true,
        operador_asignado_id: true,
      },
    }),
    // Un mixer con mantenimiento/baja ese día NO es candidato (Hito 6).
    unidadesEnMantenimiento("Mixer", dia),
  ]);
  return mixers.filter((m) => !enMantenimiento.has(m.id));
}

// ── Cascada de horarios (consciente de mixers) ───────────────────────────────

/**
 * Recalcula la cascada de horarios de TODA la cola de una planta para un día Y
 * asigna el mixer concreto de cada viaje. Es CONSCIENTE DE MIXERS: un viaje solo
 * puede arrancar cuando (a) la planta quedó libre del anterior Y (b) hay un mixer
 * de la capacidad requerida que ya regresó de sus viajes anteriores. Así un mismo
 * mixer puede hacer varios viajes en el día (reutilización por horario) y jamás
 * se traslapan dos viajes del mismo mixer.
 *
 * Reglas:
 * - Orden de cola: por hora solicitada del pedido; desempate por id de viaje.
 * - Tiempo de carga = tiempo_alistamiento_min de la planta + volumen/capacidad.
 * - Tiempos de viaje/regreso: de los campos del cliente (`tiempo_*_referencia_min`,
 *   antes en `rutas_estandar`); si faltan, se usan los valores por defecto y se
 *   marca `ruta_por_defecto = true`.
 * - Elección del mixer entre los candidatos de la capacidad requerida:
 *     1º flota propia antes que préstamo del hub (Paso 1 antes que Paso 2);
 *     2º el que pueda arrancar más temprano (menos espera);
 *     3º el que lleva MÁS tiempo sin viaje ese día (reparto de desgaste);
 *     4º id (estable).
 * - Un viaje ya Completado o cuya carga real inició es FIJO: no se recalcula ni
 *   se reasigna; solo siembra el reloj de la planta y del mixer.
 * - Un viaje ajustado_manualmente conserva su mixer (p. ej. refuerzo).
 * - Devuelve los ids de los viajes cuyos horarios cambiaron (para bitácora/UI).
 */
/**
 * Recalcula la cascada de horarios de TODAS las plantas del PLANTEL al que pertenece
 * `plantaId`. Un plantel puede tener 2 plantas (Santa Marta, Tegucigalpa) y los
 * viajes de un pedido pueden repartirse entre ellas; cada planta se agenda por
 * separado (bahía independiente), agrupando los viajes por SU `planta_id`. Devuelve
 * los ids de los viajes que cambiaron.
 */
export async function recalcularCascadaPlanta(
  plantaId: number,
  dia: Date,
): Promise<number[]> {
  const planta = await prisma.plantas.findUniqueOrThrow({
    where: { id: plantaId },
    select: { plantel_id: true },
  });
  const plantas = await prisma.plantas.findMany({
    where: { plantel_id: planta.plantel_id },
    select: { id: true },
  });
  // 1 planta → cascada de una planta (ruta original, sin cambios). 2+ plantas
  // (Santa Marta, Tegucigalpa) → cascada MERGED que reparte la flota en PARALELO
  // entre las plantas (evita que una acapare los mixers y la otra espere).
  const cambios =
    plantas.length <= 1
      ? await cascadaDeUnaPlanta(plantas[0]?.id ?? plantaId, dia)
      : await cascadaMultiPlanta(planta.plantel_id, dia);
  // Post-paso TEMPORAL/REVERSIBLE: reubica los pedidos con hora de carga fijada por
  // el Admin. No modifica la cascada; con el flag apagado no hace nada.
  await aplicarHoraCargaManual(planta.plantel_id, dia);
  return cambios;
}

/**
 * TEMPORAL/REVERSIBLE (flag `PERMITIR_HORA_CARGA_MANUAL`). Post-paso que corre
 * DESPUÉS de la cascada: por cada pedido del plantel+día con `hora_carga_manual`
 * fijada por el Admin, DESPLAZA sus viajes movibles (no iniciados) para que la carga
 * arranque a esa hora exacta, preservando duraciones y escalonamiento. NO valida
 * traslapes con otros pedidos (es justo lo que el Admin pidió permitir). No toca la
 * lógica de la cascada; si el flag está apagado, retorna de inmediato.
 */
async function aplicarHoraCargaManual(plantelId: number, dia: Date): Promise<void> {
  if (!PERMITIR_HORA_CARGA_MANUAL) return;
  const pedidos = await prisma.pedidos.findMany({
    where: {
      plantel_id: plantelId,
      estado_pedido: "Activo",
      hora_carga_manual: { not: null },
      hora_solicitada: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
    },
    select: {
      id: true,
      hora_carga_manual: true,
      viajes: {
        // Solo viajes MOVIBLES: no cancelados, no completados, sin carga real
        // iniciada, con horario calculado. Los ya iniciados conservan su realidad.
        where: {
          estado: { notIn: ["Cancelado", "Completado"] },
          ts_inicio_carga_real: null,
          motivo_asignacion: { not: "Sin cubrir" },
          hora_inicio_carga: { not: null },
        },
        select: {
          id: true,
          hora_inicio_carga: true,
          hora_fin_carga: true,
          hora_salida_planta: true,
          hora_llegada_proyecto: true,
          hora_inicio_descarga: true,
          hora_fin_descarga: true,
          hora_regreso_planta: true,
        },
      },
    },
  });

  for (const p of pedidos) {
    if (p.hora_carga_manual == null || p.viajes.length === 0) continue;
    // Ancla = inicio de carga más temprano que la cascada acaba de calcular para
    // este pedido. Desplazamos TODO el bloque para que ese arranque sea la hora
    // manual (el resto de sus viajes conserva su separación relativa).
    const firstMs = Math.min(...p.viajes.map((v) => v.hora_inicio_carga!.getTime()));
    const deltaMs = p.hora_carga_manual.getTime() - firstMs;
    if (deltaMs === 0) continue;
    const desplazar = (d: Date | null) => (d == null ? null : new Date(d.getTime() + deltaMs));
    for (const v of p.viajes) {
      await prisma.viajes.update({
        where: { id: v.id },
        data: {
          hora_inicio_carga: desplazar(v.hora_inicio_carga),
          hora_fin_carga: desplazar(v.hora_fin_carga),
          hora_salida_planta: desplazar(v.hora_salida_planta),
          hora_llegada_proyecto: desplazar(v.hora_llegada_proyecto),
          hora_inicio_descarga: desplazar(v.hora_inicio_descarga),
          hora_fin_descarga: desplazar(v.hora_fin_descarga),
          hora_regreso_planta: desplazar(v.hora_regreso_planta),
        },
      });
    }
  }
}

/**
 * PRIORIDAD NUEVA (planta siempre cargando > minimizar viajes): elige el mejor mixer
 * para el siguiente viaje ENTRE LOS DISPONIBLES, evaluando la mejor combinación solo
 * contra lo que hay AHORA — nunca esperando a que regrese una capacidad "ideal".
 *
 *  1. Se calcula, por candidato, el inicio posible = max(pisoBase, disponible del mixer).
 *  2. Se toma el conjunto que ARRANCA MÁS TEMPRANO (mínimo inicio): si algún mixer está
 *     libre AHORA, ese conjunto son los libres ahora (nunca se espera). Si NINGUNO está
 *     libre, es el/los que regresan primero (se espera al primero, de cualquier capacidad).
 *  3. Dentro de ese conjunto, se prefiere CARGA LLENA (capacidad ≤ restante, la mayor);
 *     si ninguna cabe llena (restante < capacidad mínima), la menor (carga parcial).
 *     Desempate: propio antes que hub, luego el más ocioso (reparto de desgaste), luego id.
 *
 * Devuelve el mixer, el instante de inicio y la carga (m³) del viaje, o null si no hay
 * ningún candidato (pedido queda "Sin cubrir").
 */
function elegirMixerDisponible(
  candidatos: MetaMixer[],
  dispEnMs: Map<number, number>,
  pisoBaseMs: number,
  restante: number,
  cargaReducida: boolean,
  reducidas: Map<number, number>,
  plantelId: number,
): { mixer: MetaMixer; inicioMs: number; carga: number; capacidad: number } | null {
  if (candidatos.length === 0) return null;
  const ev = candidatos.map((m) => {
    const capacidad = capacidadPlaneacion(m.capacidad_m3, cargaReducida, reducidas);
    const dispMs = dispEnMs.get(m.id) ?? 0;
    const inicioMs = Math.max(pisoBaseMs, dispMs);
    return { m, capacidad, dispMs, inicioMs, propio: m.plantel_base_id === plantelId ? 0 : 1 };
  });
  const minInicio = Math.min(...ev.map((e) => e.inicioMs));
  const enElMasTemprano = ev.filter((e) => e.inicioMs === minInicio);
  // Capacidad objetivo = la que la MEJOR COMBINACIÓN elegiría para el volumen que
  // falta, pero SOLO entre las capacidades disponibles AHORA (las del conjunto que
  // arranca más temprano). Así se preserva "minimizar viajes / evitar carga parcial
  // evitable" (requisito 1) sin esperar una capacidad que aún no está libre.
  const capsAhora = [...new Set(enElMasTemprano.map((e) => e.capacidad))];
  const plan = planificarCombinacion(restante, capsAhora);
  const capObjetivo = plan.viajes[0]?.capacidad ?? Math.max(...capsAhora);
  const pool = enElMasTemprano.filter((e) => e.capacidad === capObjetivo);
  const elegido = (pool.length ? pool : enElMasTemprano).sort(
    (a, b) => a.propio - b.propio || a.dispMs - b.dispMs || a.m.id - b.m.id,
  )[0];
  return {
    mixer: elegido.m,
    inicioMs: elegido.inicioMs,
    carga: Math.min(restante, elegido.capacidad),
    capacidad: elegido.capacidad,
  };
}

/** Cascada de UNA planta (bahía única): agenda los viajes cuyo `planta_id` es esta
 *  planta, en orden de atención. La usa `recalcularCascadaPlanta` para cada planta. */
async function cascadaDeUnaPlanta(
  plantaId: number,
  dia: Date,
): Promise<number[]> {
  const planta = await prisma.plantas.findUniqueOrThrow({
    where: { id: plantaId },
  });
  const plantel = await prisma.planteles.findUniqueOrThrow({
    where: { id: planta.plantel_id },
    select: { id: true, hub_id: true },
  });

  const candidatos = await candidatosDePlanta(plantel.id, plantel.hub_id, dia);
  const reducidas = await cargarCapacidadesReducidas();
  // Metadatos de TODOS los mixers (para viajes fijos/manuales cuyo mixer podría
  // no estar entre los candidatos, p. ej. un refuerzo de otro plantel).
  const metaTodos = new Map<number, MetaMixer>();
  for (const m of await prisma.mixers.findMany({
    select: {
      id: true,
      capacidad_m3: true,
      plantel_base_id: true,
      operador_asignado_id: true,
    },
  })) {
    metaTodos.set(m.id, m);
  }

  const viajes = await prisma.viajes.findMany({
    where: {
      estado: { not: "Cancelado" },
      // Los placeholders "Sin cubrir" no ocupan tiempo de planta.
      motivo_asignacion: { not: "Sin cubrir" },
      // Viajes dosificados en ESTA planta (por viaje, no por pedido: un pedido puede
      // repartir sus viajes entre las 2 plantas del plantel).
      planta_id: plantaId,
      pedido: {
        hora_solicitada: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
      },
    },
    include: { pedido: { include: { cliente: true } } },
  });

  // La cola de la planta se ordena por el ORDEN DE ATENCIÓN del pedido
  // (orden_dia), no por la hora solicitada. Desempate: hora solicitada, luego id.
  // Los pedidos que van a OTRA planta del mismo plantel están en otra cascada, así
  // que dos órdenes consecutivos en plantas distintas no se fuerzan en secuencia.
  viajes.sort((a, b) => {
    const oa = a.pedido.orden_dia ?? Number.MAX_SAFE_INTEGER;
    const ob = b.pedido.orden_dia ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    const t = a.pedido.hora_solicitada.getTime() - b.pedido.hora_solicitada.getTime();
    return t !== 0 ? t : a.id - b.id;
  });

  // Reloj de disponibilidad de cada mixer (ms). Se siembra con los viajes que
  // ese mixer YA tiene comprometidos en OTRAS plantas ese día (un mixer se
  // comparte entre plantas del mismo hub): no está libre hasta regresar de ellos.
  const dispEnMs = new Map<number, number>();
  const candidatosIds = candidatos.map((c) => c.id);
  if (candidatosIds.length > 0) {
    const otras = await prisma.viajes.findMany({
      where: {
        mixer_id: { in: candidatosIds },
        estado: { not: "Cancelado" },
        hora_inicio_carga: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
        // Viajes del mixer en OTRAS plantas ese día (incluye la planta hermana del
        // plantel): el mixer no está libre hasta regresar de ellos.
        planta_id: { not: plantaId },
      },
      select: { mixer_id: true, hora_regreso_planta: true, hora_fin_carga: true },
    });
    for (const o of otras) {
      if (o.mixer_id == null) continue;
      const fin = (o.hora_regreso_planta ?? o.hora_fin_carga)?.getTime();
      if (fin == null) continue;
      dispEnMs.set(o.mixer_id, Math.max(dispEnMs.get(o.mixer_id) ?? 0, fin));
    }
  }

  const cambios: number[] = [];
  let plantaLibreEn: Date | null = null;
  // LLEGADA a obra del último viaje colocado de cada pedido. La frecuencia entre
  // camiones (frecuencia_entre_camiones_min) es una CADENCIA DE LLEGADAS: la llegada
  // del viaje N debe ser >= llegada del N-1 + frecuencia. Se ancla sobre la LLEGADA
  // (no sobre el inicio de carga) para que la cadencia sea constante aunque se mezclen
  // mixers de distinta capacidad (que cargan en tiempos distintos).
  const ultimaLlegadaPorPedidoMs = new Map<number, number>();

  // `hora_solicitada` es la LLEGADA deseada al proyecto (no la hora de carga).
  // Inicio de jornada = la LLEGADA más temprana pedida en la cola. El PRIMER
  // viaje del orden se agenda para LLEGAR a esa hora (su inicio de carga se
  // calcula hacia atrás: llegada − carga − salida − transporte); el resto se
  // encadena tras él según planta y disponibilidad de mixer.
  const jornadaLlegadaMs = viajes.length
    ? Math.min(...viajes.map((v) => v.pedido.hora_solicitada.getTime()))
    : 0;

  type ViajeCola = (typeof viajes)[number];

  // Horarios de un viaje a partir de su inicio de carga, volumen y tiempos del pedido.
  const tiemposDe = (
    inicioMs: number,
    vol: number,
    tViaje: number,
    tRegreso: number,
    tipoDescarga: string,
  ) => {
    const inicioCarga = new Date(inicioMs);
    const finCarga = sumarMinutos(
      inicioCarga,
      planta.tiempo_alistamiento_min + minutosDeCarga(vol, planta.capacidad_m3h),
    );
    const salidaPlanta = sumarMinutos(finCarga, MIN_SALIDA_TRAS_CARGA);
    const llegadaProyecto = sumarMinutos(salidaPlanta, tViaje);
    const inicioDescarga = llegadaProyecto;
    const finDescarga = sumarMinutos(inicioDescarga, minutosDeDescarga(vol, tipoDescarga));
    const regresoPlanta = sumarMinutos(finDescarga, tRegreso);
    return { inicioCarga, finCarga, salidaPlanta, llegadaProyecto, inicioDescarga, finDescarga, regresoPlanta };
  };
  const cargaMinDe = (vol: number) =>
    planta.tiempo_alistamiento_min + minutosDeCarga(vol, planta.capacidad_m3h);
  const marcarSinCubrir = async (v: ViajeCola) => {
    if (v.mixer_id != null || v.motivo_asignacion !== "Sin cubrir") cambios.push(v.id);
    await prisma.viajes.update({
      where: { id: v.id },
      data: {
        mixer_id: null,
        motivo_asignacion: "Sin cubrir",
        hora_inicio_carga: null,
        hora_fin_carga: null,
        hora_salida_planta: null,
        hora_llegada_proyecto: null,
        hora_inicio_descarga: null,
        hora_fin_descarga: null,
        hora_regreso_planta: null,
      },
    });
  };

  let idx = 0;
  while (idx < viajes.length) {
    const v = viajes[idx];
    const esFijo = v.estado === ESTADO_VIAJE_COMPLETADO || v.ts_inicio_carga_real != null;

    // ── Viaje FIJO (ya inició/completó): ancla, no se re-agenda. ──
    if (esFijo) {
      if (v.hora_llegada_proyecto) ultimaLlegadaPorPedidoMs.set(v.pedido_id, v.hora_llegada_proyecto.getTime());
      const finCargaFijo =
        v.hora_fin_carga ??
        (v.hora_inicio_carga ? sumarMinutos(v.hora_inicio_carga, cargaMinDe(v.volumen_asignado_m3)) : null);
      if (finCargaFijo && (!plantaLibreEn || finCargaFijo > plantaLibreEn)) plantaLibreEn = finCargaFijo;
      if (v.mixer_id != null) {
        const fin = (v.hora_regreso_planta ?? finCargaFijo)?.getTime();
        if (fin != null) dispEnMs.set(v.mixer_id, Math.max(dispEnMs.get(v.mixer_id) ?? 0, fin));
      }
      idx++;
      continue;
    }

    const pedido = v.pedido;
    const cli = pedido.cliente;
    const transporteOverride = pedido.tiempo_transporte_min;
    const transporteCliente = cli.tiempo_viaje_referencia_min;
    const rutaPorDefecto = transporteOverride == null && transporteCliente == null;
    const tViaje = transporteOverride ?? transporteCliente ?? DEFAULT_TIEMPO_VIAJE_MIN;
    const tRegreso = tViaje;
    const freq = pedido.frecuencia_entre_camiones_min;
    const anclaDe = (backwardMs: number) =>
      pedido.hora_bloqueada
        ? pedido.hora_solicitada.getTime() - backwardMs
        : plantaLibreEn == null
          ? jornadaLlegadaMs - backwardMs
          : 0;
    // Cadencia de frecuencia SOBRE LA LLEGADA: retrasa el inicio (nunca lo adelanta)
    // para que la llegada de este viaje sea >= llegada previa del pedido + frecuencia.
    const conFrecuencia = (
      inicioMs: number,
      vol: number,
    ): { inicioMs: number; t: ReturnType<typeof tiemposDe> } => {
      let t = tiemposDe(inicioMs, vol, tViaje, tRegreso, pedido.tipo_descarga);
      if (freq != null) {
        const prev = ultimaLlegadaPorPedidoMs.get(pedido.id);
        if (prev != null) {
          const target = prev + freq * 60000;
          if (t.llegadaProyecto.getTime() < target) {
            inicioMs += target - t.llegadaProyecto.getTime();
            t = tiemposDe(inicioMs, vol, tViaje, tRegreso, pedido.tipo_descarga);
          }
        }
      }
      return { inicioMs, t };
    };

    // ── Viaje MANUAL (refuerzo/reasignación): conserva su mixer; un solo viaje. ──
    if (v.ajustado_manualmente && v.mixer_id != null) {
      const meta = metaTodos.get(v.mixer_id);
      if (!meta) {
        await marcarSinCubrir(v);
        idx++;
        continue;
      }
      const vol = v.volumen_asignado_m3;
      const backwardMs = (cargaMinDe(vol) + MIN_SALIDA_TRAS_CARGA + tViaje) * 60000;
      const inicioNaturalMs = Math.max(
        plantaLibreEn?.getTime() ?? 0,
        dispEnMs.get(meta.id) ?? 0,
        anclaDe(backwardMs),
      );
      const { t } = conFrecuencia(inicioNaturalMs, vol);
      plantaLibreEn = t.finCarga;
      dispEnMs.set(meta.id, t.regresoPlanta.getTime());
      ultimaLlegadaPorPedidoMs.set(pedido.id, t.llegadaProyecto.getTime());
      const cambio =
        v.mixer_id !== meta.id ||
        !igualFecha(v.hora_inicio_carga, t.inicioCarga) ||
        !igualFecha(v.hora_regreso_planta, t.regresoPlanta);
      if (cambio) cambios.push(v.id);
      await prisma.viajes.update({
        where: { id: v.id },
        data: {
          mixer_id: meta.id,
          capacidad_asignada_m3: capacidadPlaneacion(meta.capacidad_m3, pedido.carga_reducida, reducidas),
          motivo_asignacion: v.motivo_asignacion ?? "Flota propia",
          hora_inicio_carga: t.inicioCarga,
          hora_fin_carga: t.finCarga,
          hora_salida_planta: t.salidaPlanta,
          hora_llegada_proyecto: t.llegadaProyecto,
          hora_inicio_descarga: t.inicioDescarga,
          hora_fin_descarga: t.finDescarga,
          hora_regreso_planta: t.regresoPlanta,
          ruta_por_defecto: rutaPorDefecto,
        },
      });
      idx++;
      continue;
    }

    // ── CORRIDA AUTO: viajes consecutivos del MISMO pedido y mismo `es_adicion`. Se
    //    asigna INCREMENTALMENTE: viaje por viaje se toma el mejor mixer DISPONIBLE
    //    ahora (nunca se espera una capacidad ideal si hay otra libre). El nº de
    //    viajes es dinámico: puede diferir del plan inicial. ──
    const esAdicionRun = v.es_adicion;
    const run: ViajeCola[] = [];
    while (idx < viajes.length) {
      const w = viajes[idx];
      const wFijo = w.estado === ESTADO_VIAJE_COMPLETADO || w.ts_inicio_carga_real != null;
      const wManual = w.ajustado_manualmente && w.mixer_id != null;
      if (w.pedido_id !== pedido.id || w.es_adicion !== esAdicionRun || wFijo || wManual) break;
      run.push(w);
      idx++;
    }

    let restante = run.reduce((s, w) => s + w.volumen_asignado_m3, 0);
    if (candidatos.length === 0) {
      for (const w of run) await marcarSinCubrir(w);
      continue;
    }

    interface TripPlan {
      mixer: MetaMixer;
      vol: number;
      capacidad: number;
      motivo: string;
      t: ReturnType<typeof tiemposDe>;
    }
    const trips: TripPlan[] = [];
    while (restante > 1e-6) {
      const plantaLibreMs = plantaLibreEn?.getTime() ?? 0;
      // La frecuencia ya NO entra en el piso de selección del mixer (se aplica sobre
      // la llegada, abajo): así se elige el mixer que arranca más temprano y luego se
      // retrasa la carga lo justo para cumplir la cadencia de llegadas.
      const elegido = elegirMixerDisponible(
        candidatos,
        dispEnMs,
        plantaLibreMs,
        restante,
        pedido.carga_reducida,
        reducidas,
        plantel.id,
      );
      if (!elegido) break;
      const vol = elegido.carga;
      const backwardMs = (cargaMinDe(vol) + MIN_SALIDA_TRAS_CARGA + tViaje) * 60000;
      const inicioNaturalMs = Math.max(elegido.inicioMs, anclaDe(backwardMs));
      const { t } = conFrecuencia(inicioNaturalMs, vol);
      trips.push({
        mixer: elegido.mixer,
        vol,
        capacidad: elegido.capacidad,
        motivo: elegido.mixer.plantel_base_id === plantel.id ? "Flota propia" : "Préstamo de zona",
        t,
      });
      plantaLibreEn = t.finCarga;
      dispEnMs.set(elegido.mixer.id, t.regresoPlanta.getTime());
      ultimaLlegadaPorPedidoMs.set(pedido.id, t.llegadaProyecto.getTime());
      restante -= vol;
    }

    // Reconciliar las filas de la corrida con los viajes generados (update / create /
    // delete): puede haber más o menos viajes que el plan inicial.
    for (let k = 0; k < trips.length; k++) {
      const tp = trips[k];
      const datos = {
        mixer_id: tp.mixer.id,
        capacidad_asignada_m3: tp.capacidad,
        volumen_asignado_m3: tp.vol,
        motivo_asignacion: tp.motivo,
        operador_id: tp.mixer.operador_asignado_id,
        hora_inicio_carga: tp.t.inicioCarga,
        hora_fin_carga: tp.t.finCarga,
        hora_salida_planta: tp.t.salidaPlanta,
        hora_llegada_proyecto: tp.t.llegadaProyecto,
        hora_inicio_descarga: tp.t.inicioDescarga,
        hora_fin_descarga: tp.t.finDescarga,
        hora_regreso_planta: tp.t.regresoPlanta,
        ruta_por_defecto: rutaPorDefecto,
      };
      if (k < run.length) {
        const w = run[k];
        const cambio =
          w.mixer_id !== tp.mixer.id ||
          w.volumen_asignado_m3 !== tp.vol ||
          !igualFecha(w.hora_inicio_carga, tp.t.inicioCarga) ||
          !igualFecha(w.hora_regreso_planta, tp.t.regresoPlanta);
        if (cambio) cambios.push(w.id);
        await prisma.viajes.update({ where: { id: w.id }, data: datos });
      } else {
        const creado = await prisma.viajes.create({
          data: {
            pedido_id: pedido.id,
            planta_id: plantaId,
            hora_solicitada: pedido.hora_solicitada,
            estado: "Programado",
            estado_confirmacion: run[0]?.estado_confirmacion ?? "Pendiente",
            es_adicion: esAdicionRun,
            ajustado_manualmente: false,
            ...datos,
          },
        });
        cambios.push(creado.id);
      }
    }
    // Filas sobrantes (el resultado usó menos viajes que el plan inicial): eliminar.
    for (let k = trips.length; k < run.length; k++) {
      await prisma.viajes.delete({ where: { id: run[k].id } });
    }
  }

  return cambios;
}

/**
 * Cascada MERGED para planteles de 2+ plantas (Santa Marta, Tegucigalpa): agenda las
 * plantas EN PARALELO en una sola pasada ordenada por tiempo, compartiendo el pool de
 * mixers. En cada paso elige, entre las cabezas de cada cola, el viaje que puede
 * ARRANCAR más temprano y le asigna el mixer disponible más pronto; así ambas plantas
 * cargan a la vez en lugar de que la primera acapare la flota y la segunda espere.
 *
 * Replica la MISMA lógica por-viaje que `cascadaDeUnaPlanta` (transporte, tiempo de
 * carga, anclaje de jornada, frecuencia, selección de mixer propio/hub/ocioso, carga
 * segura); la única diferencia es el ORDEN de recorrido (intercalado entre plantas en
 * vez de una planta completa y luego la otra). Los planteles de 1 planta siguen usando
 * `cascadaDeUnaPlanta` sin cambios.
 */
async function cascadaMultiPlanta(plantelId: number, dia: Date): Promise<number[]> {
  const plantel = await prisma.planteles.findUniqueOrThrow({
    where: { id: plantelId },
    select: { id: true, hub_id: true },
  });
  const plantasDb = await prisma.plantas.findMany({
    where: { plantel_id: plantelId },
    orderBy: { id: "asc" },
  });
  const plantaIds = plantasDb.map((p) => p.id);

  const candidatos = await candidatosDePlanta(plantel.id, plantel.hub_id, dia);
  const reducidas = await cargarCapacidadesReducidas();
  const metaTodos = new Map<number, MetaMixer>();
  for (const m of await prisma.mixers.findMany({
    select: { id: true, capacidad_m3: true, plantel_base_id: true, operador_asignado_id: true },
  })) {
    metaTodos.set(m.id, m);
  }

  // Reloj de disponibilidad de mixer COMPARTIDO entre las plantas del plantel. Se
  // siembra solo con viajes en plantas de OTROS planteles (préstamos fijos): las
  // plantas hermanas se agendan aquí, así que su uso de flota se lleva en vivo.
  const dispEnMs = new Map<number, number>();
  const candidatosIds = candidatos.map((c) => c.id);
  if (candidatosIds.length > 0) {
    const otras = await prisma.viajes.findMany({
      where: {
        mixer_id: { in: candidatosIds },
        estado: { not: "Cancelado" },
        hora_inicio_carga: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
        planta_id: { notIn: plantaIds },
      },
      select: { mixer_id: true, hora_regreso_planta: true, hora_fin_carga: true },
    });
    for (const o of otras) {
      if (o.mixer_id == null) continue;
      const fin = (o.hora_regreso_planta ?? o.hora_fin_carga)?.getTime();
      if (fin == null) continue;
      dispEnMs.set(o.mixer_id, Math.max(dispEnMs.get(o.mixer_id) ?? 0, fin));
    }
  }

  // Cola (ordenada por orden_dia) y estado por planta.
  const estados = await Promise.all(
    plantasDb.map(async (planta) => {
      const viajes = await prisma.viajes.findMany({
        where: {
          estado: { not: "Cancelado" },
          motivo_asignacion: { not: "Sin cubrir" },
          planta_id: planta.id,
          pedido: { hora_solicitada: { gte: inicioDelDia(dia), lt: finDelDia(dia) } },
        },
        include: { pedido: { include: { cliente: true } } },
      });
      viajes.sort((a, b) => {
        const oa = a.pedido.orden_dia ?? Number.MAX_SAFE_INTEGER;
        const ob = b.pedido.orden_dia ?? Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        const t = a.pedido.hora_solicitada.getTime() - b.pedido.hora_solicitada.getTime();
        return t !== 0 ? t : a.id - b.id;
      });
      const jornadaLlegadaMs = viajes.length
        ? Math.min(...viajes.map((v) => v.pedido.hora_solicitada.getTime()))
        : 0;
      return { planta, viajes, ptr: 0, plantaLibreEn: null as Date | null, jornadaLlegadaMs };
    }),
  );
  type EstadoPlanta = (typeof estados)[number];
  type ViajeCola = EstadoPlanta["viajes"][number];

  const cambios: number[] = [];
  // LLEGADA del último viaje por pedido (cadencia de frecuencia sobre la llegada).
  const ultimaLlegadaPorPedidoMs = new Map<number, number>();

  const esFijo = (v: ViajeCola) =>
    v.estado === ESTADO_VIAJE_COMPLETADO || v.ts_inicio_carga_real != null;

  // Viaje FIJO (ya inició/completó): no se re-agenda; solo siembra el reloj de la
  // planta y del mixer (idéntico a la rama fija de cascadaDeUnaPlanta).
  const procesarFijo = (v: ViajeCola, e: EstadoPlanta) => {
    if (v.hora_llegada_proyecto) ultimaLlegadaPorPedidoMs.set(v.pedido_id, v.hora_llegada_proyecto.getTime());
    const finCarga =
      v.hora_fin_carga ??
      (v.hora_inicio_carga
        ? sumarMinutos(
            v.hora_inicio_carga,
            e.planta.tiempo_alistamiento_min +
              minutosDeCarga(v.volumen_asignado_m3, e.planta.capacidad_m3h),
          )
        : null);
    if (finCarga && (!e.plantaLibreEn || finCarga > e.plantaLibreEn)) e.plantaLibreEn = finCarga;
    if (v.mixer_id != null) {
      const fin = (v.hora_regreso_planta ?? finCarga)?.getTime();
      if (fin != null) dispEnMs.set(v.mixer_id, Math.max(dispEnMs.get(v.mixer_id) ?? 0, fin));
    }
  };

  const cargaMinDe = (e: EstadoPlanta, vol: number) =>
    e.planta.tiempo_alistamiento_min + minutosDeCarga(vol, e.planta.capacidad_m3h);
  const tiemposDe = (
    e: EstadoPlanta,
    inicioMs: number,
    vol: number,
    tViaje: number,
    tRegreso: number,
    tipoDescarga: string,
  ) => {
    const inicioCarga = new Date(inicioMs);
    const finCarga = sumarMinutos(inicioCarga, cargaMinDe(e, vol));
    const salidaPlanta = sumarMinutos(finCarga, MIN_SALIDA_TRAS_CARGA);
    const llegadaProyecto = sumarMinutos(salidaPlanta, tViaje);
    const inicioDescarga = llegadaProyecto;
    const finDescarga = sumarMinutos(inicioDescarga, minutosDeDescarga(vol, tipoDescarga));
    const regresoPlanta = sumarMinutos(finDescarga, tRegreso);
    return { inicioCarga, finCarga, salidaPlanta, llegadaProyecto, inicioDescarga, finDescarga, regresoPlanta };
  };

  const marcarSinCubrir = async (v: ViajeCola) => {
    if (v.mixer_id != null || v.motivo_asignacion !== "Sin cubrir") cambios.push(v.id);
    await prisma.viajes.update({
      where: { id: v.id },
      data: {
        mixer_id: null,
        motivo_asignacion: "Sin cubrir",
        hora_inicio_carga: null,
        hora_fin_carga: null,
        hora_salida_planta: null,
        hora_llegada_proyecto: null,
        hora_inicio_descarga: null,
        hora_fin_descarga: null,
        hora_regreso_planta: null,
      },
    });
  };

  // Estado de la corrida (unidad de trabajo) activa por planta: la asignación es
  // INCREMENTAL viaje por viaje (mejor mixer disponible AHORA), con nº de viajes
  // dinámico → se reciclan/crean/borran filas al reconciliar.
  interface RunState {
    rows: ViajeCola[];
    restante: number;
    emitidos: number;
    esAdicion: boolean;
    pedido: ViajeCola["pedido"];
    tViaje: number;
    tRegreso: number;
    rutaPorDefecto: boolean;
    freq: number | null;
    manualMixerId: number | null;
  }
  const runPorPlanta = new Map<number, RunState | null>();
  for (const e of estados) runPorPlanta.set(e.planta.id, null);

  const ctxPedido = (pedido: ViajeCola["pedido"]) => {
    const transporteOverride = pedido.tiempo_transporte_min;
    const transporteCliente = pedido.cliente.tiempo_viaje_referencia_min;
    const rutaPorDefecto = transporteOverride == null && transporteCliente == null;
    const tViaje = transporteOverride ?? transporteCliente ?? DEFAULT_TIEMPO_VIAJE_MIN;
    return { tViaje, tRegreso: tViaje, rutaPorDefecto, freq: pedido.frecuencia_entre_camiones_min };
  };

  // Prepara la siguiente UNIDAD de una planta: descarta fijas (sembrando relojes) y
  // arma la corrida auto (o de un viaje manual) que sigue en la cola.
  const prepararUnidad = (e: EstadoPlanta) => {
    while (e.ptr < e.viajes.length && esFijo(e.viajes[e.ptr])) {
      procesarFijo(e.viajes[e.ptr], e);
      e.ptr++;
    }
    if (e.ptr >= e.viajes.length) {
      runPorPlanta.set(e.planta.id, null);
      return;
    }
    const head = e.viajes[e.ptr];
    const c = ctxPedido(head.pedido);
    if (head.ajustado_manualmente && head.mixer_id != null) {
      runPorPlanta.set(e.planta.id, {
        rows: [head],
        restante: head.volumen_asignado_m3,
        emitidos: 0,
        esAdicion: head.es_adicion,
        pedido: head.pedido,
        ...c,
        manualMixerId: head.mixer_id,
      });
      e.ptr++;
      return;
    }
    const esAd = head.es_adicion;
    const rows: ViajeCola[] = [];
    while (e.ptr < e.viajes.length) {
      const w = e.viajes[e.ptr];
      const wManual = w.ajustado_manualmente && w.mixer_id != null;
      if (w.pedido_id !== head.pedido_id || w.es_adicion !== esAd || esFijo(w) || wManual) break;
      rows.push(w);
      e.ptr++;
    }
    runPorPlanta.set(e.planta.id, {
      rows,
      restante: rows.reduce((s, w) => s + w.volumen_asignado_m3, 0),
      emitidos: 0,
      esAdicion: esAd,
      pedido: head.pedido,
      ...c,
      manualMixerId: null,
    });
  };

  interface TripPlan {
    e: EstadoPlanta;
    run: RunState;
    mixer: MetaMixer;
    vol: number;
    capacidad: number;
    motivo: string;
    t: ReturnType<typeof tiemposDe>;
  }

  // Siguiente viaje de una corrida SIN comprometer. null → sin cubrir (sin candidato).
  // La frecuencia se aplica sobre la LLEGADA (cadencia constante), no sobre el inicio.
  const siguienteTrip = (e: EstadoPlanta, run: RunState): TripPlan | null => {
    const plantaLibreMs = e.plantaLibreEn?.getTime() ?? 0;
    const anclaDe = (backwardMs: number) =>
      run.pedido.hora_bloqueada
        ? run.pedido.hora_solicitada.getTime() - backwardMs
        : e.plantaLibreEn == null
          ? e.jornadaLlegadaMs - backwardMs
          : 0;

    let mixer: MetaMixer;
    let vol: number;
    let capacidad: number;
    let inicioMs: number;
    if (run.manualMixerId != null) {
      const meta = metaTodos.get(run.manualMixerId);
      if (!meta) return null;
      mixer = meta;
      vol = run.restante;
      capacidad = capacidadPlaneacion(meta.capacidad_m3, run.pedido.carga_reducida, reducidas);
      const backwardMs = (cargaMinDe(e, vol) + MIN_SALIDA_TRAS_CARGA + run.tViaje) * 60000;
      inicioMs = Math.max(plantaLibreMs, dispEnMs.get(meta.id) ?? 0, anclaDe(backwardMs));
    } else {
      const elegido = elegirMixerDisponible(
        candidatos,
        dispEnMs,
        plantaLibreMs,
        run.restante,
        run.pedido.carga_reducida,
        reducidas,
        plantel.id,
      );
      if (!elegido) return null;
      mixer = elegido.mixer;
      vol = elegido.carga;
      capacidad = elegido.capacidad;
      const backwardMs = (cargaMinDe(e, vol) + MIN_SALIDA_TRAS_CARGA + run.tViaje) * 60000;
      inicioMs = Math.max(elegido.inicioMs, anclaDe(backwardMs));
    }
    // Cadencia de frecuencia sobre la LLEGADA: retrasar (nunca adelantar) para que la
    // llegada del viaje sea >= llegada previa del pedido + frecuencia.
    let t = tiemposDe(e, inicioMs, vol, run.tViaje, run.tRegreso, run.pedido.tipo_descarga);
    if (run.freq != null) {
      const prev = ultimaLlegadaPorPedidoMs.get(run.pedido.id);
      if (prev != null) {
        const target = prev + run.freq * 60000;
        if (t.llegadaProyecto.getTime() < target) {
          inicioMs += target - t.llegadaProyecto.getTime();
          t = tiemposDe(e, inicioMs, vol, run.tViaje, run.tRegreso, run.pedido.tipo_descarga);
        }
      }
    }
    const motivo =
      run.manualMixerId != null
        ? (run.rows[run.emitidos]?.motivo_asignacion ?? "Flota propia")
        : mixer.plantel_base_id === plantel.id
          ? "Flota propia"
          : "Préstamo de zona";
    return { e, run, mixer, vol, capacidad, motivo, t };
  };

  // Comprometer un viaje: reconcilia la fila (recicla / crea) y avanza los relojes.
  const comprometer = async (tp: TripPlan) => {
    const { e, run } = tp;
    e.plantaLibreEn = tp.t.finCarga;
    dispEnMs.set(tp.mixer.id, tp.t.regresoPlanta.getTime());
    ultimaLlegadaPorPedidoMs.set(run.pedido.id, tp.t.llegadaProyecto.getTime());
    const esManual = run.manualMixerId != null;
    const datos = {
      mixer_id: tp.mixer.id,
      capacidad_asignada_m3: tp.capacidad,
      volumen_asignado_m3: tp.vol,
      motivo_asignacion: tp.motivo,
      ...(esManual ? {} : { operador_id: tp.mixer.operador_asignado_id }),
      hora_inicio_carga: tp.t.inicioCarga,
      hora_fin_carga: tp.t.finCarga,
      hora_salida_planta: tp.t.salidaPlanta,
      hora_llegada_proyecto: tp.t.llegadaProyecto,
      hora_inicio_descarga: tp.t.inicioDescarga,
      hora_fin_descarga: tp.t.finDescarga,
      hora_regreso_planta: tp.t.regresoPlanta,
      ruta_por_defecto: run.rutaPorDefecto,
    };
    if (run.emitidos < run.rows.length) {
      const w = run.rows[run.emitidos];
      const cambio =
        w.mixer_id !== tp.mixer.id ||
        w.volumen_asignado_m3 !== tp.vol ||
        !igualFecha(w.hora_inicio_carga, tp.t.inicioCarga) ||
        !igualFecha(w.hora_regreso_planta, tp.t.regresoPlanta);
      if (cambio) cambios.push(w.id);
      await prisma.viajes.update({ where: { id: w.id }, data: datos });
    } else {
      const creado = await prisma.viajes.create({
        data: {
          pedido_id: run.pedido.id,
          planta_id: e.planta.id,
          hora_solicitada: run.pedido.hora_solicitada,
          estado: "Programado",
          estado_confirmacion: run.rows[0]?.estado_confirmacion ?? "Pendiente",
          es_adicion: run.esAdicion,
          ajustado_manualmente: false,
          ...datos,
        },
      });
      cambios.push(creado.id);
    }
    run.emitidos++;
    run.restante -= tp.vol;
  };

  // Cierra una corrida: borra las filas sobrantes (menos viajes que el plan inicial).
  const cerrarRun = async (e: EstadoPlanta, run: RunState) => {
    for (let k = run.emitidos; k < run.rows.length; k++) {
      await prisma.viajes.delete({ where: { id: run.rows[k].id } });
    }
    runPorPlanta.set(e.planta.id, null);
  };

  // Pasada MERGED trip-driven: en cada vuelta se calcula el siguiente viaje de la
  // corrida activa de cada planta y se agenda el que arranca más temprano (así ambas
  // plantas cargan en paralelo compartiendo la flota). Cada vuelta comete al menos un
  // viaje o marca sin-cubrir → termina.
  for (;;) {
    for (const e of estados) {
      if (runPorPlanta.get(e.planta.id) == null && e.ptr < e.viajes.length) prepararUnidad(e);
    }
    const pendientes: TripPlan[] = [];
    for (const e of estados) {
      const run = runPorPlanta.get(e.planta.id);
      if (!run || run.restante <= 1e-6) continue;
      const tp = siguienteTrip(e, run);
      if (!tp) {
        for (let k = run.emitidos; k < run.rows.length; k++) await marcarSinCubrir(run.rows[k]);
        runPorPlanta.set(e.planta.id, null);
      } else {
        pendientes.push(tp);
      }
    }
    if (pendientes.length === 0) {
      if (estados.every((e) => e.ptr >= e.viajes.length && runPorPlanta.get(e.planta.id) == null)) break;
      continue; // solo hubo fijas/sin-cubrir este paso
    }
    pendientes.sort(
      (a, b) => a.t.inicioCarga.getTime() - b.t.inicioCarga.getTime() || a.e.planta.id - b.e.planta.id,
    );
    const elegido = pendientes[0];
    // CARGA SIMULTÁNEA: si el pedido la pidió y hay un viaje del MISMO pedido listo en
    // la OTRA planta, ambos arrancan a la misma hora (la más tardía de las dos).
    const hermano = elegido.run.pedido.carga_simultanea
      ? pendientes.find((c) => c !== elegido && c.run.pedido.id === elegido.run.pedido.id)
      : undefined;
    if (hermano) {
      const T = Math.max(elegido.t.inicioCarga.getTime(), hermano.t.inicioCarga.getTime());
      elegido.t = tiemposDe(elegido.e, T, elegido.vol, elegido.run.tViaje, elegido.run.tRegreso, elegido.run.pedido.tipo_descarga);
      await comprometer(elegido);
      if (elegido.run.restante <= 1e-6) await cerrarRun(elegido.e, elegido.run);
      // Recalcular el hermano con la flota ya actualizada (evita doble reserva).
      const tp2 = siguienteTrip(hermano.e, hermano.run);
      if (tp2) {
        const th = Math.max(T, tp2.t.inicioCarga.getTime());
        tp2.t = tiemposDe(tp2.e, th, tp2.vol, tp2.run.tViaje, tp2.run.tRegreso, tp2.run.pedido.tipo_descarga);
        await comprometer(tp2);
        if (tp2.run.restante <= 1e-6) await cerrarRun(tp2.e, tp2.run);
      } else {
        for (let k = hermano.run.emitidos; k < hermano.run.rows.length; k++) await marcarSinCubrir(hermano.run.rows[k]);
        runPorPlanta.set(hermano.e.planta.id, null);
      }
      continue;
    }
    await comprometer(elegido);
    if (elegido.run.restante <= 1e-6) await cerrarRun(elegido.e, elegido.run);
  }

  return cambios;
}

function igualFecha(a: Date | null, b: Date | null): boolean {
  if (a == null || b == null) return a === b;
  return a.getTime() === b.getTime();
}

// ── Orden de atención (orden_dia) por plantel+fecha ──────────────────────────

/** Siguiente orden_dia disponible en un plantel para el día de `dia` (MAX+1). */
async function siguienteOrdenDia(plantelId: number, dia: Date): Promise<number> {
  const agg = await prisma.pedidos.aggregate({
    where: {
      plantel_id: plantelId,
      hora_solicitada: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
    },
    _max: { orden_dia: true },
  });
  return (agg._max.orden_dia ?? 0) + 1;
}

/**
 * Reordena un pedido dentro de su plantel+fecha: lo mueve a `nuevoOrden` y
 * REACOMODA el resto para que la secuencia quede 1..N sin huecos ni repetidos
 * (operación atómica). Luego RECALCULA la cascada de horarios de TODAS las
 * plantas de ese plantel+fecha usando el nuevo orden como cola. Registra el
 * cambio en bitácora. No toca pedidos de otro plantel ni de otra fecha.
 */
export async function reordenarPedidoDia(
  pedidoId: number,
  nuevoOrden: number,
  usuario: string,
): Promise<{ ok: boolean; mensaje?: string; viajesRecalculados: number[] }> {
  const pedido = await prisma.pedidos.findUniqueOrThrow({
    where: { id: pedidoId },
    select: { plantel_id: true, hora_solicitada: true, orden_dia: true },
  });
  const ini = inicioDelDia(pedido.hora_solicitada);
  const fin = finDelDia(pedido.hora_solicitada);

  // Todos los pedidos del plantel+fecha, en su orden actual.
  const lista = await prisma.pedidos.findMany({
    where: { plantel_id: pedido.plantel_id, hora_solicitada: { gte: ini, lt: fin } },
    select: { id: true, planta_id: true, orden_dia: true },
    orderBy: [{ orden_dia: "asc" }, { id: "asc" }],
  });

  const desde = lista.findIndex((p) => p.id === pedidoId);
  if (desde < 0) {
    return { ok: false, mensaje: "Pedido no encontrado en la cola.", viajesRecalculados: [] };
  }
  const destino = Math.min(Math.max(1, Math.round(nuevoOrden)), lista.length) - 1;

  const ordenAnterior = pedido.orden_dia;
  const [movido] = lista.splice(desde, 1);
  lista.splice(destino, 0, movido);

  // Reasignar 1..N en una sola transacción (todo o nada).
  await prisma.$transaction(
    lista.map((p, i) =>
      prisma.pedidos.update({ where: { id: p.id }, data: { orden_dia: i + 1 } }),
    ),
  );

  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "pedidos",
      registro_id: pedidoId,
      usuario,
      campo_modificado: "orden_dia",
      valor_anterior: ordenAnterior != null ? String(ordenAnterior) : null,
      valor_nuevo: String(destino + 1),
      motivo: "Reordenamiento manual de la cola del día",
    },
  });

  // Recalcular la cascada de CADA planta del plantel+fecha (el orden cambió).
  const plantas = [...new Set(lista.map((p) => p.planta_id))];
  const viajesRecalculados: number[] = [];
  for (const plantaId of plantas) {
    const ids = await recalcularCascadaPlanta(plantaId, pedido.hora_solicitada);
    viajesRecalculados.push(...ids);
  }
  return { ok: true, viajesRecalculados };
}

/** Hora de apertura del día (medianoche local + HORA_APERTURA_POR_DEFECTO). */
function aperturaDelDiaMs(dia: Date): number {
  return new Date(
    dia.getFullYear(),
    dia.getMonth(),
    dia.getDate(),
    HORA_APERTURA_POR_DEFECTO,
    0,
    0,
    0,
  ).getTime();
}
const VENTANA_DIA_HORAS = 14; // ventana amplia del día para acotar la cola de huecos

/**
 * Huecos libres de CARGA en la bahía de una planta ese día (a partir de los viajes
 * ya programados: [hora_inicio_carga, hora_fin_carga]). Devuelve intervalos
 * {inicioMs, finMs, durMin} de duración >= margen configurable. Solo lectura — lo
 * usa la vista simplificada (tarjeta de sugerencia) y el endpoint de huecos.
 */
export async function huecosDePlanta(plantaId: number, dia: Date): Promise<Hueco[]> {
  const ini = inicioDelDia(dia);
  const fin = finDelDia(dia);
  const viajes = await prisma.viajes.findMany({
    where: {
      planta_id: plantaId,
      estado: { not: "Cancelado" },
      hora_inicio_carga: { not: null },
      hora_fin_carga: { not: null },
      pedido: { hora_solicitada: { gte: ini, lt: fin }, estado_pedido: "Activo" },
    },
    select: { hora_inicio_carga: true, hora_fin_carga: true },
  });
  const ocupados = viajes.map((v) => ({
    inicioMs: v.hora_inicio_carga!.getTime(),
    finMs: v.hora_fin_carga!.getTime(),
  }));
  const aperturaMs = aperturaDelDiaMs(ini);
  const cierreMs = aperturaMs + VENTANA_DIA_HORAS * 3_600_000;
  const margenMin = await leerMargenHueco();
  return calcularHuecos(ocupados, aperturaMs, cierreMs, margenMin);
}

/**
 * Motor de 2 PASADAS: recalcula el `orden_dia` de TODOS los pedidos activos de un
 * plantel+fecha con la heurística de anclas + relleno best-fit (`planificarDosPasadas`)
 * y RECALCULA la cascada de horarios. Es el "Organizar mi día" de la vista simple.
 * Reversible/atómico como `reordenarPedidoDia` (solo toca `orden_dia` + recálculo).
 */
export async function organizarDia(
  plantelId: number,
  dia: Date,
  usuario: string,
): Promise<{ ok: boolean; mensaje?: string; viajesRecalculados: number[] }> {
  const ini = inicioDelDia(dia);
  const fin = finDelDia(dia);

  const pedidos = await prisma.pedidos.findMany({
    where: {
      plantel_id: plantelId,
      hora_solicitada: { gte: ini, lt: fin },
      estado_pedido: "Activo",
    },
    select: {
      id: true,
      hora_solicitada: true,
      hora_bloqueada: true,
      planta_id: true,
      tiempo_transporte_min: true,
      cliente: { select: { tiempo_viaje_referencia_min: true } },
      viajes: {
        where: { estado: { not: "Cancelado" } },
        select: { planta_id: true, volumen_asignado_m3: true },
      },
    },
    orderBy: [{ orden_dia: "asc" }, { id: "asc" }],
  });
  if (pedidos.length === 0) return { ok: true, viajesRecalculados: [] };

  // Capacidad/alistamiento por planta (para medir minutos de carga de cada viaje).
  const plantas = await prisma.plantas.findMany({
    where: { plantel_id: plantelId },
    select: { id: true, capacidad_m3h: true, tiempo_alistamiento_min: true },
  });
  const capDe = new Map(plantas.map((p) => [p.id, p]));

  const margenMin = await leerMargenHueco();
  const aperturaMs = aperturaDelDiaMs(ini);
  const cierreMs = aperturaMs + VENTANA_DIA_HORAS * 3_600_000;

  const entrada: PedidoOrg[] = pedidos.map((p) => {
    const plantaPrim = p.viajes[0]?.planta_id ?? p.planta_id;
    const cap = capDe.get(plantaPrim);
    const cargaViaje = (vol: number) =>
      cap ? cap.tiempo_alistamiento_min + minutosDeCarga(vol, cap.capacidad_m3h) : 30;
    const duracionMin = p.viajes.length
      ? p.viajes.reduce((s, v) => s + cargaViaje(v.volumen_asignado_m3), 0)
      : 30;
    const transporteMin =
      p.tiempo_transporte_min ?? p.cliente?.tiempo_viaje_referencia_min ?? DEFAULT_TIEMPO_VIAJE_MIN;
    const primerCarga = p.viajes.length ? cargaViaje(p.viajes[0].volumen_asignado_m3) : 30;
    return {
      id: p.id,
      plantaId: plantaPrim,
      esAncla: p.viajes.length > 1 || p.hora_bloqueada,
      horaFija: p.hora_bloqueada,
      llegadaMs: p.hora_solicitada.getTime(),
      inicioFijoMs: p.hora_bloqueada
        ? p.hora_solicitada.getTime() - (transporteMin + primerCarga) * 60_000
        : null,
      duracionMin,
    };
  });

  const orden = planificarDosPasadas(entrada, { aperturaMs, cierreMs, margenMin });

  await prisma.$transaction(
    orden.map((o) => prisma.pedidos.update({ where: { id: o.id }, data: { orden_dia: o.orden } })),
  );
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "pedidos",
      registro_id: plantelId,
      usuario,
      campo_modificado: "orden_dia",
      valor_anterior: null,
      valor_nuevo: `Organizar dia: ${orden.length} pedidos (2 pasadas)`,
      motivo: "Organizacion automatica del dia (anclas + relleno de huecos)",
    },
  });

  const plantasIds = [...new Set(pedidos.map((p) => p.planta_id))];
  const viajesRecalculados: number[] = [];
  for (const plantaId of plantasIds) {
    const ids = await recalcularCascadaPlanta(plantaId, dia);
    viajesRecalculados.push(...ids);
  }
  return { ok: true, viajesRecalculados };
}

/**
 * Sugiere la próxima hora de LLEGADA al proyecto disponible para una planta ese
 * día: toma el momento en que la planta queda libre tras dosificar su cola
 * existente (o la apertura por defecto si está vacía) y le suma el tiempo de
 * carga de este pedido + salida + transporte hasta el proyecto. Como
 * `hora_solicitada` representa la llegada, esta sugerencia es una llegada. Es
 * editable por el Programador.
 */
export async function sugerirHoraDisponible(
  plantaId: number,
  dia: Date,
  volumen = 0,
  clienteId?: number,
): Promise<Date> {
  const planta = await prisma.plantas.findUniqueOrThrow({ where: { id: plantaId } });
  const viajes = await prisma.viajes.findMany({
    where: {
      estado: { not: "Cancelado" },
      motivo_asignacion: { not: "Sin cubrir" },
      pedido: {
        planta_id: plantaId,
        hora_solicitada: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
      },
    },
    select: { hora_fin_carga: true },
  });
  const finales = viajes
    .map((v) => v.hora_fin_carga?.getTime())
    .filter((t): t is number => t != null);

  // Momento en que la planta queda libre para cargar (fin de carga de la cola).
  let libreLoadMs: number;
  if (finales.length === 0) {
    const d = new Date(dia);
    d.setHours(HORA_APERTURA_POR_DEFECTO, 0, 0, 0);
    libreLoadMs = d.getTime();
  } else {
    libreLoadMs = Math.max(...finales);
  }

  // Transporte del cliente (si se conoce); si no, el valor por defecto.
  let tViaje = DEFAULT_TIEMPO_VIAJE_MIN;
  if (clienteId != null) {
    const cli = await prisma.clientes.findUnique({
      where: { id: clienteId },
      select: { tiempo_viaje_referencia_min: true },
    });
    tViaje = cli?.tiempo_viaje_referencia_min ?? DEFAULT_TIEMPO_VIAJE_MIN;
  }
  const cargaMin =
    planta.tiempo_alistamiento_min + minutosDeCarga(volumen, planta.capacidad_m3h);

  // Sugerencia = LLEGADA = fin de carga del hueco + salida + transporte.
  return new Date(
    libreLoadMs + (cargaMin + MIN_SALIDA_TRAS_CARGA + tViaje) * 60000,
  );
}

// ── Frecuencia entre camiones: análisis con flota real (Solución 2) ──────────

export interface EntradaAnalisisFrecuencia {
  plantelId: number;
  plantaId: number;
  volumenTotal: number;
  frecuenciaMin: number;
  tipoDescarga: string;
  /** Transporte ida (min) del pedido; null → usa el del cliente / default. */
  transporteMin?: number | null;
  clienteId?: number | null;
  usarAmbasPlantas?: boolean;
  cargaReducida?: boolean;
  /** Día del pedido (para excluir mixers en mantenimiento); default hoy. */
  dia?: Date;
}

/**
 * Analiza si la frecuencia pedida es alcanzable con la flota REAL disponible ese
 * día, usando los mismos candidatos que la cascada (`candidatosDePlanta`) y los
 * mismos tiempos (planta, transporte del pedido/cliente). Es de solo lectura: NO
 * asigna nada; alimenta la advertencia no bloqueante del formulario.
 *
 * `volumenPorViaje` = carga de planeación del mixer MÁS GRANDE disponible (el que
 * el motor prefiere): el ciclo representativo se calcula con ese viaje típico.
 * `numeroBahias` = 2 solo si el plantel tiene 2 plantas Y el pedido usa ambas.
 */
export async function analizarFrecuenciaPedido(
  entrada: EntradaAnalisisFrecuencia,
): Promise<ResultadoFrecuencia> {
  const dia = entrada.dia ?? new Date();
  const plantel = await prisma.planteles.findUniqueOrThrow({
    where: { id: entrada.plantelId },
    select: { id: true, hub_id: true, plantas: { select: { id: true } } },
  });
  const planta = await prisma.plantas.findUniqueOrThrow({
    where: { id: entrada.plantaId },
    select: { capacidad_m3h: true, tiempo_alistamiento_min: true },
  });

  const [candidatos, reducidas] = await Promise.all([
    candidatosDePlanta(plantel.id, plantel.hub_id, dia),
    cargarCapacidadesReducidas(),
  ]);

  // Capacidad de planeación del mixer más grande disponible = viaje representativo.
  const cargaReducida = entrada.cargaReducida ?? false;
  const capsPlaneacion = candidatos.map((m) =>
    capacidadPlaneacion(m.capacidad_m3, cargaReducida, reducidas),
  );
  const volumenPorViaje = capsPlaneacion.length > 0 ? Math.max(...capsPlaneacion) : 10;

  // Transporte: override del pedido → del cliente → default (igual que la cascada).
  let transporte = entrada.transporteMin ?? null;
  if (transporte == null && entrada.clienteId != null) {
    const cli = await prisma.clientes.findUnique({
      where: { id: entrada.clienteId },
      select: { tiempo_viaje_referencia_min: true },
    });
    transporte = cli?.tiempo_viaje_referencia_min ?? null;
  }
  const tViaje = transporte ?? DEFAULT_TIEMPO_VIAJE_MIN;

  const dosPlantas = plantel.plantas.length >= 2 && (entrada.usarAmbasPlantas ?? false);

  return analizarFrecuencia({
    volumenPorViaje,
    capacidadPlantaM3h: planta.capacidad_m3h,
    alistamientoMin: planta.tiempo_alistamiento_min,
    tiempoIdaMin: tViaje,
    tiempoRegresoMin: tViaje,
    tipoDescarga: entrada.tipoDescarga,
    mixersDisponibles: candidatos.length,
    numeroBahias: dosPlantas ? 2 : 1,
    frecuenciaSolicitadaMin: entrada.frecuenciaMin,
  });
}

// ── Bombas: préstamo por hub (mismo Paso 1/2/3 que los mixers, mapa propio) ──
// El mapa de dependencia de bombas es el mismo `planteles.hub_id` (Choloma, Puerto
// Cortés, Villanueva, La Ceiba -> Santa Marta; Hazama -> Tegucigalpa). A diferencia
// de los mixers, una bomba NO cicla: acompaña al pedido durante toda su descarga.
// Prioridad: (1) bomba propia del plantel, (2) bomba del hub —reservando primero lo
// que el hub necesita para su propio programa del día—, (3) refuerzo de otro plantel.

export interface BombaCandidata {
  id: number;
  identificador: string;
  plantelBaseId: number;
  origen: "Propia" | "Préstamo" | "Refuerzo";
  pedidosDelDia: number; // cuántos pedidos ya la usan ese día (carga)
}

/** Bombas candidatas para un pedido del plantel `plantelId`, ordenadas por
 *  prioridad de hub (propia -> préstamo del hub -> refuerzo) y, dentro de cada
 *  grupo, por menor carga del día. Excluye bombas en mantenimiento ese día. */
export async function bombasParaPlantel(
  plantelId: number,
  hubId: number | null,
  dia: Date,
): Promise<BombaCandidata[]> {
  const ini = inicioDelDia(dia);
  const fin = finDelDia(dia);
  const enMant = await unidadesEnMantenimiento("Bomba", dia);

  const bombas = await prisma.bombas.findMany({
    where: { estado: ESTADO_DISPONIBLE },
    select: { id: true, identificador: true, plantel_base_id: true },
  });
  // Carga del día por bomba (# de pedidos activos que la usan).
  const grupos = await prisma.pedidos.groupBy({
    by: ["bomba_id"],
    where: {
      bomba_id: { not: null },
      estado_pedido: "Activo",
      hora_solicitada: { gte: ini, lt: fin },
    },
    _count: { _all: true },
  });
  const cargaDe = new Map<number, number>();
  for (const g of grupos) if (g.bomba_id != null) cargaDe.set(g.bomba_id, g._count._all);

  const hubReal = hubId ?? plantelId;
  const propias: BombaCandidata[] = [];
  const hubBombas: BombaCandidata[] = [];
  const otras: BombaCandidata[] = [];
  for (const b of bombas) {
    if (enMant.has(b.id)) continue;
    const base: BombaCandidata = {
      id: b.id,
      identificador: b.identificador,
      plantelBaseId: b.plantel_base_id,
      origen: "Propia",
      pedidosDelDia: cargaDe.get(b.id) ?? 0,
    };
    if (b.plantel_base_id === plantelId) propias.push(base);
    else if (b.plantel_base_id === hubReal && hubReal !== plantelId)
      hubBombas.push({ ...base, origen: "Préstamo" });
    else otras.push({ ...base, origen: "Refuerzo" });
  }
  const porCarga = (a: BombaCandidata, b: BombaCandidata) =>
    a.pedidosDelDia - b.pedidosDelDia || a.id - b.id;
  propias.sort(porCarga);
  hubBombas.sort(porCarga);
  otras.sort(porCarga);

  // Reserva del hub: aparta para su propio programa tantas bombas como pedidos por
  // bomba tenga ese día; solo el excedente se ofrece en préstamo.
  let prestamo = hubBombas;
  if (hubReal !== plantelId && hubBombas.length > 0) {
    const need = await prisma.pedidos.count({
      where: {
        plantel_id: hubReal,
        estado_pedido: "Activo",
        tipo_descarga: { not: "Canal directo" },
        hora_solicitada: { gte: ini, lt: fin },
      },
    });
    const disponibles = Math.max(0, hubBombas.length - need);
    prestamo = hubBombas.slice(0, disponibles);
  }
  return [...propias, ...prestamo, ...otras];
}

/** Elige automáticamente la mejor bomba PROPIA o de PRÉSTAMO (nunca refuerzo: eso
 *  requiere elección consciente). Devuelve null si no hay ninguna disponible. */
export async function elegirBombaAutomatica(
  plantelId: number,
  hubId: number | null,
  dia: Date,
): Promise<number | null> {
  const cands = await bombasParaPlantel(plantelId, hubId, dia);
  const auto = cands.find((b) => b.origen !== "Refuerzo");
  return auto?.id ?? null;
}

/** Resuelve la bomba de un pedido: respeta la elección manual; si el pedido es por
 *  bomba y no se eligió una, la auto-asigna por hub (propia -> hub). */
async function resolverBombaPedido(entrada: EntradaPedido): Promise<number | null> {
  if (entrada.bomba_id != null) return entrada.bomba_id; // elección manual
  if (entrada.tipo_descarga === "Canal directo") return null; // sin bomba
  const plantel = await prisma.planteles.findUnique({
    where: { id: entrada.plantel_id },
    select: { hub_id: true },
  });
  return elegirBombaAutomatica(entrada.plantel_id, plantel?.hub_id ?? null, entrada.hora_solicitada);
}

// ── Programación de un pedido (flujo principal) ──────────────────────────────

/**
 * Programa un pedido completo: crea el pedido, planifica los viajes (Paso 1/2),
 * calcula la cascada de horarios, resuelve traslapes de mixer, y si algo queda
 * sin cubrir arma las sugerencias de refuerzo (Paso 3, sin asignar).
 */
export async function programarPedido(
  entrada: EntradaPedido,
): Promise<ResultadoProgramacion> {
  // Orden de atención por defecto: el siguiente disponible en el plantel+fecha.
  const ordenDia = await siguienteOrdenDia(
    entrada.plantel_id,
    entrada.hora_solicitada,
  );
  // Bomba: elección manual o auto-asignación por hub (propia -> hub).
  const bombaId = await resolverBombaPedido(entrada);
  // El ORIGEN define si es parte del programa o una adición:
  //  · Programación (Nuevo pedido / conversión) → parte del programa: la línea base
  //    (volumen_programado) es el volumen del pedido; aparece en el DPCR-08.
  //  · Despacho en vivo (Adicionar pedido) → ADICIÓN: base 0 (todo lo suministrado
  //    cuenta como adición) y NO aparece en el DPCR-08.
  const esAdicion = entrada.es_adicion ?? false;
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: entrada.cliente_id,
      diseno_id: entrada.diseno_id,
      volumen_total_m3: entrada.volumen_total_m3,
      volumen_programado: esAdicion ? 0 : entrada.volumen_total_m3,
      es_adicion: esAdicion,
      hora_solicitada: entrada.hora_solicitada,
      plantel_id: entrada.plantel_id,
      planta_id: entrada.planta_id,
      bomba_id: bombaId,
      tipo_descarga: entrada.tipo_descarga,
      revenimiento: entrada.revenimiento ?? null,
      tipo_servicio: entrada.tipo_servicio ?? null,
      sacos_hielo_por_m3: entrada.sacos_hielo_por_m3 ?? 0,
      asesor_id: entrada.asesor_id ?? null,
      orden_dia: ordenDia,
      hora_bloqueada: entrada.hora_bloqueada ?? false,
      usar_ambas_plantas: entrada.usar_ambas_plantas ?? false,
      carga_simultanea: entrada.carga_simultanea ?? false,
      carga_reducida: entrada.carga_reducida ?? false,
      frecuencia_entre_camiones_min: entrada.frecuencia_entre_camiones_min ?? null,
      tiempo_transporte_min: entrada.tiempo_transporte_min ?? null,
      elemento: entrada.elemento ?? null,
      ubicacion_detalle: entrada.ubicacion_detalle ?? null,
      creado_por: entrada.creado_por,
    },
  });

  return asignarViajesDePedido(pedido.id, entrada);
}

/**
 * Modifica un pedido existente: borra sus viajes, actualiza sus datos y RE-CORRE
 * el motor de asignación. Si cambió de planta o de día, recalcula además la
 * cascada de la planta/día ANTERIOR (para cerrar el hueco que dejó ahí).
 */
export async function modificarPedido(
  pedidoId: number,
  entrada: EntradaPedido,
): Promise<ResultadoProgramacion> {
  const anterior = await prisma.pedidos.findUniqueOrThrow({
    where: { id: pedidoId },
    select: {
      planta_id: true,
      hora_solicitada: true,
      volumen_programado: true,
      es_adicion: true,
    },
  });

  await prisma.viajes.deleteMany({ where: { pedido_id: pedidoId } });
  // Bomba: elección manual o auto-asignación por hub (propia -> hub).
  const bombaId = await resolverBombaPedido(entrada);
  await prisma.pedidos.update({
    where: { id: pedidoId },
    data: {
      cliente_id: entrada.cliente_id,
      diseno_id: entrada.diseno_id,
      volumen_total_m3: entrada.volumen_total_m3,
      // El origen (adición) NO cambia al reprogramar. Una ADICIÓN mantiene base 0.
      // Un pedido de PROGRAMA redefine su base solo si aún no cerró el programa (4pm
      // del día anterior); después del cierre la base queda congelada (el programa no
      // se mueve) y contra ella se miden adiciones/cancelaciones.
      volumen_programado: anterior.es_adicion
        ? 0
        : new Date() < cierreProgramaDe(entrada.hora_solicitada)
          ? entrada.volumen_total_m3
          : anterior.volumen_programado,
      hora_solicitada: entrada.hora_solicitada,
      plantel_id: entrada.plantel_id,
      planta_id: entrada.planta_id,
      bomba_id: bombaId,
      tipo_descarga: entrada.tipo_descarga,
      revenimiento: entrada.revenimiento ?? null,
      tipo_servicio: entrada.tipo_servicio ?? null,
      sacos_hielo_por_m3: entrada.sacos_hielo_por_m3 ?? 0,
      asesor_id: entrada.asesor_id ?? null,
      hora_bloqueada: entrada.hora_bloqueada ?? false,
      usar_ambas_plantas: entrada.usar_ambas_plantas ?? false,
      carga_simultanea: entrada.carga_simultanea ?? false,
      carga_reducida: entrada.carga_reducida ?? false,
      frecuencia_entre_camiones_min: entrada.frecuencia_entre_camiones_min ?? null,
      tiempo_transporte_min: entrada.tiempo_transporte_min ?? null,
      elemento: entrada.elemento ?? null,
      ubicacion_detalle: entrada.ubicacion_detalle ?? null,
    },
  });

  // La planta/día anterior perdió este pedido → recalcular su cascada.
  if (
    anterior.planta_id !== entrada.planta_id ||
    !mismoDia(anterior.hora_solicitada, entrada.hora_solicitada)
  ) {
    await recalcularCascadaPlanta(anterior.planta_id, anterior.hora_solicitada);
  }

  return asignarViajesDePedido(pedidoId, entrada);
}

// ── MODO MANUAL: escritura directa de viajes SIN cascada ─────────────────────
// El Programador/Jefe de Planta arma el día a mano. Estas funciones escriben los
// tiempos de UN viaje exactamente como el usuario los fijó (inicio de carga tecleado
// + hitos derivados con la misma matemática del motor) y NUNCA llaman a la cascada:
// no reordenan, no mueven, no reasignan a nadie más. La única "corrección" del
// sistema son las validaciones (lib/motor/validacion-manual.ts), que solo avisan.

/** Entrada para agregar/mover un viaje en modo manual. */
export interface EntradaViajeManual {
  cliente_id: number;
  diseno_id: number;
  plantel_id: number;
  planta_id: number;
  mixer_id: number;
  volumen: number;
  inicio_carga: Date; // hora de carga EXACTA que fijó el usuario (piso duro)
  tipo_descarga: string;
  creado_por: string;
}

/** Transporte (ida = regreso) de un pedido: override del pedido → del cliente →
 *  default. Devuelve `[min, rutaPorDefecto]`. */
function transporteDePedido(
  override: number | null,
  cliente: number | null,
): [number, boolean] {
  const rutaPorDefecto = override == null && cliente == null;
  return [override ?? cliente ?? DEFAULT_TIEMPO_VIAJE_MIN, rutaPorDefecto];
}

/** Recalcula `volumen_total_m3` (= Σ viajes) de un pedido; antes del cierre del
 *  DPCR-08 también mueve la línea base `volumen_programado` (salvo adiciones). Si el
 *  pedido quedó sin viajes, lo ELIMINA (deja de existir en el programa). No cascada. */
async function reconciliarPedidoManual(pedidoId: number): Promise<void> {
  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: { id: true, es_adicion: true, hora_solicitada: true, viajes: { select: { volumen_asignado_m3: true } } },
  });
  if (!pedido) return;
  if (pedido.viajes.length === 0) {
    await prisma.pedidos.delete({ where: { id: pedidoId } });
    return;
  }
  const total = pedido.viajes.reduce((s, v) => s + v.volumen_asignado_m3, 0);
  const antesDelCierre = new Date() < cierreProgramaDe(pedido.hora_solicitada);
  await prisma.pedidos.update({
    where: { id: pedidoId },
    data: {
      volumen_total_m3: total,
      ...(!pedido.es_adicion && antesDelCierre ? { volumen_programado: total } : {}),
    },
  });
}

/** Pedido de programa destino para un viaje manual: reutiliza el pedido Activo del
 *  cliente ese día en el plantel con el MISMO diseño (para no fragmentar); si no hay,
 *  crea uno nuevo. El día se toma de la hora de carga tecleada. */
async function pedidoManualDestino(e: EntradaViajeManual, llegada: Date): Promise<number> {
  const ini = inicioDelDia(e.inicio_carga);
  const fin = finDelDia(e.inicio_carga);
  const existente = await prisma.pedidos.findFirst({
    where: {
      cliente_id: e.cliente_id,
      plantel_id: e.plantel_id,
      diseno_id: e.diseno_id,
      estado_pedido: "Activo",
      hora_solicitada: { gte: ini, lt: fin },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (existente) return existente.id;
  const ordenDia = await siguienteOrdenDia(e.plantel_id, e.inicio_carga);
  const creado = await prisma.pedidos.create({
    data: {
      cliente_id: e.cliente_id,
      diseno_id: e.diseno_id,
      volumen_total_m3: e.volumen,
      volumen_programado: e.volumen,
      es_adicion: false, // programación manual = parte del programa/DPCR-08
      hora_solicitada: llegada, // la llegada del primer viaje representa la del pedido
      plantel_id: e.plantel_id,
      planta_id: e.planta_id,
      tipo_descarga: e.tipo_descarga,
      orden_dia: ordenDia,
      creado_por: e.creado_por,
    },
    select: { id: true },
  });
  return creado.id;
}

/** Agrega UN viaje a mano: escribe inicio de carga + hitos derivados y el mixer
 *  elegido, tal cual. NO recalcula ni mueve ningún otro viaje. Devuelve el viaje. */
export async function agregarViajeManual(e: EntradaViajeManual): Promise<{ viajeId: number; pedidoId: number }> {
  const [planta, mixer, cliente] = await Promise.all([
    prisma.plantas.findUniqueOrThrow({
      where: { id: e.planta_id },
      select: { capacidad_m3h: true, tiempo_alistamiento_min: true },
    }),
    prisma.mixers.findUniqueOrThrow({
      where: { id: e.mixer_id },
      select: { id: true, capacidad_m3: true, plantel_base_id: true, operador_asignado_id: true },
    }),
    prisma.clientes.findUniqueOrThrow({
      where: { id: e.cliente_id },
      select: { tiempo_viaje_referencia_min: true },
    }),
  ]);
  const [tMin, rutaPorDefecto] = transporteDePedido(null, cliente.tiempo_viaje_referencia_min);
  const t = tiemposDeViaje(e.inicio_carga.getTime(), {
    alistamientoMin: planta.tiempo_alistamiento_min,
    capacidadPlantaM3h: planta.capacidad_m3h,
    volumen: e.volumen,
    tViajeMin: tMin,
    tRegresoMin: tMin,
    tipoDescarga: e.tipo_descarga,
  });
  const pedidoId = await pedidoManualDestino(e, new Date(t.llegadaMs));
  const viaje = await prisma.viajes.create({
    data: {
      pedido_id: pedidoId,
      planta_id: e.planta_id,
      mixer_id: mixer.id,
      operador_id: mixer.operador_asignado_id,
      capacidad_asignada_m3: mixer.capacidad_m3,
      volumen_asignado_m3: e.volumen,
      hora_solicitada: new Date(t.llegadaMs),
      motivo_asignacion: mixer.plantel_base_id === e.plantel_id ? "Flota propia" : "Préstamo de zona",
      estado: "Programado",
      estado_confirmacion: "Pendiente",
      es_adicion: false,
      ajustado_manualmente: true, // colocado a mano: la cascada (si se corre) lo respeta
      ruta_por_defecto: rutaPorDefecto,
      hora_inicio_carga: new Date(t.inicioCargaMs),
      hora_fin_carga: new Date(t.finCargaMs),
      hora_salida_planta: new Date(t.salidaMs),
      hora_llegada_proyecto: new Date(t.llegadaMs),
      hora_inicio_descarga: new Date(t.inicioDescargaMs),
      hora_fin_descarga: new Date(t.finDescargaMs),
      hora_regreso_planta: new Date(t.regresoMs),
    },
    select: { id: true },
  });
  await reconciliarPedidoManual(pedidoId);
  return { viajeId: viaje.id, pedidoId };
}

/** Cambios permitidos al editar un viaje a mano. */
export interface PatchViajeManual {
  mixer_id?: number;
  volumen?: number;
  inicio_carga?: Date;
  cliente_id?: number; // reasigna el viaje al pedido de otro cliente (crea si hace falta)
  diseno_id?: number; // requerido si cambia el cliente (para ubicar/crear su pedido)
  creado_por: string;
}

/** Edita UN viaje a mano: recalcula SOLO sus propios hitos con los tiempos ya
 *  configurados. NO toca ningún otro viaje. Si cambia el cliente, reasigna el viaje
 *  al pedido de ese cliente (creándolo si hace falta) y reconcilia ambos pedidos. */
export async function editarViajeManual(viajeId: number, patch: PatchViajeManual): Promise<{ ok: boolean; mensaje?: string }> {
  const viaje = await prisma.viajes.findUnique({
    where: { id: viajeId },
    include: {
      pedido: { select: { id: true, plantel_id: true, planta_id: true, tipo_descarga: true, tiempo_transporte_min: true, cliente: { select: { tiempo_viaje_referencia_min: true } } } },
      planta: { select: { id: true, capacidad_m3h: true, tiempo_alistamiento_min: true } },
    },
  });
  if (!viaje || !viaje.planta) return { ok: false, mensaje: "Viaje no encontrado." };
  if (viaje.estado === ESTADO_VIAJE_COMPLETADO || viaje.ts_inicio_carga_real != null) {
    return { ok: false, mensaje: "Ese viaje ya inició o se completó: no se puede editar a mano." };
  }

  const nuevoMixerId = patch.mixer_id ?? viaje.mixer_id;
  const volumen = patch.volumen ?? viaje.volumen_asignado_m3;
  const inicioMs = (patch.inicio_carga ?? viaje.hora_inicio_carga ?? new Date()).getTime();

  const mixer =
    nuevoMixerId != null
      ? await prisma.mixers.findUnique({
          where: { id: nuevoMixerId },
          select: { id: true, capacidad_m3: true, plantel_base_id: true, operador_asignado_id: true },
        })
      : null;

  // ¿Cambia de cliente? Entonces se reasigna a otro pedido (mismo plantel/planta/día).
  const pedidoAnteriorId = viaje.pedido.id;
  let pedidoDestinoId = pedidoAnteriorId;
  const plantelId = viaje.pedido.plantel_id;
  let transporteOverride = viaje.pedido.tiempo_transporte_min;
  let transporteCliente = viaje.pedido.cliente.tiempo_viaje_referencia_min;

  if (patch.cliente_id != null) {
    const disenoId = patch.diseno_id;
    if (disenoId == null) return { ok: false, mensaje: "Falta el diseño para reasignar el cliente." };
    const cli = await prisma.clientes.findUniqueOrThrow({
      where: { id: patch.cliente_id },
      select: { tiempo_viaje_referencia_min: true },
    });
    transporteOverride = null;
    transporteCliente = cli.tiempo_viaje_referencia_min;
    const [tMinPrev] = transporteDePedido(transporteOverride, transporteCliente);
    const tPrev = tiemposDeViaje(inicioMs, {
      alistamientoMin: viaje.planta.tiempo_alistamiento_min,
      capacidadPlantaM3h: viaje.planta.capacidad_m3h,
      volumen,
      tViajeMin: tMinPrev,
      tRegresoMin: tMinPrev,
      tipoDescarga: viaje.pedido.tipo_descarga,
    });
    pedidoDestinoId = await pedidoManualDestino(
      {
        cliente_id: patch.cliente_id,
        diseno_id: disenoId,
        plantel_id: plantelId,
        planta_id: viaje.planta.id,
        mixer_id: nuevoMixerId ?? 0,
        volumen,
        inicio_carga: new Date(inicioMs),
        tipo_descarga: viaje.pedido.tipo_descarga,
        creado_por: patch.creado_por,
      },
      new Date(tPrev.llegadaMs),
    );
  }

  const [tMin, rutaPorDefecto] = transporteDePedido(transporteOverride, transporteCliente);
  const t = tiemposDeViaje(inicioMs, {
    alistamientoMin: viaje.planta.tiempo_alistamiento_min,
    capacidadPlantaM3h: viaje.planta.capacidad_m3h,
    volumen,
    tViajeMin: tMin,
    tRegresoMin: tMin,
    tipoDescarga: viaje.pedido.tipo_descarga,
  });

  await prisma.viajes.update({
    where: { id: viajeId },
    data: {
      pedido_id: pedidoDestinoId,
      mixer_id: mixer?.id ?? null,
      operador_id: mixer?.operador_asignado_id ?? null,
      capacidad_asignada_m3: mixer?.capacidad_m3 ?? viaje.capacidad_asignada_m3,
      volumen_asignado_m3: volumen,
      motivo_asignacion: mixer ? (mixer.plantel_base_id === plantelId ? "Flota propia" : "Préstamo de zona") : viaje.motivo_asignacion,
      ajustado_manualmente: true,
      ruta_por_defecto: rutaPorDefecto,
      hora_solicitada: new Date(t.llegadaMs),
      hora_inicio_carga: new Date(t.inicioCargaMs),
      hora_fin_carga: new Date(t.finCargaMs),
      hora_salida_planta: new Date(t.salidaMs),
      hora_llegada_proyecto: new Date(t.llegadaMs),
      hora_inicio_descarga: new Date(t.inicioDescargaMs),
      hora_fin_descarga: new Date(t.finDescargaMs),
      hora_regreso_planta: new Date(t.regresoMs),
    },
  });

  await reconciliarPedidoManual(pedidoDestinoId);
  if (pedidoDestinoId !== pedidoAnteriorId) await reconciliarPedidoManual(pedidoAnteriorId);
  return { ok: true };
}

/** Elimina UN viaje a mano (y su pedido si queda vacío). NO recalcula a nadie. */
export async function eliminarViajeManual(viajeId: number): Promise<{ ok: boolean; mensaje?: string }> {
  const viaje = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: { id: true, pedido_id: true, estado: true, ts_inicio_carga_real: true },
  });
  if (!viaje) return { ok: false, mensaje: "Viaje no encontrado." };
  if (viaje.estado === ESTADO_VIAJE_COMPLETADO || viaje.ts_inicio_carga_real != null) {
    return { ok: false, mensaje: "Ese viaje ya inició o se completó: no se puede eliminar a mano." };
  }
  await prisma.viajes.delete({ where: { id: viajeId } });
  await reconciliarPedidoManual(viaje.pedido_id);
  return { ok: true };
}

/** Elimina VARIOS viajes a mano (p. ej. deshacer una generación en serie completa).
 *  Ignora los que ya iniciaron/completaron. Reconcilia cada pedido afectado una vez. */
export async function eliminarViajesManual(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const viajes = await prisma.viajes.findMany({
    where: { id: { in: ids } },
    select: { id: true, pedido_id: true, estado: true, ts_inicio_carga_real: true },
  });
  const borrables = viajes.filter(
    (v) => v.estado !== ESTADO_VIAJE_COMPLETADO && v.ts_inicio_carga_real == null,
  );
  if (borrables.length === 0) return;
  await prisma.viajes.deleteMany({ where: { id: { in: borrables.map((v) => v.id) } } });
  for (const pid of [...new Set(borrables.map((v) => v.pedido_id))]) {
    await reconciliarPedidoManual(pid);
  }
}

/** Entrada para generar una serie de viajes iguales a mano. */
export interface EntradaSerieManual {
  cliente_id: number;
  diseno_id: number;
  plantel_id: number;
  plantaIds: number[]; // se alternan (round-robin)
  mixerIds: number[]; // se rotan (round-robin)
  volumen: number;
  cantidad: number;
  frecuenciaMin: number; // min entre inicios de carga
  inicio_carga: Date; // carga del PRIMER viaje
  tipo_descarga: string;
  creado_por: string;
}

/** Genera N viajes de una vez (mismo cliente/diseño/volumen), alternando plantas y
 *  rotando mixers a una cadencia fija. Escribe cada viaje TAL CUAL el plan (sin
 *  cascada) y devuelve los ids creados (para poder deshacer la serie como un bloque). */
export async function generarViajesEnSerie(e: EntradaSerieManual): Promise<{ viajeIds: number[] }> {
  const plan = planificarSerie({
    cantidad: e.cantidad,
    frecuenciaMin: e.frecuenciaMin,
    inicioMs: e.inicio_carga.getTime(),
    plantaIds: e.plantaIds,
    mixerIds: e.mixerIds,
  });
  const viajeIds: number[] = [];
  for (const v of plan) {
    const r = await agregarViajeManual({
      cliente_id: e.cliente_id,
      diseno_id: e.diseno_id,
      plantel_id: e.plantel_id,
      planta_id: v.plantaId,
      mixer_id: v.mixerId,
      volumen: e.volumen,
      inicio_carga: new Date(v.inicioCargaMs),
      tipo_descarga: e.tipo_descarga,
      creado_por: e.creado_por,
    });
    viajeIds.push(r.viajeId);
  }
  return { viajeIds };
}

/**
 * Le busca a un viaje OTRO mixer que esté libre durante su ciclo, CONSERVANDO su
 * horario programado. Se usa cuando a un viaje le quitaron su mixer para dárselo a
 * otro: el viaje no se reprograma (su hueco en la planta sigue siendo suyo), solo
 * cambia de unidad. Si no hay ninguna libre queda sin mixer y el despachador la
 * asigna a mano — es preferible a mover la programación de todo el día.
 */
async function reemplazarMixerConservandoHora(
  viajeId: number,
  plantelId: number,
  hubId: number | null,
  dia: Date,
): Promise<void> {
  const v = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: {
      id: true,
      volumen_asignado_m3: true,
      hora_inicio_carga: true,
      hora_regreso_planta: true,
    },
  });
  if (!v?.hora_inicio_carga || !v.hora_regreso_planta) return;
  const desde = v.hora_inicio_carga.getTime();
  const hasta = v.hora_regreso_planta.getTime();

  const candidatos = await candidatosDePlanta(plantelId, hubId, dia);
  const ocupados = await prisma.viajes.findMany({
    where: {
      id: { not: viajeId },
      mixer_id: { not: null },
      estado: { not: "Cancelado" },
      hora_inicio_carga: { lt: new Date(hasta) },
      hora_regreso_planta: { gt: new Date(desde) },
    },
    select: { mixer_id: true },
  });
  const tomados = new Set(ocupados.map((o) => o.mixer_id));

  const libre = candidatos.find(
    (m) => !tomados.has(m.id) && m.capacidad_m3 >= v.volumen_asignado_m3,
  );
  if (!libre) return; // sin unidad libre: queda para asignar a mano

  await prisma.viajes.update({
    where: { id: viajeId },
    data: {
      mixer_id: libre.id,
      operador_id: libre.operador_asignado_id,
      capacidad_asignada_m3: libre.capacidad_m3,
      motivo_asignacion: libre.plantel_base_id === plantelId ? "Flota propia" : "Préstamo de zona",
    },
  });
}

/**
 * Coloca los viajes de una ADICIÓN al FINAL de la cola de carga de su planta, uno
 * tras otro, y les asigna un mixer que esté libre en esa ventana.
 *
 * Se hace así —y no con `recalcularCascadaPlanta`— porque esto se ejecuta desde
 * DESPACHO EN VIVO: la cascada es el programador automático y reescribiría las
 * `hora_*` de los viajes ya programados, moviéndolos de lugar y alterando el
 * Programa DPCR-08 ya publicado. Una adición se agrega al final; nadie más se mueve.
 *
 * Si no hay ningún mixer libre en la ventana, el viaje queda sin mixer y el
 * despachador lo asigna a mano (la pantalla ya lo permite).
 */
async function colocarAdicionesAlFinal(
  viajeIds: number[],
  dia: Date,
  candidatos: { id: number; capacidad_m3: number; plantel_base_id: number; operador_asignado_id: number | null }[],
  tipoDescarga: string,
  transporteMin: number,
  plantelId: number,
): Promise<void> {
  if (viajeIds.length === 0) return;
  const ini = inicioDelDia(dia);
  const fin = finDelDia(dia);

  const nuevos = await prisma.viajes.findMany({
    where: { id: { in: viajeIds } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      planta_id: true,
      volumen_asignado_m3: true,
      planta: { select: { capacidad_m3h: true, tiempo_alistamiento_min: true } },
    },
  });

  // Ocupación existente del día: hasta cuándo carga cada planta y qué ventana tiene
  // tomada cada mixer. Se lee UNA vez y se va actualizando en memoria.
  const existentes = await prisma.viajes.findMany({
    where: {
      pedido: { hora_solicitada: { gte: ini, lt: fin } },
      id: { notIn: viajeIds },
      estado: { not: "Cancelado" },
    },
    select: {
      planta_id: true,
      mixer_id: true,
      hora_inicio_carga: true,
      hora_fin_carga: true,
      hora_regreso_planta: true,
      ts_fin_carga_real: true,
    },
  });

  /** Hasta cuándo está ocupada la boca de carga de cada planta. */
  const libreDesde = new Map<number, number>();
  /** Ventanas [inicio de carga, regreso) ya tomadas por cada mixer. */
  const ocupacionMixer = new Map<number, [number, number][]>();
  for (const v of existentes) {
    const finCarga = (v.ts_fin_carga_real ?? v.hora_fin_carga)?.getTime();
    if (v.planta_id != null && finCarga != null) {
      libreDesde.set(v.planta_id, Math.max(libreDesde.get(v.planta_id) ?? 0, finCarga));
    }
    if (v.mixer_id != null && v.hora_inicio_carga && v.hora_regreso_planta) {
      const arr = ocupacionMixer.get(v.mixer_id) ?? [];
      arr.push([v.hora_inicio_carga.getTime(), v.hora_regreso_planta.getTime()]);
      ocupacionMixer.set(v.mixer_id, arr);
    }
  }

  for (const v of nuevos) {
    if (v.planta_id == null || !v.planta) continue;
    const arranque = Math.max(
      libreDesde.get(v.planta_id) ?? ini.getTime(),
      ini.getTime(),
    );
    const t = tiemposDeViaje(arranque, {
      alistamientoMin: v.planta.tiempo_alistamiento_min,
      capacidadPlantaM3h: v.planta.capacidad_m3h,
      volumen: v.volumen_asignado_m3,
      tViajeMin: transporteMin,
      tRegresoMin: transporteMin,
      tipoDescarga,
    });

    // Primer mixer con capacidad suficiente y libre en toda la ventana del ciclo.
    const elegido = candidatos.find((m) => {
      if (m.capacidad_m3 < v.volumen_asignado_m3) return false;
      const ventanas = ocupacionMixer.get(m.id) ?? [];
      return !ventanas.some(([a, b]) => t.inicioCargaMs < b && a < t.regresoMs);
    });

    await prisma.viajes.update({
      where: { id: v.id },
      data: {
        mixer_id: elegido?.id ?? null,
        operador_id: elegido?.operador_asignado_id ?? null,
        motivo_asignacion: elegido
          ? elegido.plantel_base_id === plantelId
            ? "Flota propia"
            : "Préstamo de zona"
          : "Sin cubrir",
        hora_solicitada: new Date(t.llegadaMs),
        hora_inicio_carga: new Date(t.inicioCargaMs),
        hora_fin_carga: new Date(t.finCargaMs),
        hora_salida_planta: new Date(t.salidaMs),
        hora_llegada_proyecto: new Date(t.llegadaMs),
        hora_inicio_descarga: new Date(t.inicioDescargaMs),
        hora_fin_descarga: new Date(t.finDescargaMs),
        hora_regreso_planta: new Date(t.regresoMs),
      },
    });

    // La boca de carga y el mixer quedan ocupados para el siguiente de la tanda.
    libreDesde.set(v.planta_id, t.finCargaMs);
    if (elegido) {
      const arr = ocupacionMixer.get(elegido.id) ?? [];
      arr.push([t.inicioCargaMs, t.regresoMs]);
      ocupacionMixer.set(elegido.id, arr);
    }
  }
}

/**
 * Agrega volumen ADICIONAL a un pedido existente creando viajes nuevos con las
 * MISMAS características (cliente, diseño, revenimiento, tipo de descarga, etc. —
 * todo vive en el pedido, no en el viaje). El volumen se suma a `volumen_total_m3`
 * pero NO a `volumen_programado`: así el exceso sobre la línea base se contabiliza
 * como ADICIÓN del día en las métricas comerciales, cargado al asesor dueño del
 * cliente.
 *
 * Los viajes nuevos se colocan al FINAL de la cola de su planta
 * (`colocarAdicionesAlFinal`); NO se recalcula la cascada, porque esto corre desde
 * Despacho en vivo y el despacho no reescribe la programación publicada.
 */
export async function agregarVolumenAlPedido(
  pedidoId: number,
  volumenAdicional: number,
): Promise<ResultadoProgramacion> {
  if (!(volumenAdicional > 0)) {
    throw new Error("El volumen adicional debe ser mayor que 0.");
  }
  const pedido = await prisma.pedidos.findUniqueOrThrow({
    where: { id: pedidoId },
    select: {
      plantel_id: true,
      planta_id: true,
      hora_solicitada: true,
      volumen_total_m3: true,
      usar_ambas_plantas: true,
      carga_simultanea: true,
      carga_reducida: true,
      estado_pedido: true,
      tipo_descarga: true,
      tiempo_transporte_min: true,
      cliente: { select: { tiempo_viaje_referencia_min: true } },
    },
  });
  if (pedido.estado_pedido === "Cancelado") {
    throw new Error("No se puede agregar volumen a un pedido cancelado.");
  }
  const plantel = await prisma.planteles.findUniqueOrThrow({
    where: { id: pedido.plantel_id },
  });

  // Capacidades disponibles (flota propia + hub, sin mantenimiento la fecha).
  const candidatos = await candidatosDePlanta(
    pedido.plantel_id,
    plantel.hub_id,
    pedido.hora_solicitada,
  );
  // Capacidad de planeación por mixer (carga segura, o efectiva reducida si el pedido
  // tiene `carga_reducida`).
  const reducidas = await cargarCapacidadesReducidas();
  const capacidades = [
    ...new Set(
      candidatos.map((m) => capacidadPlaneacion(m.capacidad_m3, pedido.carga_reducida, reducidas)),
    ),
  ];
  const plan = planificarCombinacion(volumenAdicional, capacidades);

  // Planta de los viajes nuevos: respeta el modo "ambas plantas" del pedido.
  const plantasViaje = await repartirPlantas(
    pedido.plantel_id,
    pedido.planta_id,
    plan.viajes.length,
    pedido.hora_solicitada,
    pedido.usar_ambas_plantas,
    pedido.carga_simultanea,
  );

  let idxPlanta = 0;
  const idsNuevos: number[] = [];
  for (const vp of plan.viajes) {
    const creado = await prisma.viajes.create({
      data: {
        pedido_id: pedidoId,
        mixer_id: null,
        planta_id: plantasViaje[idxPlanta++] ?? pedido.planta_id,
        capacidad_asignada_m3: vp.capacidad,
        volumen_asignado_m3: vp.volumen,
        hora_solicitada: pedido.hora_solicitada,
        motivo_asignacion: "Flota propia",
        estado_confirmacion: "Pendiente",
        es_adicion: true, // agregado en Despacho -> adición, fuera del DPCR-08
      },
      select: { id: true },
    });
    idsNuevos.push(creado.id);
  }
  if (plan.volumenSinCubrir > 0) {
    await prisma.viajes.create({
      data: {
        pedido_id: pedidoId,
        mixer_id: null,
        planta_id: pedido.planta_id,
        capacidad_asignada_m3: 0,
        volumen_asignado_m3: plan.volumenSinCubrir,
        hora_solicitada: pedido.hora_solicitada,
        motivo_asignacion: "Sin cubrir",
        estado_confirmacion: "Pendiente",
        es_adicion: true,
      },
    });
  }

  // Sube el total del pedido SIN tocar `volumen_programado` (línea base): el
  // exceso queda como adición del día atribuida al asesor del cliente.
  await prisma.pedidos.update({
    where: { id: pedidoId },
    data: { volumen_total_m3: pedido.volumen_total_m3 + volumenAdicional },
  });

  // Los viajes nuevos se colocan al final de la cola de su planta. NO se recalcula
  // la cascada: esto corre desde Despacho en vivo y no debe mover la programacion.
  const [tMinAdicion] = transporteDePedido(
    pedido.tiempo_transporte_min,
    pedido.cliente.tiempo_viaje_referencia_min,
  );
  await colocarAdicionesAlFinal(
    idsNuevos,
    pedido.hora_solicitada,
    candidatos,
    pedido.tipo_descarga,
    tMinAdicion,
    pedido.plantel_id,
  );
  const viajesRecalculados: number[] = idsNuevos;
  const volumenSinCubrir = await volumenSinCubrirDePedido(pedidoId);
  const sugerenciasRefuerzo =
    volumenSinCubrir > 0
      ? await sugerirRefuerzo(
          volumenSinCubrir,
          pedido.plantel_id,
          plantel.hub_id ?? pedido.plantel_id,
          pedido.hora_solicitada,
        )
      : [];
  const alertasMargen = await detectarAlertasMargen(pedido.hora_solicitada);
  const viajes = await resumenViajes(pedidoId);
  return {
    pedidoId,
    viajes,
    volumenSinCubrir,
    sugerenciasRefuerzo,
    alertasMargen,
    viajesRecalculados,
  };
}

/**
 * Recalcula el "tiempo de transporte" de referencia del cliente al PROMEDIO REAL de
 * sus suministros: para cada viaje entregado toma salida de planta → llegada a obra
 * (`ts_salida_real` → `ts_llegada_real`) y promedia. Guarda el resultado (espeja
 * ida = regreso, como el form de cliente) para que las próximas programaciones usen
 * un dato real en vez del estimado inicial. Descarta lecturas absurdas. Devuelve
 * `{anterior, nuevo}` si el valor cambió, o `null` si no hay datos o no cambió (la
 * bitácora la escribe la acción que lo invoca, según la convención del proyecto).
 */
export async function recalcularTransportePromedioCliente(
  clienteId: number,
): Promise<{ anterior: number | null; nuevo: number } | null> {
  const viajes = await prisma.viajes.findMany({
    where: {
      ts_salida_real: { not: null },
      ts_llegada_real: { not: null },
      estado: { not: "Cancelado" },
      pedido: { cliente_id: clienteId },
    },
    select: { ts_salida_real: true, ts_llegada_real: true },
  });
  const mins = viajes
    .map((v) => (v.ts_llegada_real!.getTime() - v.ts_salida_real!.getTime()) / 60000)
    // Descarta lecturas absurdas (negativas o > 10 h por errores de captura).
    .filter((m) => m > 0 && m < 600);
  if (mins.length === 0) return null;
  const promedio = Math.round(mins.reduce((s, m) => s + m, 0) / mins.length);
  const cliente = await prisma.clientes.findUnique({
    where: { id: clienteId },
    select: { tiempo_viaje_referencia_min: true },
  });
  if (!cliente || cliente.tiempo_viaje_referencia_min === promedio) return null;
  const anterior = cliente.tiempo_viaje_referencia_min;
  await prisma.clientes.update({
    where: { id: clienteId },
    data: {
      tiempo_viaje_referencia_min: promedio,
      tiempo_regreso_referencia_min: promedio, // ida = regreso (espejo)
    },
  });
  return { anterior, nuevo: promedio };
}

/**
 * Núcleo reutilizable (crear/modificar): dado un pedido YA persistido y sin
 * viajes, elige la mejor combinación de capacidades (planificador puro), crea un
 * viaje por cada carga y deja que el agendador (recalcularCascadaPlanta) asigne
 * los mixers concretos con reutilización por horario y reparto de desgaste.
 */
/**
 * Reparte `cantidad` viajes nuevos entre las plantas del plantel, eligiendo cada vez
 * la de hueco libre más temprano (aprox. por el fin de carga comprometido ese día);
 * desempata a favor de la planta preferida del pedido. Solo reparte cuando el pedido
 * pidió `usarAmbas` (carga simultánea en las 2 plantas). Si no, o si el plantel tiene
 * una sola planta, TODOS los viajes van a `plantaPreferida` (la planta elegida en el
 * pedido). Devuelve un planta_id por viaje, en orden.
 */
async function repartirPlantas(
  plantelId: number,
  plantaPreferida: number,
  cantidad: number,
  dia: Date,
  usarAmbas: boolean,
  simultanea = false,
): Promise<number[]> {
  // Decisión del usuario: una sola planta salvo que se marque "ambas plantas".
  if (!usarAmbas) {
    return Array(cantidad).fill(plantaPreferida);
  }
  const plantas = await prisma.plantas.findMany({
    where: { plantel_id: plantelId },
    select: { id: true, capacidad_m3h: true, tiempo_alistamiento_min: true },
    orderBy: { id: "asc" },
  });
  if (plantas.length <= 1) {
    return Array(cantidad).fill(plantas[0]?.id ?? plantaPreferida);
  }

  // CARGA SIMULTÁNEA: reparto BALANCEADO (round-robin), sin mirar la ocupación de
  // OTROS pedidos del día. La carga simultánea exige que ambas plantas carguen a la
  // par, así que cada una recibe ~mitad de los viajes. Empezar por la planta preferida
  // (la elegida en el pedido) para que el primer viaje salga de ella. Antes se usaba la
  // heurística de "planta más libre", que con otro pedido tardío en una planta tiraba
  // TODOS los viajes a la otra (ninguno con quien sincronizar) y la simultaneidad
  // quedaba imposible.
  if (simultanea) {
    const orden = [plantaPreferida, ...plantas.map((p) => p.id).filter((id) => id !== plantaPreferida)];
    return Array.from({ length: cantidad }, (_, i) => orden[i % orden.length]);
  }

  // "Libre en" por planta = fin de carga comprometido más tardío ese día (ms).
  const libreEn = new Map<number, number>(plantas.map((p) => [p.id, 0]));
  const comprometidos = await prisma.viajes.groupBy({
    by: ["planta_id"],
    where: {
      estado: { not: "Cancelado" },
      planta_id: { in: plantas.map((p) => p.id) },
      hora_inicio_carga: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
    },
    _max: { hora_fin_carga: true },
  });
  for (const g of comprometidos) {
    if (g.planta_id != null && g._max.hora_fin_carga) {
      libreEn.set(g.planta_id, g._max.hora_fin_carga.getTime());
    }
  }
  // Tiempo de carga estimado por planta (para avanzar el reloj entre viajes).
  const cargaMs = new Map<number, number>(
    plantas.map((p) => [p.id, (p.tiempo_alistamiento_min + (9 / p.capacidad_m3h) * 60) * 60000]),
  );
  const resultado: number[] = [];
  for (let i = 0; i < cantidad; i++) {
    const elegida = plantas
      .map((p) => ({ id: p.id, fin: libreEn.get(p.id) ?? 0 }))
      .sort(
        (a, b) =>
          a.fin - b.fin ||
          (a.id === plantaPreferida ? -1 : b.id === plantaPreferida ? 1 : a.id - b.id),
      )[0];
    resultado.push(elegida.id);
    libreEn.set(elegida.id, (libreEn.get(elegida.id) ?? 0) + (cargaMs.get(elegida.id) ?? 1_800_000));
  }
  return resultado;
}

async function asignarViajesDePedido(
  pedidoId: number,
  entrada: EntradaPedido,
): Promise<ResultadoProgramacion> {
  const plantel = await prisma.planteles.findUniqueOrThrow({
    where: { id: entrada.plantel_id },
  });

  // Capacidades disponibles = tamaños distintos de la flota propia + hub (excluye
  // mixers en mantenimiento la fecha del pedido).
  const candidatos = await candidatosDePlanta(
    entrada.plantel_id,
    plantel.hub_id,
    entrada.hora_solicitada,
  );
  // Capacidad de planeación por mixer: carga segura normal, o carga EFECTIVA reducida
  // si el pedido tiene `carga_reducida` (acceso difícil / pendiente).
  const reducidas = await cargarCapacidadesReducidas();
  const capacidades = [
    ...new Set(
      candidatos.map((m) =>
        capacidadPlaneacion(m.capacidad_m3, entrada.carga_reducida ?? false, reducidas),
      ),
    ),
  ];

  const plan = planificarCombinacion(entrada.volumen_total_m3, capacidades);

  // Reparto de PLANTA por viaje. Si el pedido pidió "ambas plantas", se distribuyen
  // entre las 2 (hueco más temprano; preferida = la del pedido) para carga simultánea;
  // si no, todos van a la planta elegida.
  const plantasViaje = await repartirPlantas(
    entrada.plantel_id,
    entrada.planta_id,
    plan.viajes.length,
    entrada.hora_solicitada,
    entrada.usar_ambas_plantas ?? false,
    entrada.carga_simultanea ?? false,
  );

  // Un viaje por cada carga del plan. El mixer lo asigna la cascada (mixer null).
  let idxPlanta = 0;
  for (const vp of plan.viajes) {
    await prisma.viajes.create({
      data: {
        pedido_id: pedidoId,
        mixer_id: null,
        planta_id: plantasViaje[idxPlanta++] ?? entrada.planta_id,
        capacidad_asignada_m3: vp.capacidad,
        volumen_asignado_m3: vp.volumen,
        hora_solicitada: entrada.hora_solicitada,
        // Motivo tentativo (no "Sin cubrir" para que la cascada lo agende); el
        // agendador recomputa el motivo real al asignar el mixer.
        motivo_asignacion: "Flota propia",
        estado_confirmacion: "Pendiente",
      },
    });
  }

  // Solo hay "Sin cubrir" si el plantel NO tiene ninguna capacidad disponible
  // (cero mixers propios y sin hub). Con reutilización por horario, cualquier
  // volumen se cubre serializando viajes en las unidades que existan.
  if (plan.volumenSinCubrir > 0) {
    await prisma.viajes.create({
      data: {
        pedido_id: pedidoId,
        mixer_id: null,
        planta_id: entrada.planta_id,
        capacidad_asignada_m3: 0,
        volumen_asignado_m3: plan.volumenSinCubrir,
        hora_solicitada: entrada.hora_solicitada,
        motivo_asignacion: "Sin cubrir",
        estado_confirmacion: "Pendiente",
      },
    });
  }

  // Cascada de horarios + asignación de mixers de toda la planta ese día.
  const viajesRecalculados = await recalcularCascadaPlanta(
    entrada.planta_id,
    entrada.hora_solicitada,
  );

  const volumenSinCubrir = await volumenSinCubrirDePedido(pedidoId);
  const sugerenciasRefuerzo =
    volumenSinCubrir > 0
      ? await sugerirRefuerzo(
          volumenSinCubrir,
          entrada.plantel_id,
          plantel.hub_id ?? entrada.plantel_id,
          entrada.hora_solicitada,
        )
      : [];

  const alertasMargen = await detectarAlertasMargen(entrada.hora_solicitada);
  const viajes = await resumenViajes(pedidoId);
  // Aviso de simultaneidad: solo si el pedido la pidió (2 plantas a la vez).
  const avisoSimultaneidad = entrada.carga_simultanea
    ? await avisoSimultaneidadDePedido(pedidoId)
    : null;

  return {
    pedidoId,
    viajes,
    volumenSinCubrir,
    sugerenciasRefuerzo,
    alertasMargen,
    viajesRecalculados,
    avisoSimultaneidad,
  };
}

/**
 * Aviso de carga simultánea: revisa el primer viaje (por hora de carga) de CADA planta
 * de un pedido; si una planta arrancó más tarde que la otra por más de 5 min (porque
 * estaba ocupada con otro cliente), devuelve cuál y la diferencia. null = arrancaron a
 * la vez (o el pedido no usó 2 plantas).
 */
async function avisoSimultaneidadDePedido(
  pedidoId: number,
): Promise<{ plantaTarde: string; minutosDiferencia: number } | null> {
  const viajes = await prisma.viajes.findMany({
    where: { pedido_id: pedidoId, mixer_id: { not: null }, hora_inicio_carga: { not: null } },
    select: { hora_inicio_carga: true, planta_id: true, planta: { select: { nombre: true } } },
  });
  const primera = new Map<number, { nombre: string; ms: number }>();
  for (const v of viajes) {
    if (v.planta_id == null) continue;
    const ms = v.hora_inicio_carga!.getTime();
    const prev = primera.get(v.planta_id);
    if (!prev || ms < prev.ms) primera.set(v.planta_id, { nombre: v.planta?.nombre ?? "?", ms });
  }
  const arr = [...primera.values()].sort((a, b) => a.ms - b.ms);
  if (arr.length < 2) return null; // no repartió en 2 plantas
  const dif = Math.round((arr[arr.length - 1].ms - arr[0].ms) / 60000);
  if (dif <= 5) return null; // arrancaron ~a la vez
  return { plantaTarde: arr[arr.length - 1].nombre, minutosDiferencia: dif };
}

/**
 * Llegada (hora_llegada_proyecto) MÁS TEMPRANA por pedido activo de una planta+día.
 * Sirve para medir el impacto de insertar/reprogramar un pedido sobre la hora de
 * llegada esperada de los clientes que YA estaban programados en esa planta.
 */
export async function llegadasPorPlanta(
  plantaId: number,
  dia: Date,
): Promise<Map<number, { ms: number; cliente: string }>> {
  const viajes = await prisma.viajes.findMany({
    where: {
      hora_llegada_proyecto: { not: null },
      pedido: {
        planta_id: plantaId,
        estado_pedido: "Activo",
        hora_solicitada: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
      },
    },
    select: {
      pedido_id: true,
      hora_llegada_proyecto: true,
      pedido: { select: { cliente: { select: { empresa: true } } } },
    },
  });
  const m = new Map<number, { ms: number; cliente: string }>();
  for (const v of viajes) {
    const t = v.hora_llegada_proyecto!.getTime();
    const cur = m.get(v.pedido_id);
    if (!cur || t < cur.ms) m.set(v.pedido_id, { ms: t, cliente: v.pedido.cliente.empresa });
  }
  return m;
}

/** Suma el volumen de los viajes del pedido que quedaron sin mixer. */
async function volumenSinCubrirDePedido(pedidoId: number): Promise<number> {
  const viajes = await prisma.viajes.findMany({
    where: { pedido_id: pedidoId, mixer_id: null },
    select: { volumen_asignado_m3: true },
  });
  const total = viajes.reduce((s, v) => s + v.volumen_asignado_m3, 0);
  return Math.round(total * 100) / 100;
}

// ── Paso 3: sugerencias de refuerzo excepcional ──────────────────────────────

/**
 * Arma la lista de mixers sugeridos como refuerzo desde CUALQUIER otro plantel
 * (ni el del pedido ni su hub, que ya se intentaron). Solo mixers Disponible sin
 * viajes programados el resto del día en su propio plantel. NO se asignan: es
 * una sugerencia que el usuario debe confirmar.
 *
 * Orden: (1) capacidad más cercana al volumen faltante, (2) plantel con más
 * holgura de flota respecto a su demanda restante del día, (3) mixer con más
 * tiempo sin viaje ese día (desempate).
 */
export async function sugerirRefuerzo(
  volumenFaltante: number,
  plantelPedidoId: number,
  hubId: number,
  dia: Date,
): Promise<SugerenciaRefuerzo[]> {
  const ini = inicioDelDia(dia);
  const fin = finDelDia(dia);

  const mixers = await prisma.mixers.findMany({
    where: {
      estado: ESTADO_DISPONIBLE,
      plantel_base_id: { notIn: [plantelPedidoId, hubId] },
    },
    include: {
      plantel_base: true,
      viajes: {
        where: {
          estado: { not: "Cancelado" },
          hora_inicio_carga: { gte: ini, lt: fin },
        },
        select: { hora_inicio_carga: true, hora_regreso_planta: true },
      },
    },
  });

  // Holgura de flota libre por plantel respecto a su demanda restante del día.
  const holguraPorPlantel = await calcularHolguraPorPlantel(dia);

  const sugerencias: SugerenciaRefuerzo[] = mixers
    // "sin ningún viaje programado el resto del día en su propio plantel"
    .filter((m) => m.viajes.length === 0)
    .map((m) => {
      // Sin viajes hoy → idle máximo (desde el inicio del día hasta la hora ref).
      const minutosSinViaje = diferenciaMinutos(ini, dia);
      return {
        mixerId: m.id,
        identificador: m.identificador,
        capacidad: cargaSeguraMixer(m.capacidad_m3), // carga segura de planeacion
        plantelId: m.plantel_base_id,
        plantelNombre: m.plantel_base.nombre,
        holguraPlantel: holguraPorPlantel.get(m.plantel_base_id) ?? 0,
        minutosSinViaje,
      };
    });

  sugerencias.sort(
    (a, b) =>
      Math.abs(a.capacidad - volumenFaltante) -
        Math.abs(b.capacidad - volumenFaltante) ||
      b.holguraPlantel - a.holguraPlantel ||
      b.minutosSinViaje - a.minutosSinViaje,
  );

  return sugerencias;
}

/**
 * Holgura por plantel = (mixers libres) − (viajes pendientes ese día).
 * Heurística simple para ordenar sugerencias; se puede refinar en fases
 * posteriores con la demanda real por volumen.
 */
async function calcularHolguraPorPlantel(dia: Date): Promise<Map<number, number>> {
  const ini = inicioDelDia(dia);
  const fin = finDelDia(dia);

  const planteles = await prisma.planteles.findMany({
    include: {
      mixers_base: { where: { estado: ESTADO_DISPONIBLE }, select: { id: true } },
    },
  });

  const mapa = new Map<number, number>();
  for (const p of planteles) {
    const pendientes = await prisma.viajes.count({
      where: {
        estado: { notIn: ["Cancelado", ESTADO_VIAJE_COMPLETADO] },
        pedido: {
          plantel_id: p.id,
          hora_solicitada: { gte: ini, lt: fin },
        },
      },
    });
    mapa.set(p.id, p.mixers_base.length - pendientes);
  }
  return mapa;
}

// ── Reasignación manual ──────────────────────────────────────────────────────

export interface ResultadoReasignacion {
  ok: boolean;
  motivo?: string; // mensaje de ERROR (bloqueo)
  alertasMargen: AlertaMargen[];
  // Aviso informativo (no bloqueante), p. ej. flota insuficiente al recuperar un
  // viaje liberado o al cubrir el remanente de volumen.
  aviso?: string;
  // Viajes existentes que se vieron afectados por la reasignación (liberados y
  // reprogramados, o a los que se les absorbió volumen). Para la bitácora.
  viajesAfectados?: number[];
  // Viajes NUEVOS creados para cubrir el remanente de volumen (cambio de capacidad).
  viajesAgregados?: number[];
  // Volumen que quedó SIN CUBRIR tras la reasignación (0 = todo cubierto).
  volumenSinCubrir?: number;
}

/**
 * Reasigna manualmente el mixer de un viaje. Valida estado del mixer y que no
 * haya traslape con otros viajes de ESE mixer ese día. Marca el viaje como
 * ajustado_manualmente. Nunca permite un traslape.
 */
export async function reasignarMixer(
  viajeId: number,
  nuevoMixerId: number,
): Promise<ResultadoReasignacion> {
  const viaje = await prisma.viajes.findUniqueOrThrow({
    where: { id: viajeId },
    include: { pedido: true },
  });
  const mixer = await prisma.mixers.findUniqueOrThrow({
    where: { id: nuevoMixerId },
  });

  if (mixer.estado !== ESTADO_DISPONIBLE) {
    return {
      ok: false,
      motivo: `El mixer ${nuevoMixerId} no está disponible (estado: ${mixer.estado}).`,
      alertasMargen: [],
    };
  }

  // Rechazar si el mixer tiene mantenimiento/baja programado que cubre la fecha
  // del viaje (Hito 6): no se puede forzar una unidad en mantenimiento.
  const mant = await mantenimientoDeUnidad(
    "Mixer",
    nuevoMixerId,
    viaje.pedido.hora_solicitada,
  );
  if (mant) {
    const fmt = (d: Date) =>
      d.toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric" });
    const etq = mant.tipo_evento === "Mantenimiento_Programado" ? "mantenimiento programado" : "baja de servicio";
    return {
      ok: false,
      motivo: `El mixer ${mixer.identificador ?? `#${nuevoMixerId}`} tiene ${etq} del ${fmt(mant.fecha_inicio)} al ${fmt(mant.fecha_fin)} — no se puede asignar en esa fecha.`,
      alertasMargen: [],
    };
  }

  // Ventana de ocupación del viaje objetivo por horas REALES cuando existen (un
  // viaje ya en curso ocupa el mixer según lo que realmente pasó, no lo programado).
  const ventana = ventanaOcupacion(viaje);
  if (!ventana) {
    return {
      ok: false,
      motivo: "El viaje no tiene horario calculado todavía.",
      alertasMargen: [],
    };
  }

  const dia = viaje.pedido.hora_solicitada;
  const round = (n: number) => Math.round(n * 100) / 100;

  // Otros viajes de ESTE mixer ese día que SE TRASLAPAN con la ventana del viaje
  // objetivo (excluyendo el propio viaje). Un mixer puede hacer varios viajes al
  // día si NO se traslapan (reutilización), así que solo nos importan los que sí.
  // La comparación usa la ventana de OCUPACIÓN REAL: un viaje Completado cuyo
  // regreso real ya pasó NO bloquea otro que carga más tarde (evita falso traslape).
  const otros = await prisma.viajes.findMany({
    where: {
      mixer_id: nuevoMixerId,
      id: { not: viajeId },
      estado: { not: "Cancelado" },
      hora_inicio_carga: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
    },
    include: { pedido: { select: { planta_id: true } } },
  });
  const conflictivos = otros.filter((o) => {
    const w = ventanaOcupacion(o);
    return w != null && !unidadLibreEnVentana(ventana, [w]);
  });

  // Un viaje en conflicto que YA inició su carga (o está Completado) no se puede
  // liberar: el mixer ya está físicamente comprometido. En ese caso se bloquea.
  const enCurso = conflictivos.find(
    (o) => o.ts_inicio_carga_real != null || o.estado === ESTADO_VIAJE_COMPLETADO,
  );
  if (enCurso) {
    return {
      ok: false,
      motivo: `El mixer ${mixer.identificador ?? `#${nuevoMixerId}`} ya está cargando/completó el viaje #${enCurso.id} que se traslapa con este horario — no se puede tomar.`,
      alertasMargen: [],
    };
  }

  // Procedencia según el plantel del nuevo mixer.
  const motivo =
    mixer.plantel_base_id === viaje.pedido.plantel_id
      ? "Flota propia"
      : "Préstamo de zona";

  // Cambio de capacidad: si el nuevo mixer es MÁS PEQUEÑO que el volumen que
  // llevaba el viaje, se recorta a la capacidad de planeación y el remanente se
  // redistribuye. Capacidad de planeación = carga segura, o efectiva reducida si el
  // pedido tiene `carga_reducida`. (En emergencia el despacho sube por el campo Volumen.)
  const reducidas = await cargarCapacidadesReducidas();
  const nuevaCap = capacidadPlaneacion(mixer.capacidad_m3, viaje.pedido.carga_reducida, reducidas);
  const volCapado = Math.min(viaje.volumen_asignado_m3, nuevaCap);
  let remanente = round(viaje.volumen_asignado_m3 - volCapado);

  // Asignar el mixer al viaje objetivo (arrastra el motorista del mixer).
  await prisma.viajes.update({
    where: { id: viajeId },
    data: {
      mixer_id: nuevoMixerId,
      capacidad_asignada_m3: nuevaCap,
      volumen_asignado_m3: volCapado,
      operador_id: mixer.operador_asignado_id,
      motivo_asignacion: motivo,
      ajustado_manualmente: true,
    },
  });

  const viajesAfectados: number[] = [];
  const viajesAgregados: number[] = [];

  // ── Los viajes en conflicto pierden el mixer pero CONSERVAN su horario ──
  // Antes se les borraban todas las horas para que la cascada los recolocara, lo que
  // reprogramaba la planta entera. Como esto corre desde Despacho en vivo, el horario
  // programado no se toca: al viaje solo se le busca OTRA unidad libre en su mismo
  // hueco; si no hay, queda sin mixer para que el despachador lo asigne a mano.
  const hubDelPlantel = conflictivos.length
    ? (
        await prisma.planteles.findUnique({
          where: { id: viaje.pedido.plantel_id },
          select: { hub_id: true },
        })
      )?.hub_id ?? null
    : null;
  for (const o of conflictivos) {
    await prisma.viajes.update({
      where: { id: o.id },
      data: { mixer_id: null, operador_id: null },
    });
    await reemplazarMixerConservandoHora(o.id, viaje.pedido.plantel_id, hubDelPlantel, dia);
    viajesAfectados.push(o.id);
  }

  // ── Recalcular volumen del pedido si el cambio de capacidad dejó remanente ──
  if (remanente > 0.001) {
    // 1) Absorber en otros viajes del MISMO pedido que tengan margen dentro de la
    //    capacidad de su propio mixer ya asignado (sin tocar viajes ya iniciados).
    const hermanos = await prisma.viajes.findMany({
      where: {
        pedido_id: viaje.pedido_id,
        id: { not: viajeId },
        estado: { not: "Cancelado" },
        motivo_asignacion: { not: "Sin cubrir" },
      },
      orderBy: { id: "asc" },
    });
    for (const h of hermanos) {
      if (remanente <= 0.001) break;
      if (h.ts_inicio_carga_real != null || h.estado === ESTADO_VIAJE_COMPLETADO) continue;
      const margen = round(h.capacidad_asignada_m3 - h.volumen_asignado_m3);
      if (margen <= 0.001) continue;
      const add = Math.min(margen, remanente);
      await prisma.viajes.update({
        where: { id: h.id },
        data: { volumen_asignado_m3: round(h.volumen_asignado_m3 + add) },
      });
      remanente = round(remanente - add);
      viajesAfectados.push(h.id);
    }

    // 2) Si aún queda remanente, generar viaje(s) adicional(es) con el mismo motor
    //    de "mejor combinación de capacidades". El mixer lo asigna la cascada.
    if (remanente > 0.001) {
      const plantelPedido = await prisma.planteles.findUniqueOrThrow({
        where: { id: viaje.pedido.plantel_id },
        select: { id: true, hub_id: true },
      });
      const candidatos = await candidatosDePlanta(
        plantelPedido.id,
        plantelPedido.hub_id,
        dia,
      );
      const caps = [
        ...new Set(
          candidatos.map((m) =>
            capacidadPlaneacion(m.capacidad_m3, viaje.pedido.carga_reducida, reducidas),
          ),
        ),
      ];
      const plan = planificarCombinacion(remanente, caps);
      for (const vp of plan.viajes) {
        const nuevo = await prisma.viajes.create({
          data: {
            pedido_id: viaje.pedido_id,
            mixer_id: null,
            planta_id: viaje.planta_id, // misma planta que el viaje reasignado
            capacidad_asignada_m3: vp.capacidad,
            volumen_asignado_m3: vp.volumen,
            hora_solicitada: viaje.pedido.hora_solicitada,
            motivo_asignacion: "Flota propia",
            estado_confirmacion: "Pendiente",
          },
        });
        viajesAgregados.push(nuevo.id);
      }
      if (plan.volumenSinCubrir > 0.001) {
        await prisma.viajes.create({
          data: {
            pedido_id: viaje.pedido_id,
            mixer_id: null,
            planta_id: viaje.planta_id,
            capacidad_asignada_m3: 0,
            volumen_asignado_m3: round(plan.volumenSinCubrir),
            hora_solicitada: viaje.pedido.hora_solicitada,
            motivo_asignacion: "Sin cubrir",
            estado_confirmacion: "Pendiente",
          },
        });
      }
    }
  }

  // ── Colocar los viajes que nacieron del remanente, sin tocar el resto ──
  // Se agregan al FINAL de la cola de su planta (igual que una adición). NO se
  // recalcula la cascada: esto corre desde Despacho en vivo y la programación
  // publicada no se reescribe.
  if (viajesAgregados.length > 0) {
    const [tMinRem] = transporteDePedido(
      viaje.pedido.tiempo_transporte_min,
      (
        await prisma.clientes.findUnique({
          where: { id: viaje.pedido.cliente_id },
          select: { tiempo_viaje_referencia_min: true },
        })
      )?.tiempo_viaje_referencia_min ?? null,
    );
    await colocarAdicionesAlFinal(
      viajesAgregados,
      dia,
      await candidatosDePlanta(
        viaje.pedido.plantel_id,
        (
          await prisma.planteles.findUnique({
            where: { id: viaje.pedido.plantel_id },
            select: { hub_id: true },
          })
        )?.hub_id ?? null,
        dia,
      ),
      viaje.pedido.tipo_descarga,
      tMinRem,
      viaje.pedido.plantel_id,
    );
  }

  // Volumen sin cubrir tras todo (target + viajes liberados de otros pedidos).
  const pedidosAfectados = new Set<number>([viaje.pedido_id]);
  const liberados = await prisma.viajes.findMany({
    where: { id: { in: viajesAfectados } },
    select: { pedido_id: true },
  });
  for (const l of liberados) pedidosAfectados.add(l.pedido_id);
  let volumenSinCubrir = 0;
  for (const pid of pedidosAfectados) {
    volumenSinCubrir = round(volumenSinCubrir + (await volumenSinCubrirDePedido(pid)));
  }

  const aviso =
    volumenSinCubrir > 0.001
      ? `Flota insuficiente: quedaron ${volumenSinCubrir} m³ sin cubrir tras la reasignación. Revisa las sugerencias de refuerzo.`
      : undefined;

  return {
    ok: true,
    alertasMargen: await detectarAlertasMargen(dia),
    aviso,
    viajesAfectados,
    viajesAgregados,
    volumenSinCubrir,
  };
}

// ── Cambio de planta de un viaje (Despacho en vivo) ──────────────────────────

export interface ResultadoCambioPlanta {
  ok: boolean;
  mensaje?: string;
  alertasMargen: AlertaMargen[];
  plantaAnterior?: string; // nombres para la bitácora
  plantaNueva?: string;
}

/**
 * Cambia la PLANTA dosificadora de UN viaje (útil cuando una planta se satura o
 * falla y el Despachador mueve viajes pendientes a la otra planta del plantel, sin
 * cancelar/recrear). La planta destino debe ser del MISMO plantel del pedido. Marca
 * el viaje en la nueva planta y recalcula la cascada del plantel (ambas plantas) —
 * la cola de la planta destino reacomoda el horario del viaje. No se puede mover un
 * viaje ya iniciado (carga real) ni completado.
 */
export async function cambiarPlantaViaje(
  viajeId: number,
  nuevaPlantaId: number,
): Promise<ResultadoCambioPlanta> {
  const viaje = await prisma.viajes.findUniqueOrThrow({
    where: { id: viajeId },
    include: {
      planta: { select: { nombre: true } },
      pedido: { select: { plantel_id: true, hora_solicitada: true } },
    },
  });
  if (viaje.estado === ESTADO_VIAJE_COMPLETADO) {
    return { ok: false, mensaje: "No se puede cambiar la planta de un viaje ya completado.", alertasMargen: [] };
  }
  if (viaje.ts_inicio_carga_real != null) {
    return { ok: false, mensaje: "El viaje ya inició su carga; no se puede mover de planta.", alertasMargen: [] };
  }
  const destino = await prisma.plantas.findUnique({
    where: { id: nuevaPlantaId },
    select: { plantel_id: true, nombre: true },
  });
  if (!destino) return { ok: false, mensaje: "Planta no encontrada.", alertasMargen: [] };
  if (destino.plantel_id !== viaje.pedido.plantel_id) {
    return { ok: false, mensaje: "Esa planta no pertenece al plantel del pedido.", alertasMargen: [] };
  }
  if (viaje.planta_id === nuevaPlantaId) {
    return { ok: true, alertasMargen: [], plantaAnterior: viaje.planta?.nombre, plantaNueva: destino.nombre };
  }

  // SOLO se cambia la planta. NO se recalcula la cascada: esta acción es de DESPACHO
  // EN VIVO y el despacho nunca reescribe los `hora_*` programados (línea base del
  // programa y del DPCR-08). Antes se llamaba a `recalcularCascadaPlanta`, que es el
  // programador automático: movía la hora de carga de ESTE viaje —con lo que saltaba
  // de lugar en la lista, que se ordena por hora de carga programada— y además
  // reescribía las horas de los demás viajes de la planta, alterando el programa ya
  // publicado. Si el mixer sale de otra planta, la ejecución real se sella en los
  // `ts_*_real` como en cualquier otro viaje.
  await prisma.viajes.update({ where: { id: viajeId }, data: { planta_id: nuevaPlantaId } });

  return {
    ok: true,
    alertasMargen: await detectarAlertasMargen(viaje.pedido.hora_solicitada),
    plantaAnterior: viaje.planta?.nombre ?? "—",
    plantaNueva: destino.nombre,
  };
}

// ── Alerta de margen insuficiente (red de seguridad) ─────────────────────────

/**
 * Detecta pares consecutivos de la MISMA unidad (mixer o bomba) con menos de
 * MARGEN_MINIMO_MIN de holgura entre uno y el siguiente. No es bloqueante: es
 * una advertencia visible, pensada para detectar ajustes MANUALES que dejan el
 * margen apretado. Un margen negativo significa TRASLAPE directo.
 *
 * - Mixer: entre el regreso a planta de un viaje y el inicio de carga del
 *   siguiente viaje del mismo mixer.
 * - Bomba: entre el fin de descarga de un pedido y el inicio de descarga del
 *   siguiente pedido que usa la misma bomba (la bomba está en el proyecto
 *   durante toda la ventana de descarga del pedido).
 */
export async function detectarAlertasMargen(dia: Date): Promise<AlertaMargen[]> {
  const ini = inicioDelDia(dia);
  const fin = finDelDia(dia);
  const alertas: AlertaMargen[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;

  // ── Mixers ──────────────────────────────────────────────────────────────
  const viajes = await prisma.viajes.findMany({
    where: {
      mixer_id: { not: null },
      estado: { not: "Cancelado" },
      hora_inicio_carga: { gte: ini, lt: fin },
    },
    select: {
      id: true,
      mixer_id: true,
      hora_inicio_carga: true,
      hora_regreso_planta: true,
    },
  });

  const porMixer = new Map<number, typeof viajes>();
  for (const v of viajes) {
    if (v.mixer_id == null) continue;
    const lista = porMixer.get(v.mixer_id) ?? [];
    lista.push(v);
    porMixer.set(v.mixer_id, lista);
  }

  for (const [mixerId, lista] of porMixer) {
    lista.sort(
      (a, b) =>
        (a.hora_inicio_carga?.getTime() ?? 0) -
        (b.hora_inicio_carga?.getTime() ?? 0),
    );
    for (let i = 1; i < lista.length; i++) {
      const anterior = lista[i - 1];
      const siguiente = lista[i];
      if (!anterior.hora_regreso_planta || !siguiente.hora_inicio_carga) continue;
      const margen = diferenciaMinutos(
        anterior.hora_regreso_planta,
        siguiente.hora_inicio_carga,
      );
      if (margen < MARGEN_MINIMO_MIN) {
        alertas.push({
          tipoUnidad: "mixer",
          unidadId: mixerId,
          viajeAnteriorId: anterior.id,
          viajeSiguienteId: siguiente.id,
          margenMin: round(margen),
        });
      }
    }
  }

  // ── Bombas ──────────────────────────────────────────────────────────────
  // La ventana de la bomba para un pedido = [primer inicio de descarga,
  // último fin de descarga] entre sus viajes.
  const pedidosBomba = await prisma.pedidos.findMany({
    where: { bomba_id: { not: null }, hora_solicitada: { gte: ini, lt: fin } },
    select: {
      bomba_id: true,
      viajes: {
        where: { estado: { not: "Cancelado" } },
        select: { id: true, hora_inicio_descarga: true, hora_fin_descarga: true },
      },
    },
  });

  interface OcupBomba {
    refViajeId: number;
    inicio: Date;
    fin: Date;
  }
  const porBomba = new Map<number, OcupBomba[]>();
  for (const p of pedidosBomba) {
    if (p.bomba_id == null) continue;
    const desc = p.viajes.filter(
      (v) => v.hora_inicio_descarga && v.hora_fin_descarga,
    );
    if (desc.length === 0) continue;
    desc.sort(
      (a, b) =>
        a.hora_inicio_descarga!.getTime() - b.hora_inicio_descarga!.getTime(),
    );
    const inicio = desc[0].hora_inicio_descarga!;
    const finVentana = new Date(
      Math.max(...desc.map((v) => v.hora_fin_descarga!.getTime())),
    );
    const lista = porBomba.get(p.bomba_id) ?? [];
    lista.push({ refViajeId: desc[0].id, inicio, fin: finVentana });
    porBomba.set(p.bomba_id, lista);
  }

  for (const [bombaId, lista] of porBomba) {
    lista.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
    for (let i = 1; i < lista.length; i++) {
      const anterior = lista[i - 1];
      const siguiente = lista[i];
      const margen = diferenciaMinutos(anterior.fin, siguiente.inicio);
      if (margen < MARGEN_MINIMO_MIN) {
        alertas.push({
          tipoUnidad: "bomba",
          unidadId: bombaId,
          viajeAnteriorId: anterior.refViajeId,
          viajeSiguienteId: siguiente.refViajeId,
          margenMin: round(margen),
        });
      }
    }
  }

  return alertas;
}

// ── Cancelar / modificar un pedido (recalcula la cascada) ────────────────────

/**
 * Cancela (elimina) un pedido y RECALCULA la cascada de horarios de la planta
 * para ese día, tal como exige el spec ("recalcula al agregar/cancelar/cambiar
 * un pedido"). Los viajes del pedido se borran en cascada (FK onDelete).
 * Devuelve los ids de viajes cuyos horarios cambiaron por el recálculo.
 */
export async function cancelarPedido(
  pedidoId: number,
): Promise<{ viajesRecalculados: number[] }> {
  const pedido = await prisma.pedidos.findUniqueOrThrow({
    where: { id: pedidoId },
    select: { planta_id: true, hora_solicitada: true },
  });

  await prisma.pedidos.delete({ where: { id: pedidoId } });

  const viajesRecalculados = await recalcularCascadaPlanta(
    pedido.planta_id,
    pedido.hora_solicitada,
  );
  return { viajesRecalculados };
}

/**
 * Cancela un pedido MARCÁNDOLO (no lo borra): guarda motivo + detalle + usuario,
 * cancela sus viajes (liberando mixer) y recalcula la cascada de la planta para
 * cerrar el hueco. El pedido queda para el indicador comercial y la bitácora.
 */
export async function cancelarPedidoConMotivo(
  pedidoId: number,
  motivo: string,
  detalle: string | null,
  usuario: string,
): Promise<{ viajesRecalculados: number[] }> {
  const pedido = await prisma.pedidos.findUniqueOrThrow({
    where: { id: pedidoId },
    select: { planta_id: true, hora_solicitada: true, estado_pedido: true },
  });

  // ¿El Programa DPCR-08 de este día YA está publicado (congelado)? Se publica a
  // las 16:00 del día anterior. Si la cancelación ocurre DESPUÉS de ese cierre, el
  // documento no se reescribe: el cliente PERMANECE en el programa con su mixer y
  // horarios tal como se publicaron, y NO se recalcula la cascada (no se corren los
  // demás clientes). Si ocurre ANTES del cierre, se libera y se reoptimiza como
  // siempre (el cliente desaparece del programa). En ambos casos el pedido queda
  // Cancelado para métricas comerciales (cancelación cargada al asesor) y sale del
  // Despacho activo.
  const congelado = new Date() >= cierreProgramaDe(pedido.hora_solicitada);

  if (congelado) {
    // Post-cierre: marca Cancelado SIN tocar la programación. Se conservan
    // mixer/operador/horarios de los viajes (la cascada ya ignora los Cancelados,
    // así que la flota queda libre para reutilizarse sin borrar el registro).
    await prisma.$transaction([
      prisma.viajes.updateMany({
        where: { pedido_id: pedidoId, estado: { not: "Completado" } },
        data: { estado: "Cancelado" },
      }),
      prisma.pedidos.update({
        where: { id: pedidoId },
        data: {
          estado_pedido: "Cancelado",
          motivo_cancelacion: motivo,
          detalle_cancelacion: detalle,
          cancelado_por: usuario,
          fecha_cancelacion: new Date(),
        },
      }),
    ]);
    return { viajesRecalculados: [] };
  }

  await prisma.$transaction([
    prisma.viajes.updateMany({
      where: { pedido_id: pedidoId, estado: { not: "Completado" } },
      data: { estado: "Cancelado", mixer_id: null, operador_id: null },
    }),
    prisma.pedidos.update({
      where: { id: pedidoId },
      data: {
        estado_pedido: "Cancelado",
        motivo_cancelacion: motivo,
        detalle_cancelacion: detalle,
        cancelado_por: usuario,
        fecha_cancelacion: new Date(),
      },
    }),
  ]);

  // La planta libera el hueco del pedido cancelado → recalcular su cascada.
  const viajesRecalculados = await recalcularCascadaPlanta(
    pedido.planta_id,
    pedido.hora_solicitada,
  );
  return { viajesRecalculados };
}

// ── Paso 3: confirmar un refuerzo excepcional ────────────────────────────────

/**
 * Confirma un mixer de refuerzo (Paso 3) para cubrir el volumen "Sin cubrir" de
 * un pedido. Crea un viaje con origen "Refuerzo excepcional", lo agenda en la
 * cascada de la planta, valida que el mixer no se traslape con otro viaje suyo
 * y reduce (o elimina) el placeholder "Sin cubrir". Requiere confirmación del
 * usuario: NO es automático.
 */
export async function confirmarRefuerzo(
  pedidoId: number,
  mixerId: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const pedido = await prisma.pedidos.findUniqueOrThrow({
    where: { id: pedidoId },
    select: { planta_id: true, hora_solicitada: true, carga_reducida: true },
  });
  const placeholders = await prisma.viajes.findMany({
    where: { pedido_id: pedidoId, motivo_asignacion: "Sin cubrir" },
    orderBy: { id: "asc" },
  });
  const faltante = placeholders.reduce((s, v) => s + v.volumen_asignado_m3, 0);
  if (faltante <= 0) {
    return { ok: false, mensaje: "Este pedido no tiene volumen sin cubrir." };
  }

  const mixer = await prisma.mixers.findUniqueOrThrow({ where: { id: mixerId } });
  if (mixer.estado !== ESTADO_DISPONIBLE) {
    return { ok: false, mensaje: "El mixer de refuerzo no está disponible." };
  }

  // Capacidad de planeación (carga segura, o efectiva reducida si el pedido tiene
  // `carga_reducida`).
  const reducidas = await cargarCapacidadesReducidas();
  const cargaSegura = capacidadPlaneacion(mixer.capacidad_m3, pedido.carga_reducida, reducidas);
  const cubierto = Math.min(cargaSegura, faltante);

  const nuevo = await prisma.viajes.create({
    data: {
      pedido_id: pedidoId,
      mixer_id: mixerId,
      planta_id: pedido.planta_id, // refuerzo entra por la planta del pedido
      capacidad_asignada_m3: cargaSegura,
      volumen_asignado_m3: cubierto,
      hora_solicitada: pedido.hora_solicitada,
      motivo_asignacion: "Refuerzo excepcional",
      estado_confirmacion: "Pendiente",
      operador_id: mixer.operador_asignado_id,
      ajustado_manualmente: true,
    },
  });

  // Agendar el viaje de refuerzo en la cascada de la planta.
  await recalcularCascadaPlanta(pedido.planta_id, pedido.hora_solicitada);

  // Validar traslape del mixer de refuerzo en su ventana ya calculada.
  const conHoras = await prisma.viajes.findUniqueOrThrow({
    where: { id: nuevo.id },
  });
  const ventana = ventanaDeViaje(conHoras);
  if (ventana) {
    const otras = await prisma.viajes.findMany({
      where: {
        mixer_id: mixerId,
        id: { not: nuevo.id },
        estado: { not: "Cancelado" },
        hora_inicio_carga: {
          gte: inicioDelDia(pedido.hora_solicitada),
          lt: finDelDia(pedido.hora_solicitada),
        },
      },
      select: { hora_inicio_carga: true, hora_regreso_planta: true },
    });
    const ventanas = otras
      .map(ventanaDeViaje)
      .filter((v): v is VentanaViaje => v != null);
    if (!unidadLibreEnVentana(ventana, ventanas)) {
      await prisma.viajes.delete({ where: { id: nuevo.id } });
      await recalcularCascadaPlanta(pedido.planta_id, pedido.hora_solicitada);
      return {
        ok: false,
        mensaje: "El mixer de refuerzo se traslapa con otro viaje suyo ese día.",
      };
    }
  }

  // Reducir / eliminar el(los) placeholder(s) "Sin cubrir".
  let restante = cubierto;
  for (const ph of placeholders) {
    if (restante <= 1e-6) break;
    if (ph.volumen_asignado_m3 <= restante + 1e-6) {
      restante -= ph.volumen_asignado_m3;
      await prisma.viajes.delete({ where: { id: ph.id } });
    } else {
      await prisma.viajes.update({
        where: { id: ph.id },
        data: {
          volumen_asignado_m3:
            Math.round((ph.volumen_asignado_m3 - restante) * 100) / 100,
        },
      });
      restante = 0;
    }
  }

  return { ok: true };
}

// ── Utilidades de lectura ────────────────────────────────────────────────────

async function resumenViajes(pedidoId: number): Promise<ViajeResumen[]> {
  const pedido = await prisma.pedidos.findUniqueOrThrow({
    where: { id: pedidoId },
    select: { plantel_id: true },
  });
  const viajes = await prisma.viajes.findMany({
    where: { pedido_id: pedidoId },
    orderBy: { id: "asc" },
    include: {
      mixer: {
        select: {
          id: true,
          identificador: true,
          plantel_base_id: true,
          plantel_base: { select: { nombre: true } },
        },
      },
    },
  });
  return viajes.map((v) => ({
    id: v.id,
    mixerId: v.mixer_id,
    mixerLabel: v.mixer ? (v.mixer.identificador ?? `#${v.mixer.id}`) : null,
    flota: v.mixer ? v.mixer.plantel_base.nombre : null,
    flotaPropia: v.mixer ? v.mixer.plantel_base_id === pedido.plantel_id : false,
    capacidad: v.capacidad_asignada_m3,
    volumen: v.volumen_asignado_m3,
    origen: (v.motivo_asignacion ?? "Sin cubrir") as Origen,
    rutaPorDefecto: v.ruta_por_defecto,
    hora_inicio_carga: v.hora_inicio_carga,
    hora_regreso_planta: v.hora_regreso_planta,
  }));
}

// ── Despacho en vivo: avanzar estado (SELLA ts_*_real, NUNCA hora_*) ─────────

export interface ResultadoAvance {
  ok: boolean;
  estado?: string;
  mensaje?: string;
}

/**
 * Los 6 campos de hora REAL, en orden lógico del viaje. La programación
 * (hora_*) es la línea base del Hito 2 y NO se toca aquí jamás.
 */
export const CAMPOS_TS_REAL = [
  "ts_inicio_carga_real",
  "ts_salida_real",
  "ts_llegada_real",
  "ts_inicio_descarga_real",
  "ts_fin_descarga_real",
  "ts_regreso_real",
] as const;
export type CampoTsReal = (typeof CAMPOS_TS_REAL)[number];

/**
 * Avanza un viaje al `nuevoEstado` indicado y SELLA la(s) hora(s) real(es) del
 * hito con la hora del SERVIDOR (`ahora`). El servidor valida que no se salten
 * pasos: `nuevoEstado` debe ser exactamente el siguiente de la secuencia.
 *
 * IMPORTANTE: solo escribe campos `ts_*_real`. Nunca modifica los `hora_*`
 * programados (línea base). Al sellar `ts_inicio_carga_real`, el viaje queda
 * "fijo" para la cascada.
 */
export async function avanzarEstadoViaje(
  viajeId: number,
  nuevoEstado: string,
  ahora: Date = new Date(),
): Promise<ResultadoAvance> {
  const viaje = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });

  if (viaje.mixer_id == null) {
    return { ok: false, mensaje: "El viaje no tiene mixer asignado." };
  }

  const idx = (SECUENCIA_ESTADOS_VIAJE as readonly string[]).indexOf(viaje.estado);
  if (idx < 0 || idx >= SECUENCIA_ESTADOS_VIAJE.length - 1) {
    return { ok: false, mensaje: "El viaje ya está en su estado final." };
  }
  const esperado = SECUENCIA_ESTADOS_VIAJE[idx + 1];
  if (nuevoEstado !== esperado) {
    return {
      ok: false,
      mensaje: `No se puede saltar pasos: el siguiente estado válido es '${esperado}'.`,
    };
  }

  // Sella SOLO campos ts_*_real (la programación hora_* queda intacta).
  const data: {
    estado: string;
    ts_inicio_carga_real?: Date;
    ts_fin_carga_real?: Date;
    ts_salida_real?: Date;
    ts_llegada_real?: Date;
    ts_inicio_descarga_real?: Date;
    ts_fin_descarga_real?: Date;
    ts_regreso_real?: Date;
  } = { estado: esperado };

  switch (esperado) {
    case "En carga":
      data.ts_inicio_carga_real = ahora;
      break;
    case "En ruta":
      // Sale de planta: la carga física terminó → sella fin de carga + salida.
      data.ts_fin_carga_real = ahora;
      data.ts_salida_real = ahora;
      break;
    case "Llegada":
      // Llegó a la obra: el Laboratorista revisa el concreto antes de descargar.
      data.ts_llegada_real = ahora;
      break;
    case "Descargando":
      data.ts_inicio_descarga_real = ahora;
      break;
    case "Regresando":
      data.ts_fin_descarga_real = ahora;
      break;
    case "Completado":
      data.ts_regreso_real = ahora;
      break;
  }

  await prisma.viajes.update({ where: { id: viajeId }, data });
  return { ok: true, estado: esperado };
}

/**
 * Corrige manualmente una hora real ya capturada. Valida que se respete el
 * orden lógico del viaje (cada hito real ≥ el anterior) y registra el cambio en
 * `bitacora_auditoria` (usuario, valor anterior/nuevo, momento). Nunca toca la
 * programación (hora_*).
 */
export async function corregirHoraReal(
  viajeId: number,
  campo: CampoTsReal,
  nuevoValor: Date,
  usuario: string,
  ahora: Date = new Date(),
): Promise<{ ok: boolean; mensaje?: string }> {
  if (!CAMPOS_TS_REAL.includes(campo)) {
    return { ok: false, mensaje: `Campo '${campo}' no es una hora real válida.` };
  }
  const viaje = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });

  // Construir la secuencia de reales con el valor corregido aplicado.
  const valores: (Date | null)[] = CAMPOS_TS_REAL.map((c) =>
    c === campo ? nuevoValor : (viaje[c] as Date | null),
  );
  // Validar que los valores NO nulos queden en orden no decreciente.
  let ultimo = -Infinity;
  for (const v of valores) {
    if (v == null) continue;
    if (v.getTime() < ultimo) {
      return {
        ok: false,
        mensaje:
          "La corrección rompe el orden lógico del viaje (un hito no puede ser anterior al previo).",
      };
    }
    ultimo = v.getTime();
  }

  const anterior = viaje[campo] as Date | null;
  await prisma.viajes.update({
    where: { id: viajeId },
    data: { [campo]: nuevoValor, ajustado_manualmente: true },
  });

  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "viajes",
      registro_id: viajeId,
      usuario,
      fecha_hora: ahora,
      campo_modificado: campo,
      valor_anterior: anterior ? anterior.toISOString() : null,
      valor_nuevo: nuevoValor.toISOString(),
      motivo: "Corrección manual de hora real (despacho)",
    },
  });

  return { ok: true };
}

/**
 * Edita el volumen de un viaje (ajuste de último momento). Solo permitido
 * mientras el viaje sigue en "Programado"/"En carga" y la carga NO ha finalizado
 * (`ts_fin_carga_real` nulo). Valida que no exceda la capacidad del mixer y
 * registra el cambio en bitácora. No toca la programación de horarios.
 */
export async function editarVolumenViaje(
  viajeId: number,
  nuevoVolumen: number,
  usuario: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const viaje = await prisma.viajes.findUniqueOrThrow({
    where: { id: viajeId },
    include: { mixer: { select: { capacidad_m3: true } } },
  });

  const editable =
    (viaje.estado === "Programado" || viaje.estado === "En carga") &&
    viaje.ts_fin_carga_real == null;
  if (!editable) {
    return { ok: false, mensaje: "No editable: la carga ya finalizó." };
  }
  if (!(nuevoVolumen > 0)) {
    return { ok: false, mensaje: "El volumen debe ser mayor que 0." };
  }
  // EMERGENCIA: el tope es la capacidad FISICA de la unidad (lo que el usuario
  // registro al agregar el mixer), no la carga segura de planeacion. Asi el
  // despachador puede cargar hasta el maximo real del mixer cuando lo necesita.
  const topeFisico = viaje.mixer?.capacidad_m3 ?? viaje.capacidad_asignada_m3;
  if (topeFisico > 0 && nuevoVolumen > topeFisico) {
    return {
      ok: false,
      mensaje: `El volumen no puede exceder la capacidad del mixer (${topeFisico} m³).`,
    };
  }

  const anterior = viaje.volumen_asignado_m3;
  await prisma.viajes.update({
    where: { id: viajeId },
    data: { volumen_asignado_m3: nuevoVolumen, ajustado_manualmente: true },
  });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "viajes",
      registro_id: viajeId,
      usuario,
      campo_modificado: "volumen_asignado_m3",
      valor_anterior: String(anterior),
      valor_nuevo: String(nuevoVolumen),
      motivo: "Ajuste de volumen de último momento (despacho)",
    },
  });
  return { ok: true };
}

/** Cambia el motorista de un viaje (validando que el operador esté disponible). */
export async function cambiarOperadorViaje(
  viajeId: number,
  operadorId: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const operador = await prisma.operadores.findUnique({
    where: { id: operadorId },
  });
  if (!operador) return { ok: false, mensaje: "Operador no encontrado." };
  if (operador.estado !== ESTADO_DISPONIBLE) {
    return { ok: false, mensaje: `El operador no está disponible.` };
  }
  await prisma.viajes.update({
    where: { id: viajeId },
    data: { operador_id: operadorId },
  });
  return { ok: true };
}
