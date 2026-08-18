"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, FlaskConical, Plus, X } from "lucide-react";
import { guardarLaboratoristasAction, guardarMuestreoPedidoAction } from "./actions";
import { MAX_MUESTRAS, UBICACIONES_MUESTRAS, textoMuestreo } from "@/lib/calidad/muestreo";

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
  labIds: string[]; // uno o varios laboratoristas; vacío = Ninguno
  enConflicto: boolean;
  /** Dónde se elaboran los testigos: "En obra" | "En planta" | "" (sin definir). */
  muestrasUbicacion: string;
  /** Cuántos cilindros hay que elaborar (null = sin definir). */
  muestrasCantidad: number | null;
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
                key={`${p.pedidoId}-${p.labIds.join(",")}`}
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

/** Una fila = un programa del día. Puede tener UNO O VARIOS Laboratoristas: un
 *  selector por cada uno + botón "+" para agregar otro y una "X" para quitar. */
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
  // Al menos una fila visible (vacía = "Ninguno") para poder elegir el primero.
  const [sel, setSel] = useState<string[]>(p.labIds.length ? p.labIds : [""]);

  // Guarda el conjunto (dedup + sin vacíos lo hace el servidor). Revierte si se rechaza.
  const guardar = (nuevas: string[]) => {
    const anterior = sel;
    setSel(nuevas.length ? nuevas : [""]);
    startTransition(async () => {
      const res = await guardarLaboratoristasAction(p.pedidoId, nuevas.filter((x) => x));
      if (res.ok) onCambiar();
      else {
        alert(res.mensaje ?? "No se pudo guardar la asignación.");
        setSel(anterior.length ? anterior : [""]); // revertir
      }
    });
  };

  const cambiarEn = (i: number, valor: string) => {
    const copia = [...sel];
    copia[i] = valor;
    guardar(copia);
  };
  const quitar = (i: number) => guardar(sel.filter((_, k) => k !== i));
  const agregar = () => setSel([...sel, ""]); // fila vacía; se guarda al elegir

  const nombreDe = (id: string) => laboratoristas.find((l) => l.id === id)?.nombre ?? "Ninguno";

  return (
    <li
      className={`rounded-lg border p-3 ${
        p.enConflicto ? "border-amber-300 bg-amber-50" : "border-border bg-surface"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
              Laboratorista(s):
            </span>
            <span className="font-medium text-ink">
              {p.labIds.length ? p.labIds.map(nombreDe).join(", ") : "Ninguno"}
            </span>
          </div>
        ) : (
          <div className="space-y-1.5">
            <span className="block text-[10px] uppercase tracking-wide text-muted">Laboratorista(s)</span>
            {sel.map((valor, i) => (
              <div key={i} className="flex items-center gap-1">
                <select
                  value={valor}
                  disabled={pendiente || laboratoristas.length === 0}
                  onChange={(e) => cambiarEn(i, e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50 sm:w-auto sm:min-w-[190px]"
                >
                  <option value="">Ninguno</option>
                  {laboratoristas.map((l) => {
                    // Marcar/deshabilitar los ya elegidos en OTRA línea (no duplicar).
                    const yaEnOtra = sel.some((s, k) => k !== i && s === l.id);
                    return (
                      <option key={l.id} value={l.id} disabled={yaEnOtra}>
                        {l.nombre}{yaEnOtra ? " (ya asignado)" : ""}
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
              disabled={pendiente || laboratoristas.length === 0 || sel.some((s) => !s)}
              title="Agregar otro laboratorista a este proyecto"
              className="inline-flex items-center gap-1 rounded-lg border border-accent px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              <Plus size={13} /> Agregar laboratorista
            </button>
          </div>
        )}
      </div>
      </div>

      <MuestreoPrograma p={p} soloLectura={soloLectura} onCambiar={onCambiar} />
    </li>
  );
}

/**
 * Instrucciones de MUESTREO del programa: dónde se elaboran los testigos y cuántos
 * cilindros hay que hacer. Las llena el Jefe de Laboratorio / Gerente de Control de
 * Calidad / Admin; el Laboratorista asignado las ve en solo lectura.
 */
function MuestreoPrograma({
  p,
  soloLectura,
  onCambiar,
}: {
  p: ProgramaDia;
  soloLectura: boolean;
  onCambiar: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [ubicacion, setUbicacion] = useState(p.muestrasUbicacion);
  const [cantidad, setCantidad] = useState(
    p.muestrasCantidad != null ? String(p.muestrasCantidad) : "",
  );

  const guardar = (nuevaUbicacion: string, nuevaCantidad: string) => {
    const n = nuevaCantidad.trim() === "" ? null : Number(nuevaCantidad);
    if (n != null && (!Number.isInteger(n) || n < 0 || n > MAX_MUESTRAS)) {
      alert(`La cantidad debe ser un número entero entre 0 y ${MAX_MUESTRAS}.`);
      return;
    }
    startTransition(async () => {
      const res = await guardarMuestreoPedidoAction(p.pedidoId, nuevaUbicacion, n);
      if (res.ok) onCambiar();
      else {
        alert(res.mensaje ?? "No se pudo guardar el muestreo.");
        setUbicacion(p.muestrasUbicacion);
        setCantidad(p.muestrasCantidad != null ? String(p.muestrasCantidad) : "");
      }
    });
  };

  // El Laboratorista solo consulta lo que le indicaron.
  if (soloLectura) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2 text-xs">
        <FlaskConical size={13} className="shrink-0 text-muted" />
        <span className="text-muted">Muestras:</span>
        <span className="font-medium text-ink">
          {textoMuestreo(p.muestrasUbicacion || null, p.muestrasCantidad)}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border/60 pt-2">
      <label className="text-xs">
        <span className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
          <FlaskConical size={12} /> Ubicación de las muestras
        </span>
        <select
          value={ubicacion}
          disabled={pendiente}
          onChange={(e) => {
            setUbicacion(e.target.value);
            guardar(e.target.value, cantidad);
          }}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">Sin definir</option>
          {UBICACIONES_MUESTRAS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted">
          Cilindros a elaborar
        </span>
        <input
          type="number"
          min="0"
          max={MAX_MUESTRAS}
          step="1"
          value={cantidad}
          disabled={pendiente}
          placeholder="0"
          onChange={(e) => setCantidad(e.target.value)}
          onBlur={(e) => {
            const actual = p.muestrasCantidad != null ? String(p.muestrasCantidad) : "";
            if (e.target.value !== actual) guardar(ubicacion, e.target.value);
          }}
          className="w-24 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
        />
      </label>
    </div>
  );
}
