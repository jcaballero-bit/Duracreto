"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanceActual } from "@/lib/auth/guard";
import { filtroPlantelPorZona } from "@/lib/auth/acceso";
import type { Alcance } from "@/lib/auth/acceso";

/** Solo Admin, Jefe de Planta o Programador gestionan reasignaciones de Dosificador. */
async function autorizar(): Promise<
  { ok: true; quien: string; alcance: Alcance } | { ok: false; mensaje: string }
> {
  const alcance = await alcanceActual();
  if (!alcance) return { ok: false, mensaje: "Sesión no válida." };
  if (!alcance.esAdmin && !alcance.esJefePlanta && !alcance.esProgramador) {
    return {
      ok: false,
      mensaje: "Solo un Jefe de Planta, Programador o Administrador puede reasignar.",
    };
  }
  const sesion = await auth();
  return { ok: true, quien: sesion?.user?.name ?? sesion?.user?.email ?? "sistema", alcance };
}

/** IDs de las plantas dentro del alcance del gestor (Admin = todas). */
export async function plantasEnAlcance(alcance: Alcance): Promise<Set<number>> {
  const plantas = await prisma.plantas.findMany({
    where: { plantel: filtroPlantelPorZona(alcance) },
    select: { id: true },
  });
  return new Set(plantas.map((p) => p.id));
}

/**
 * Crea/actualiza la reasignación de un Dosificador a una planta para una fecha. Única
 * por (dosificador, fecha): si ya hay una ese día, la REEMPLAZA. La planta destino
 * debe estar dentro del alcance del gestor (su zona/planteles). Bitácora incluida.
 */
export async function crearReasignacionAction(
  dosificadorId: string,
  plantaId: number,
  fechaISO: string, // "YYYY-MM-DD"
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await autorizar();
  if (!g.ok) return g;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!m) return { ok: false, mensaje: "Fecha inválida." };
  const fecha = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);

  // El usuario debe ser un Dosificador activo.
  const dosi = await prisma.user.findUnique({
    where: { id: dosificadorId },
    select: { activo: true, roles: { where: { rol: "Dosificador" }, select: { id: true } } },
  });
  if (!dosi || !dosi.activo || dosi.roles.length === 0) {
    return { ok: false, mensaje: "El usuario seleccionado no es un Dosificador activo." };
  }

  // La planta destino debe existir y estar en el alcance del gestor.
  const planta = await prisma.plantas.findUnique({
    where: { id: plantaId },
    select: { nombre: true, plantel: { select: { nombre: true } } },
  });
  if (!planta) return { ok: false, mensaje: "Planta no encontrada." };
  if (!g.alcance.esAdmin) {
    const permitidas = await plantasEnAlcance(g.alcance);
    if (!permitidas.has(plantaId)) {
      return { ok: false, mensaje: "Esa planta no está en tu zona/planteles." };
    }
  }

  await prisma.reasignaciones_dosificador_planta.upsert({
    where: { dosificador_id_fecha: { dosificador_id: dosificadorId, fecha } },
    update: { planta_id: plantaId, creado_por: g.quien },
    create: { dosificador_id: dosificadorId, planta_id: plantaId, fecha, creado_por: g.quien },
  });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "reasignaciones_dosificador_planta",
      registro_id: 0,
      usuario: g.quien,
      campo_modificado: "planta",
      valor_anterior: null,
      valor_nuevo: `dosificador=${dosificadorId} planta=${planta.plantel.nombre}/${planta.nombre} (${fechaISO})`,
      motivo: "Reasignacion de planta del Dosificador por dia",
    },
  });
  revalidatePath("/reasignaciones");
  revalidatePath("/despacho");
  return { ok: true };
}

/** Elimina una reasignación (el Dosificador vuelve a su planta predeterminada ese día). */
export async function eliminarReasignacionAction(
  id: number,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await autorizar();
  if (!g.ok) return g;
  const reg = await prisma.reasignaciones_dosificador_planta.findUnique({
    where: { id },
    select: { planta_id: true },
  });
  if (!reg) return { ok: false, mensaje: "Reasignación no encontrada." };
  if (!g.alcance.esAdmin) {
    const permitidas = await plantasEnAlcance(g.alcance);
    if (!permitidas.has(reg.planta_id)) {
      return { ok: false, mensaje: "No puedes quitar una reasignación fuera de tu alcance." };
    }
  }
  await prisma.reasignaciones_dosificador_planta.delete({ where: { id } });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "reasignaciones_dosificador_planta",
      registro_id: id,
      usuario: g.quien,
      campo_modificado: "planta",
      valor_anterior: null,
      valor_nuevo: null,
      motivo: "Reasignacion de planta eliminada (vuelve a la predeterminada)",
    },
  });
  revalidatePath("/reasignaciones");
  revalidatePath("/despacho");
  return { ok: true };
}
