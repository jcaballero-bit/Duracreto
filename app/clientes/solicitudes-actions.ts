"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";

type Res = { ok: boolean; mensaje?: string };

export interface DatosCelda {
  tipo_concreto_estimado: string;
  revenimiento: string; // '3" a 4"' … '9" a 10"'
  tipo_servicio: string; // "Normal" | "Servicio de Construcción"
  tipo_descarga_estimado: string; // "Bomba" | "Directo" | ""
  volumen_estimado_m3: string;
  sacos_hielo_por_m3: string; // control de temperatura estimado (0-10)
  elemento: string; // elemento estructural (pavimento, losa, columna…)
  frecuencia_entre_camiones_min: string;
  observaciones: string;
  plantel_id: string; // planta que atenderá (puede variar por día)
}

interface Contexto {
  userId: string;
  quien: string;
  esAdmin: boolean;
  esProgramador: boolean;
  esAsesor: boolean;
  zona: string | null; // zona del usuario (Programador) para acotar sus escrituras
}

async function contexto(): Promise<Contexto | { error: string }> {
  const sesion = await auth();
  if (!sesion?.user) return { error: "Sesión no válida." };
  const alcance = calcularAlcance(sesion.user.roles ?? [], sesion.user.zona ?? null);
  if (!alcance.esAdmin && !alcance.esAsesor && !alcance.esProgramador) {
    return { error: "No tienes permiso para el Programa Semana." };
  }
  return {
    userId: sesion.user.id,
    quien: sesion.user.name ?? sesion.user.email ?? "usuario",
    esAdmin: alcance.esAdmin,
    esProgramador: alcance.esProgramador,
    esAsesor: alcance.esAsesor,
    zona: alcance.zona,
  };
}

/**
 * Para el PROGRAMADOR (acotado a su zona): ¿puede tocar una proyección cuya zona se
 * infiere del asesor del cliente y/o del plantel de la celda? Regla: sí si el asesor
 * o el plantel son de su zona; sí también si ambos son "desconocidos" (null) — no se
 * puede probar que sea de otra zona; NO si apunta claramente a la otra zona. Admin y
 * Programador sin zona: siempre sí.
 */
async function programadorEnZona(
  ctx: Contexto,
  asesorZona: string | null,
  plantelId: number | null,
): Promise<boolean> {
  if (!ctx.esProgramador || ctx.esAdmin || !ctx.zona) return true;
  if (asesorZona === ctx.zona) return true;
  if (plantelId != null) {
    const pl = await prisma.planteles.findUnique({
      where: { id: plantelId },
      select: { zona: true },
    });
    if (pl?.zona === ctx.zona) return true;
    if (pl && pl.zona !== ctx.zona) return false; // planta claramente de otra zona
  }
  // Sin planta y sin zona de asesor → no se puede probar que sea ajena: permitir.
  return asesorZona == null;
}

const num = (v: string) => {
  const t = (v ?? "").trim().replace(",", ".");
  if (t === "") return null;
  const n = Number.parseFloat(t);
  return Number.isNaN(n) ? null : n;
};
const int = (v: string) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const txt = (v: string) => ((v ?? "").trim() === "" ? null : v.trim());

/**
 * ¿El usuario puede ESCRIBIR sobre las proyecciones de este cliente? (server-side)
 *  · Admin: cualquiera.
 *  · Programador: solo los de SU zona (por la zona del asesor del cliente y/o la
 *    planta de la celda). `plantelId` = planta de la celda al crear/editar (opcional).
 *  · Asesor: solo los suyos.
 */
async function puedeEscribirCliente(
  ctx: Contexto,
  clienteId: number,
  plantelId: number | null = null,
) {
  const cliente = await prisma.clientes.findUnique({
    where: { id: clienteId },
    include: { asesor: { select: { usuario_auth_id: true, zona_asignada: true } } },
  });
  if (!cliente) return { ok: false as const, mensaje: "Cliente no encontrado." };
  if (ctx.esAdmin) return { ok: true as const, cliente };
  if (ctx.esProgramador) {
    const ok = await programadorEnZona(ctx, cliente.asesor?.zona_asignada ?? null, plantelId);
    return ok
      ? { ok: true as const, cliente }
      : { ok: false as const, mensaje: "Ese cliente/planta es de otra zona." };
  }
  if (cliente.asesor?.usuario_auth_id === ctx.userId) return { ok: true as const, cliente };
  return { ok: false as const, mensaje: "Solo puedes proyectar tus propios clientes." };
}

/** Fecha "YYYY-MM-DD" → Date a medianoche local (para el @@unique cliente+fecha). */
function fechaLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

async function auditar(
  registroId: number,
  quien: string,
  campo: string,
  motivo: string,
) {
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "solicitudes_anticipadas",
      registro_id: registroId,
      usuario: quien,
      campo_modificado: campo,
      valor_anterior: null,
      valor_nuevo: null,
      motivo,
    },
  });
}

/**
 * Guarda una proyección del Programa Semana. Con `solicitudId` edita esa entrada
 * (o la borra si queda vacía); sin `solicitudId` crea UNA NUEVA (un cliente puede
 * tener varias el mismo día). Una proyección ya Programada/Descartada no se edita.
 */
export async function guardarSolicitudAction(
  clienteId: number,
  fechaISO: string,
  datos: DatosCelda,
  solicitudId?: number,
): Promise<Res> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, mensaje: ctx.error };
  const permiso = await puedeEscribirCliente(ctx, clienteId, int(datos.plantel_id));
  if (!permiso.ok) return permiso;
  const fecha = fechaLocal(fechaISO);
  if (!fecha) return { ok: false, mensaje: "Fecha inválida." };

  const data = {
    volumen_estimado_m3: num(datos.volumen_estimado_m3),
    tipo_concreto_estimado: txt(datos.tipo_concreto_estimado),
    revenimiento: txt(datos.revenimiento),
    tipo_servicio: txt(datos.tipo_servicio),
    tipo_descarga_estimado: txt(datos.tipo_descarga_estimado),
    sacos_hielo_por_m3: int(datos.sacos_hielo_por_m3),
    elemento: txt(datos.elemento),
    frecuencia_entre_camiones_min: int(datos.frecuencia_entre_camiones_min),
    observaciones: txt(datos.observaciones),
    plantel_id: int(datos.plantel_id),
  };
  // La celda está "vacía" si no hay contenido de proyección (el plantel por sí
  // solo no cuenta: sin volumen/tipo no hay nada que proyectar).
  const vacia =
    data.volumen_estimado_m3 == null &&
    data.tipo_concreto_estimado == null &&
    data.tipo_descarga_estimado == null &&
    data.elemento == null &&
    data.frecuencia_entre_camiones_min == null &&
    data.observaciones == null;

  // Entrada existente (edición): debe ser de este cliente y estar Pendiente.
  let existente = null as Awaited<
    ReturnType<typeof prisma.solicitudes_anticipadas.findUnique>
  > | null;
  if (solicitudId != null) {
    existente = await prisma.solicitudes_anticipadas.findUnique({
      where: { id: solicitudId },
    });
    if (!existente || existente.cliente_id !== clienteId) {
      return { ok: false, mensaje: "Proyección no encontrada." };
    }
    if (existente.estado !== "Pendiente") {
      return {
        ok: false,
        mensaje: `Esta proyección ya está ${existente.estado.toLowerCase()} y no se puede editar aquí.`,
      };
    }
  }

  try {
    if (vacia) {
      // Vaciar una entrada existente = borrarla. Sin id, no hay nada que crear.
      if (existente) {
        await prisma.solicitudes_anticipadas.delete({ where: { id: existente.id } });
        await auditar(existente.id, ctx.quien, "*", "Proyección eliminada (Programa Semana)");
      }
      revalidatePath("/clientes/semana");
      return { ok: true };
    }

    if (existente) {
      // `actualizado_en` marca la última edición (aparte de `creado_en`, que queda fijo).
      await prisma.solicitudes_anticipadas.update({
        where: { id: existente.id },
        data: { ...data, actualizado_en: new Date() },
      });
      await auditar(existente.id, ctx.quien, "*", "Edición de proyección (Programa Semana)");
    } else {
      const creada = await prisma.solicitudes_anticipadas.create({
        data: {
          cliente_id: clienteId,
          asesor_id: permiso.cliente.asesor_id, // dueño = asesor del cliente
          fecha_requerida: fecha,
          ...data,
          creado_por: ctx.quien,
        },
      });
      await auditar(creada.id, ctx.quien, "alta", "Alta de proyección (Programa Semana)");
    }
    revalidatePath("/clientes/semana");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado." };
  }
}

/**
 * Elimina una proyección del Programa Semana. Solo se permite si está Pendiente o
 * Descartada; una ya `Programado` generó un pedido real y NO se borra desde aquí
 * (se conserva la trazabilidad). Asesor: solo las de sus clientes. Queda en bitácora.
 */
export async function eliminarSolicitudAction(id: number): Promise<Res> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, mensaje: ctx.error };
  const solicitud = await prisma.solicitudes_anticipadas.findUnique({ where: { id } });
  if (!solicitud) return { ok: false, mensaje: "Proyección no encontrada." };
  const permiso = await puedeEscribirCliente(ctx, solicitud.cliente_id, solicitud.plantel_id);
  if (!permiso.ok) return permiso;
  if (solicitud.estado === "Programado") {
    return {
      ok: false,
      mensaje: "Ya fue programado — no se puede eliminar desde aquí.",
    };
  }
  try {
    await prisma.solicitudes_anticipadas.delete({ where: { id } });
    await auditar(id, ctx.quien, "*", "Proyección eliminada (Programa Semana)");
    revalidatePath("/clientes/semana");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado." };
  }
}

/** El Programador/Administrador descarta una proyección sin convertirla. El
 *  Programador solo puede descartar las de SU zona. */
export async function descartarSolicitudAction(id: number): Promise<Res> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, mensaje: ctx.error };
  if (!ctx.esAdmin && !ctx.esProgramador) {
    return { ok: false, mensaje: "Solo Programador/Administrador puede descartar." };
  }
  const solicitud = await prisma.solicitudes_anticipadas.findUnique({ where: { id } });
  if (!solicitud) return { ok: false, mensaje: "Proyección no encontrada." };
  const permiso = await puedeEscribirCliente(ctx, solicitud.cliente_id, solicitud.plantel_id);
  if (!permiso.ok) return permiso;
  try {
    await prisma.solicitudes_anticipadas.update({
      where: { id },
      data: { estado: "Descartada" },
    });
    await auditar(id, ctx.quien, "estado", "Proyección descartada");
    revalidatePath("/clientes/semana");
    revalidatePath("/programacion");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado." };
  }
}
