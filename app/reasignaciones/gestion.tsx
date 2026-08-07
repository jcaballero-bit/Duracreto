"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { crearReasignacionAction, eliminarReasignacionAction } from "./actions";

export interface DosificadorOpc {
  id: string;
  nombre: string;
  predeterminada: string;
}
export interface PlantaOpc {
  id: number;
  label: string;
}
export interface ReasignacionVista {
  id: number;
  dosificador: string;
  planta: string;
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

export function GestionReasignaciones({
  fecha,
  dosificadores,
  plantas,
  reasignaciones,
}: {
  fecha: string;
  dosificadores: DosificadorOpc[];
  plantas: PlantaOpc[];
  reasignaciones: ReasignacionVista[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [dosi, setDosi] = useState("");
  const [planta, setPlanta] = useState("");

  const navegarFecha = (nueva: string) => router.push(`/reasignaciones?fecha=${nueva}`);

  const crear = () => {
    if (!dosi || !planta) {
      alert("Elige un Dosificador y una planta.");
      return;
    }
    startTransition(async () => {
      const res = await crearReasignacionAction(dosi, Number(planta), fecha);
      if (res.ok) {
        setDosi("");
        setPlanta("");
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo reasignar.");
    });
  };

  const eliminar = (id: number) => {
    if (!confirm("¿Quitar esta reasignación? El Dosificador volverá a su planta predeterminada ese día.")) return;
    startTransition(async () => {
      const res = await eliminarReasignacionAction(id);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo quitar.");
    });
  };

  const predetDe = dosificadores.find((x) => x.id === dosi)?.predeterminada;

  return (
    <div className="space-y-5">
      {/* Fecha (filtra la lista y es la fecha de la nueva reasignación) */}
      <label className="block max-w-xs text-sm">
        <span className="mb-1 block font-medium text-ink">Fecha</span>
        <input
          type="date"
          value={fecha}
          onChange={(e) => navegarFecha(e.target.value)}
          className={inputCls}
        />
      </label>

      {/* Formulario de nueva reasignación */}
      <div className="rounded-lg border border-border bg-content/40 p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Reasignar un Dosificador este día</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink">Dosificador</span>
            <select value={dosi} onChange={(e) => setDosi(e.target.value)} className={inputCls}>
              <option value="">— Elige —</option>
              {dosificadores.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre}
                </option>
              ))}
            </select>
            {predetDe && (
              <span className="mt-1 block text-[11px] text-muted">Predeterminada: {predetDe}</span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink">Reasignar a la planta</span>
            <select value={planta} onChange={(e) => setPlanta(e.target.value)} className={inputCls}>
              <option value="">— Elige —</option>
              {plantas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            {/* Espaciador invisible del alto de una etiqueta: alinea el botón con los
                selects en ≥sm (la columna del Dosificador es más alta por su nota). */}
            <span className="mb-1 hidden text-sm font-medium sm:block" aria-hidden="true">
              &nbsp;
            </span>
            <button
              type="button"
              onClick={crear}
              disabled={pendiente}
              className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
            >
              <Plus size={16} /> Reasignar
            </button>
          </div>
        </div>
        {dosificadores.length === 0 && (
          <p className="mt-2 text-xs text-danger">
            No hay usuarios con rol Dosificador. Crea uno en Administración › Usuarios.
          </p>
        )}
      </div>

      {/* Reasignaciones vigentes ese día */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          Reasignaciones de este día ({reasignaciones.length})
        </h3>
        {reasignaciones.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted">
            Sin reasignaciones. Cada Dosificador trabaja en su planta predeterminada.
          </p>
        ) : (
          <ul className="space-y-2">
            {reasignaciones.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-ink">{r.dosificador}</span>
                  <span className="text-muted"> → </span>
                  <span className="text-ink">{r.planta}</span>
                </div>
                <button
                  type="button"
                  onClick={() => eliminar(r.id)}
                  disabled={pendiente}
                  title="Quitar reasignación"
                  className="rounded-md p-1.5 text-danger hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
