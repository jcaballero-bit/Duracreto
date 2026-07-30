"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock } from "lucide-react";
import { asignarPedidoAction } from "./actions";

export interface LaboratoristaOpc {
  id: string;
  nombre: string;
  zona: string | null;
}
export interface ProgramaDia {
  pedidoId: number;
  empresa: string;
  proyecto: string;
  plantel: string;
  zona: string;
  ventanaTxt: string | null;
  labId: string; // "" = Ninguno
  enConflicto: boolean;
}

/** Lista de programas del día (pedidos) en orden de programación; en cada uno se
 *  elige el Laboratorista que lo visitará (o Ninguno). */
export function GestionAsignaciones({
  fecha,
  laboratoristas,
  programas,
  conflictos,
  soloLectura = false,
}: {
  fecha: string;
  laboratoristas: LaboratoristaOpc[];
  programas: ProgramaDia[];
  conflictos: string[];
  soloLectura?: boolean;
}) {
  const router = useRouter();

  const navegar = (nuevaFecha: string) => {
    router.push(`/laboratorio?fecha=${nuevaFecha}`);
  };

  const inputCls =
    "rounded-lg border border-border bg-surface px-2.5 py-2.5 text-sm text-ink outline-none focus:border-accent";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-ink">Fecha</span>
          <input type="date" value={fecha} onChange={(e) => navegar(e.target.value)} className={inputCls} />
        </label>
        {!soloLectura && laboratoristas.length === 0 && (
          <span className="mb-1 text-xs text-danger">
            No hay usuarios con rol Laboratorista. Crea uno en Administración › Usuarios.
          </span>
        )}
      </div>

      {conflictos.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} /> Hay horarios cruzados en las asignaciones de este día
          </div>
          <ul className="ml-6 list-disc space-y-0.5">
            {conflictos.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Revisa esas asignaciones: cámbialas a otro Laboratorista o a Ninguno.</p>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {soloLectura ? "Tus programas asignados" : "Programas del día"} ({programas.length})
        </h3>
        {programas.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted">
            {soloLectura
              ? "No tienes programas asignados para este día."
              : "No hay programas (pedidos) para este día."}
          </p>
        ) : (
          <ul className="space-y-2">
            {programas.map((p, idx) => (
              <FilaPrograma
                key={`${p.pedidoId}-${p.labId}`}
                indice={idx + 1}
                p={p}
                laboratoristas={laboratoristas}
                soloLectura={soloLectura}
                onCambiar={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Una fila = un programa del día, con el selector de Laboratorista (+ Ninguno). */
function FilaPrograma({
  indice,
  p,
  laboratoristas,
  soloLectura,
  onCambiar,
}: {
  indice: number;
  p: ProgramaDia;
  laboratoristas: LaboratoristaOpc[];
  soloLectura: boolean;
  onCambiar: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [sel, setSel] = useState(p.labId);

  const cambiar = (nuevo: string) => {
    const anterior = sel;
    setSel(nuevo);
    startTransition(async () => {
      const res = await asignarPedidoAction(p.pedidoId, nuevo);
      if (res.ok) {
        onCambiar();
      } else {
        alert(res.mensaje ?? "No se pudo asignar el Laboratorista.");
        setSel(anterior); // revertir el selector si se rechazó
      }
    });
  };

  return (
    <li
      className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
        p.enConflicto ? "border-amber-300 bg-amber-50" : "border-border bg-surface"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-muted">{indice}.</span>
          <span className="font-medium text-ink">{p.empresa}</span>
        </div>
        {p.proyecto && <div className="text-xs text-link">{p.proyecto}</div>}
        <div className="text-[11px] text-muted">{p.plantel} · {p.zona}</div>
        <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
          <Clock size={12} />
          {p.ventanaTxt ?? "sin horario aún"}
        </div>
        {p.enConflicto && (
          <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-amber-700">
            <AlertTriangle size={12} /> horario cruzado
          </div>
        )}
      </div>

      <div className="shrink-0 sm:w-auto">
        {soloLectura ? (
          <div className="text-sm">
            <span className="mr-1 text-[10px] uppercase tracking-wide text-muted sm:hidden">
              Laboratorista:
            </span>
            <span className="font-medium text-ink">
              {laboratoristas.find((l) => l.id === sel)?.nombre ?? "Ninguno"}
            </span>
          </div>
        ) : (
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted sm:hidden">
              Laboratorista
            </span>
            <select
              value={sel}
              disabled={pendiente || laboratoristas.length === 0}
              onChange={(e) => cambiar(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50 sm:w-auto sm:min-w-[180px] sm:py-1.5"
            >
              <option value="">Ninguno</option>
              {laboratoristas.map((l) => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </li>
  );
}
