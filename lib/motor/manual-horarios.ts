// MODO MANUAL — ajuste de horarios desde la hora de LLEGADA comprometida.
//
// El dato que se negocia con el cliente es "el concreto tiene que estar en obra a las
// 8:00", no la hora de carga. Aquí el usuario fija esa llegada y el sistema arma el
// resto de la cadena: hacia ATRÁS la salida y la carga, hacia ADELANTE la descarga y
// el regreso. Y reacomoda los demás viajes DE ESE CLIENTE a la cadencia pedida.
//
// Sigue valiendo la regla central del modo manual: **el sistema no reprograma a
// terceros**. Los viajes de otros clientes no se tocan nunca; si el movimiento genera
// un cruce, se AVISA (las validaciones existentes lo marcan en pantalla) pero no se
// corrige solo. Tampoco se mueven los viajes con hora fija ni los que ya iniciaron:
// se saltan y se informa.

import { prisma } from "@/lib/prisma";
import { DEFAULT_TIEMPO_VIAJE_MIN, ESTADO_VIAJE_COMPLETADO } from "./config";
import { leerAperturaPlanta, msDeApertura, textoHoraMin } from "./apertura";
import { cadenciaActual, planificarReajusteCliente, type ViajeReajuste } from "./reajuste-cliente";
import {
  inicioDelDia,
  minutosCargaALlegada,
  tiemposDeViaje,
  tiemposDesdeLlegada,
  type ParamsTiempoViaje,
} from "./tiempos";

export interface ResultadoAjusteHorario {
  ok: boolean;
  mensaje?: string;
  /** Avisos NO bloqueantes para mostrar al usuario (apertura, saltos, simultaneidad). */
  avisos: string[];
  /** Cuántos viajes se movieron (incluye el editado). */
  movidos: number;
}

/** Hora local "8:05 a.m." para los avisos. */
function hhmm(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suf = h < 12 ? "a.m." : "p.m.";
  h = h % 12 || 12;
  return `${h}:${m} ${suf}`;
}

/** Datos que necesita un viaje para calcular su propia cadena. */
interface ViajeCalculo {
  id: number;
  plantaId: number;
  volumen: number;
  llegadaMs: number;
  horaFija: boolean;
  yaInicio: boolean;
  params: ParamsTiempoViaje;
}

/** Escribe en un viaje todos sus hitos derivados de la nueva LLEGADA. */
async function guardarDesdeLlegada(v: ViajeCalculo, llegadaMs: number): Promise<void> {
  const t = tiemposDesdeLlegada(llegadaMs, v.params);
  await prisma.viajes.update({
    where: { id: v.id },
    data: {
      ajustado_manualmente: true,
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
}

/**
 * Ajusta la hora de LLEGADA de un viaje y reacomoda la cola de su cliente.
 *
 * · Punto 1: recalcula la cadena completa del viaje editado (atrás y adelante).
 * · Punto 2: los siguientes viajes del MISMO pedido, en la MISMA planta, se recorren a
 *   `frecuencia_entre_camiones_min` de distancia entre llegadas. Los de hora fija o ya
 *   iniciados se saltan (y se avisa).
 * · Punto 3: si el pedido tiene carga simultánea en 2 plantas, el primer viaje de la
 *   otra planta se iguala a la MISMA hora de inicio de carga y su cola se recorre igual.
 * · Punto 4: si la carga resultante cae antes de la apertura de la planta, se avisa con
 *   la hora mínima disponible — sin bloquear.
 */
export async function ajustarLlegadaManual(
  viajeId: number,
  llegada: Date,
): Promise<ResultadoAjusteHorario> {
  const avisos: string[] = [];

  const viaje = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: {
      id: true,
      planta_id: true,
      estado: true,
      ts_inicio_carga_real: true,
      pedido: { select: { id: true } },
    },
  });
  if (!viaje || viaje.planta_id == null) {
    return { ok: false, mensaje: "Viaje no encontrado.", avisos, movidos: 0 };
  }
  if (viaje.estado === ESTADO_VIAJE_COMPLETADO || viaje.ts_inicio_carga_real != null) {
    return {
      ok: false,
      mensaje: "Ese viaje ya inició o se completó: no se puede mover.",
      avisos,
      movidos: 0,
    };
  }

  // Pedido completo con sus viajes: la cola del cliente que se va a reacomodar.
  const pedido = await prisma.pedidos.findUniqueOrThrow({
    where: { id: viaje.pedido.id },
    select: {
      id: true,
      tipo_descarga: true,
      tiempo_transporte_min: true,
      frecuencia_entre_camiones_min: true,
      carga_simultanea: true,
      hora_solicitada: true,
      cliente: { select: { tiempo_viaje_referencia_min: true } },
      viajes: {
        select: {
          id: true,
          planta_id: true,
          volumen_asignado_m3: true,
          hora_llegada_proyecto: true,
          hora_inicio_carga: true,
          hora_fija: true,
          estado: true,
          ts_inicio_carga_real: true,
          planta: { select: { id: true, capacidad_m3h: true, tiempo_alistamiento_min: true } },
        },
      },
    },
  });

  const transporteMin =
    pedido.tiempo_transporte_min ??
    pedido.cliente.tiempo_viaje_referencia_min ??
    DEFAULT_TIEMPO_VIAJE_MIN;

  // Normaliza los viajes del pedido a la forma de cálculo.
  const calculo: ViajeCalculo[] = pedido.viajes
    .filter((v) => v.planta != null && v.hora_llegada_proyecto != null)
    .map((v) => ({
      id: v.id,
      plantaId: v.planta!.id,
      volumen: v.volumen_asignado_m3,
      llegadaMs: v.hora_llegada_proyecto!.getTime(),
      horaFija: v.hora_fija,
      yaInicio: v.estado === ESTADO_VIAJE_COMPLETADO || v.ts_inicio_carga_real != null,
      params: {
        alistamientoMin: v.planta!.tiempo_alistamiento_min,
        capacidadPlantaM3h: v.planta!.capacidad_m3h,
        volumen: v.volumen_asignado_m3,
        tViajeMin: transporteMin,
        tRegresoMin: transporteMin,
        tipoDescarga: pedido.tipo_descarga,
      },
    }));
  const porId = new Map(calculo.map((v) => [v.id, v]));
  const editado = porId.get(viajeId);
  if (!editado) return { ok: false, mensaje: "Viaje sin horario base.", avisos, movidos: 0 };

  const dia = inicioDelDia(pedido.hora_solicitada);
  const llegadaMs = llegada.getTime();
  /** Viajes que este ajuste movió (para revisar después con quién chocan). */
  const movidosIds = new Set<number>();

  /** Aplica el reajuste de UNA planta a partir de la llegada de su viaje ancla. */
  const reacomodarPlanta = async (
    plantaId: number,
    anclaId: number,
    anclaLlegadaMs: number,
  ): Promise<number> => {
    const dePlanta = calculo.filter((v) => v.plantaId === plantaId);
    // Cadencia con la que se recorre la cola: la que pidió el asesor y, si el pedido
    // no la trae, la que la cola YA tenía (así el resto de los viajes del cliente
    // siempre se reacomodan y conservan su ritmo, en vez de quedarse atrás).
    const frecuencia =
      pedido.frecuencia_entre_camiones_min ?? cadenciaActual(dePlanta.map((v) => v.llegadaMs));
    const plan = planificarReajusteCliente(
      dePlanta.map<ViajeReajuste>((v) => ({
        id: v.id,
        llegadaMs: v.llegadaMs,
        horaFija: v.horaFija,
        yaInicio: v.yaInicio,
      })),
      anclaId,
      anclaLlegadaMs,
      frecuencia,
    );

    for (const c of plan.cambios) {
      const v = porId.get(c.id);
      if (v) {
        await guardarDesdeLlegada(v, c.llegadaMs);
        movidosIds.add(c.id);
      }
    }
    for (const s of plan.saltados) {
      const v = porId.get(s.id);
      avisos.push(
        s.motivo === "hora_fija"
          ? `Un viaje con hora fija (llegada ${hhmm(v?.llegadaMs ?? 0)}) quedó fuera del reajuste.`
          : `Un viaje que ya inició (llegada ${hhmm(v?.llegadaMs ?? 0)}) quedó fuera del reajuste.`,
      );
    }
    return plan.cambios.length;
  };

  // ── Punto 1 + 2: el viaje editado y la cola de su planta ───────────────────
  let movidos = await reacomodarPlanta(editado.plantaId, editado.id, llegadaMs);

  // ── Punto 4: aviso si la carga cae antes de la apertura de la planta ───────
  const inicioCargaMs = tiemposDesdeLlegada(llegadaMs, editado.params).inicioCargaMs;
  const apertura = await leerAperturaPlanta(editado.plantaId, dia);
  const aperturaMs = msDeApertura(dia, apertura.minutos);
  if (inicioCargaMs < aperturaMs) {
    // Hora de llegada MÍNIMA posible cargando justo a la apertura.
    const llegadaMinMs = aperturaMs + minutosCargaALlegada(editado.params) * 60_000;
    avisos.push(
      `Para llegar a las ${hhmm(llegadaMs)} habría que cargar a las ${hhmm(inicioCargaMs)}, ` +
        `antes de la apertura de la planta (${textoHoraMin(apertura.minutos)}${apertura.esExcepcion ? ", excepción de este día" : ""}). ` +
        `La llegada más temprana posible es ${hhmm(llegadaMinMs)}; si necesitas antes, adelanta la apertura de ese día.`,
    );
  }

  // ── Punto 3: carga simultánea en las 2 plantas ─────────────────────────────
  if (pedido.carga_simultanea) {
    const otras = [...new Set(calculo.map((v) => v.plantaId))].filter(
      (id) => id !== editado.plantaId,
    );
    for (const otraPlantaId of otras) {
      // Primer viaje (por llegada) de la otra planta: es el que debe arrancar a la par.
      const primera = calculo
        .filter((v) => v.plantaId === otraPlantaId)
        .sort((a, b) => a.llegadaMs - b.llegadaMs || a.id - b.id)[0];
      if (!primera) continue;
      if (primera.horaFija || primera.yaInicio) {
        avisos.push(
          "El primer viaje de la otra planta tiene hora fija o ya inició: no se igualó la carga simultánea.",
        );
        continue;
      }
      // Misma hora de INICIO DE CARGA; su llegada se deriva de sus propios tiempos
      // (volumen y capacidad de esa planta pueden diferir).
      const llegadaOtraMs =
        tiemposDeViaje(inicioCargaMs, primera.params).llegadaMs;
      const choque = await primeraHoraLibre(otraPlantaId, pedido.id, inicioCargaMs, primera);
      if (choque) {
        avisos.push(
          `La otra planta está ocupada con ${choque.cliente} a esa hora: podría arrancar a las ` +
            `${hhmm(choque.libreDesdeMs)}. Puedes mover a ese cliente, esperar, o continuar sin simultaneidad.`,
        );
      }
      movidos += await reacomodarPlanta(otraPlantaId, primera.id, llegadaOtraMs);
    }
  }

  // Choques con OTROS clientes tras el movimiento. Solo se AVISA: el modo manual no
  // corrige a terceros por su cuenta (la pantalla además los marca en rojo).
  avisos.push(...(await detectarChoques(pedido.id, [...movidosIds])));

  // La hora del PEDIDO representa la llegada de su primer viaje: se mantiene al día.
  const primeraLlegada = await prisma.viajes.findFirst({
    where: { pedido_id: pedido.id, hora_llegada_proyecto: { not: null } },
    orderBy: { hora_llegada_proyecto: "asc" },
    select: { hora_llegada_proyecto: true },
  });
  if (primeraLlegada?.hora_llegada_proyecto) {
    await prisma.pedidos.update({
      where: { id: pedido.id },
      data: { hora_solicitada: primeraLlegada.hora_llegada_proyecto },
    });
  }

  return { ok: true, avisos, movidos };
}

/**
 * Choques con OTROS clientes que dejó el movimiento. Devuelve avisos legibles; NO
 * corrige nada (el modo manual no reprograma a terceros — la pantalla además marca
 * esas filas en rojo). Dos tipos:
 *  · **Carga**: dos mixers no pueden estar cargando a la vez en la misma boca.
 *  · **Mixer**: el mismo mixer no puede estar en dos suministros a la vez (su ciclo va
 *    del inicio de carga al regreso a planta).
 */
async function detectarChoques(pedidoId: number, viajeIds: number[]): Promise<string[]> {
  if (viajeIds.length === 0) return [];
  const avisos: string[] = [];

  const movidos = await prisma.viajes.findMany({
    where: { id: { in: viajeIds } },
    select: {
      planta_id: true,
      mixer_id: true,
      hora_inicio_carga: true,
      hora_fin_carga: true,
      hora_regreso_planta: true,
      mixer: { select: { identificador: true } },
    },
  });

  for (const v of movidos) {
    if (!v.hora_inicio_carga || !v.hora_fin_carga) continue;

    // ── Choque de CARGA en la misma planta ──
    if (v.planta_id != null) {
      const enCarga = await prisma.viajes.findFirst({
        where: {
          planta_id: v.planta_id,
          pedido_id: { not: pedidoId },
          estado: { not: "Cancelado" },
          hora_inicio_carga: { lt: v.hora_fin_carga },
          hora_fin_carga: { gt: v.hora_inicio_carga },
        },
        orderBy: { hora_inicio_carga: "asc" },
        select: {
          hora_inicio_carga: true,
          pedido: { select: { cliente: { select: { empresa: true } } } },
        },
      });
      if (enCarga?.hora_inicio_carga) {
        avisos.push(
          `La carga de las ${hhmm(v.hora_inicio_carga.getTime())} se encima con la de ` +
            `${enCarga.pedido.cliente.empresa} (${hhmm(enCarga.hora_inicio_carga.getTime())}) en la misma planta.`,
        );
      }
    }

    // ── Choque del MIXER con el suministro de otro cliente ──
    if (v.mixer_id != null && v.hora_regreso_planta) {
      const mismoMixer = await prisma.viajes.findFirst({
        where: {
          mixer_id: v.mixer_id,
          pedido_id: { not: pedidoId },
          estado: { not: "Cancelado" },
          hora_inicio_carga: { lt: v.hora_regreso_planta },
          hora_regreso_planta: { gt: v.hora_inicio_carga },
        },
        orderBy: { hora_inicio_carga: "asc" },
        select: {
          hora_inicio_carga: true,
          pedido: { select: { cliente: { select: { empresa: true } } } },
        },
      });
      if (mismoMixer?.hora_inicio_carga) {
        avisos.push(
          `El mixer ${v.mixer?.identificador ?? ""} ya está en el suministro de ` +
            `${mismoMixer.pedido.cliente.empresa} (carga ${hhmm(mismoMixer.hora_inicio_carga.getTime())}): ` +
            "no puede hacer los dos viajes.",
        );
      }
    }
  }

  // Un mismo choque puede detectarse desde varios viajes movidos.
  return [...new Set(avisos)];
}

/**
 * ¿La boca de carga de `plantaId` está ocupada por OTRO pedido en la ventana de carga
 * que necesita este viaje? Devuelve con quién choca y desde cuándo quedaría libre.
 * Solo informa: no mueve a nadie.
 */
async function primeraHoraLibre(
  plantaId: number,
  pedidoId: number,
  inicioCargaMs: number,
  viaje: ViajeCalculo,
): Promise<{ cliente: string; libreDesdeMs: number } | null> {
  const t = tiemposDeViaje(inicioCargaMs, viaje.params);
  const ini = new Date(t.inicioCargaMs);
  const fin = new Date(t.finCargaMs);
  const ocupados = await prisma.viajes.findMany({
    where: {
      planta_id: plantaId,
      pedido_id: { not: pedidoId },
      hora_inicio_carga: { lt: fin },
      hora_fin_carga: { gt: ini },
    },
    orderBy: { hora_fin_carga: "desc" },
    select: {
      hora_fin_carga: true,
      pedido: { select: { cliente: { select: { empresa: true } } } },
    },
  });
  const choque = ocupados[0];
  if (!choque?.hora_fin_carga) return null;
  return {
    cliente: choque.pedido.cliente.empresa,
    libreDesdeMs: choque.hora_fin_carga.getTime(),
  };
}

/** Marca/desmarca la hora fija de un viaje (queda fuera de los reajustes por frecuencia). */
export async function fijarHoraViajeManual(
  viajeId: number,
  fija: boolean,
): Promise<{ ok: boolean; mensaje?: string }> {
  const viaje = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: { id: true },
  });
  if (!viaje) return { ok: false, mensaje: "Viaje no encontrado." };
  await prisma.viajes.update({ where: { id: viajeId }, data: { hora_fija: fija } });
  return { ok: true };
}
