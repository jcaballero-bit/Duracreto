"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LayoutGrid, SlidersHorizontal } from "lucide-react";
import { VistaSimple, type PlantelSimple } from "./vista-simple";

const KEY = "programacion-modo"; // preferencia recordada (localStorage)

/**
 * Envoltura de Programación que alterna entre la vista SIMPLE (por defecto, para
 * gente sin experiencia en logística) y el MODO AVANZADO (Gantt técnico + tablas,
 * pasado como `avanzado`). Recuerda la preferencia del usuario en localStorage.
 */
export function VistaProgramacion({
  plantelesSimple,
  fecha,
  puedeOrganizar,
  puedeReordenar,
  puedeAvanzado,
  avanzado,
}: {
  plantelesSimple: PlantelSimple[];
  fecha: string;
  puedeOrganizar: boolean;
  puedeReordenar: boolean;
  puedeAvanzado: boolean; // roles operativos ven el switch a modo avanzado
  avanzado: ReactNode;
}) {
  const [modo, setModo] = useState<"simple" | "avanzado">("simple");

  useEffect(() => {
    if (!puedeAvanzado) return;
    const guardado = window.localStorage.getItem(KEY);
    if (guardado === "avanzado") setModo("avanzado");
  }, [puedeAvanzado]);

  const cambiar = (m: "simple" | "avanzado") => {
    setModo(m);
    try {
      window.localStorage.setItem(KEY, m);
    } catch {
      /* localStorage no disponible: no persiste, pero funciona en la sesión */
    }
  };

  return (
    <div>
      {puedeAvanzado && (
        <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => cambiar("simple")}
            className={
              "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors " +
              (modo === "simple" ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink")
            }
          >
            <LayoutGrid size={16} /> Vista simple
          </button>
          <button
            onClick={() => cambiar("avanzado")}
            className={
              "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors " +
              (modo === "avanzado" ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink")
            }
          >
            <SlidersHorizontal size={16} /> Modo avanzado
          </button>
        </div>
      )}

      {modo === "avanzado" && puedeAvanzado ? (
        avanzado
      ) : (
        <VistaSimple
          planteles={plantelesSimple}
          fecha={fecha}
          puedeOrganizar={puedeOrganizar}
          puedeReordenar={puedeReordenar}
        />
      )}
    </div>
  );
}
