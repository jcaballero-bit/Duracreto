"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { asignarLaboratoristaPlantaAction } from "./actions";

export interface PlantaAsignable {
  id: number;
  nombre: string;
  plantelNombre: string;
  zona: string;
  labId: string; // "" = sin asignar
}
export interface LabOpc {
  id: string;
  nombre: string;
  zona: string | null;
}

/**
 * Asignación de un Laboratorista a la SALIDA de cada PLANTA por día (control de
 * calidad de salida). Es distinta de la asignación por proyecto: se puede cambiar
 * cuantas veces haga falta en el día (una nueva reemplaza la anterior). Cada planta
 * ofrece solo los laboratoristas de SU zona.
 */
export function AsignacionPlantas({
  fecha,
  plantas,
  laboratoristas,
}: {
  fecha: string;
  plantas: PlantaAsignable[];
  laboratoristas: LabOpc[];
}) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-ink">
        Control de calidad a la salida de planta ({plantas.length})
      </h3>
      <p className="mb-3 text-xs text-muted">
        Asigna quién controla la calidad del concreto a la salida de cada planta hoy. Se
        puede cambiar durante el día; la nueva asignación reemplaza a la anterior.
      </p>
      {plantas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted">
          No hay plantas para asignar en tu alcance.
        </p>
      ) : (
        <ul className="space-y-2">
          {plantas.map((p) => (
            <FilaPlanta key={p.id} planta={p} laboratoristas={laboratoristas} fecha={fecha} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilaPlanta({
  planta,
  laboratoristas,
  fecha,
}: {
  planta: PlantaAsignable;
  laboratoristas: LabOpc[];
  fecha: string;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [sel, setSel] = useState(planta.labId);

  // Solo laboratoristas de la zona de la planta (o sin zona definida).
  const opciones = laboratoristas.filter((l) => !l.zona || l.zona === planta.zona);

  const cambiar = (nuevo: string) => {
    const anterior = sel;
    setSel(nuevo);
    startTransition(async () => {
      const res = await asignarLaboratoristaPlantaAction(planta.id, fecha, nuevo);
      if (res.ok) router.refresh();
      else {
        alert(res.mensaje ?? "No se pudo asignar el Laboratorista.");
        setSel(anterior);
      }
    });
  };

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <span className="font-medium text-ink">{planta.plantelNombre}</span>
        <span className="text-ink"> · {planta.nombre}</span>
        <div className="text-[11px] text-muted">{planta.zona}</div>
      </div>
      <div className="shrink-0 sm:w-auto">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted sm:hidden">
            Laboratorista de salida
          </span>
          <select
            value={sel}
            disabled={pendiente || opciones.length === 0}
            onChange={(e) => cambiar(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50 sm:w-auto sm:min-w-[180px] sm:py-1.5"
          >
            <option value="">Ninguno</option>
            {opciones.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}
