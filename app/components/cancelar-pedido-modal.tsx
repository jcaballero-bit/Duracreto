"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { MOTIVOS_CANCELACION } from "@/lib/cancelacion";
import { cancelarPedidoAction } from "../actions";

/**
 * Modal para CANCELAR un pedido con motivo obligatorio (lista fija del negocio).
 * Si el motivo es "Otro", exige un detalle libre. Lo usan Programación y Despacho.
 */
export function CancelarPedidoModal({
  pedidoId,
  etiqueta,
  onClose,
  onCancelado,
}: {
  pedidoId: number;
  etiqueta: string; // cliente / referencia para el encabezado
  onClose: () => void;
  onCancelado: () => void;
}) {
  const [motivo, setMotivo] = useState<string>("");
  const [detalle, setDetalle] = useState("");
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirmar = () => {
    setError(null);
    if (!motivo) {
      setError("Selecciona un motivo de cancelación.");
      return;
    }
    if (motivo === "Otro" && !detalle.trim()) {
      setError("Indica la causa de la cancelación.");
      return;
    }
    startTransition(async () => {
      const res = await cancelarPedidoAction(pedidoId, motivo, detalle.trim() || undefined);
      if (res.ok) onCancelado();
      else setError(res.mensaje ?? "No se pudo cancelar.");
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
          <h2 className="text-lg font-bold text-ink">Cancelar pedido</h2>
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
            Vas a cancelar el pedido de <span className="font-medium text-ink">{etiqueta}</span>.
            Indica el motivo (queda registrado para Gerencia Comercial).
          </p>

          <fieldset className="space-y-1.5">
            {MOTIVOS_CANCELACION.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="motivo"
                  value={m}
                  checked={motivo === m}
                  onChange={() => setMotivo(m)}
                  className="h-4 w-4 accent-accent"
                />
                {m}
              </label>
            ))}
          </fieldset>

          {motivo === "Otro" && (
            <textarea
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder="Describe la causa…"
              rows={2}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          )}

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
              {pendiente ? "Cancelando…" : "Cancelar pedido"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
