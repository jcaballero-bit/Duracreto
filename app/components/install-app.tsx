"use client";

import { useState } from "react";
import { Download, Share } from "lucide-react";
import { useInstalacion } from "./use-instalacion";

/**
 * Opción "Instalar app" del menú de usuario. Aparece SIEMPRE en celular/tablet (si
 * no está ya instalada) — segunda vía por si no se usó el banner del primer inicio.
 * Con prompt nativo (Android) instala de una; si no, muestra cómo agregarla a inicio.
 */
export function InstallApp({ onAccion }: { onAccion?: () => void }) {
  const { modo, instalar } = useInstalacion();
  const [ayuda, setAyuda] = useState(false);

  if (modo === "no") return null;

  const onClick = async () => {
    if (modo === "android") {
      const lanzo = await instalar();
      if (lanzo) onAccion?.();
      else setAyuda((v) => !v); // por si el prompt ya no está disponible
      return;
    }
    setAyuda((v) => !v); // ios / manual → mostrar instrucciones
  };

  return (
    <div className="border-t border-slate-100">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-accent hover:bg-slate-50"
      >
        <Download size={16} /> Instalar app / Agregar a inicio
      </button>
      {ayuda && modo !== "android" && (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-xs leading-snug text-slate-500">
          <Share size={13} className="mt-0.5 shrink-0" />
          {modo === "ios" ? (
            <span>
              En Safari toca <strong>Compartir</strong> y luego{" "}
              <strong>“Agregar a inicio”</strong> para instalar DURACRETO Logistics.
            </span>
          ) : (
            <span>
              Abre el menú del navegador (<strong>⋮</strong>) y elige{" "}
              <strong>“Instalar aplicación”</strong> o{" "}
              <strong>“Agregar a pantalla de inicio”</strong>.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
