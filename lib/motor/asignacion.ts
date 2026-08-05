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
  DEFAULT_TIEMPO_REGRESO_MIN,
  DEFAULT_TIEMPO_VIAJE_MIN,
  ESTADO_DISPONIBLE,
  ESTADO_VIAJE_COMPLETADO,
  HORA_APERTURA_POR_DEFECTO,
  MARGEN_MINIMO_MIN,
  MIN_SALIDA_TRAS_CARGA,
  SECUENCIA_ESTADOS_VIAJE,
} from "./config";
import { planificarCombinacion, unidadLibreEnVentana } from "./planificador";
import type { VentanaViaje } from "./planificador";
import {
  diferenciaMinutos,
  finDelDia,
  inicioDelDia,
  minutosDeCarga,
  minutosDeDescarga,
  mismoDia,
  sumarMinutos,
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
  const cambios: number[] = [];
  for (const p of plantas) {
    cambios.push(...(await cascadaDeUnaPlanta(p.id, dia)));
  }
  return cambios;
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
  // Inicio de carga del último viaje colocado de cada pedido, para escalonar los
  // camiones según frecuencia_entre_camiones_min (restricción del sitio).
  const ultimoInicioPorPedidoMs = new Map<number, number>();

  // `hora_solicitada` es la LLEGADA deseada al proyecto (no la hora de carga).
  // Inicio de jornada = la LLEGADA más temprana pedida en la cola. El PRIMER
  // viaje del orden se agenda para LLEGAR a esa hora (su inicio de carga se
  // calcula hacia atrás: llegada − carga − salida − transporte); el resto se
  // encadena tras él según planta y disponibilidad de mixer.
  const jornadaLlegadaMs = viajes.length
    ? Math.min(...viajes.map((v) => v.pedido.hora_solicitada.getTime()))
    : 0;

  for (const v of viajes) {
    const esFijo =
      v.estado === ESTADO_VIAJE_COMPLETADO || v.ts_inicio_carga_real != null;

    if (esFijo) {
      if (v.hora_inicio_carga) {
        ultimoInicioPorPedidoMs.set(v.pedido_id, v.hora_inicio_carga.getTime());
      }
      const finCarga =
        v.hora_fin_carga ??
        (v.hora_inicio_carga
          ? sumarMinutos(
              v.hora_inicio_carga,
              planta.tiempo_alistamiento_min +
                minutosDeCarga(v.volumen_asignado_m3, planta.capacidad_m3h),
            )
          : null);
      if (finCarga && (!plantaLibreEn || finCarga > plantaLibreEn)) {
        plantaLibreEn = finCarga;
      }
      if (v.mixer_id != null) {
        const fin = (v.hora_regreso_planta ?? finCarga)?.getTime();
        if (fin != null) {
          dispEnMs.set(v.mixer_id, Math.max(dispEnMs.get(v.mixer_id) ?? 0, fin));
        }
      }
      continue;
    }

    // Tiempo de transporte (ida): el override del pedido manda; si no, el del
    // cliente (fusionado desde la antigua tabla rutas_estandar). El regreso se
    // asume IGUAL a la ida. Null en ambos → default marcado visualmente.
    const cli = v.pedido.cliente;
    const transporteOverride = v.pedido.tiempo_transporte_min;
    const transporteCliente = cli.tiempo_viaje_referencia_min;
    const rutaPorDefecto = transporteOverride == null && transporteCliente == null;
    const tViaje =
      transporteOverride ?? transporteCliente ?? DEFAULT_TIEMPO_VIAJE_MIN;
    const tRegreso = tViaje; // ida = regreso
    // Tiempo de carga de este viaje (alistamiento + dosificación).
    const cargaMin =
      planta.tiempo_alistamiento_min +
      minutosDeCarga(v.volumen_asignado_m3, planta.capacidad_m3h);
    // Piso de inicio:
    //  · Solo el PRIMER viaje de la cola (planta aún libre) se ancla por la
    //    LLEGADA de jornada: inicio_carga = llegada − carga − salida − transporte.
    //    El resto NO se ancla a su hora solicitada: fluye tras el anterior según
    //    planta + disponibilidad de mixer.
    //  · Si el pedido tiene frecuencia entre camiones, respeta esa separación
    //    respecto al viaje anterior del MISMO pedido.
    const freq = v.pedido.frecuencia_entre_camiones_min;
    const previoMs = ultimoInicioPorPedidoMs.get(v.pedido_id);
    const pisoFrecuenciaMs =
      freq != null && previoMs != null ? previoMs + freq * 60000 : 0;
    const backwardMs = (cargaMin + MIN_SALIDA_TRAS_CARGA + tViaje) * 60000;
    // Ancla del inicio de carga:
    //  · Pedido con HORA FIJA (hora_bloqueada): su llegada = hora_solicitada
    //    exacta (piso duro) → inicio = hora_solicitada − transporte − carga. No se
    //    empaqueta junto al resto; puede dejar un hueco (p. ej. suministro de tarde).
    //  · Si no, solo el PRIMER viaje de la jornada se ancla al inicio de jornada.
    const anclaMs = v.pedido.hora_bloqueada
      ? v.pedido.hora_solicitada.getTime() - backwardMs
      : plantaLibreEn == null
        ? jornadaLlegadaMs - backwardMs
        : 0;
    const pisoMs = Math.max(anclaMs, pisoFrecuenciaMs);
    const plantaLibreMs = plantaLibreEn?.getTime() ?? 0;

    // Elegibles: mixers de la capacidad requerida. Si el viaje fue ajustado
    // manualmente, conserva su mixer (aunque no esté entre los candidatos).
    let elegibles: MetaMixer[];
    if (v.ajustado_manualmente && v.mixer_id != null) {
      const meta = metaTodos.get(v.mixer_id);
      elegibles = meta ? [meta] : [];
    } else {
      elegibles = candidatos.filter(
        (m) => m.capacidad_m3 === v.capacidad_asignada_m3,
      );
    }

    if (elegibles.length === 0) {
      // Ninguna unidad de esa capacidad: queda sin cubrir (sin horario).
      if (v.mixer_id != null || v.motivo_asignacion !== "Sin cubrir") {
        cambios.push(v.id);
      }
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
      continue;
    }

    // Escoger el mejor mixer: propio antes que hub, luego el que arranca más
    // temprano, luego el más "ocioso" (reparto de desgaste), luego id.
    const evaluado = elegibles
      .map((m) => {
        const dispMs = dispEnMs.get(m.id) ?? 0;
        const inicioMs = Math.max(plantaLibreMs, dispMs, pisoMs);
        const propio = m.plantel_base_id === plantel.id ? 0 : 1;
        return { m, dispMs, inicioMs, propio };
      })
      .sort(
        (a, b) =>
          a.propio - b.propio ||
          a.inicioMs - b.inicioMs ||
          a.dispMs - b.dispMs || // menor dispMs = lleva más tiempo libre
          a.m.id - b.m.id,
      )[0];

    const mixer = evaluado.m;
    const inicioCarga = new Date(evaluado.inicioMs);
    const finCarga = sumarMinutos(inicioCarga, cargaMin);
    const salidaPlanta = sumarMinutos(finCarga, MIN_SALIDA_TRAS_CARGA);
    const llegadaProyecto = sumarMinutos(salidaPlanta, tViaje);
    const inicioDescarga = llegadaProyecto;
    const finDescarga = sumarMinutos(
      inicioDescarga,
      minutosDeDescarga(v.volumen_asignado_m3, v.pedido.tipo_descarga),
    );
    const regresoPlanta = sumarMinutos(finDescarga, tRegreso);

    // La planta queda libre al terminar de cargar; el mixer, al regresar.
    plantaLibreEn = finCarga;
    dispEnMs.set(mixer.id, regresoPlanta.getTime());
    ultimoInicioPorPedidoMs.set(v.pedido_id, inicioCarga.getTime());

    // Procedencia: los ajustados (refuerzo, reasignación manual) conservan su
    // motivo; los automáticos se marcan propio/préstamo según el plantel base.
    const motivo = v.ajustado_manualmente
      ? (v.motivo_asignacion ?? "Flota propia")
      : mixer.plantel_base_id === plantel.id
        ? "Flota propia"
        : "Préstamo de zona";

    const cambio =
      v.mixer_id !== mixer.id ||
      !igualFecha(v.hora_inicio_carga, inicioCarga) ||
      !igualFecha(v.hora_regreso_planta, regresoPlanta);
    if (cambio) cambios.push(v.id);

    await prisma.viajes.update({
      where: { id: v.id },
      data: {
        mixer_id: mixer.id,
        capacidad_asignada_m3: mixer.capacidad_m3,
        motivo_asignacion: motivo,
        // El motorista sigue al mixer solo en asignaciones automáticas (una
        // reasignación/refuerzo manual ya fijó su propio operador).
        ...(v.ajustado_manualmente
          ? {}
          : { operador_id: mixer.operador_asignado_id }),
        hora_inicio_carga: inicioCarga,
        hora_fin_carga: finCarga,
        hora_salida_planta: salidaPlanta,
        hora_llegada_proyecto: llegadaProyecto,
        hora_inicio_descarga: inicioDescarga,
        hora_fin_descarga: finDescarga,
        hora_regreso_planta: regresoPlanta,
        ruta_por_defecto: rutaPorDefecto,
      },
    });
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
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: entrada.cliente_id,
      diseno_id: entrada.diseno_id,
      volumen_total_m3: entrada.volumen_total_m3,
      // Snapshot del volumen programado (línea base para medir adiciones del día).
      volumen_programado: entrada.volumen_total_m3,
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
    select: { planta_id: true, hora_solicitada: true },
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
      // Reprogramar redefine la línea base de volumen (no cuenta como adición).
      volumen_programado: entrada.volumen_total_m3,
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
  const capacidades = [...new Set(candidatos.map((m) => m.capacidad_m3))];

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
        capacidad: m.capacidad_m3,
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
  // llevaba el viaje, se recorta a la capacidad y el remanente se redistribuye.
  const nuevaCap = mixer.capacidad_m3;
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
  const plantasRecalc = new Set<number>([viaje.pedido.planta_id]);

  // ── Liberar los viajes futuros en conflicto y dejar que el motor los reasigne ──
  for (const o of conflictivos) {
    await prisma.viajes.update({
      where: { id: o.id },
      data: {
        mixer_id: null,
        ajustado_manualmente: false, // que la cascada le busque otro mixer
        operador_id: null,
        motivo_asignacion: "Flota propia", // tentativo; la cascada recomputa
        hora_inicio_carga: null,
        hora_fin_carga: null,
        hora_salida_planta: null,
        hora_llegada_proyecto: null,
        hora_inicio_descarga: null,
        hora_fin_descarga: null,
        hora_regreso_planta: null,
      },
    });
    viajesAfectados.push(o.id);
    plantasRecalc.add(o.pedido.planta_id);
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
      const caps = [...new Set(candidatos.map((m) => m.capacidad_m3))];
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

  // ── Recalcular la cascada de todas las plantas afectadas (target primero, para
  //    que la ocupación del mixer fijado se propague al resto). ──
  for (const pid of plantasRecalc) {
    await recalcularCascadaPlanta(pid, dia);
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

  await prisma.viajes.update({ where: { id: viajeId }, data: { planta_id: nuevaPlantaId } });
  // Recalcula el plantel completo (planta origen que libera el hueco + destino que
  // acomoda el viaje en su cola, respetando su capacidad m3/h).
  await recalcularCascadaPlanta(nuevaPlantaId, viaje.pedido.hora_solicitada);

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
    select: { planta_id: true, hora_solicitada: true },
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

  const cubierto = Math.min(mixer.capacidad_m3, faltante);

  const nuevo = await prisma.viajes.create({
    data: {
      pedido_id: pedidoId,
      mixer_id: mixerId,
      planta_id: pedido.planta_id, // refuerzo entra por la planta del pedido
      capacidad_asignada_m3: mixer.capacidad_m3,
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
  const viaje = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });

  const editable =
    (viaje.estado === "Programado" || viaje.estado === "En carga") &&
    viaje.ts_fin_carga_real == null;
  if (!editable) {
    return { ok: false, mensaje: "No editable: la carga ya finalizó." };
  }
  if (!(nuevoVolumen > 0)) {
    return { ok: false, mensaje: "El volumen debe ser mayor que 0." };
  }
  if (viaje.capacidad_asignada_m3 > 0 && nuevoVolumen > viaje.capacidad_asignada_m3) {
    return {
      ok: false,
      mensaje: `El volumen no puede exceder la capacidad del mixer (${viaje.capacidad_asignada_m3} m³).`,
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
