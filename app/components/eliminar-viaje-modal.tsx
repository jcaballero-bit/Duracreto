"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, X } from "lucide-react";
import { eliminarViajeDespachoAction } from "../actions";

/**
 * Modal para ELIMINAR definitivamente un viaje de Despacho en vivo. Es distinto de
 * cancelar: cancelar deja el viaje visible (el programa publicado no se reescribe
 * porque un camión se caiga) y su faltante se le carga al asesor. Esto es para el
 * viaje que NO debió existir — el caso típico es un cliente cargado con el diseño
 * equivocado — así que desaparece y no cuenta en ningún estadístico.
 *
 * Solo lo ve el Administrador (la pantalla oculta el botón y el servidor lo vuelve a
 * validar contra la sesión). Es irreversible, así que la ventana dice exactamente
 * qué se pierde antes de confirmar.
 */
export function EliminarViajeModal({
  viajeId,
  etiqueta,
  volumen,
  estado,
  esUnicoDelPedido,
  onClose,
  onEliminado,
}: {
  viajeId: number;
  etiqueta: string; // "Cliente · Viaje N de M" para el encabezado
  volumen: number;
  estado: string;
  esUnicoDelPedido: boolean;
  onClose: () => void;
  onEliminado: () => void;
}) {
  const [nota, setNota] = useState("");
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirmar = () => {
    setError(null);
    startTransition(async () => {
      const res = await eliminarViajeDespachoAction(viajeId, nota.trim() || undefined);
      if (res.ok) onEliminado();
      else setError(res.mensaje ?? "No se pudo eliminar el viaje.");
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
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
            <AlertTriangle size={18} className="text-red-600" />
            Eliminar el viaje
          </h2>
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
            Vas a borrar <span className="font-medium text-ink">{etiqueta}</span> ({volumen} m³,
            estado {estado}). Úsalo cuando el viaje se cargó por error —por ejemplo un cliente
            con el diseño equivocado—, no cuando el cliente decide no recibirlo (para eso está{" "}
            <span className="font-medium text-ink">Cancelar viaje</span>, que lo conserva con su
            motivo).
          </p>

          <ul className="space-y-1 rounded-lg bg-content px-3 py-2.5 text-xs text-muted">
            <li>
              · Desaparece de Despacho, de Programación y de la vista previa del Programa
              DPCR-08. <span className="text-ink">No se puede deshacer.</span>
            </li>
            <li>
              · No cuenta en ningún estadístico: la línea base del pedido se rebaja, así que no
              aparece como cancelación del asesor ni como volumen faltante.
            </li>
            <li>· Se borran también sus lecturas de control de calidad (revenimiento, temperatura, muestras).</li>
            <li>
              · Las versiones del DPCR-08 ya generadas conservan el viaje: un documento emitido
              no se reescribe.
            </li>
            {esUnicoDelPedido && (
              <li className="text-ink">
                · Es el único viaje del cliente ese día: se eliminará también el pedido completo
                y su proyección del Programa Semana volverá a Pendiente.
              </li>
            )}
          </ul>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Motivo (opcional, queda en la bitácora)</span>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej. se cargó con el diseño equivocado"
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
              No eliminar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={pendiente}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pendiente ? "Eliminando…" : "Eliminar definitivamente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
