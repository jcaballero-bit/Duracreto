"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  actualizarRegistro,
  crearRegistro,
  eliminarRegistro,
  type Catalogo,
} from "./catalogos-actions";
import { ImportarCsv } from "./importar-csv";

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
}: {
  catalogo: Catalogo;
  singular: string;
  columnas: ColumnaDef[];
  campos: CampoDef[];
  filas: FilaCatalogo[];
  sinImport?: boolean;
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
                      {f.celdas[c.key] ?? "—"}
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
