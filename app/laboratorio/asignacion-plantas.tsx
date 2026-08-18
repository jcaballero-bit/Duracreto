"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, X } from "lucide-react";
import { guardarLaboratoristasPlantaAction } from "./actions";

export interface PlantaAsignable {
  id: number;
  nombre: string;
  plantelNombre: string;
  zona: string;
  /** Laboratoristas asignados a la salida de esta planta ese día (puede ser varios). */
  labIds: string[];
  /** Indicación del turno que verán los laboratoristas asignados. */
  observaciones: string;
}
export interface LabOpc {
  id: string;
  nombre: string;
  zona: string | null;
}

/**
 * Asignación de Laboratoristas a la SALIDA de cada PLANTA por día (control de calidad
 * de salida). Distinta de la asignación por proyecto: se puede cambiar cuantas veces
 * haga falta en el día. Admite VARIOS laboratoristas por planta (turnos o apoyo) y una
 * OBSERVACIÓN del turno que el laboratorista asignado ve en su pantalla. Cada planta
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
        Asigna quién controla la calidad del concreto a la salida de cada planta hoy. Puedes
        poner más de un laboratorista por planta y dejarles una observación del turno; ellos
        la ven junto con la planta que tienen asignada.
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
  // Al menos una línea visible (vacía = "Ninguno") para poder elegir el primero.
  const [sel, setSel] = useState<string[]>(planta.labIds.length ? planta.labIds : [""]);
  const [nota, setNota] = useState(planta.observaciones);
  const [notaGuardada, setNotaGuardada] = useState(planta.observaciones);

  // Solo laboratoristas de la zona de la planta (o sin zona definida).
  const opciones = laboratoristas.filter((l) => !l.zona || l.zona === planta.zona);

  /** Guarda el conjunto completo + la observación. Revierte si el servidor rechaza. */
  const guardar = (nuevas: string[], observacion: string) => {
    const anterior = sel;
    const notaAnterior = notaGuardada;
    setSel(nuevas.length ? nuevas : [""]);
    startTransition(async () => {
      const res = await guardarLaboratoristasPlantaAction(
        planta.id,
        fecha,
        nuevas.filter((x) => x),
        observacion,
      );
      if (res.ok) {
        setNotaGuardada(observacion);
        router.refresh();
      } else {
        alert(res.mensaje ?? "No se pudo guardar la asignación.");
        setSel(anterior.length ? anterior : [""]);
        setNota(notaAnterior);
      }
    });
  };

  const cambiarEn = (i: number, valor: string) => {
    const copia = [...sel];
    copia[i] = valor;
    guardar(copia, nota);
  };
  const quitar = (i: number) => guardar(sel.filter((_, k) => k !== i), nota);
  const agregar = () => setSel([...sel, ""]); // línea vacía; se guarda al elegir

  const notaSinGuardar = nota !== notaGuardada;

  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="font-medium text-ink">{planta.plantelNombre}</span>
          <span className="text-ink"> · {planta.nombre}</span>
          <div className="text-[11px] text-muted">{planta.zona}</div>
        </div>

        <div className="shrink-0 space-y-1.5 sm:w-auto">
          <span className="block text-[10px] uppercase tracking-wide text-muted">
            Laboratorista(s) de salida
          </span>
          {sel.map((valor, i) => (
            <div key={i} className="flex items-center gap-1">
              <select
                value={valor}
                disabled={pendiente || opciones.length === 0}
                onChange={(e) => cambiarEn(i, e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50 sm:w-auto sm:min-w-[180px] sm:py-1.5"
              >
                <option value="">Ninguno</option>
                {opciones.map((l) => {
                  // Marca los ya elegidos en OTRA línea (no duplicar la misma persona).
                  const yaEnOtra = sel.some((x, k) => k !== i && x === l.id);
                  return (
                    <option key={l.id} value={l.id} disabled={yaEnOtra}>
                      {l.nombre}
                      {yaEnOtra ? " (ya asignado)" : ""}
                    </option>
                  );
                })}
              </select>
              {(sel.length > 1 || valor !== "") && (
                <button
                  type="button"
                  onClick={() => quitar(i)}
                  disabled={pendiente}
                  title="Quitar este laboratorista"
                  className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={agregar}
            disabled={pendiente || opciones.length === 0 || sel.some((x) => !x)}
            title="Agregar otro laboratorista a esta planta"
            className="inline-flex items-center gap-1 rounded-lg border border-accent px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            <Plus size={13} /> Agregar laboratorista
          </button>
        </div>
      </div>

      {/* Observación del turno: la ve el laboratorista asignado a esta planta. */}
      <label className="mt-3 block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted">
          Observación del turno (la ve el laboratorista)
        </span>
        <div className="flex items-start gap-2">
          <textarea
            value={nota}
            rows={2}
            disabled={pendiente}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej. revisar revenimiento en cada carga del silo 2"
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => guardar(sel, nota)}
            disabled={pendiente || !notaSinGuardar}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            <Save size={14} /> Guardar
          </button>
        </div>
      </label>
    </li>
  );
}
