"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Mantiene la vista al día sin recargar la página.
 *
 * Cómo funciona ahora: en cada tick pregunta al LATIDO (`/api/latido`) si algo cambió en
 * el rango de fechas de la pantalla — una respuesta de ~100 bytes — y solo cuando la
 * firma cambia hace el `router.refresh()` (refresco SUAVE: re-obtiene los datos del
 * servidor sin recargar ni perder el estado de la UI, como un modal abierto).
 *
 * Por qué: antes cada tick releía TODA la pantalla (61-78 KB) aunque no hubiera pasado
 * nada. Con la operación normal eso superaba los 14 GB de transferencia al mes, casi el
 * triple del límite del plan gratuito de la base — que al agotarse suspende el servicio
 * hasta el mes siguiente. Un tick sin novedades ahora cuesta menos de 200 bytes.
 *
 * Sin `desdeISO` cae al comportamiento anterior (refrescar en cada tick), para que
 * cualquier pantalla que se monte sin rango siga funcionando.
 *
 * Reglas que se conservan:
 *  · Solo mientras la pestaña está VISIBLE (una pestaña en segundo plano no consulta).
 *  · Al volver el foco / hacerse visible, se comprueba de inmediato.
 *  · NUNCA refresca mientras el usuario está escribiendo en un campo: un refresco en
 *    medio de una edición reemplaza los datos y descarta lo tecleado (en la tabla del
 *    modo manual se veía como que el valor "se volvía a poner solo"). El siguiente tick
 *    lo hace en cuanto el campo pierde el foco.
 */
function editandoUnCampo(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function AutoRefresh({
  intervalMs = 60000,
  desdeISO,
  hastaISO,
}: {
  intervalMs?: number;
  /** Día que muestra la pantalla ("YYYY-MM-DD"). Sin él se refresca en cada tick. */
  desdeISO?: string;
  /** Fin EXCLUSIVO del rango, si la pantalla cubre más de un día (Confirmaciones). */
  hastaISO?: string;
}) {
  const router = useRouter();
  // Última firma conocida. Arranca en null: el primer latido solo toma la referencia,
  // sin refrescar (la página acaba de renderizarse con esos datos).
  const firma = useRef<string | null>(null);

  useEffect(() => {
    // Si cambia el día que se está viendo, la referencia anterior ya no aplica.
    firma.current = null;
    let vivo = true;

    const revisar = async () => {
      if (!vivo) return;
      if (document.visibilityState !== "visible") return;
      if (editandoUnCampo()) return; // no pisar una edición en curso

      if (!desdeISO) {
        router.refresh();
        return;
      }
      try {
        const params = new URLSearchParams({ desde: desdeISO });
        if (hastaISO) params.set("hasta", hastaISO);
        const res = await fetch(`/api/latido?${params.toString()}`, { cache: "no-store" });
        if (!res.ok || !vivo) return;
        const { v } = (await res.json()) as { v: string };
        if (firma.current === null) {
          firma.current = v; // primera lectura: solo referencia
          return;
        }
        if (v !== firma.current) {
          firma.current = v;
          // Se vuelve a comprobar el foco: el latido tardó un momento en responder y
          // el usuario pudo empezar a escribir en ese intervalo.
          if (!editandoUnCampo()) router.refresh();
        }
      } catch {
        // Sin red o servidor caído: no se hace nada y se intenta en el siguiente tick.
      }
    };

    const id = setInterval(revisar, intervalMs);
    window.addEventListener("focus", revisar);
    document.addEventListener("visibilitychange", revisar);

    return () => {
      vivo = false;
      clearInterval(id);
      window.removeEventListener("focus", revisar);
      document.removeEventListener("visibilitychange", revisar);
    };
  }, [router, intervalMs, desdeISO, hastaISO]);

  return null;
}
