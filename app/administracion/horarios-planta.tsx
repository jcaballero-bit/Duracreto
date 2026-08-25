"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  guardarCostoFichaAction,
  guardarHorarioPlantaAction,
  guardarUmbralExtraAction,
} from "./horarios-actions";

export interface CeldaHorario {
  tipoDia: string;
  apertura: string; // "HH:MM"
  cierre: string;
  activo: boolean;
}

export interface FilaPlantaHorario {
  plantaId: number;
  planta: string;
  plantel: string;
  celdas: CeldaHorario[];
}

const TIPOS: { clave: string; etiqueta: string }[] = [
  { clave: "LunVie", etiqueta: "Lunes a viernes" },
  { clave: "Sabado", etiqueta: "Sábado" },
  { clave: "Domingo", etiqueta: "Domingo" },
];

const inCls =
  "w-[74px] rounded-lg border border-border bg-surface px-2 py-1 text-xs tabular-nums text-ink outline-none focus:border-accent";

/**
 * Horario normal (jornada operativa) por PLANTA y tipo de día. Es lo que decide si un
 * despacho salió en horario normal o extraordinario; NO son las bandas de recargo de
 * ley (esas están en la pestaña "Recargos de ley" y aplican a las personas).
 *
 * Una planta puede tener horario distinto a otra: el Administrador puede dejar SANY
 * abierta hasta las 17:00 mientras STALO cierra a las 15:00.
 */
export function HorariosPlanta({
  filas,
  costoFicha,
  umbralPct,
}: {
  filas: FilaPlantaHorario[];
  costoFicha: number;
  umbralPct: number;
}) {
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Jornada <strong>operativa normal</strong> de cada planta. Un viaje que sale fuera de esta
        ventana cuenta como <strong>despacho en horario extraordinario</strong>. Es distinto de las
        bandas de recargo de ley (pestaña <em>Recargos de ley</em>), que aplican a las personas:
        pueden coincidir, pero se configuran por separado y cada planta puede tener su propio
        horario. Desmarcar <em>Abre</em> significa que ese día no hay horario normal, o sea que
        todo el día es extraordinario (así viene el domingo).
      </p>

      <div className="mb-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-content text-left text-xs font-medium text-muted">
              <th className="px-3 py-2">Plantel</th>
              <th className="px-3 py-2">Planta</th>
              {TIPOS.map((t) => (
                <th key={t.clave} className="px-3 py-2">
                  {t.etiqueta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.plantaId} className="border-b border-border/60">
                <td className="px-3 py-2 text-xs text-muted">{f.plantel}</td>
                <td className="px-3 py-2 font-medium text-ink">{f.planta}</td>
                {TIPOS.map((t) => {
                  const c =
                    f.celdas.find((x) => x.tipoDia === t.clave) ??
                    { tipoDia: t.clave, apertura: "07:00", cierre: "15:00", activo: false };
                  return (
                    <td key={t.clave} className="px-3 py-2">
                      <CeldaEditor
                        key={`${f.plantaId}-${t.clave}-${c.apertura}-${c.cierre}-${c.activo}`}
                        plantaId={f.plantaId}
                        celda={c}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AjustesCosto costoFicha={costoFicha} umbralPct={umbralPct} />
    </div>
  );
}

function CeldaEditor({ plantaId, celda }: { plantaId: number; celda: CeldaHorario }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [apertura, setApertura] = useState(celda.apertura);
  const [cierre, setCierre] = useState(celda.cierre);
  const [activo, setActivo] = useState(celda.activo);

  const guardar = (siguiente?: { activo?: boolean }) => {
    const act = siguiente?.activo ?? activo;
    startTransition(async () => {
      const r = await guardarHorarioPlantaAction(plantaId, celda.tipoDia, apertura, cierre, act);
      if (!r.ok) {
        alert(r.mensaje ?? "No se pudo guardar el horario.");
        setApertura(celda.apertura);
        setCierre(celda.cierre);
        setActivo(celda.activo);
      } else router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <label className="flex items-center gap-1 text-[11px] text-muted" title="Si se desmarca, todo el día es extraordinario">
        <input
          type="checkbox"
          checked={activo}
          disabled={pendiente}
          onChange={(e) => {
            setActivo(e.target.checked);
            guardar({ activo: e.target.checked });
          }}
          className="accent-accent"
        />
        Abre
      </label>
      <input
        value={apertura}
        disabled={!activo || pendiente}
        onChange={(e) => setApertura(e.target.value)}
        onBlur={() => apertura !== celda.apertura && guardar()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={inCls + " disabled:opacity-50"}
      />
      <span className="text-xs text-muted">a</span>
      <input
        value={cierre}
        disabled={!activo || pendiente}
        onChange={(e) => setCierre(e.target.value)}
        onBlur={() => cierre !== celda.cierre && guardar()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={inCls + " disabled:opacity-50"}
      />
    </div>
  );
}

/** Costo por m³ de la ficha y umbral de resaltado del reporte de horario extraordinario. */
function AjustesCosto({ costoFicha, umbralPct }: { costoFicha: number; umbralPct: number }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [costo, setCosto] = useState(costoFicha.toFixed(2));
  const [umbral, setUmbral] = useState(String(umbralPct));

  const guardarCosto = () => {
    if (costo === costoFicha.toFixed(2)) return;
    startTransition(async () => {
      const r = await guardarCostoFichaAction(costo);
      if (!r.ok) {
        alert(r.mensaje ?? "No se pudo guardar.");
        setCosto(costoFicha.toFixed(2));
      } else router.refresh();
    });
  };
  const guardarUmbral = () => {
    if (umbral === String(umbralPct)) return;
    startTransition(async () => {
      const r = await guardarUmbralExtraAction(umbral);
      if (!r.ok) {
        alert(r.mensaje ?? "No se pudo guardar.");
        setUmbral(String(umbralPct));
      } else router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-border bg-content/40 p-4">
      <h3 className="mb-1 text-sm font-semibold text-ink">
        Parámetros del reporte de horario extraordinario
      </h3>
      <p className="mb-3 text-xs text-muted">
        Ambos cambios quedan en la bitácora. El costo de la ficha es lo que la ficha de costos
        absorbe de sobretiempo por cada m³ producido.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-muted">
          Costo en ficha (L por m³)
          <input
            value={costo}
            disabled={pendiente}
            inputMode="decimal"
            onChange={(e) => setCosto(e.target.value)}
            onBlur={guardarCosto}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="mt-0.5 block w-32 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="text-xs text-muted">
          Umbral para resaltar (% de volumen extra)
          <input
            value={umbral}
            disabled={pendiente}
            inputMode="numeric"
            onChange={(e) => setUmbral(e.target.value)}
            onBlur={guardarUmbral}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="mt-0.5 block w-32 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-ink outline-none focus:border-accent"
          />
        </label>
      </div>
    </div>
  );
}
