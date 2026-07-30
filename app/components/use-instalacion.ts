"use client";

import { useCallback, useEffect, useState } from "react";

/** Evento no estándar de Chrome/Android para ofrecer la instalación de la PWA. */
interface PromptInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "no"      = no aplica (escritorio o ya instalada) → no mostrar nada.
 * "android" = hay prompt nativo disponible (instalación con un toque).
 * "ios"     = iOS/Safari: requiere instrucciones manuales (Compartir → Agregar a inicio).
 * "manual"  = móvil/tablet sin prompt nativo aún: se muestra igual, con instrucciones
 *             del menú del navegador (segunda opción por si el banner no se usó).
 */
export type ModoInstalacion = "no" | "android" | "ios" | "manual";

/**
 * Detecta si conviene ofrecer "Instalar app" en ESTE dispositivo y expone `instalar()`.
 * Se activa en celular/tablet (puntero táctil) y si no está ya instalada. Comparte
 * la lógica entre el botón del menú y el banner de primer inicio.
 */
export function useInstalacion() {
  const [modo, setModo] = useState<ModoInstalacion>("no");
  const [prompt, setPrompt] = useState<PromptInstalacion | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const yaInstalada =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (yaInstalada) return;

    const esTactil =
      window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
    if (!esTactil) return;

    const ua = navigator.userAgent.toLowerCase();
    const ios =
      /iphone|ipad|ipod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) {
      setModo("ios");
      return;
    }

    // Móvil/tablet no-iOS: por defecto "manual" (siempre visible con instrucciones);
    // sube a "android" si el navegador ofrece el prompt nativo de instalación.
    setModo("manual");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as PromptInstalacion);
      setModo("android");
    };
    const onInstalada = () => {
      setPrompt(null);
      setModo("no");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalada);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalada);
    };
  }, []);

  /** Lanza el prompt nativo (Android). Devuelve true si se lanzó; false si no había. */
  const instalar = useCallback(async (): Promise<boolean> => {
    if (modo === "android" && prompt) {
      await prompt.prompt();
      await prompt.userChoice;
      setPrompt(null);
      setModo("no");
      return true;
    }
    return false;
  }, [modo, prompt]);

  return { modo, instalar };
}
