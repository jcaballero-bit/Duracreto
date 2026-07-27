"use server";

import { signOut } from "@/auth";

/** Cierra la sesión y vuelve al login. */
export async function cerrarSesionAction() {
  await signOut({ redirectTo: "/login" });
}
