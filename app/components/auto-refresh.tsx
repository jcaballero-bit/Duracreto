"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Mantiene la vista al día sin recargar la página: hace un `router.refresh()`
 * (refresco SUAVE — re-obtiene los datos del servidor sin recargar ni perder el
 * estado de la UI, como modales abiertos) en dos momentos:
 *  · Cada `intervalMs` mientras la pestaña está visible.
 *  · Al volver el foco / hacerse visible la pestaña (p. ej. el Programador
 *    regresa a la ventana) → refresco inmediato.
 *
 * Así, cuando un Asesor confirma su programación (u ocurre cualquier cambio en el
 * servidor), el resto de los usuarios lo ven en segundos sin apretar recargar.
 *
 * NO refresca mientras el usuario está escribiendo en un campo: un refresco en medio
 * de una edición reemplaza los datos y descarta lo tecleado (en la tabla del modo
 * manual se veía como que el valor "se volvía a poner solo"). El siguiente tick lo
 * hace en cuanto el campo pierde el foco.
 */
function editandoUnCampo(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function AutoRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refrescarSiVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (editandoUnCampo()) return; // no pisar una edición en curso
      router.refresh();
    };

    const id = setInterval(refrescarSiVisible, intervalMs);
    window.addEventListener("focus", refrescarSiVisible);
    document.addEventListener("visibilitychange", refrescarSiVisible);

    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refrescarSiVisible);
      document.removeEventListener("visibilitychange", refrescarSiVisible);
    };
  }, [router, intervalMs]);

  return null;
}
