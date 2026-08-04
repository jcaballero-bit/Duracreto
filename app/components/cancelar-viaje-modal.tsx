"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { cancelarViajeAction } from "../actions";

/**
 * Modal para cancelar UN SOLO VIAJE en Despacho (no todo el pedido). Ej.: el cliente
 * pidió 3 viajes pero solo requiere 2 → se cancela el sobrante y quedan los demás.
 * El pedido sigue Activo (no es una cancelación comercial del cliente). Nota libre
 * opcional para la bitácora.
 */
export function CancelarViajeModal({
  viajeId,
  etiqueta,
  onClose,
  onCancelado,
}: {
  viajeId: number;
  etiqueta: string; // "Cliente · Viaje N de M" para el encabezado
  onClose: () => void;
  onCancelado: () => void;
}) {
  const [nota, setNota] = useState("");
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirmar = () => {
    setError(null);
    startTransition(async () => {
      const res = await cancelarViajeAction(viajeId, nota.trim() || undefined);
      if (res.ok) onCancelado();
      else setError(res.mensaje ?? "No se pudo cancelar el viaje.");
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
          <h2 className="text-lg font-bold text-ink">Cancelar este viaje</h2>
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
            Vas a cancelar <span className="font-medium text-ink">solo este viaje</span> (
            {etiqueta}). Los demás viajes del pedido se conservan y el pedido sigue activo.
          </p>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Nota (opcional)</span>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej. el cliente ya no requiere este viaje"
              rows={2}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
            />
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
              No cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={pendiente}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pendiente ? "Cancelando…" : "Cancelar viaje"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
