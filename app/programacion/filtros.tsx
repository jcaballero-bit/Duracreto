"use client";

import { useRouter } from "next/navigation";
import { Card } from "../components/ui";

interface PlantelOpc {
  id: number;
  nombre: string;
  zona: string;
}

/** Formatea "2026-07-13" → "lunes 13 de julio 2026" (evita desfase de zona). */
function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);
  const texto = fecha.toLocaleDateString("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return texto.replace(/ de (\d{4})$/, " $1");
}

export function Filtros({
  fecha,
  plantel,
  planteles,
  basePath = "/programacion",
}: {
  fecha: string;
  plantel: string;
  planteles: PlantelOpc[];
  basePath?: string;
}) {
  const router = useRouter();

  const navegar = (nuevaFecha: string, nuevoPlantel: string) => {
    const params = new URLSearchParams();
    params.set("fecha", nuevaFecha);
    if (nuevoPlantel !== "todos") params.set("plantel", nuevoPlantel);
    router.push(`${basePath}?${params.toString()}`);
  };

  return (
    <Card className="mb-5 flex flex-wrap items-end justify-between gap-4 p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => navegar(e.target.value, plantel)}
            className="rounded-lg border border-border bg-surface px-2.5 py-2.5 text-sm text-ink outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">Plantel</span>
          <select
            value={plantel}
            onChange={(e) => navegar(fecha, e.target.value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-2.5 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="todos">Todos</option>
            {planteles.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.nombre} ({p.zona})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="text-sm text-muted">
        Mostrando: <span className="font-medium text-ink">{fechaLarga(fecha)}</span>
      </div>
    </Card>
  );
}
