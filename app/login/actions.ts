"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

/** Inicia sesión con correo/contraseña. Devuelve un mensaje de error o redirige. */
export async function iniciarSesionAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
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
  await signIn("google", { redirectTo: "/" });
}
