"use server";

import bcrypt from "bcryptjs";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Cambia la contraseña del USUARIO ACTUAL. Verifica la contraseña actual, exige
 * una nueva de al menos 6 caracteres y distinta, y apaga la bandera
 * `debe_cambiar_password`. Si el usuario venía FORZADO (primer ingreso), cierra
 * la sesión al terminar para refrescar el token (redirige a /login).
 */
export async function cambiarMiPasswordAction(
  actual: string,
  nueva: string,
  confirmar: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await auth();
  if (!sesion?.user?.id) return { ok: false, mensaje: "Sesión no válida." };

  const user = await prisma.user.findUnique({ where: { id: sesion.user.id } });
  if (!user?.passwordHash) {
    return { ok: false, mensaje: "Tu usuario no tiene contraseña local (¿inicias con Google?)." };
  }

  const nuevaLimpia = (nueva ?? "").trim();
  if (nuevaLimpia.length < 6) {
    return { ok: false, mensaje: "La nueva contraseña debe tener al menos 6 caracteres." };
  }
  if (nuevaLimpia !== (confirmar ?? "").trim()) {
    return { ok: false, mensaje: "La confirmación no coincide con la nueva contraseña." };
  }

  const actualOk = await bcrypt.compare(actual ?? "", user.passwordHash);
  if (!actualOk) {
    return { ok: false, mensaje: "La contraseña actual no es correcta." };
  }
  if (await bcrypt.compare(nuevaLimpia, user.passwordHash)) {
    return { ok: false, mensaje: "La nueva contraseña debe ser distinta a la actual." };
  }

  const eraForzado = user.debe_cambiar_password;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(nuevaLimpia, 10),
      debe_cambiar_password: false,
    },
  });

  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "users",
      registro_id: 0, // el id de User es texto (cuid); no aplica al Int de la bitácora
      usuario: user.email ?? user.name ?? "usuario",
      campo_modificado: "passwordHash",
      valor_anterior: null,
      valor_nuevo: "(contraseña actualizada)",
      motivo: eraForzado ? "Cambio obligatorio (primer ingreso)" : "Cambio de contraseña",
    },
  });

  // Si venía forzado, el token todavía dice debeCambiar=true → cerrar sesión para
  // que al re-loguear tome la bandera ya apagada. (Esto redirige a /login.)
  if (eraForzado) {
    await signOut({ redirectTo: "/login?cambiada=1" });
  }

  return { ok: true };
}
