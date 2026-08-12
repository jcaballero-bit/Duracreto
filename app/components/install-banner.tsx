"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { useInstalacion } from "./use-instalacion";

// Se recuerda el descarte para NO volver a mostrar el banner (una sola vez).
const CLAVE = "duracreto_pwa_banner_v1";

/**
 * Banner que aparece la PRIMERA vez en celular/tablet invitando a instalar la app.
 * Se puede cerrar (se recuerda en localStorage) y no vuelve a salir. En Android usa
 * el prompt nativo; en iOS muestra las instrucciones de "Agregar a inicio".
 */
export function InstallBanner() {
  const { modo, instalar } = useInstalacion();
  const [oculto, setOculto] = useState(true); // oculto hasta leer localStorage
  const [ayuda, setAyuda] = useState(false); // mostrar instrucciones (ios/manual)

  useEffect(() => {
    try {
      if (localStorage.getItem(CLAVE) !== "oculto") setOculto(false);
    } catch {
      setOculto(false);
    }
  }, []);

  if (oculto || modo === "no") return null;

  const cerrar = () => {
    try {
      localStorage.setItem(CLAVE, "oculto");
    } catch {
      /* almacenamiento no disponible: se ocultará solo esta sesión */
    }
    setOculto(true);
  };

  const onInstalar = async () => {
    if (modo === "android") {
      await instalar();
      cerrar();
      return;
    }
    setAyuda(true); // ios / manual → mostrar cómo agregar a inicio
  };

  return (
    <div className="print-hide fixed inset-x-0 bottom-0 z-30 px-3 pb-3" role="dialog" aria-label="Instalar aplicación">
      <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-3 shadow-lg">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">Instala DURACRETO Logistics</div>
            <div className="text-xs text-muted">Acceso directo en la pantalla de inicio de tu celular.</div>
          </div>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {ayuda ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-content px-3 py-2 text-xs leading-snug text-slate-600">
            <Share size={14} className="mt-0.5 shrink-0" />
            {modo === "ios" ? (
              <span>
                En Safari toca <strong>Compartir</strong> y luego{" "}
                <strong>“Agregar a inicio”</strong>.
              </span>
            ) : (
              <span>
                Abre el menú del navegador (<strong>⋮</strong>) y elige{" "}
                <strong>“Instalar aplicación”</strong> o{" "}
                <strong>“Agregar a pantalla de inicio”</strong>.
              </span>
            )}
          </p>
        ) : (
          <button
            type="button"
            onClick={onInstalar}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <Download size={16} /> Instalar
          </button>
        )}
      </div>
    </div>
  );
}
