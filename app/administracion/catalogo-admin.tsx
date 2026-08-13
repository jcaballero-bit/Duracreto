"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Clock, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  actualizarRegistro,
  crearRegistro,
  eliminarRegistro,
  type Catalogo,
} from "./catalogos-actions";
import {
  asignarMixerOperadorAction,
  cambiarEstadoUnidadAction,
  historialEstadoUnidad,
  type CambioEstadoUnidad,
} from "../flota/actions";
import { ImportarCsv } from "./importar-csv";

/** Un mixer disponible para asignar como habitual de un operador (F5). */
export interface MixerOpc {
  id: number;
  identificador: string;
  capacidad: number;
  plantelBaseId: number;
  operadorAsignadoId: number | null;
}

export interface OpcionCampo {
  value: string;
  label: string;
}
export interface CampoDef {
  name: string;
  label: string;
  tipo: "text" | "number" | "select";
  opciones?: OpcionCampo[];
  requerido?: boolean;
  placeholder?: string;
}
export interface ColumnaDef {
  key: string;
  label: string;
}
export interface FilaCatalogo {
  id: number;
  celdas: Record<string, string>;
  valores: Record<string, string>;
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

export function CatalogoAdmin({
  catalogo,
  singular,
  columnas,
  campos,
  filas,
  sinImport = false,
  estadoRapido,
  mixerAsignado,
}: {
  catalogo: Catalogo;
  singular: string;
  columnas: ColumnaDef[];
  campos: CampoDef[];
  filas: FilaCatalogo[];
  sinImport?: boolean;
  // Cuando se define, la columna "estado" se vuelve un cambio RÁPIDO (desplegable
  // inline) para la unidad, con historial. `unidadTipo` = "Mixer"|"Bomba"|... .
  estadoRapido?: { unidadTipo: string; opciones: OpcionCampo[] };
  // Cuando se define, la columna "mixer" (catálogo operadores) es un desplegable
  // inline para asignar el MIXER habitual del operador (F5). `mixers` = todos los
  // mixers; la celda filtra por el plantel asignado del operador.
  mixerAsignado?: { mixers: MixerOpc[] };
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<FilaCatalogo | null>(null);
  const [pendiente, startTransition] = useTransition();

  const abrirNuevo = () => {
    setEditando(null);
    setAbierto(true);
  };
  const abrirEditar = (fila: FilaCatalogo) => {
    setEditando(fila);
    setAbierto(true);
  };

  const guardar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const datos: Record<string, string> = {};
    for (const c of campos) datos[c.name] = String(fd.get(c.name) ?? "");
    startTransition(async () => {
      const res = editando
        ? await actualizarRegistro(catalogo, editando.id, datos)
        : await crearRegistro(catalogo, datos);
      if (res.ok) {
        setAbierto(false);
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo guardar.");
    });
  };

  const eliminar = (fila: FilaCatalogo) => {
    if (!confirm(`¿Eliminar este registro (#${fila.id})?`)) return;
    startTransition(async () => {
      const res = await eliminarRegistro(catalogo, fila.id);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo eliminar.");
    });
  };

  return (
    <>
      <div className="mb-3 flex justify-end gap-2">
        {!sinImport && <ImportarCsv catalogo={catalogo} singular={singular} />}
        <button
          onClick={abrirNuevo}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={16} /> Nuevo {singular}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              {columnas.map((c) => (
                <th key={c.key} className="px-3 py-2">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={columnas.length + 1} className="px-3 py-8 text-center text-muted">
                  Sin registros. Usa <strong>+ Nuevo {singular}</strong>.
                </td>
              </tr>
            ) : (
              filas.map((f) => (
                <tr key={f.id} className="border-b border-border/60">
                  {columnas.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-ink">
                      {estadoRapido && c.key === "estado" ? (
                        <EstadoRapidoCelda
                          unidadTipo={estadoRapido.unidadTipo}
                          unidadId={f.id}
                          valor={f.valores.estado ?? f.celdas.estado ?? ""}
                          opciones={estadoRapido.opciones}
                        />
                      ) : mixerAsignado && c.key === "mixer" ? (
                        <MixerAsignadoCelda
                          operadorId={f.id}
                          plantelAsignadoId={
                            f.valores.plantel_asignado_id
                              ? Number(f.valores.plantel_asignado_id)
                              : null
                          }
                          mixers={mixerAsignado.mixers}
                        />
                      ) : (
                        (f.celdas[c.key] ?? "—")
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => abrirEditar(f)}
                        title="Editar"
                        className="rounded-md p-1.5 text-muted hover:bg-content"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => eliminar(f)}
                        disabled={pendiente}
                        title="Eliminar"
                        className="rounded-md p-1.5 text-danger hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {abierto && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
          onClick={() => setAbierto(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-lg font-bold text-ink">
                {editando ? `Editar ${singular}` : `Nuevo ${singular}`}
              </h2>
              <button
                onClick={() => setAbierto(false)}
                className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={guardar} className="space-y-3 p-5">
              {campos.map((campo) => (
                <label key={campo.name} className="block text-sm">
                  <span className="mb-1 block font-medium text-ink">{campo.label}</span>
                  {campo.tipo === "select" ? (
                    <select
                      name={campo.name}
                      required={campo.requerido}
                      defaultValue={editando?.valores[campo.name] ?? ""}
                      className={inputCls}
                    >
                      {!campo.requerido && <option value="">—</option>}
                      {campo.opciones?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={campo.tipo}
                      name={campo.name}
                      required={campo.requerido}
                      step={campo.tipo === "number" ? "any" : undefined}
                      placeholder={campo.placeholder}
                      defaultValue={editando?.valores[campo.name] ?? ""}
                      className={inputCls}
                    />
                  )}
                </label>
              ))}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pendiente}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {pendiente ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Desplegable inline para asignar el MIXER habitual de un operador (F5). Muestra solo
 * los mixers del plantel asignado del operador (si tiene uno); marca los que ya son
 * habituales de OTRO operador como "(asignado)" y deshabilitados. Al elegir, guarda en
 * mixers.operador_asignado_id (fuente única) vía asignarMixerOperadorAction.
 */
function MixerAsignadoCelda({
  operadorId,
  plantelAsignadoId,
  mixers,
}: {
  operadorId: number;
  plantelAsignadoId: number | null;
  mixers: MixerOpc[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  // Mixer actualmente asignado a ESTE operador (si alguno).
  const actual = mixers.find((m) => m.operadorAsignadoId === operadorId) ?? null;
  // Candidatos: los del plantel asignado del operador (o todos si no tiene plantel).
  const candidatos = mixers.filter(
    (m) => plantelAsignadoId == null || m.plantelBaseId === plantelAsignadoId,
  );

  const cambiar = (valor: string) => {
    const nuevo = valor === "" ? null : Number(valor);
    if ((nuevo ?? null) === (actual?.id ?? null)) return;
    startTransition(async () => {
      const res = await asignarMixerOperadorAction(operadorId, nuevo);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo asignar el mixer.");
    });
  };

  if (plantelAsignadoId == null && candidatos.length === 0) {
    return <span className="text-xs text-muted/60">Sin plantel</span>;
  }

  return (
    <select
      value={actual?.id ?? ""}
      disabled={pendiente}
      onChange={(e) => cambiar(e.target.value)}
      className="rounded border border-border bg-surface px-1.5 py-1 text-xs text-ink outline-none focus:border-accent disabled:opacity-50"
    >
      <option value="">— Ninguno —</option>
      {candidatos.map((m) => {
        // Ya es habitual de OTRO operador: se muestra pero no se puede elegir.
        const ocupadoPorOtro =
          m.operadorAsignadoId != null && m.operadorAsignadoId !== operadorId;
        return (
          <option key={m.id} value={m.id} disabled={ocupadoPorOtro}>
            {m.identificador} ({m.capacidad} m³){ocupadoPorOtro ? " · asignado" : ""}
          </option>
        );
      })}
    </select>
  );
}

/** Color del texto según el estado de la unidad (verde = disponible). */
function colorEstado(estado: string): string {
  if (estado === "Disponible") return "text-emerald-700";
  if (estado === "En mantenimiento") return "text-amber-700";
  return "text-red-700"; // Fuera de servicio / Dañado / otros
}

/**
 * Cambio RÁPIDO de estado de una unidad (desplegable inline en la fila), sin abrir el
 * formulario completo. Al cambiar, llama a la acción (que registra el historial) y
 * refresca. El botón de reloj abre el historial de cambios de esa unidad.
 */
function EstadoRapidoCelda({
  unidadTipo,
  unidadId,
  valor,
  opciones,
}: {
  unidadTipo: string;
  unidadId: number;
  valor: string;
  opciones: OpcionCampo[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [historial, setHistorial] = useState<CambioEstadoUnidad[] | null>(null);
  const [cargando, setCargando] = useState(false);

  const cambiar = (nuevo: string) => {
    if (nuevo === valor) return;
    startTransition(async () => {
      const res = await cambiarEstadoUnidadAction(unidadTipo, unidadId, nuevo);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo cambiar el estado.");
    });
  };

  const verHistorial = async () => {
    setCargando(true);
    setHistorial([]);
    const h = await historialEstadoUnidad(unidadTipo, unidadId);
    setHistorial(h);
    setCargando(false);
  };

  const fmt = (ms: number) =>
    new Date(ms).toLocaleString("es-HN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="flex items-center gap-1">
      <select
        value={valor}
        disabled={pendiente}
        onChange={(e) => cambiar(e.target.value)}
        className={`rounded border border-border bg-surface px-1.5 py-1 text-xs font-medium outline-none focus:border-accent disabled:opacity-50 ${colorEstado(valor)}`}
      >
        {/* Si el estado actual no está en la lista, se muestra igual. */}
        {!opciones.some((o) => o.value === valor) && valor && (
          <option value={valor}>{valor}</option>
        )}
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={verHistorial}
        title="Ver historial de estados"
        className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
      >
        <Clock size={14} />
      </button>

      {historial != null && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
          onClick={() => setHistorial(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-base font-bold text-ink">Historial de estados</h2>
              <button
                onClick={() => setHistorial(null)}
                className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {cargando ? (
                <p className="text-sm text-muted">Cargando…</p>
              ) : historial.length === 0 ? (
                <p className="text-sm text-muted">Sin cambios de estado registrados.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {historial.map((h, i) => (
                    <li key={i} className="border-b border-border/60 pb-2">
                      <div className="text-xs text-muted">{fmt(h.fechaMs)}</div>
                      <div className="text-ink">
                        <span className={colorEstado(h.anterior ?? "")}>
                          {h.anterior ?? "—"}
                        </span>{" "}
                        <span className="text-muted">a</span>{" "}
                        <span className={`font-medium ${colorEstado(h.nuevo)}`}>{h.nuevo}</span>
                      </div>
                      {h.usuario && <div className="text-[11px] text-muted">por {h.usuario}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
