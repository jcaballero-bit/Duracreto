"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { calcularAlcance, puedeOperarEnFecha, ESTADOS_LABORATORISTA } from "@/lib/auth/acceso";
import { alcanceActual } from "@/lib/auth/guard";
import { MOTIVOS_CANCELACION } from "@/lib/cancelacion";
import {
  avanzarEstadoViaje,
  cambiarOperadorViaje,
  cancelarPedido,
  cancelarPedidoConMotivo,
  confirmarRefuerzo,
  corregirHoraReal,
  editarVolumenViaje,
  mantenimientoDeUnidad,
  modificarPedido,
  programarPedido,
  reasignarMixer,
  reordenarPedidoDia,
  sugerirHoraDisponible,
  type CampoTsReal,
  type EntradaPedido,
  type ResultadoProgramacion,
} from "@/lib/motor/asignacion";

// ── Autorización server-side (rol + zona + reglas de fecha) ──────────────────

type Permiso = { ok: true } | { ok: false; mensaje: string };

/** ¿El usuario puede operar en la zona/plantel de este plantel? */
async function autorizarZonaPlantel(plantelId: number): Promise<Permiso> {
  const alcance = await alcanceActual();
  if (!alcance) return { ok: false, mensaje: "Sesión no válida." };
  if (alcance.esAdmin || alcance.esAsesor || alcance.esLaboratorista) return { ok: true };
  // JefePlanta / Dosificador: SOLO su plantel asignado (alcance por plantel).
  if (alcance.esJefePlanta || alcance.esDosificador) {
    return alcance.plantelAsignadoId === plantelId
      ? { ok: true }
      : { ok: false, mensaje: "Solo puedes operar tu plantel asignado." };
  }
  const plantel = await prisma.planteles.findUnique({
    where: { id: plantelId },
    select: { zona: true },
  });
  if (!plantel) return { ok: false, mensaje: "Plantel no encontrado." };
  if (!alcance.zonasPermitidas.includes(plantel.zona)) {
    return { ok: false, mensaje: "Sin permiso sobre la zona de ese plantel." };
  }
  return { ok: true };
}

/** Autoriza crear/modificar: zona del plantel + regla de fecha del rol. */
async function autorizarNuevoPedido(
  plantelId: number,
  fecha: Date,
): Promise<Permiso> {
  const zona = await autorizarZonaPlantel(plantelId);
  if (!zona.ok) return zona;
  const alcance = await alcanceActual();
  if (alcance && !puedeOperarEnFecha(alcance, fecha, new Date())) {
    return {
      ok: false,
      mensaje:
        "Tu rol no permite programar en esa fecha (Programador: hoy en adelante; Despachador: solo hoy).",
    };
  }
  return { ok: true };
}

/** Regla de fecha del rol para operar un pedido (Programador: hoy en adelante;
 *  Despachador: solo hoy; Admin: cualquiera). */
async function autorizarFecha(fecha: Date): Promise<Permiso> {
  const alcance = await alcanceActual();
  if (!alcance) return { ok: false, mensaje: "Sesión no válida." };
  if (puedeOperarEnFecha(alcance, fecha, new Date())) return { ok: true };
  return {
    ok: false,
    mensaje:
      "Tu rol no permite operar en esa fecha (Programador: hoy en adelante; Despachador: solo hoy).",
  };
}

/** Autoriza operar sobre un pedido existente (zona + fecha del rol). */
async function autorizarPorPedido(pedidoId: number): Promise<Permiso> {
  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: { plantel_id: true, hora_solicitada: true },
  });
  if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };
  const zona = await autorizarZonaPlantel(pedido.plantel_id);
  if (!zona.ok) return zona;
  return autorizarFecha(pedido.hora_solicitada);
}

/** Rechaza si la bomba elegida tiene mantenimiento/baja que cubre la fecha del
 *  pedido (Hito 6). Devuelve mensaje o null si está libre. */
async function validarBombaMantenimiento(entrada: EntradaPedido): Promise<string | null> {
  if (entrada.bomba_id == null) return null;
  const mant = await mantenimientoDeUnidad("Bomba", entrada.bomba_id, entrada.hora_solicitada);
  if (!mant) return null;
  const fmt = (d: Date) =>
    d.toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric" });
  const etq = mant.tipo_evento === "Mantenimiento_Programado" ? "mantenimiento programado" : "baja de servicio";
  return `La bomba elegida tiene ${etq} del ${fmt(mant.fecha_inicio)} al ${fmt(mant.fecha_fin)} — no se puede asignar en esa fecha.`;
}

/** Autoriza operar sobre un viaje (zona + fecha del rol, por su pedido). */
async function autorizarPorViaje(viajeId: number): Promise<Permiso> {
  const viaje = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: { pedido: { select: { plantel_id: true, hora_solicitada: true } } },
  });
  if (!viaje) return { ok: false, mensaje: "Viaje no encontrado." };
  const zona = await autorizarZonaPlantel(viaje.pedido.plantel_id);
  if (!zona.ok) return zona;
  return autorizarFecha(viaje.pedido.hora_solicitada);
}

/** Solo estos roles editan CAMPOS del viaje (volumen/mixer/motorista/hora real).
 *  Laboratorista, Asesor y JefeLaboratorio NO. */
async function autorizarEdicionCampos(): Promise<Permiso> {
  const a = await alcanceActual();
  if (!a) return { ok: false, mensaje: "Sesión no válida." };
  if (a.esAdmin || a.esDespachador || a.esJefePlanta || a.esDosificador) return { ok: true };
  return { ok: false, mensaje: "Tu rol no permite editar este dato del viaje." };
}

/** ¿El viaje pertenece a un PROGRAMA (pedido) asignado a este laboratorista? */
async function viajeEsDeLaboratorista(viajeId: number, userId: string): Promise<boolean> {
  const v = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: { pedido: { select: { asignacion_lab: { select: { laboratorista_id: true } } } } },
  });
  return v?.pedido.asignacion_lab?.laboratorista_id === userId;
}

export interface EstadoFormulario {
  ok: boolean;
  mensaje?: string;
  resultado?: {
    pedidoId: number;
    volumenSinCubrir: number;
    viajes: Array<{
      id: number;
      mixerLabel: string | null;
      flota: string | null;
      flotaPropia: boolean;
      capacidad: number;
      volumen: number;
      origen: string;
      rutaPorDefecto: boolean;
      horaCarga: string | null;
      horaRegreso: string | null;
    }>;
    sugerencias: Array<{
      mixerId: number;
      identificador: string | null;
      capacidad: number;
      plantelNombre: string;
      holguraPlantel: number;
    }>;
    alertas: Array<{
      tipoUnidad: "mixer" | "bomba";
      unidadId: number;
      viajeAnteriorId: number;
      viajeSiguienteId: number;
      margenMin: number;
    }>;
    recalculados: number[];
  };
}

function fmtHora(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Lee y valida los campos del formulario de pedido en una EntradaPedido. */
function construirEntrada(
  formData: FormData,
  creadoPor: string,
): { entrada?: EntradaPedido; error?: string } {
  const volumen = Number(formData.get("volumen_total_m3"));
  const horaStr = String(formData.get("hora_solicitada"));
  const hielo = Number(formData.get("sacos_hielo_por_m3") ?? 0) || 0;
  if (!volumen || volumen <= 0) {
    return { error: "El volumen debe ser mayor que 0." };
  }
  if (!horaStr) {
    return { error: "Debe indicar la fecha y hora solicitada." };
  }
  if (!Number.isInteger(hielo) || hielo < 0 || hielo > 10) {
    return { error: "El hielo (sacos) debe ser un entero entre 0 y 10." };
  }
  return {
    entrada: {
      cliente_id: Number(formData.get("cliente_id")),
      diseno_id: Number(formData.get("diseno_id")),
      volumen_total_m3: volumen,
      hora_solicitada: new Date(horaStr),
      plantel_id: Number(formData.get("plantel_id")),
      planta_id: Number(formData.get("planta_id")),
      bomba_id: Number(formData.get("bomba_id")) || null,
      tipo_descarga: String(formData.get("tipo_descarga")),
      sacos_hielo_por_m3: hielo,
      asesor_id: Number(formData.get("asesor_id")) || null,
      hora_bloqueada: !!formData.get("hora_bloqueada"),
      frecuencia_entre_camiones_min:
        Number(formData.get("frecuencia_entre_camiones_min")) || null,
      tiempo_transporte_min:
        Number(formData.get("tiempo_transporte_min")) || null,
      elemento: String(formData.get("elemento") || "") || null,
      ubicacion_detalle: String(formData.get("ubicacion_detalle") || "") || null,
      creado_por: creadoPor,
    },
  };
}

/** Aplana el resultado del motor a la forma serializable del formulario. */
function mapResultado(r: ResultadoProgramacion): EstadoFormulario["resultado"] {
  return {
    pedidoId: r.pedidoId,
    volumenSinCubrir: r.volumenSinCubrir,
    viajes: r.viajes.map((v) => ({
      id: v.id,
      mixerLabel: v.mixerLabel,
      flota: v.flota,
      flotaPropia: v.flotaPropia,
      capacidad: v.capacidad,
      volumen: v.volumen,
      origen: v.origen,
      rutaPorDefecto: v.rutaPorDefecto,
      horaCarga: fmtHora(v.hora_inicio_carga),
      horaRegreso: fmtHora(v.hora_regreso_planta),
    })),
    sugerencias: r.sugerenciasRefuerzo.map((s) => ({
      mixerId: s.mixerId,
      identificador: s.identificador,
      capacidad: s.capacidad,
      plantelNombre: s.plantelNombre,
      holguraPlantel: s.holguraPlantel,
    })),
    alertas: r.alertasMargen.map((a) => ({
      tipoUnidad: a.tipoUnidad,
      unidadId: a.unidadId,
      viajeAnteriorId: a.viajeAnteriorId,
      viajeSiguienteId: a.viajeSiguienteId,
      margenMin: a.margenMin,
    })),
    recalculados: r.viajesRecalculados,
  };
}

function revalidarPantallas() {
  revalidatePath("/");
  revalidatePath("/programacion");
  revalidatePath("/despacho");
}

/** Server action: crea y programa un pedido a partir del formulario. */
export async function crearPedidoAction(
  _prev: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    const { entrada, error } = construirEntrada(formData, "interfaz-prueba");
    if (error) return { ok: false, mensaje: error };
    const permiso = await autorizarNuevoPedido(
      entrada!.plantel_id,
      entrada!.hora_solicitada,
    );
    if (!permiso.ok) return { ok: false, mensaje: permiso.mensaje };
    const errBomba = await validarBombaMantenimiento(entrada!);
    if (errBomba) return { ok: false, mensaje: errBomba };
    const r = await programarPedido(entrada!);

    // Si el pedido nació de una solicitud anticipada (proyección semanal),
    // vincularla y marcarla como Programado (deja de estar Pendiente).
    const solicitudId = Number(formData.get("solicitud_id")) || null;
    if (solicitudId) {
      await prisma.solicitudes_anticipadas.update({
        where: { id: solicitudId },
        data: { estado: "Programado", pedido_id: r.pedidoId },
      });
      revalidatePath("/clientes/semana");
    }

    revalidarPantallas();
    return { ok: true, resultado: mapResultado(r) };
  } catch (e) {
    return {
      ok: false,
      mensaje: e instanceof Error ? e.message : "Error inesperado al programar.",
    };
  }
}

/**
 * Server action: modifica un pedido existente y re-corre el motor. El pedidoId
 * se enlaza en el cliente con .bind(null, pedidoId).
 */
export async function modificarPedidoAction(
  pedidoId: number,
  _prev: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    const { entrada, error } = construirEntrada(formData, "edicion");
    if (error) return { ok: false, mensaje: error };
    // Permiso sobre el pedido original y sobre el destino (zona) + fecha.
    const permisoOrigen = await autorizarPorPedido(pedidoId);
    if (!permisoOrigen.ok) return { ok: false, mensaje: permisoOrigen.mensaje };
    const permisoDestino = await autorizarNuevoPedido(
      entrada!.plantel_id,
      entrada!.hora_solicitada,
    );
    if (!permisoDestino.ok) return { ok: false, mensaje: permisoDestino.mensaje };
    const errBomba = await validarBombaMantenimiento(entrada!);
    if (errBomba) return { ok: false, mensaje: errBomba };
    const r = await modificarPedido(pedidoId, entrada!);
    revalidarPantallas();
    return { ok: true, resultado: mapResultado(r) };
  } catch (e) {
    return {
      ok: false,
      mensaje: e instanceof Error ? e.message : "Error inesperado al modificar.",
    };
  }
}

/**
 * Server action: reordena un pedido dentro de su plantel+fecha (el Programador
 * escribe un nuevo número). Reacomoda el resto y recalcula los horarios. Valida
 * zona + fecha del rol y registra en bitácora (dentro del motor).
 */
export async function reordenarPedidoAction(
  pedidoId: number,
  nuevoOrden: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const permiso = await autorizarPorPedido(pedidoId);
  if (!permiso.ok) return permiso;
  if (!Number.isFinite(nuevoOrden) || nuevoOrden < 1) {
    return { ok: false, mensaje: "El orden debe ser un número mayor o igual a 1." };
  }
  const sesion = await auth();
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "programador";
  const res = await reordenarPedidoDia(pedidoId, nuevoOrden, quien);
  if (res.ok) revalidarPantallas();
  return { ok: res.ok, mensaje: res.mensaje };
}

/**
 * Server action: sugiere la próxima hora disponible de una planta ese día (para
 * pre-llenar el formulario de Nuevo pedido). Devuelve "YYYY-MM-DDTHH:mm" local.
 */
export async function sugerirHoraSolicitadaAction(
  plantaId: number,
  fechaISO: string, // "YYYY-MM-DD"
  volumen = 0,
  clienteId?: number,
): Promise<{ ok: boolean; horaLocal?: string; mensaje?: string }> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!plantaId || !m) return { ok: false, mensaje: "Datos inválidos." };
  const planta = await prisma.plantas.findUnique({
    where: { id: plantaId },
    select: { plantel_id: true },
  });
  if (!planta) return { ok: false, mensaje: "Planta no encontrada." };
  const permiso = await autorizarZonaPlantel(planta.plantel_id);
  if (!permiso.ok) return { ok: false, mensaje: permiso.mensaje };

  const dia = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const fecha = await sugerirHoraDisponible(plantaId, dia, volumen, clienteId);
  const p = (n: number) => String(n).padStart(2, "0");
  const horaLocal = `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}T${p(fecha.getHours())}:${p(fecha.getMinutes())}`;
  return { ok: true, horaLocal };
}

/** Server action: reasignación manual de mixer. */
export async function reasignarMixerAction(
  viajeId: number,
  nuevoMixerId: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const permiso = await autorizarPorViaje(viajeId);
  if (!permiso.ok) return permiso;
  const ed = await autorizarEdicionCampos();
  if (!ed.ok) return ed;
  const res = await reasignarMixer(viajeId, nuevoMixerId);
  if (res.ok) revalidarPantallas();
  return { ok: res.ok, mensaje: res.motivo };
}

/**
 * Server action: avanza el estado de un viaje (despacho en vivo). Sella la hora
 * REAL con la hora del SERVIDOR (no la del dispositivo). El servidor valida que
 * `nuevoEstado` sea exactamente el siguiente de la secuencia.
 */
export async function avanzarEstadoAction(
  viajeId: number,
  nuevoEstado: string,
): Promise<{ ok: boolean; estado?: string; mensaje?: string }> {
  const permiso = await autorizarPorViaje(viajeId);
  if (!permiso.ok) return permiso;

  // Restricciones de rol para avanzar estados.
  const alcance = await alcanceActual();
  const rolPlenoDespacho =
    alcance?.esAdmin || alcance?.esDespachador || alcance?.esJefePlanta || alcance?.esDosificador;
  if (alcance && !rolPlenoDespacho) {
    if (alcance.esLaboratorista) {
      // Laboratorista: solo Llegada/Descargando/Regresando y solo sus proyectos.
      if (!(ESTADOS_LABORATORISTA as readonly string[]).includes(nuevoEstado)) {
        return { ok: false, mensaje: "Como Laboratorista solo puedes marcar Llegada, Descargando o Regresando." };
      }
      const sesion = await auth();
      const uid = sesion?.user?.id ?? "";
      if (!(await viajeEsDeLaboratorista(viajeId, uid))) {
        return { ok: false, mensaje: "Ese viaje no es de un proyecto asignado a ti." };
      }
    } else {
      return { ok: false, mensaje: "Tu rol no permite avanzar el estado de los viajes." };
    }
  }

  const res = await avanzarEstadoViaje(viajeId, nuevoEstado);
  if (res.ok) revalidarPantallas();
  return res;
}

/** Server action: ajuste de volumen de un viaje (gate + auditoría en el motor). */
export async function editarVolumenAction(
  viajeId: number,
  nuevoVolumen: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const permiso = await autorizarPorViaje(viajeId);
  if (!permiso.ok) return permiso;
  const ed = await autorizarEdicionCampos();
  if (!ed.ok) return ed;
  const res = await editarVolumenViaje(viajeId, nuevoVolumen, "despachador");
  if (res.ok) revalidarPantallas();
  return res;
}

/** Server action: confirma un mixer de refuerzo (Paso 3) para un pedido. */
export async function confirmarRefuerzoAction(
  pedidoId: number,
  mixerId: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const permiso = await autorizarPorPedido(pedidoId);
  if (!permiso.ok) return permiso;
  const res = await confirmarRefuerzo(pedidoId, mixerId);
  if (res.ok) revalidarPantallas();
  return res;
}

/** Server action: cambia el motorista de un viaje. */
export async function cambiarOperadorAction(
  viajeId: number,
  operadorId: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const permiso = await autorizarPorViaje(viajeId);
  if (!permiso.ok) return permiso;
  const ed = await autorizarEdicionCampos();
  if (!ed.ok) return ed;
  const res = await cambiarOperadorViaje(viajeId, operadorId);
  if (res.ok) revalidarPantallas();
  return res;
}

/**
 * Server action: corrige manualmente una hora real ya capturada. Valida el
 * orden lógico y registra el cambio en bitácora. Recibe la hora como string
 * datetime-local; el usuario es placeholder hasta la Fase 3 (auth).
 */
export async function corregirHoraRealAction(
  viajeId: number,
  campo: CampoTsReal,
  valorLocal: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  if (!valorLocal) return { ok: false, mensaje: "Hora inválida." };
  const permiso = await autorizarPorViaje(viajeId);
  if (!permiso.ok) return permiso;
  const ed = await autorizarEdicionCampos();
  if (!ed.ok) return ed;
  const res = await corregirHoraReal(
    viajeId,
    campo,
    new Date(valorLocal),
    "despachador", // [fase futura] usuario real desde la sesión (Fase 3)
  );
  if (res.ok) revalidarPantallas();
  return res;
}

/**
 * Server action: el Asesor (o Admin) confirma un pedido de su cliente. Marca los
 * viajes como Confirmado, sella quién/cuándo y registra en bitácora.
 */
export async function confirmarPedidoAsesorAction(
  pedidoId: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };
  const alcance = calcularAlcance(
    sesion.user.roles ?? [],
    sesion.user.zona ?? null,
  );
  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    include: { cliente: { include: { asesor: true } } },
  });
  if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };

  const esSuCliente = pedido.cliente.asesor?.usuario_auth_id === sesion.user.id;
  if (!alcance.esAdmin && !(alcance.esAsesor && esSuCliente)) {
    return { ok: false, mensaje: "No puedes confirmar este pedido." };
  }

  const ahora = new Date();
  const quien = sesion.user.name ?? sesion.user.email ?? "asesor";
  await prisma.viajes.updateMany({
    where: { pedido_id: pedidoId },
    data: {
      estado_confirmacion: "Confirmado",
      fecha_hora_confirmacion: ahora,
      usuario_confirmo: quien,
    },
  });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "pedidos",
      registro_id: pedidoId,
      usuario: quien,
      campo_modificado: "estado_confirmacion",
      valor_anterior: "Pendiente",
      valor_nuevo: "Confirmado",
      motivo: "Confirmación de asesor",
    },
  });
  revalidatePath("/confirmaciones");
  revalidatePath("/programacion");
  return { ok: true };
}

/**
 * Server action: CANCELA un pedido con motivo (lo marca, no lo borra). Disponible
 * para Programador/Despachador/Admin (zona + regla de fecha del rol). El motivo
 * debe ser uno de la lista fija; "Otro" exige un detalle. Queda para el indicador
 * comercial (por asesor) y la bitácora.
 */
export async function cancelarPedidoAction(
  pedidoId: number,
  motivo: string,
  detalle?: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  try {
    const permiso = await autorizarPorPedido(pedidoId);
    if (!permiso.ok) return permiso;

    if (!MOTIVOS_CANCELACION.includes(motivo as (typeof MOTIVOS_CANCELACION)[number])) {
      return { ok: false, mensaje: "Motivo de cancelación no válido." };
    }
    const detalleLimpio = (detalle ?? "").trim();
    if (motivo === "Otro" && !detalleLimpio) {
      return { ok: false, mensaje: "Indica la causa de la cancelación (motivo 'Otro')." };
    }

    const sesion = await auth();
    const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";

    // Datos previos para la bitácora (cliente/volumen).
    const antes = await prisma.pedidos.findUnique({
      where: { id: pedidoId },
      select: { volumen_total_m3: true, cliente: { select: { empresa: true } } },
    });

    await cancelarPedidoConMotivo(pedidoId, motivo, detalleLimpio || null, quien);

    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "pedidos",
        registro_id: pedidoId,
        usuario: quien,
        campo_modificado: "estado_pedido",
        valor_anterior: "Activo",
        valor_nuevo: "Cancelado",
        motivo: motivo === "Otro" ? `Otro: ${detalleLimpio}` : motivo,
      },
    });

    void antes; // (datos disponibles por si se amplía el detalle de bitácora)
    revalidarPantallas();
    revalidatePath("/comercial");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      mensaje: e instanceof Error ? e.message : "No se pudo cancelar el pedido.",
    };
  }
}

/**
 * Server action: cancela (elimina) un pedido. Recalcula la cascada de horarios
 * de la planta afectada para ese día (vía cancelarPedido en el motor).
 */
export async function eliminarPedidoAction(
  pedidoId: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  try {
    const permiso = await autorizarPorPedido(pedidoId);
    if (!permiso.ok) return permiso;
    await cancelarPedido(pedidoId);
    revalidatePath("/");
    revalidatePath("/programacion");
    revalidatePath("/despacho");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      mensaje: e instanceof Error ? e.message : "No se pudo eliminar el pedido.",
    };
  }
}
