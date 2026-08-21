"use client";

import { useEffect, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, FlaskConical, Save, X } from "lucide-react";
import {
  guardarControlViajeAction,
  guardarControlGeneralAction,
  guardarSalidaPlantaAction,
  type DatosControlGeneral,
} from "../calidad/actions";
import { UNIDAD_TEMPERATURA } from "@/lib/calidad/config";
import { formatearRevenimiento, parsearRevenimiento } from "@/lib/calidad/fraccion";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

/**
 * Captura INLINE del control de calidad de un viaje, dentro de la tarjeta de Despacho
 * en vivo. Son DOS lecturas de dos personas distintas:
 *
 *  · **Salida de planta** — la toma el laboratorista de báscula al terminar la carga,
 *    antes de marcar "En ruta". Se abre sola cuando el mixer entra "En carga".
 *  · **En obra** — la toma el laboratorista del proyecto al llegar el mixer. Se abre
 *    sola al marcar "Llegada".
 *
 * Cada bloque solo aparece si el usuario puede capturarlo (el servidor lo refuerza) y
 * ninguno bloquea el avance del viaje. El revenimiento se escribe como se mide:
 * admite fracciones ("5 3/4", "5-3/4") además de decimales.
 */
export function CapturaCalidadViaje({
  viajeId,
  revenimiento,
  temperatura,
  revenimientoPlanta,
  temperaturaPlanta,
  muestraPlanta,
  muestraObra,
  llegadaAlcanzada,
  cargaIniciada,
  puedeSalidaPlanta,
  puedeObra,
}: {
  viajeId: number;
  /** Lecturas EN OBRA. */
  revenimiento: number | null;
  temperatura: number | null;
  /** Lecturas a la SALIDA DE PLANTA. */
  revenimientoPlanta: number | null;
  temperaturaPlanta: number | null;
  /** Ya se marcó que de este viaje se tomó muestra en planta / en obra. */
  muestraPlanta: boolean;
  muestraObra: boolean;
  llegadaAlcanzada: boolean;
  cargaIniciada: boolean;
  /** El usuario es laboratorista de ESTA planta hoy (o Admin/Jefe/Gerente). */
  puedeSalidaPlanta: boolean;
  /** El usuario captura el control en obra de este programa. */
  puedeObra: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const hayPlanta = revenimientoPlanta != null || temperaturaPlanta != null || muestraPlanta;
  const hayObra = revenimiento != null || temperatura != null || muestraObra;
  const sinPulgada = (n: number | null) =>
    n != null ? formatearRevenimiento(n).replace(/"/g, "") : "";

  const [abierto, setAbierto] = useState(false);
  const [revP, setRevP] = useState(sinPulgada(revenimientoPlanta));
  const [tempP, setTempP] = useState(temperaturaPlanta?.toString() ?? "");
  const [enPlanta, setEnPlanta] = useState(muestraPlanta);
  const [rev, setRev] = useState(sinPulgada(revenimiento));
  const [temp, setTemp] = useState(temperatura?.toString() ?? "");
  const [enObra, setEnObra] = useState(muestraObra);

  // Se abre sola en el momento de tomar cada muestra: al empezar a cargar (planta) y
  // al llegar a la obra. Nunca bloquea el avance del viaje.
  useEffect(() => {
    if (puedeSalidaPlanta && cargaIniciada && !hayPlanta) setAbierto(true);
    else if (puedeObra && llegadaAlcanzada && !hayObra) setAbierto(true);
  }, [puedeSalidaPlanta, cargaIniciada, hayPlanta, puedeObra, llegadaAlcanzada, hayObra]);

  /** Lee el revenimiento tecleado; avisa si no se entiende en vez de guardar basura. */
  const leerRev = (texto: string): number | null | false => {
    const n = parsearRevenimiento(texto);
    if (n === undefined) {
      alert("Revenimiento no válido. Escribe por ejemplo 5, 5.75, 5 3/4 o 5-3/4.");
      return false;
    }
    return n;
  };

  const guardarPlanta = () => {
    const n = leerRev(revP);
    if (n === false) return;
    startTransition(async () => {
      const res = await guardarSalidaPlantaAction(
        viajeId,
        n,
        tempP.trim() === "" ? null : Number(tempP),
        enPlanta,
      );
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo guardar la salida de planta.");
    });
  };

  const guardarObra = () => {
    const n = leerRev(rev);
    if (n === false) return;
    startTransition(async () => {
      const res = await guardarControlViajeAction(
        viajeId,
        n,
        temp.trim() === "" ? null : Number(temp),
        enObra,
      );
      if (res.ok) {
        setAbierto(false);
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo guardar la lectura de calidad.");
    });
  };

  const resumen = [
    hayPlanta
      ? `Planta ${formatearRevenimiento(revenimientoPlanta)}${
          temperaturaPlanta != null ? ` · ${temperaturaPlanta} ${UNIDAD_TEMPERATURA}` : ""
        }`
      : null,
    hayObra
      ? `Obra ${formatearRevenimiento(revenimiento)}${
          temperatura != null ? ` · ${temperatura} ${UNIDAD_TEMPERATURA}` : ""
        }`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    <div className="mt-3 rounded-lg border border-border bg-content/40 p-2.5">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <FlaskConical size={14} className="text-accent" />
          Control de calidad
        </span>
        <span className="text-[11px] text-muted">
          {resumen || (abierto ? "Capturando…" : "Capturar revenimiento y temperatura")}
        </span>
      </button>

      {abierto && puedeSalidaPlanta && (
        <BloqueLectura
          titulo="Salida de planta"
          rev={revP}
          setRev={setRevP}
          temp={tempP}
          setTemp={setTempP}
          marcada={enPlanta}
          setMarcada={setEnPlanta}
          etiquetaMuestra="Se tomó muestra en planta"
          pendiente={pendiente}
          onGuardar={guardarPlanta}
        />
      )}

      {abierto && puedeObra && (
        <BloqueLectura
          titulo="En obra (proyecto)"
          rev={rev}
          setRev={setRev}
          temp={temp}
          setTemp={setTemp}
          marcada={enObra}
          setMarcada={setEnObra}
          etiquetaMuestra="Se tomó muestra en obra"
          pendiente={pendiente}
          onGuardar={guardarObra}
        />
      )}
    </div>
  );
}

/** Un par de lecturas (revenimiento + temperatura) con su casilla de muestra. */
function BloqueLectura({
  titulo,
  rev,
  setRev,
  temp,
  setTemp,
  marcada,
  setMarcada,
  etiquetaMuestra,
  pendiente,
  onGuardar,
}: {
  titulo: string;
  rev: string;
  setRev: Dispatch<SetStateAction<string>>;
  temp: string;
  setTemp: Dispatch<SetStateAction<string>>;
  marcada: boolean;
  setMarcada: Dispatch<SetStateAction<boolean>>;
  etiquetaMuestra: string;
  pendiente: boolean;
  onGuardar: () => void;
}) {
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="mb-1.5 text-[11px] font-semibold text-ink">{titulo}</div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="text-xs sm:flex-1">
          <span className="mb-1 block text-muted">Revenimiento (pulg)</span>
          <input
            type="text"
            placeholder="5 3/4"
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
          onClick={onGuardar}
          disabled={pendiente}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          <Save size={14} /> {pendiente ? "…" : "Guardar"}
        </button>
      </div>
      <label className="mt-1.5 inline-flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={marcada}
          onChange={(e) => setMarcada(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-ink">{etiquetaMuestra}</span>
      </label>
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

/** Casilla de una pregunta sí/no del control general. A nivel de módulo (no dentro
 *  del render de GeneralModal) para no recrear el componente en cada render. */
function CheckCalidad({
  k,
  label,
  d,
  setD,
}: {
  k: keyof GeneralCalidad;
  label: string;
  d: GeneralCalidad;
  setD: Dispatch<SetStateAction<GeneralCalidad>>;
}) {
  return (
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
            <CheckCalidad k="humedecio_area" label="¿Se humedeció el área?" d={d} setD={setD} />
            <CheckCalidad k="vibro_concreto" label="¿Se vibró el concreto?" d={d} setD={setD} />
            <CheckCalidad k="uso_curador" label="¿Se usó curador?" d={d} setD={setD} />
            <CheckCalidad k="aplico_aditivo" label="¿Se aplicó aditivo?" d={d} setD={setD} />
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
            <CheckCalidad k="existe_reclamo" label="¿Existe algún reclamo?" d={d} setD={setD} />
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
