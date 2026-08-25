"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { textoLempiras } from "@/lib/planilla/salario";
import { eliminarCobroAction, registrarCobroAction } from "./actions";

export interface CobroVista {
  id: number;
  fechaISO: string;
  monto: number;
  cliente: string;
  observaciones: string;
}

/**
 * Cobros de sobretiempo hechos a clientes en el periodo. Captura MANUAL y opcional:
 * si tiene valor, el análisis de absorción muestra también la diferencia neta.
 * Solo el Administrador captura (el Jefe de Planta ve la lista).
 */
export function Cobros({
  cobros,
  clientes,
  puedeCapturar,
  fechaSugerida,
}: {
  cobros: CobroVista[];
  clientes: { id: number; nombre: string }[];
  puedeCapturar: boolean;
  fechaSugerida: string;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(fechaSugerida);
  const [monto, setMonto] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [obs, setObs] = useState("");

  const guardar = () => {
    startTransition(async () => {
      const r = await registrarCobroAction(
        fecha,
        monto,
        clienteId === "" ? null : Number(clienteId),
        obs,
      );
      if (!r.ok) alert(r.mensaje ?? "No se pudo registrar el cobro.");
      else {
        setMonto("");
        setClienteId("");
        setObs("");
        setAbierto(false);
        router.refresh();
      }
    });
  };

  const borrar = (id: number) => {
    if (!confirm("¿Borrar este cobro? Queda registrado en la bitácora.")) return;
    startTransition(async () => {
      const r = await eliminarCobroAction(id);
      if (!r.ok) alert(r.mensaje ?? "No se pudo borrar.");
      else router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Sobretiempo que sí se le cobró a un cliente en el periodo. Es opcional: si no hay
          cobros, la diferencia neta es igual a la diferencia.
        </p>
        {puedeCapturar && (
          <button
            type="button"
            onClick={() => setAbierto((a) => !a)}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
          >
            <Plus size={13} /> Registrar un cobro
          </button>
        )}
      </div>

      {abierto && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-content/40 p-3">
          <label className="text-xs text-muted">
            Fecha
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="text-xs text-muted">
            Monto (L)
            <input
              value={monto}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setMonto(e.target.value)}
              className="mt-0.5 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="text-xs text-muted">
            Cliente (opcional)
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              className="mt-0.5 block max-w-[240px] rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            >
              <option value="">— Sin especificar —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-xs text-muted">
            Observaciones
            <input
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              className="mt-0.5 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={guardar}
            disabled={pendiente}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="rounded-lg px-2 py-2 text-sm text-muted hover:text-ink"
          >
            Cancelar
          </button>
        </div>
      )}

      {cobros.length === 0 ? (
        <p className="text-sm text-muted">Sin cobros registrados en el periodo.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border bg-content text-left text-xs font-medium text-muted">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Observaciones</th>
                <th className="px-3 py-2 text-right">Monto</th>
                {puedeCapturar && <th className="w-10 px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {cobros.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="px-3 py-2 tabular-nums text-ink">{c.fechaISO}</td>
                  <td className="px-3 py-2 text-ink">{c.cliente}</td>
                  <td className="px-3 py-2 text-xs text-muted">{c.observaciones || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {textoLempiras(c.monto)}
                  </td>
                  {puedeCapturar && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => borrar(c.id)}
                        title="Borrar este cobro"
                        className="text-muted hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
