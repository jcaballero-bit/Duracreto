"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { agregarViajePedidoAction } from "../actions";

/**
 * Modal para AGREGAR volumen adicional a un pedido en Despacho en vivo. Crea viajes
 * nuevos con las mismas características del pedido (diseño, revenimiento, descarga,
 * etc.). El volumen agregado se contabiliza como ADICIÓN del día, cargada al asesor
 * dueño del cliente. El motor decide cuántos viajes según la flota disponible.
 */
export function AgregarViajeModal({
  pedidoId,
  cliente,
  onClose,
  onAgregado,
  esAdmin = false,
}: {
  pedidoId: number;
  cliente: string; // nombre del cliente para el encabezado
  onClose: () => void;
  onAgregado: (mensaje?: string) => void;
  // Solo el Admin puede agregar volúmenes fuera del paso de 0.5 m³ (step libre).
  esAdmin?: boolean;
}) {
  const [volumen, setVolumen] = useState("");
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirmar = () => {
    setError(null);
    const n = Number(volumen);
    if (!n || n <= 0) {
      setError("Indica un volumen adicional mayor que 0.");
      return;
    }
    startTransition(async () => {
      const res = await agregarViajePedidoAction(pedidoId, n);
      if (res.ok) onAgregado(res.mensaje);
      else setError(res.mensaje ?? "No se pudo agregar el volumen.");
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Agregar viaje (adicional)</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <p className="text-sm text-muted">
            Agregas volumen adicional a{" "}
            <span className="font-medium text-ink">{cliente}</span> con las mismas
            características del pedido (tipo de concreto, revenimiento, descarga…).
            Este volumen se contabiliza como <span className="font-medium text-ink">adición
            del día</span>, cargado al asesor responsable del cliente.
          </p>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Volumen adicional (m³)</span>
            <input
              type="number"
              min="0.5"
              step={esAdmin ? "any" : "0.5"}
              autoFocus
              value={volumen}
              onChange={(e) => setVolumen(e.target.value)}
              placeholder="Ej. 8"
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <span className="mt-1 block text-xs text-muted">
              El sistema arma los viajes necesarios y les asigna mixer.
            </span>
          </label>

          {error && (
            <p className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={pendiente}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {pendiente ? "Agregando…" : "Agregar viaje"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
