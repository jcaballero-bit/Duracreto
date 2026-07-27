"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarPlus, X } from "lucide-react";
import { descartarSolicitudAction } from "../clientes/solicitudes-actions";
import { PedidoForm, type PresetPedido } from "../pedido-form";
import type { OpcionesModal } from "./tabla-pedidos";

export interface PendienteVista {
  id: number;
  clienteId: number;
  empresa: string;
  proyecto: string;
  asesorNombre: string;
  volumen: number | null;
  tipoConcreto: string;
  tipoDescarga: string; // "Bomba" | "Directo" | ""
  sacosHielo: number | null;
  elemento: string;
  frecuencia: number | null;
  observaciones: string;
  plantelId: number | null;
  disenoSugeridoId: number | null;
}

/** Panel de proyecciones (Programa Semana) pendientes para el día seleccionado. */
export function PendientesDelDia({
  pendientes,
  opciones,
  fecha,
}: {
  pendientes: PendienteVista[];
  opciones: OpcionesModal;
  fecha: string;
}) {
  const router = useRouter();
  const [convirtiendo, setConvirtiendo] = useState<PendienteVista | null>(null);
  const [pendiente, startTransition] = useTransition();

  if (pendientes.length === 0) return null;

  const descartar = (id: number) => {
    if (!confirm("¿Descartar esta proyección sin convertirla en pedido?")) return;
    startTransition(async () => {
      const res = await descartarSolicitudAction(id);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo descartar.");
    });
  };

  const preset = (p: PendienteVista): PresetPedido => ({
    cliente_id: p.clienteId,
    diseno_id: p.disenoSugeridoId ?? undefined,
    plantel_id: p.plantelId ?? undefined,
    volumen_total_m3: p.volumen ?? undefined,
    sacos_hielo_por_m3: p.sacosHielo ?? undefined,
    elemento: p.elemento || undefined,
    // El asesor solo dice Bomba/Directo; el Programador elige la bomba concreta.
    tipo_descarga: p.tipoDescarga === "Bomba" ? "Bomba estacionaria" : "Canal directo",
    frecuencia_entre_camiones_min: p.frecuencia ?? undefined,
    hora_local: `${fecha}T07:00`,
    solicitud_id: p.id,
  });

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-amber-900">
        Pendientes del Programa Semana para este día ({pendientes.length})
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-amber-200 text-left text-xs uppercase tracking-wide text-amber-800/80">
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Asesor</th>
              <th className="px-3 py-2">Volumen</th>
              <th className="px-3 py-2">Tipo de concreto</th>
              <th className="px-3 py-2">Descarga</th>
              <th className="px-3 py-2">Frecuencia</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pendientes.map((p) => (
              <tr key={p.id} className="border-b border-amber-200/60">
                <td className="px-3 py-2">
                  <div className="font-medium text-ink">{p.empresa}</div>
                  {p.proyecto && <div className="text-xs text-link">{p.proyecto}</div>}
                </td>
                <td className="px-3 py-2 text-muted">{p.asesorNombre}</td>
                <td className="px-3 py-2 whitespace-nowrap font-medium">
                  {p.volumen != null ? `${p.volumen} m³` : "—"}
                </td>
                <td className="px-3 py-2 text-muted">{p.tipoConcreto || "—"}</td>
                <td className="px-3 py-2 text-muted">{p.tipoDescarga || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted">
                  {p.frecuencia != null ? `${p.frecuencia} min` : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setConvirtiendo(p)}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
                    >
                      <CalendarPlus size={14} /> Convertir
                    </button>
                    <button
                      onClick={() => descartar(p.id)}
                      disabled={pendiente}
                      className="rounded-md border border-amber-300 px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Descartar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {convirtiendo && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
          onClick={() => setConvirtiendo(null)}
        >
          <div
            className="w-full max-w-3xl rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-lg font-bold text-ink">
                Convertir a pedido — {convirtiendo.empresa}
              </h2>
              <button
                onClick={() => setConvirtiendo(null)}
                className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5">
              <p className="mb-3 text-xs text-muted">
                Datos precargados de la proyección del asesor. Confirma o ajusta el
                diseño, volumen, descarga, hielo y frecuencia; la bomba/mixer los
                asignas normalmente. Al guardar, la proyección queda como Programada.
              </p>
              {convirtiendo.observaciones && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span className="font-semibold">Observaciones del asesor:</span>{" "}
                  {convirtiendo.observaciones}
                </div>
              )}
              <PedidoForm
                {...opciones}
                preset={preset(convirtiendo)}
                fechaInicial={fecha}
                onExito={() => {
                  setConvirtiendo(null);
                  router.refresh();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
