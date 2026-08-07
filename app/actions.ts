"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { calcularAlcance, puedeOperarEnFecha, ESTADOS_LABORATORISTA } from "@/lib/auth/acceso";
import { alcanceActual } from "@/lib/auth/guard";
import { MOTIVOS_CANCELACION } from "@/lib/cancelacion";
import { PERMITIR_HORA_CARGA_MANUAL, UMBRAL_IMPACTO_INSERCION_MIN } from "@/lib/motor/config";
import {
  agregarVolumenAlPedido,
  avanzarEstadoViaje,
  cambiarOperadorViaje,
  cambiarPlantaViaje,
  cancelarPedido,
  cancelarPedidoConMotivo,
  confirmarRefuerzo,
  corregirHoraReal,
  editarVolumenViaje,
  llegadasPorPlanta,
  mantenimientoDeUnidad,
  modificarPedido,
  programarPedido,
  reasignarMixer,
  recalcularCascadaPlanta,
  recalcularTransportePromedioCliente,
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
  // Jefe de Planta: SOLO sus planteles asignados (M2M). Puede operar CUALQUIERA de
  // ellos (programar/hacer adiciones), no otros.
  if (alcance.esJefePlanta) {
    return alcance.plantelesAsignados.includes(plantelId)
      ? { ok: true }
      : { ok: false, mensaje: "Solo puedes operar tus planteles asignados." };
  }
  // Dosificador: SOLO su plantel asignado (alcance fino por plantel/planta).
  if (alcance.esDosificador) {
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

/** Autoriza operar sobre un viaje (zona + fecha del rol, por su pedido). Además,
 *  el Dosificador queda acotado a SU planta asignada: solo puede operar (avanzar
 *  estado, incl. "Completado" al regresar el mixer; editar) los viajes de su propia
 *  planta, no los de otra planta del mismo plantel (punto 14). No aplica a quienes
 *  también tienen un rol de despacho más amplio (Admin/Despachador/JefePlanta). */
async function autorizarPorViaje(viajeId: number): Promise<Permiso> {
  const viaje = await prisma.viajes.findUnique({
    where: { id: viajeId },
    select: { planta_id: true, pedido: { select: { plantel_id: true, hora_solicitada: true } } },
  });
  if (!viaje) return { ok: false, mensaje: "Viaje no encontrado." };
  const zona = await autorizarZonaPlantel(viaje.pedido.plantel_id);
  if (!zona.ok) return zona;

  const a = await alcanceActual();
  const dosificadorPuro =
    !!a &&
    a.esDosificador &&
    !a.esAdmin &&
    !a.esDespachador &&
    !a.esJefePlanta &&
    !a.esProgramador;
  if (dosificadorPuro && a.plantaAsignadaId != null && viaje.planta_id !== a.plantaAsignadaId) {
    return { ok: false, mensaje: "Solo puedes operar los viajes de tu planta asignada." };
  }

  return autorizarFecha(viaje.pedido.hora_solicitada);
}

/** Roles que pueden CREAR/MODIFICAR/CANCELAR/ELIMINAR/REORDENAR pedidos y confirmar
 *  refuerzos. Solo Admin, Programador, Despachador, Jefe de Planta y Dosificador.
 *  Excluye explícitamente Laboratorista, Asesor, GerenteComercial y JefeLaboratorio:
 *  esos roles NO operan pedidos (solo consultan o avanzan estados de SUS viajes). Sin
 *  este gate, un Laboratorista pasaba zona+fecha y podía crear/cancelar/eliminar
 *  cualquier pedido del día en ambas zonas. */
async function autorizarOperacionPedido(): Promise<Permiso> {
  const a = await alcanceActual();
  if (!a) return { ok: false, mensaje: "Sesión no válida." };
  if (a.esAdmin || a.esProgramador || a.esDespachador || a.esJefePlanta || a.esDosificador) {
    return { ok: true };
  }
  return { ok: false, mensaje: "Tu rol no permite crear ni modificar pedidos." };
}

/** El mixer que se reasigna debe pertenecer a la ZONA del operador (se permiten
 *  préstamos intra-zona / hub, pero NO tomar flota de la OTRA zona — las dos
 *  restricciones de flota son independientes por zona). Admin: cualquiera. */
async function autorizarMixerDeZona(mixerId: number): Promise<Permiso> {
  const a = await alcanceActual();
  if (!a) return { ok: false, mensaje: "Sesión no válida." };
  if (a.esAdmin) return { ok: true };
  const mixer = await prisma.mixers.findUnique({
    where: { id: mixerId },
    select: { plantel_base: { select: { zona: true } } },
  });
  if (!mixer?.plantel_base) return { ok: false, mensaje: "Mixer sin plantel base válido." };
  // Zona(s) del operador: Programador/Despachador por User.zona; Dosificador por la
  // zona de su plantel asignado; Jefe de Planta por las zonas de SUS planteles (M2M).
  const zonas = new Set<string>();
  if (a.zona) zonas.add(a.zona);
  if (a.plantelAsignadoId != null) {
    const mio = await prisma.planteles.findUnique({
      where: { id: a.plantelAsignadoId },
      select: { zona: true },
    });
    if (mio) zonas.add(mio.zona);
  }
  if (a.plantelesAsignados.length > 0) {
    const suyos = await prisma.planteles.findMany({
      where: { id: { in: a.plantelesAsignados } },
      select: { zona: true },
    });
    for (const p of suyos) zonas.add(p.zona);
  }
  // Sin zona resoluble → no bloquear (fallback); si hay zona, debe coincidir.
  if (zonas.size === 0 || zonas.has(mixer.plantel_base.zona)) return { ok: true };
  return { ok: false, mensaje: "Ese mixer es de otra zona; no puedes asignarlo." };
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
  // El pedido retrasaría a un cliente ya programado más del umbral: se revirtió y
  // se pide confirmación explícita para continuar (reenviar con confirmar_impacto).
  requiereConfirmacion?: boolean;
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
    // Carga simultánea: si una planta no pudo arrancar a la vez (ocupada), avisa
    // cuál y por cuántos minutos. null/undefined = arrancaron juntas o no aplica.
    avisoSimultaneidad?: { plantaTarde: string; minutosDiferencia: number } | null;
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
      revenimiento: String(formData.get("revenimiento") || "") || null,
      tipo_servicio: String(formData.get("tipo_servicio") || "") || null,
      sacos_hielo_por_m3: hielo,
      asesor_id: Number(formData.get("asesor_id")) || null,
      hora_bloqueada: !!formData.get("hora_bloqueada"),
      usar_ambas_plantas: !!formData.get("usar_ambas_plantas"),
      carga_simultanea: !!formData.get("carga_simultanea"),
      carga_reducida: !!formData.get("carga_reducida"),
      es_adicion: !!formData.get("es_adicion"),
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
    avisoSimultaneidad: r.avisoSimultaneidad ?? null,
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
    const op = await autorizarOperacionPedido();
    if (!op.ok) return { ok: false, mensaje: op.mensaje };
    const permiso = await autorizarNuevoPedido(
      entrada!.plantel_id,
      entrada!.hora_solicitada,
    );
    if (!permiso.ok) return { ok: false, mensaje: permiso.mensaje };
    const errBomba = await validarBombaMantenimiento(entrada!);
    if (errBomba) return { ok: false, mensaje: errBomba };

    // Impacto sobre la cola ya programada: snapshot de las llegadas ANTES de insertar.
    const llegadasAntes = await llegadasPorPlanta(
      entrada!.planta_id,
      entrada!.hora_solicitada,
    );

    const r = await programarPedido(entrada!);

    // Si insertar este pedido retrasa la LLEGADA esperada de algún cliente ya
    // programado más que el umbral, se REVIERTE y se pide confirmación explícita.
    // Los pedidos con hora fija (hora_bloqueada) no se mueven, así que no disparan
    // la advertencia. El Programador puede reenviar con confirmar_impacto=1.
    const confirmarImpacto = !!formData.get("confirmar_impacto");
    if (!confirmarImpacto) {
      const llegadasDespues = await llegadasPorPlanta(
        entrada!.planta_id,
        entrada!.hora_solicitada,
      );
      let peor: { cliente: string; delta: number } | null = null;
      for (const [pid, antes] of llegadasAntes) {
        const despues = llegadasDespues.get(pid);
        if (!despues) continue;
        const delta = Math.round((despues.ms - antes.ms) / 60000);
        if (delta > UMBRAL_IMPACTO_INSERCION_MIN && (!peor || delta > peor.delta)) {
          peor = { cliente: antes.cliente, delta };
        }
      }
      if (peor) {
        // Revertir la inserción (aún no se confirma) y restaurar la cascada.
        await prisma.viajes.deleteMany({ where: { pedido_id: r.pedidoId } });
        await prisma.pedidos.delete({ where: { id: r.pedidoId } });
        await recalcularCascadaPlanta(entrada!.planta_id, entrada!.hora_solicitada);
        return {
          ok: false,
          requiereConfirmacion: true,
          mensaje: `Insertar este pedido va a retrasar la llegada a ${peor.cliente} en aproximadamente ${peor.delta} minutos. ¿Deseas continuar?`,
        };
      }
    }

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
    const op = await autorizarOperacionPedido();
    if (!op.ok) return { ok: false, mensaje: op.mensaje };
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
  const op = await autorizarOperacionPedido();
  if (!op.ok) return op;
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
  // El mixer destino debe ser de la zona del operador (no tomar flota de otra zona).
  const zonaMixer = await autorizarMixerDeZona(nuevoMixerId);
  if (!zonaMixer.ok) return zonaMixer;
  const res = await reasignarMixer(viajeId, nuevoMixerId);
  if (!res.ok) return { ok: false, mensaje: res.motivo };

  // Bitácora: quién reasignó, a qué mixer y qué viajes se vieron afectados
  // (liberados/reprogramados o con volumen absorbido) + remanente sin cubrir.
  const sesion = await auth();
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "usuario";
  const afectados = [...(res.viajesAfectados ?? []), ...(res.viajesAgregados ?? [])];
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "viajes",
      registro_id: viajeId,
      usuario: quien,
      campo_modificado: "mixer_id",
      valor_anterior: null,
      valor_nuevo: `Mixer ${nuevoMixerId}`,
      motivo:
        "Reasignacion manual de mixer" +
        (afectados.length ? ` (viajes afectados: ${afectados.join(", ")})` : "") +
        (res.volumenSinCubrir && res.volumenSinCubrir > 0
          ? ` - ${res.volumenSinCubrir} m3 sin cubrir`
          : ""),
    },
  });

  revalidarPantallas();
  return { ok: true, mensaje: res.aviso };
}

/**
 * Server action: cambia la PLANTA dosificadora de un viaje (Despacho en vivo). Lo
 * usa el Despachador (o Admin/Jefe de Planta) cuando una planta se satura/falla y
 * hay que mover viajes pendientes a la otra planta del plantel. El Dosificador NO
 * (está acotado a su planta). Revalida (planta del mismo plantel), recalcula la
 * cascada del plantel y registra en bitácora.
 */
export async function cambiarPlantaViajeAction(
  viajeId: number,
  plantaId: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  try {
    const permiso = await autorizarPorViaje(viajeId);
    if (!permiso.ok) return permiso;
    const a = await alcanceActual();
    if (!a || !(a.esAdmin || a.esDespachador || a.esJefePlanta)) {
      return { ok: false, mensaje: "Tu rol no permite cambiar la planta del viaje." };
    }
    const res = await cambiarPlantaViaje(viajeId, plantaId);
    if (!res.ok) return { ok: false, mensaje: res.mensaje };

    const sesion = await auth();
    const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "viajes",
        registro_id: viajeId,
        usuario: quien,
        campo_modificado: "planta_id",
        valor_anterior: res.plantaAnterior ?? null,
        valor_nuevo: res.plantaNueva ?? String(plantaId),
        motivo: "Cambio de planta dosificadora (despacho)",
      },
    });

    revalidarPantallas();
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "No se pudo cambiar la planta." };
  }
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
  if (res.ok) {
    // Al sellar la LLEGADA hay un nuevo dato real de transporte (salida→llegada):
    // refresca el promedio de transporte del cliente para futuras programaciones.
    if (nuevoEstado === "Llegada") {
      const v = await prisma.viajes.findUnique({
        where: { id: viajeId },
        select: { pedido: { select: { cliente_id: true } } },
      });
      if (v) {
        const cambio = await recalcularTransportePromedioCliente(v.pedido.cliente_id);
        if (cambio) {
          await prisma.bitacora_auditoria.create({
            data: {
              tabla_afectada: "clientes",
              registro_id: v.pedido.cliente_id,
              usuario: "sistema",
              campo_modificado: "tiempo_viaje_referencia_min",
              valor_anterior: cambio.anterior != null ? String(cambio.anterior) : null,
              valor_nuevo: String(cambio.nuevo),
              motivo: "Promedio real de transporte actualizado",
            },
          });
        }
      }
    }
    revalidarPantallas();
  }
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
  const op = await autorizarOperacionPedido();
  if (!op.ok) return op;
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
    const op = await autorizarOperacionPedido();
    if (!op.ok) return op;
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
 * Server action: cancela UN SOLO VIAJE (despacho en vivo). Ej.: un cliente tiene 3
 * viajes programados pero solo requiere 2 → se cancela el último y quedan los demás.
 * El pedido sigue Activo; marca el viaje Cancelado, libera su mixer/operador y lo
 * deja fuera del tablero. No se puede cancelar un viaje ya Completado (entregado).
 * Nota: como reduce el volumen SUMINISTRADO, si el pedido cierra por debajo de lo
 * programado esa diferencia SÍ se refleja como faltante del asesor en el dashboard
 * comercial (modelo suministrado vs programado). No se cuenta como faltante el
 * volumen que quede "Sin cubrir" por flota (eso es operativo, no del cliente).
 */
export async function cancelarViajeAction(
  viajeId: number,
  motivo?: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  try {
    const permiso = await autorizarPorViaje(viajeId);
    if (!permiso.ok) return permiso;
    const ed = await autorizarEdicionCampos();
    if (!ed.ok) return ed;

    const viaje = await prisma.viajes.findUnique({
      where: { id: viajeId },
      select: {
        estado: true,
        pedido: { select: { id: true, cliente: { select: { empresa: true } } } },
      },
    });
    if (!viaje) return { ok: false, mensaje: "Viaje no encontrado." };
    if (viaje.estado === "Completado") {
      return { ok: false, mensaje: "No se puede cancelar un viaje ya completado (entregado)." };
    }

    const sesion = await auth();
    const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
    const nota = (motivo ?? "").trim();

    await prisma.viajes.update({
      where: { id: viajeId },
      data: { estado: "Cancelado", mixer_id: null, operador_id: null },
    });
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "viajes",
        registro_id: viajeId,
        usuario: quien,
        campo_modificado: "estado",
        valor_anterior: viaje.estado,
        valor_nuevo: "Cancelado",
        motivo: nota
          ? `Viaje cancelado en despacho: ${nota}`
          : `Viaje cancelado en despacho (pedido #${viaje.pedido.id}, ${viaje.pedido.cliente.empresa})`,
      },
    });

    revalidarPantallas();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      mensaje: e instanceof Error ? e.message : "No se pudo cancelar el viaje.",
    };
  }
}

/**
 * Server action: agrega VIAJES ADICIONALES a un pedido existente (Despacho en vivo)
 * con las mismas características (diseño, revenimiento, descarga, etc.). El volumen
 * extra se contabiliza como ADICIÓN del día cargada al asesor dueño del cliente
 * (no toca `volumen_programado`). Roles: Admin/Programador/Despachador/JefePlanta/
 * Dosificador (con su zona + regla de fecha del rol). Escribe bitácora.
 */
export async function agregarViajePedidoAction(
  pedidoId: number,
  volumenAdicional: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  try {
    const op = await autorizarOperacionPedido();
    if (!op.ok) return op;
    const permiso = await autorizarPorPedido(pedidoId);
    if (!permiso.ok) return permiso;
    if (!(volumenAdicional > 0)) {
      return { ok: false, mensaje: "El volumen adicional debe ser mayor que 0." };
    }

    const antes = await prisma.pedidos.findUnique({
      where: { id: pedidoId },
      select: { volumen_total_m3: true, cliente: { select: { empresa: true } } },
    });
    if (!antes) return { ok: false, mensaje: "Pedido no encontrado." };

    const r = await agregarVolumenAlPedido(pedidoId, volumenAdicional);

    const sesion = await auth();
    const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "pedidos",
        registro_id: pedidoId,
        usuario: quien,
        campo_modificado: "volumen_total_m3",
        valor_anterior: String(antes.volumen_total_m3),
        valor_nuevo: String(antes.volumen_total_m3 + volumenAdicional),
        // ASCII-only (BD local WIN1252): sin "m3" con superindice ni flechas.
        motivo: `Adicion de ${volumenAdicional} m3 en despacho (${antes.cliente.empresa})`,
      },
    });

    revalidarPantallas();
    revalidatePath("/comercial");
    const sinCubrir =
      r.volumenSinCubrir > 0
        ? ` Quedan ${r.volumenSinCubrir} m³ sin cubrir con flota disponible.`
        : "";
    return {
      ok: true,
      mensaje: `Se agregaron ${volumenAdicional} m³ como adición al pedido.${sinCubrir}`,
    };
  } catch (e) {
    return {
      ok: false,
      mensaje: e instanceof Error ? e.message : "No se pudo agregar el volumen.",
    };
  }
}

/**
 * TEMPORAL/REVERSIBLE (flag PERMITIR_HORA_CARGA_MANUAL). Solo Admin: FIJA (o limpia)
 * la hora de carga manual de un pedido. Con valor, tras la cascada el post-paso
 * reubica los viajes para que la carga arranque a esa hora, AUNQUE choque con otro
 * pedido. `horaLocal` = "YYYY-MM-DDTHH:mm"; "" o null vuelve a automático.
 */
export async function fijarHoraCargaManualAction(
  pedidoId: number,
  horaLocal: string | null,
): Promise<{ ok: boolean; mensaje?: string }> {
  try {
    if (!PERMITIR_HORA_CARGA_MANUAL) {
      return { ok: false, mensaje: "La hora de carga manual está deshabilitada." };
    }
    const alcance = await alcanceActual();
    if (!alcance) return { ok: false, mensaje: "Sesión no válida." };
    if (!alcance.esAdmin) {
      return {
        ok: false,
        mensaje: "Solo el Administrador puede fijar la hora de carga manual.",
      };
    }
    const pedido = await prisma.pedidos.findUnique({
      where: { id: pedidoId },
      select: { planta_id: true, hora_solicitada: true, hora_carga_manual: true },
    });
    if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };

    const limpiar = !horaLocal || !horaLocal.trim();
    const nueva = limpiar ? null : new Date(horaLocal!);
    if (!limpiar && Number.isNaN(nueva!.getTime())) {
      return { ok: false, mensaje: "Hora de carga no válida." };
    }

    await prisma.pedidos.update({
      where: { id: pedidoId },
      data: { hora_carga_manual: nueva },
    });
    // Recalcular la planta+día: la cascada corre normal y el post-paso reubica.
    await recalcularCascadaPlanta(pedido.planta_id, pedido.hora_solicitada);

    // Valor ASCII-safe para la bitácora (BD local WIN1252).
    const fmtManual = (d: Date | null) =>
      d == null
        ? "automatico"
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
            d.getDate(),
          ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
            d.getMinutes(),
          ).padStart(2, "0")}`;
    const sesion = await auth();
    const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "pedidos",
        registro_id: pedidoId,
        usuario: quien,
        campo_modificado: "hora_carga_manual",
        valor_anterior: fmtManual(pedido.hora_carga_manual),
        valor_nuevo: fmtManual(nueva),
        motivo: nueva
          ? "Hora de carga fijada manualmente (Admin)"
          : "Hora de carga vuelta a automatico (Admin)",
      },
    });

    revalidarPantallas();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      mensaje: e instanceof Error ? e.message : "No se pudo fijar la hora de carga.",
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
    const op = await autorizarOperacionPedido();
    if (!op.ok) return op;
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
