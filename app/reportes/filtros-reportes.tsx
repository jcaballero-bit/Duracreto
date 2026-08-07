"use client";

import { useRouter } from "next/navigation";
import { Card } from "../components/ui";

export interface PlantelOpc {
  id: number;
  nombre: string;
}

const RANGOS: { key: string; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "semana", label: "Esta semana" },
  { key: "mes", label: "Este mes" },
];

export function FiltrosReportes({
  rango,
  plantelId,
  planteles,
  puedeElegirPlantel,
  plantelFijo,
  permitirTodos = true,
}: {
  rango: string; // "hoy" | "semana" | "mes"
  plantelId: string; // "" = todos
  planteles: PlantelOpc[];
  puedeElegirPlantel: boolean;
  plantelFijo?: string; // nombre del plantel cuando el usuario está fijado a uno
  permitirTodos?: boolean; // false para el Jefe de Planta (solo SUS planteles)
}) {
  const router = useRouter();

  const navegar = (nuevoRango: string, nuevoPlantel: string) => {
    const params = new URLSearchParams();
    params.set("rango", nuevoRango);
    if (nuevoPlantel) params.set("plantel", nuevoPlantel);
    router.push(`/reportes?${params.toString()}`);
  };

  return (
    <Card className="mb-5 flex flex-wrap items-end gap-4 p-4">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Periodo</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {RANGOS.map((r) => {
            const activo = r.key === rango;
            return (
              <button
                key={r.key}
                onClick={() => navegar(r.key, plantelId)}
                className={
                  "px-3 py-2 text-sm font-medium transition-colors " +
                  (activo
                    ? "bg-accent text-white"
                    : "bg-surface text-muted hover:text-ink")
                }
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {puedeElegirPlantel ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">Plantel</span>
          <select
            value={plantelId}
            onChange={(e) => navegar(rango, e.target.value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            {permitirTodos && <option value="">Todos los planteles</option>}
            {planteles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
      ) : (
        plantelFijo && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">Plantel</span>
            <span className="rounded-lg border border-border bg-content px-2.5 py-2 text-sm text-ink">
              {plantelFijo}
            </span>
          </div>
        )
      )}
    </Card>
  );
}
