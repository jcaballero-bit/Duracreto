"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, FlaskConical, Save, X } from "lucide-react";
import {
  guardarControlViajeAction,
  guardarControlGeneralAction,
  type DatosControlGeneral,
} from "../calidad/actions";
import { UNIDAD_TEMPERATURA } from "@/lib/calidad/config";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

/**
 * Captura INLINE de revenimiento + temperatura de un viaje (control de calidad),
 * dentro de la tarjeta de Despacho en vivo. Solo se muestra cuando el pedido tiene un
 * Laboratorista asignado. Se abre sola cuando el viaje llega a "Llegada" (momento de
 * tomar la muestra), pero NO bloquea el avance del viaje.
 */
export function CapturaCalidadViaje({
  viajeId,
  revenimiento,
  temperatura,
  llegadaAlcanzada,
}: {
  viajeId: number;
  revenimiento: number | null;
  temperatura: number | null;
  llegadaAlcanzada: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const yaCapturado = revenimiento != null || temperatura != null;
  const [abierto, setAbierto] = useState(false);
  const [rev, setRev] = useState(revenimiento?.toString() ?? "");
  const [temp, setTemp] = useState(temperatura?.toString() ?? "");

  // Al presionar "Llegada" (el viaje registra su llegada real) se abre la captura,
  // salvo que ya se haya capturado la muestra.
  useEffect(() => {
    if (llegadaAlcanzada && !yaCapturado) setAbierto(true);
  }, [llegadaAlcanzada, yaCapturado]);

  const guardar = () => {
    startTransition(async () => {
      const res = await guardarControlViajeAction(
        viajeId,
        rev.trim() === "" ? null : Number(rev),
        temp.trim() === "" ? null : Number(temp),
      );
      if (res.ok) {
        setAbierto(false);
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo guardar la lectura de calidad.");
    });
  };

  const resumen =
    (revenimiento != null ? `Rev ${revenimiento}"` : "") +
    (revenimiento != null && temperatura != null ? " · " : "") +
    (temperatura != null ? `${temperatura} ${UNIDAD_TEMPERATURA}` : "");

  return (
    <div className="mt-3 rounded-lg border border-border bg-content/40 p-2.5">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <FlaskConical size={14} className="text-accent" />
          Muestra de calidad
        </span>
        <span className="text-[11px] text-muted">
          {yaCapturado ? resumen : abierto ? "Capturando…" : "Capturar revenimiento y temperatura"}
        </span>
      </button>

      {abierto && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-xs sm:flex-1">
            <span className="mb-1 block text-muted">Revenimiento en obra (pulg)</span>
            <input
              type="number"
              step="0.25"
              min="0"
              value={rev}
              onChange={(e) => setRev(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="text-xs sm:flex-1">
            <span className="mb-1 block text-muted">Temperatura ({UNIDAD_TEMPERATURA})</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              className={inputCls}
            />
          </label>
          <button
            type="button"
            onClick={guardar}
            disabled={pendiente}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <Save size={14} /> {pendiente ? "…" : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}

export interface GeneralCalidad {
  observaciones: string;
  humedecio_area: boolean;
  vibro_concreto: boolean;
  m3_colocados: number | null;
  aplico_aditivo: boolean;
  aditivo_unidades: string;
  uso_curador: boolean;
  existe_reclamo: boolean;
  detalle_reclamo: string;
}

/**
 * Botón "Finalizar control de calidad" + modal con las preguntas generales del pedido
 * (una vez por cliente/día). Se muestra en el ÚLTIMO viaje del pedido cuando hay
 * Laboratorista asignado. No obliga a salir de Despacho en vivo.
 */
export function FinalizarCalidadBoton({
  pedidoId,
  cliente,
  general,
  m3Sugerido,
}: {
  pedidoId: number;
  cliente: string;
  general: GeneralCalidad | null;
  m3Sugerido: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const yaLleno = general != null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
        title="Llenar las preguntas generales del control de calidad de este cliente"
      >
        <ClipboardCheck size={13} /> {yaLleno ? "Ver/editar control de calidad" : "Finalizar control de calidad"}
      </button>
      {abierto && (
        <GeneralModal
          pedidoId={pedidoId}
          cliente={cliente}
          general={general}
          m3Sugerido={m3Sugerido}
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  );
}

function GeneralModal({
  pedidoId,
  cliente,
  general,
  m3Sugerido,
  onClose,
}: {
  pedidoId: number;
  cliente: string;
  general: GeneralCalidad | null;
  m3Sugerido: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [d, setD] = useState<GeneralCalidad>(
    general ?? {
      observaciones: "",
      humedecio_area: false,
      vibro_concreto: false,
      m3_colocados: m3Sugerido || null,
      aplico_aditivo: false,
      aditivo_unidades: "",
      uso_curador: false,
      existe_reclamo: false,
      detalle_reclamo: "",
    },
  );

  const guardar = () => {
    startTransition(async () => {
      const datos: DatosControlGeneral = { ...d };
      const res = await guardarControlGeneralAction(pedidoId, datos);
      if (res.ok) {
        onClose();
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo guardar el formulario general.");
    });
  };

  const Check = ({ k, label }: { k: keyof GeneralCalidad; label: string }) => (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={!!d[k]}
        onChange={(e) => setD((prev) => ({ ...prev, [k]: e.target.checked }) as GeneralCalidad)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-ink">Control de calidad — {cliente}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Check k="humedecio_area" label="¿Se humedeció el área?" />
            <Check k="vibro_concreto" label="¿Se vibró el concreto?" />
            <Check k="uso_curador" label="¿Se usó curador?" />
            <Check k="aplico_aditivo" label="¿Se aplicó aditivo?" />
            {d.aplico_aditivo && (
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block font-medium text-ink">Aditivo (unidades / detalle)</span>
                <input
                  value={d.aditivo_unidades}
                  onChange={(e) => setD((p) => ({ ...p, aditivo_unidades: e.target.value }))}
                  className={inputCls}
                />
              </label>
            )}
            <label className="text-sm">
              <span className="mb-1 block font-medium text-ink">m³ colocados</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={d.m3_colocados ?? ""}
                onChange={(e) =>
                  setD((p) => ({ ...p, m3_colocados: e.target.value === "" ? null : Number(e.target.value) }))
                }
                className={inputCls}
              />
              <span className="mt-0.5 block text-[11px] text-muted">Sugerido: {m3Sugerido} m³ (despachado)</span>
            </label>
            <Check k="existe_reclamo" label="¿Existe algún reclamo?" />
            {d.existe_reclamo && (
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block font-medium text-ink">Detalle del reclamo</span>
                <input
                  value={d.detalle_reclamo}
                  onChange={(e) => setD((p) => ({ ...p, detalle_reclamo: e.target.value }))}
                  className={inputCls}
                />
              </label>
            )}
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-ink">Observaciones</span>
              <textarea
                rows={2}
                value={d.observaciones}
                onChange={(e) => setD((p) => ({ ...p, observaciones: e.target.value }))}
                className={inputCls}
              />
            </label>
          </div>
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
              onClick={guardar}
              disabled={pendiente}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Save size={16} /> {pendiente ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
