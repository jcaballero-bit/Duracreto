"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { alternarActivoClienteAction, eliminarClienteAction } from "./actions";
import { ClienteFormModal, type Opcion, type ValoresCliente } from "./cliente-form-modal";

export interface FilaCliente {
  id: number;
  celdas: Record<string, string>;
  valores: Record<string, string>;
}

export function ClientesTabla({
  filas,
  columnas,
  esAdmin,
  asesores,
}: {
  filas: FilaCliente[];
  columnas: { key: string; label: string }[];
  esAdmin: boolean;
  asesores: Opcion[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<ValoresCliente | null>(null);
  const [pendiente, startTransition] = useTransition();

  const eliminar = (fila: FilaCliente) => {
    if (!confirm(`¿Eliminar el cliente "${fila.celdas.empresa}"?`)) return;
    startTransition(async () => {
      const res = await eliminarClienteAction(fila.id);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo eliminar.");
    });
  };

  const alternarActivo = (fila: FilaCliente) => {
    const nuevo = fila.valores.activo !== "true";
    startTransition(async () => {
      const res = await alternarActivoClienteAction(fila.id, nuevo);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo cambiar el estado.");
    });
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => {
            setEditando(null);
            setAbierto(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={16} /> Nuevo cliente
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
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
                  Sin clientes. Usa <strong>+ Nuevo cliente</strong>.
                </td>
              </tr>
            ) : (
              filas.map((f) => (
                <tr
                  key={f.id}
                  className={`border-b border-border/60 ${
                    f.valores.activo === "true" ? "" : "bg-slate-50/60 text-muted"
                  }`}
                >
                  {columnas.map((c) =>
                    c.key === "estado" ? (
                      <td key={c.key} className="px-3 py-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={f.valores.activo === "true"}
                          aria-label={
                            f.valores.activo === "true"
                              ? "Cliente activo (clic para inactivar)"
                              : "Cliente inactivo (clic para activar)"
                          }
                          onClick={() => alternarActivo(f)}
                          disabled={pendiente}
                          title={f.valores.activo === "true" ? "Activo" : "Inactivo"}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                            f.valores.activo === "true" ? "bg-emerald-500" : "bg-slate-300"
                          }`}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                              f.valores.activo === "true" ? "translate-x-5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </td>
                    ) : (
                      <td key={c.key} className="px-3 py-2 text-ink">
                        {f.celdas[c.key] ?? "—"}
                      </td>
                    ),
                  )}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditando({ id: f.id, valores: f.valores });
                          setAbierto(true);
                        }}
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
        <ClienteFormModal
          editando={editando}
          esAdmin={esAdmin}
          asesores={asesores}
          onClose={() => setAbierto(false)}
          onExito={() => {
            setAbierto(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
