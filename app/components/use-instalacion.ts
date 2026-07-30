"use client";

import { useCallback, useEffect, useState } from "react";

/** Evento no estándar de Chrome/Android para ofrecer la instalación de la PWA. */
interface PromptInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** "no" = no instalable / ya instalada / escritorio; "android" = prompt nativo;
 *  "ios" = Safari (sin botón: requiere instrucciones manuales). */
export type ModoInstalacion = "no" | "android" | "ios";

/**
 * Detecta si el sistema se puede instalar como PWA en ESTE dispositivo y expone
 * `instalar()`. Solo se activa en celular/tablet (puntero táctil) y si no está ya
 * instalada. Comparte la lógica entre el botón del menú y el banner.
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

  /** Lanza el prompt nativo (Android). En iOS no hace nada (el caller muestra ayuda). */
  const instalar = useCallback(async () => {
    if (modo === "android" && prompt) {
      await prompt.prompt();
      await prompt.userChoice;
      setPrompt(null);
      setModo("no");
    }
  }, [modo, prompt]);

  return { modo, instalar };
}
