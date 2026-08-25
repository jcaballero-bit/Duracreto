"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Download } from "lucide-react";

export interface OpcionPlantel {
  id: number;
  nombre: string;
  zona: string;
}

/**
 * Filtros del reporte: rango de fechas + zona/plantel. Van en la URL (searchParams)
 * para que el reporte se pueda compartir por enlace y para que la exportación a CSV
 * reciba exactamente el mismo filtro que se está viendo.
 */
export function FiltrosExtraordinario({
  desde,
  hasta,
  planteles,
  zonas,
  zonaActual,
  plantelActual,
}: {
  desde: string;
  hasta: string;
  planteles: OpcionPlantel[];
  zonas: string[];
  zonaActual: string;
  plantelActual: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendiente, startTransition] = useTransition();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);

  const navegar = (cambios: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v === "") p.delete(k);
      else p.set(k, v);
    }
    startTransition(() => router.push(`/extraordinario?${p.toString()}`));
  };

  // Al elegir una zona, el plantel se limpia (si no, quedaría uno de otra zona).
  const visibles = zonaActual === "" ? planteles : planteles.filter((p) => p.zona === zonaActual);
  const csvHref = `/extraordinario/csv?${params.toString()}`;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-muted">
        Desde
        <input
          type="date"
          value={d}
          onChange={(e) => setD(e.target.value)}
          onBlur={() => d !== desde && navegar({ desde: d })}
          className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
        />
      </label>
      <label className="text-xs text-muted">
        Hasta
        <input
          type="date"
          value={h}
          onChange={(e) => setH(e.target.value)}
          onBlur={() => h !== hasta && navegar({ hasta: h })}
          className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
        />
      </label>

      {zonas.length > 1 && (
        <label className="text-xs text-muted">
          Zona
          <select
            value={zonaActual}
            onChange={(e) => navegar({ zona: e.target.value, plantel: "" })}
            className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">Todas las zonas</option>
            {zonas.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="text-xs text-muted">
        Plantel
        <select
          value={plantelActual}
          onChange={(e) => navegar({ plantel: e.target.value })}
          className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="">
            {visibles.length === 1 ? visibles[0].nombre : "Todos los planteles"}
          </option>
          {visibles.length > 1 &&
            visibles.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.nombre}
              </option>
            ))}
        </select>
      </label>

      <a
        href={csvHref}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink hover:border-accent hover:text-accent"
      >
        <Download size={15} /> Exportar a Excel/CSV
      </a>

      {pendiente && <span className="text-xs text-muted">Actualizando…</span>}
    </div>
  );
}
