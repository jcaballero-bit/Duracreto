"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { ajustarPeriodoAction, cambiarEstadoPeriodoAction } from "./actions";

const ESTADOS = ["Abierto", "Cerrado", "Pagado"];

const TONO: Record<string, string> = {
  Abierto: "bg-blue-50 text-blue-700 border-blue-200",
  Cerrado: "bg-amber-50 text-amber-800 border-amber-200",
  Pagado: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

/**
 * Selector de periodo de pago: navegación anterior/siguiente (por índice respecto al
 * ancla, así nunca falta una catorcena), estado del periodo y ajuste manual del cierre
 * y la fecha de pago para la catorcena que se salga del calendario.
 */
export function PeriodoControles({
  indice,
  etiqueta,
  fechaPago,
  estado,
  finISO,
  pagoISO,
}: {
  indice: number;
  etiqueta: string;
  fechaPago: string;
  estado: string;
  finISO: string;
  pagoISO: string;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [ajustando, setAjustando] = useState(false);
  const [fin, setFin] = useState(finISO);
  const [pago, setPago] = useState(pagoISO);

  const cambiarEstado = (nuevo: string) => {
    startTransition(async () => {
      const r = await cambiarEstadoPeriodoAction(indice, nuevo);
      if (!r.ok) alert(r.mensaje ?? "No se pudo cambiar el estado.");
      else router.refresh();
    });
  };

  const guardarAjuste = () => {
    startTransition(async () => {
      const r = await ajustarPeriodoAction(indice, fin, pago);
      if (!r.ok) alert(r.mensaje ?? "No se pudo ajustar el periodo.");
      else {
        setAjustando(false);
        router.refresh();
      }
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/planilla?periodo=${indice - 1}`}
          title="Catorcena anterior"
          className="rounded-lg border border-border p-1.5 text-muted hover:border-accent hover:text-accent"
        >
          <ChevronLeft size={16} />
        </Link>
        <div>
          <div className="text-sm font-semibold text-ink">{etiqueta}</div>
          <div className="flex items-center gap-1 text-xs text-muted">
            <CalendarCheck size={12} /> Se paga el {fechaPago}
          </div>
        </div>
        <Link
          href={`/planilla?periodo=${indice + 1}`}
          title="Catorcena siguiente"
          className="rounded-lg border border-border p-1.5 text-muted hover:border-accent hover:text-accent"
        >
          <ChevronRight size={16} />
        </Link>

        <select
          value={estado}
          disabled={pendiente}
          onChange={(e) => cambiarEstado(e.target.value)}
          className={
            "ml-2 rounded-full border px-2.5 py-1 text-xs font-medium outline-none " +
            (TONO[estado] ?? "border-border text-muted")
          }
        >
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setAjustando((a) => !a)}
          title="Ajustar el cierre y la fecha de pago de esta catorcena"
          className="rounded-lg border border-border p-1.5 text-muted hover:border-accent hover:text-accent"
        >
          <Pencil size={14} />
        </button>
      </div>

      {ajustando && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-content p-2">
          <label className="text-xs text-muted">
            Cierre
            <input
              type="date"
              value={fin}
              onChange={(e) => setFin(e.target.value)}
              className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="text-xs text-muted">
            Fecha de pago
            <input
              type="date"
              value={pago}
              onChange={(e) => setPago(e.target.value)}
              className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={guardarAjuste}
            disabled={pendiente}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={() => setAjustando(false)}
            className="rounded-lg px-2 py-1.5 text-xs text-muted hover:text-ink"
          >
            Cancelar
          </button>
          <span className="text-[11px] text-muted">
            El inicio no cambia (identifica la catorcena). Por defecto el cierre son 14 días y el
            pago 6 días después.
          </span>
        </div>
      )}
    </div>
  );
}
