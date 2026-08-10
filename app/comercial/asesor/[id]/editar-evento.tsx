"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { editarEventoComercialAction } from "../../actions";

/**
 * Botón (solo Admin) para editar la FECHA y el VOLUMEN de una adición o cancelación
 * del registro comercial. Abre un mini-formulario; al guardar recalcula el registro.
 */
export function EditarEvento({
  pedidoId,
  tipo,
  fechaMs,
  m3,
  cliente,
}: {
  pedidoId: number;
  tipo: "adicion" | "cancelacion";
  fechaMs: number;
  m3: number;
  cliente: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();
  const [fecha, setFecha] = useState(() => {
    const d = new Date(fechaMs);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const [volumen, setVolumen] = useState(String(m3));
  const [error, setError] = useState<string | null>(null);

  const guardar = () => {
    setError(null);
    const v = Number(volumen);
    if (!(v > 0)) return setError("El volumen debe ser mayor que 0.");
    startTransition(async () => {
      const res = await editarEventoComercialAction(pedidoId, tipo, fecha, v);
      if (res.ok) {
        if (res.mensaje) alert(res.mensaje); // aviso de tope (adición > suministrado)
        setAbierto(false);
        router.refresh();
      } else {
        setError(res.mensaje ?? "No se pudo editar.");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title={`Editar fecha y volumen de esta ${tipo}`}
        aria-label={`Editar ${tipo}`}
        className="rounded p-1 text-muted hover:bg-content hover:text-ink"
      >
        <Pencil size={14} />
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
          onClick={() => setAbierto(false)}
        >
          <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-base font-bold text-ink">
                Editar {tipo === "adicion" ? "adición" : "cancelación"} — {cliente}
              </h2>
              <button onClick={() => setAbierto(false)} className="rounded-md p-1 text-muted hover:bg-content hover:text-ink" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-ink">Fecha</span>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-ink">Volumen (m³)</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={volumen}
                  onChange={(e) => setVolumen(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <p className="text-xs text-muted">
                {tipo === "adicion"
                  ? "El volumen adicionado no puede exceder lo suministrado (viajes completados)."
                  : "Ajusta el volumen cancelado y la fecha con que se registra la cancelación."}
              </p>
              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setAbierto(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content"
                >
                  Cancelar
                </button>
                <button
                  onClick={guardar}
                  disabled={pendiente}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {pendiente ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
