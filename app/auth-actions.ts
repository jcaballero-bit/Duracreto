"use server";

import { revalidatePath } from "next/cache";
import { signOut } from "@/auth";

/**
 * Cierra la sesión. **No redirige**: de eso se encarga quien la llama, con una recarga
 * completa del navegador (ver `user-menu.tsx`).
 *
 * Las dos piezas de aquí son lo que hace que cerrar sesión cierre DE VERDAD en una
 * computadora compartida por turnos:
 *
 *  1. `signOut` borra la cookie de sesión en el servidor. Desde ese momento cualquier
 *     petición a una pantalla del sistema responde con un redirect a /login.
 *  2. `revalidatePath("/", "layout")` borra la CACHÉ DE ROUTER del navegador. Sin esto
 *     los RSC de las pantallas que la persona recorrió siguen en memoria del cliente, y
 *     como cerrar sesión es una server action que termina en una navegación del lado
 *     del cliente (no una recarga), el router podía servírselas a quien entrara
 *     después: el siguiente usuario veía pantallas con datos del anterior.
 *
 * El orden importa: si `signOut` lanzara el redirect, lo que viniera después no se
 * ejecutaría. Por eso se invalida primero y se sale con `redirect: false`.
 */
export async function cerrarSesionAction() {
  revalidatePath("/", "layout");
  await signOut({ redirect: false });
}
