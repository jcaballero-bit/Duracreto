"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import {
  guardarControlViajeAction,
  guardarControlGeneralAction,
  type DatosControlGeneral,
} from "./actions";

export interface ViajeCaptura {
  id: number;
  mixerLabel: string;
  llegadaTxt: string;
  inicioDescargaTxt: string;
  finDescargaTxt: string;
  revenimiento: number | null;
  temperatura: number | null;
}
export interface GeneralCaptura {
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

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

/** Captura editable (no se imprime) del control de calidad de un pedido: lecturas por
 *  viaje + preguntas generales. El documento imprimible refleja lo ya guardado. */
export function CalidadCaptura({
  pedidoId,
  viajes,
  general,
  m3Sugerido,
  unidadTemp,
}: {
  pedidoId: number;
  viajes: ViajeCaptura[];
  general: GeneralCaptura | null;
  m3Sugerido: number;
  unidadTemp: string;
}) {
  return (
    <div className="no-print space-y-4 rounded-lg border border-border bg-content/40 p-4">
      <h4 className="text-sm font-semibold text-ink">Captura del Laboratorista</h4>
      <LecturasViajes viajes={viajes} unidadTemp={unidadTemp} />
      <FormularioGeneral pedidoId={pedidoId} general={general} m3Sugerido={m3Sugerido} />
    </div>
  );
}

function LecturasViajes({ viajes, unidadTemp }: { viajes: ViajeCaptura[]; unidadTemp: string }) {
  if (viajes.length === 0) {
    return <p className="text-xs text-muted">Este programa aún no tiene viajes con mixer asignado.</p>;
  }
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Lecturas por viaje (revenimiento en obra y temperatura)
      </p>
      <div className="space-y-2">
        {viajes.map((v) => (
          <FilaLectura key={v.id} viaje={v} unidadTemp={unidadTemp} />
        ))}
      </div>
    </div>
  );
}

function FilaLectura({ viaje, unidadTemp }: { viaje: ViajeCaptura; unidadTemp: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [rev, setRev] = useState(viaje.revenimiento?.toString() ?? "");
  const [temp, setTemp] = useState(viaje.temperatura?.toString() ?? "");

  const guardar = () => {
    startTransition(async () => {
      const res = await guardarControlViajeAction(
        viaje.id,
        rev.trim() === "" ? null : Number(rev),
        temp.trim() === "" ? null : Number(temp),
      );
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo guardar la lectura.");
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2 sm:flex-row sm:items-end">
      <div className="min-w-[110px] text-xs text-muted sm:pb-2">
        <span className="font-medium text-ink">{viaje.mixerLabel}</span>
        <div>Llegada {viaje.llegadaTxt}</div>
      </div>
      <label className="text-xs sm:flex-1">
        <span className="mb-1 block text-muted">Revenimiento (pulg)</span>
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
        <span className="mb-1 block text-muted">Temperatura ({unidadTemp})</span>
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
  );
}

function FormularioGeneral({
  pedidoId,
  general,
  m3Sugerido,
}: {
  pedidoId: number;
  general: GeneralCaptura | null;
  m3Sugerido: number;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [d, setD] = useState<GeneralCaptura>(
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

  const set = <K extends keyof GeneralCaptura>(k: K, v: GeneralCaptura[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const guardar = () => {
    startTransition(async () => {
      const datos: DatosControlGeneral = {
        observaciones: d.observaciones,
        humedecio_area: d.humedecio_area,
        vibro_concreto: d.vibro_concreto,
        m3_colocados: d.m3_colocados,
        aplico_aditivo: d.aplico_aditivo,
        aditivo_unidades: d.aditivo_unidades,
        uso_curador: d.uso_curador,
        existe_reclamo: d.existe_reclamo,
        detalle_reclamo: d.detalle_reclamo,
      };
      const res = await guardarControlGeneralAction(pedidoId, datos);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo guardar el formulario general.");
    });
  };

  // Todos los `k` usados aquí son campos booleanos; el cast es seguro y evita el
  // conflicto de TS con una clave de tipo unión.
  const Check = ({ k, label }: { k: keyof GeneralCaptura; label: string }) => (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={!!d[k]}
        onChange={(e) => setD((prev) => ({ ...prev, [k]: e.target.checked }) as GeneralCaptura)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Preguntas generales (una vez por cliente/día, al finalizar)
      </p>
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
              onChange={(e) => set("aditivo_unidades", e.target.value)}
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
            onChange={(e) => set("m3_colocados", e.target.value === "" ? null : Number(e.target.value))}
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
              onChange={(e) => set("detalle_reclamo", e.target.value)}
              className={inputCls}
            />
          </label>
        )}
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Observaciones</span>
          <textarea
            rows={2}
            value={d.observaciones}
            onChange={(e) => set("observaciones", e.target.value)}
            className={inputCls}
          />
        </label>
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={guardar}
          disabled={pendiente}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          <Save size={16} /> {pendiente ? "Guardando…" : "Guardar formulario general"}
        </button>
      </div>
    </div>
  );
}
