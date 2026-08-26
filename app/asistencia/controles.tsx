"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, CircleDashed } from "lucide-react";

/**
 * Controles de la pantalla de Asistencia: fecha (con navegación al día anterior y
 * siguiente), plantel, y el AVANCE del día — cuántas personas ya tienen asistencia y
 * cuántas faltan, para no cerrar el día con registros incompletos sin darse cuenta.
 */
export function ControlesAsistencia({
  fechaISO,
  etiquetaFecha,
  hrefAnterior,
  hrefSiguiente,
  planteles,
  plantelActual,
  etiquetaAlcance,
  registrados,
  faltantes,
  total,
}: {
  fechaISO: string;
  etiquetaFecha: string;
  hrefAnterior: string;
  hrefSiguiente: string;
  planteles: { id: number; nombre: string; zona: string }[];
  plantelActual: string;
  etiquetaAlcance: string;
  registrados: number;
  faltantes: number;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendiente, startTransition] = useTransition();

  const navegar = (cambios: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v === "") p.delete(k);
      else p.set(k, v);
    }
    startTransition(() => router.push(`/asistencia?${p.toString()}`));
  };

  const pct = total > 0 ? Math.round((registrados / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1.5">
          <Link
            href={hrefAnterior}
            title="Día anterior"
            className="rounded-lg border border-border p-2 text-muted hover:border-accent hover:text-accent"
          >
            <ChevronLeft size={16} />
          </Link>
          <label className="text-xs text-muted">
            Fecha
            <input
              type="date"
              value={fechaISO}
              onChange={(e) => navegar({ fecha: e.target.value })}
              className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <Link
            href={hrefSiguiente}
            title="Día siguiente"
            className="rounded-lg border border-border p-2 text-muted hover:border-accent hover:text-accent"
          >
            <ChevronRight size={16} />
          </Link>
        </div>

        <label className="text-xs text-muted">
          Plantel
          <select
            value={plantelActual}
            onChange={(e) => navegar({ plantel: e.target.value })}
            className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">
              {planteles.length === 1 ? planteles[0].nombre : `${etiquetaAlcance}`}
            </option>
            {planteles.length > 1 &&
              planteles.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.nombre} ({p.zona})
                </option>
              ))}
          </select>
        </label>

        <div className="flex items-center gap-1.5 pb-1 text-xs text-muted">
          <CalendarDays size={13} /> {etiquetaFecha}
          {pendiente && <span className="ml-1">· actualizando…</span>}
        </div>
      </div>

      {/* Avance del día */}
      <div className="min-w-[240px]">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-ink">
            <CheckCircle2 size={13} className="text-emerald-600" />
            {registrados} con asistencia
          </span>
          <span
            className={
              "flex items-center gap-1 " + (faltantes > 0 ? "font-medium text-amber-700" : "text-muted")
            }
          >
            <CircleDashed size={13} />
            {faltantes} {faltantes === 1 ? "falta" : "faltan"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-content">
          <div
            className={"h-full rounded-full " + (faltantes === 0 ? "bg-emerald-500" : "bg-accent")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-0.5 text-right text-[11px] text-muted">
          {registrados} de {total} personas ({pct} %)
        </div>
      </div>
    </div>
  );
}
