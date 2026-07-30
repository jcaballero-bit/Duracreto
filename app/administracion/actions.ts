"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/guard";

/**
 * Asegura que un usuario con rol Asesor tenga su registro en `asesores` vinculado.
 * Si ya está vinculado, no hace nada. Si existe un asesor SIN vincular con el mismo
 * correo, lo enlaza (evita duplicados cuando el asesor ya estaba en el catálogo);
 * si no, crea uno nuevo con el nombre/correo del usuario.
 */
async function vincularOCrearAsesor(userId: string, nombre: string, email: string) {
  const yaVinculado = await prisma.asesores.findFirst({ where: { usuario_auth_id: userId } });
  if (yaVinculado) return;
  if (email) {
    const porCorreo = await prisma.asesores.findFirst({
      where: { usuario_auth_id: null, correo: email },
    });
    if (porCorreo) {
      await prisma.asesores.update({ where: { id: porCorreo.id }, data: { usuario_auth_id: userId } });
      return;
    }
  }
  await prisma.asesores.create({
    data: { nombre: nombre.trim() || email || "Asesor", correo: email || null, usuario_auth_id: userId },
  });
}

/** Activa/desactiva un rol de un usuario. */
export async function alternarRolAction(
  userId: string,
  rol: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;

  // Evitar que un admin se quite a sí mismo el rol Administrador (lockout).
  if (guard.userId === userId && rol === "Administrador") {
    return { ok: false, mensaje: "No puedes quitarte tu propio rol de Administrador." };
  }

  const existe = await prisma.userRole.findUnique({
    where: { userId_rol: { userId, rol } },
  });
  if (existe) {
    await prisma.userRole.delete({ where: { id: existe.id } });
  } else {
    await prisma.userRole.create({ data: { userId, rol } });
    // Al ACTIVAR el rol Asesor, autocrear/vincular su registro en asesores.
    if (rol === "Asesor") {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
      if (u) await vincularOCrearAsesor(userId, u.name ?? "", u.email ?? "");
    }
  }

  revalidatePath("/administracion");
  return { ok: true };
}

/** Fija (o limpia) la zona operativa de un usuario. */
export async function fijarZonaAction(
  userId: string,
  zona: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  await prisma.user.update({
    where: { id: userId },
    data: { zona: zona === "" ? null : zona },
  });
  revalidatePath("/administracion");
  return { ok: true };
}

/** Fija (o limpia) el plantel asignado de un usuario (JefePlanta/Dosificador). */
export async function fijarPlantelAsignadoAction(
  userId: string,
  plantelId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  await prisma.user.update({
    where: { id: userId },
    data: { plantel_asignado_id: plantelId === "" ? null : Number(plantelId) },
  });
  revalidatePath("/administracion");
  return { ok: true };
}

/** Activa/desactiva el acceso de un usuario (sin borrarlo). */
export async function alternarActivoAction(
  userId: string,
  activo: boolean,
): Promise<{ ok: boolean; mensaje?: string }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  if (guard.userId === userId && !activo) {
    return { ok: false, mensaje: "No puedes desactivar tu propio usuario." };
  }
  await prisma.user.update({ where: { id: userId }, data: { activo } });
  revalidatePath("/administracion");
  return { ok: true };
}

/** Crea un usuario (correo/contraseña) con roles y zona iniciales. */
export async function crearUsuarioAction(
  nombre: string,
  correo: string,
  password: string,
  roles: string[],
  zona: string,
  plantelAsignadoId: string = "",
): Promise<{ ok: boolean; mensaje?: string }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;

  const email = correo.toLowerCase().trim();
  if (!nombre.trim() || !email || password.length < 6) {
    return {
      ok: false,
      mensaje: "Nombre, correo y contraseña (mín. 6) son obligatorios.",
    };
  }
  const existe = await prisma.user.findUnique({ where: { email } });
  if (existe) return { ok: false, mensaje: "Ya existe un usuario con ese correo." };

  const u = await prisma.user.create({
    data: {
      name: nombre.trim(),
      email,
      passwordHash: await bcrypt.hash(password, 10),
      activo: true,
      zona: zona === "" ? null : zona,
      plantel_asignado_id: plantelAsignadoId === "" ? null : Number(plantelAsignadoId),
      // El usuario nuevo debe cambiar la contraseña en su primer ingreso.
      debe_cambiar_password: true,
      roles: { create: roles.map((rol) => ({ rol })) },
    },
  });
  // Si nace con rol Asesor, autocrear/vincular su registro en `asesores`.
  if (roles.includes("Asesor")) {
    await vincularOCrearAsesor(u.id, nombre, email);
  }
  revalidatePath("/administracion");
  return { ok: true };
}

/**
 * Marca a un usuario para que deba cambiar su contraseña en su próximo ingreso
 * (`debe_cambiar_password = true`). Sirve para forzar el cambio a usuarios que ya
 * existían (los nuevos ya nacen con la bandera en true).
 */
export async function forzarCambioPasswordAction(
  userId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  await prisma.user.update({ where: { id: userId }, data: { debe_cambiar_password: true } });
  revalidatePath("/administracion");
  return { ok: true };
}

/** Elimina un usuario (desvincula asesor si lo hubiera). No puedes borrarte a ti. */
export async function eliminarUsuarioAction(
  userId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  if (guard.userId === userId) {
    return { ok: false, mensaje: "No puedes eliminar tu propio usuario." };
  }
  // Desvincular de asesores para no violar la FK.
  await prisma.asesores.updateMany({
    where: { usuario_auth_id: userId },
    data: { usuario_auth_id: null },
  });
  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/administracion");
  return { ok: true };
}
