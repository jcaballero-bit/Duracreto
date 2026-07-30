"use client";

import { useState } from "react";
import { Download, Share } from "lucide-react";
import { useInstalacion } from "./use-instalacion";

/**
 * Opción "Instalar App" del menú de usuario. Solo aparece en celular/tablet y
 * cuando el sistema es instalable (o en iOS, con instrucciones, ya que Safari no
 * expone un botón). Al instalar, se agrega a la pantalla de inicio un acceso
 * directo con el logo DURACRETO que abre el sistema a pantalla completa.
 */
export function InstallApp({ onAccion }: { onAccion?: () => void }) {
  const { modo, instalar } = useInstalacion();
  const [ayudaIOS, setAyudaIOS] = useState(false);

  if (modo === "no") return null;

  const onClick = async () => {
    if (modo === "ios") {
      setAyudaIOS((v) => !v);
      return;
    }
    await instalar();
    onAccion?.();
  };

  return (
    <div className="border-t border-slate-100">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-accent hover:bg-slate-50"
      >
        <Download size={16} /> Instalar App
      </button>
      {modo === "ios" && ayudaIOS && (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-xs leading-snug text-slate-500">
          <Share size={13} className="mt-0.5 shrink-0" />
          <span>
            En Safari toca <strong>Compartir</strong> y luego{" "}
            <strong>“Agregar a inicio”</strong> para instalar DURACRETO Logistics.
          </span>
        </p>
      )}
    </div>
  );
}
