"use client";

import { useEffect } from "react";

/** Registra el service worker de la PWA (solo en producción / contexto seguro). */
export function RegistrarSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Requiere contexto seguro (HTTPS o localhost). En LAN por IP no aplica.
    if (!window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silencioso: si falla, la app funciona igual (solo no será instalable).
    });
  }, []);
  return null;
}
