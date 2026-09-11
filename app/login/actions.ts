"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { signIn } from "@/auth";

/** Inicia sesión con correo/contraseña. Devuelve un mensaje de error o redirige. */
export async function iniciarSesionAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // Se limpia la caché de router del navegador ANTES de entrar: si en esta
  // computadora hubo otra sesión, sus pantallas siguen en memoria del cliente y el
  // router podría servírselas a quien acaba de entrar (ver `cerrarSesionAction`). Se
  // hace en los dos extremos a propósito: cerrar sesión no siempre pasa por el botón
  // —se puede vencer el token o cerrarse el navegador— y entonces esta es la única
  // oportunidad de invalidarla.
  revalidatePath("/", "layout");
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (error) {
    // signIn lanza un redirect en éxito (hay que dejarlo propagar).
    if (error instanceof AuthError) return "Correo o contraseña inválidos.";
    throw error;
  }
  return undefined;
}

/** Inicia sesión con Google (solo si el proveedor está habilitado). */
export async function entrarConGoogleAction() {
  revalidatePath("/", "layout");
  await signIn("google", { redirectTo: "/" });
}
