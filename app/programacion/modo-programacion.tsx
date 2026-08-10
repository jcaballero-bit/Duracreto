"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Cog, Hand } from "lucide-react";

const KEY = "programacion-modo-top"; // preferencia recordada (localStorage)

/**
 * Selector de nivel superior en Programación: AUTOMÁTICO (el motor arma el día, lo
 * que existe hoy) vs MANUAL (el usuario arma todo a mano; el motor solo valida y
 * avisa). Recuerda la preferencia entre sesiones. Solo se ofrece a los roles que
 * pueden programar a mano (Programador, Jefe de Planta, Administrador).
 */
export function ModoProgramacion({
  puedeManual,
  auto,
  manual,
}: {
  puedeManual: boolean;
  auto: ReactNode;
  manual: ReactNode;
}) {
  const [modo, setModo] = useState<"auto" | "manual">("auto");

  useEffect(() => {
    if (!puedeManual) return;
    if (window.localStorage.getItem(KEY) === "manual") setModo("manual");
  }, [puedeManual]);

  const cambiar = (m: "auto" | "manual") => {
    setModo(m);
    try {
      window.localStorage.setItem(KEY, m);
    } catch {
      /* localStorage no disponible */
    }
  };

  if (!puedeManual) return <>{auto}</>;

  return (
    <div>
      <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-border">
        <button
          onClick={() => cambiar("auto")}
          className={
            "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors " +
            (modo === "auto" ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink")
          }
        >
          <Cog size={16} /> Automático
        </button>
        <button
          onClick={() => cambiar("manual")}
          className={
            "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors " +
            (modo === "manual" ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink")
          }
        >
          <Hand size={16} /> Manual
        </button>
      </div>

      {modo === "manual" ? manual : auto}
    </div>
  );
}
