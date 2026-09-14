"use server";

import { revalidatePath } from "next/cache";
import { signOut } from "@/auth";

/**
 * Cierra la sesión y vuelve al login.
 *
 * Son dos cosas, y las dos hacen falta en una computadora de planta que se relevan
 * varios turnos:
 *
 *  1. `signOut` borra la cookie de sesión en el servidor. Desde ese momento cualquier
 *     petición a una pantalla del sistema responde con un redirect a /login.
 *  2. `revalidatePath("/", "layout")` borra la CACHÉ DE ROUTER del navegador. Sin esto
 *     los RSC de las pantallas que la persona recorrió siguen en memoria del cliente y
 *     el router puede servírselas a quien entre después: el siguiente usuario veía
 *     pantallas con datos del anterior.
 *
 * El orden importa: `signOut` con `redirectTo` **lanza** el redirect, así que lo que
 * viniera después no se ejecutaría. Por eso se invalida primero.
 *
 * **El redirect lo hace `signOut`, no el cliente.** Se probó sacarlo de aquí
 * (`redirect: false`) para que el menú hiciera `window.location.replace("/login")` y
 * ganar una recarga completa; el usuario reportó que con eso el botón dejaba de cerrar
 * sesión. La cadena de aquí es la documentada por Auth.js y la que venía funcionando,
 * así que el botón se queda con ella: un paso propio en el cliente que puede fallar no
 * vale lo que costaba.
 */
export async function cerrarSesionAction() {
  revalidatePath("/", "layout");
  await signOut({ redirectTo: "/login" });
}
