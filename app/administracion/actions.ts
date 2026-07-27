"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/guard";

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
  if (existe) await prisma.userRole.delete({ where: { id: existe.id } });
  else await prisma.userRole.create({ data: { userId, rol } });

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

  await prisma.user.create({
    data: {
      name: nombre.trim(),
      email,
      passwordHash: await bcrypt.hash(password, 10),
      activo: true,
      zona: zona === "" ? null : zona,
      roles: { create: roles.map((rol) => ({ rol })) },
    },
  });
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
