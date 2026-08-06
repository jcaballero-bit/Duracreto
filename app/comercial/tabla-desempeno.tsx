"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import { guardarMetaAction } from "./actions";

export interface SemanaFila {
  label: string;
  m3Vendidos: number;
  precisionPct: number | null;
  confirmacionPct: number | null;
}
export interface FilaDesempeno {
  asesorId: number;
  nombre: string;
  m3Vendidos: number;
  metaM3: number | null;
  cumplimientoPct: number | null;
  precisionPct: number | null;
  confirmacionPct: number | null;
  adicionesM3: number;
  adicionesCount: number;
  cancelacionesCount: number;
  cancelacionesM3: number;
  semanas: SemanaFila[];
}

/** Color de semáforo por umbrales (verde/amarillo/rojo) o gris si no hay dato. */
function tono(pct: number | null, verde: number, amarillo: number): string {
  if (pct == null) return "text-muted";
  if (pct >= verde) return "text-ok";
  if (pct >= amarillo) return "text-warn";
  return "text-danger";
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function TablaDesempeno({
  filas,
  anio,
  mes,
  periodo,
  zonaParam,
  puedeEditar,
}: {
  filas: FilaDesempeno[];
  anio: number;
  mes: number;
  periodo: string;
  zonaParam: string;
  puedeEditar: boolean;
}) {
  const detalleUrl = (id: number) => {
    const params = new URLSearchParams({ periodo });
    if (zonaParam !== "todas") params.set("zona", zonaParam);
    return `/comercial/asesor/${id}?${params.toString()}`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Asesor</th>
            <th className="px-3 py-2 text-right">m³ vendidos</th>
            <th className="px-3 py-2 text-right">Meta / cumplimiento</th>
            <th className="px-3 py-2 text-right">Precisión proyección</th>
            <th className="px-3 py-2 text-right">Confirmación a tiempo</th>
            <th className="px-3 py-2 text-right">Adiciones</th>
            <th className="px-3 py-2 text-right">Cancelaciones</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-muted">
                {zonaParam === "todas"
                  ? "No hay asesores registrados."
                  : `Ningún asesor asignado a ${zonaParam} ni con actividad este mes. Asigna la zona en Admin › Asesores.`}
              </td>
            </tr>
          ) : (
            filas.map((f) => (
              <Fragment key={f.asesorId}>
                {/* Fila del asesor: totales del MES + meta editable. */}
                <tr className="border-b border-border/60">
                  <td className="px-3 py-2">
                    <Link href={detalleUrl(f.asesorId)} className="group flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                        {iniciales(f.nombre)}
                      </span>
                      <span className="font-medium text-ink group-hover:text-accent group-hover:underline">
                        {f.nombre}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-ink">
                    {f.m3Vendidos.toFixed(1)} m³
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <MetaCelda
                        asesorId={f.asesorId}
                        anio={anio}
                        mes={mes}
                        metaM3={f.metaM3}
                        puedeEditar={puedeEditar}
                      />
                      <span className={`w-24 text-right font-semibold ${tono(f.cumplimientoPct, 95, 80)}`}>
                        {f.cumplimientoPct == null
                          ? "Sin meta definida"
                          : `${f.cumplimientoPct.toFixed(0)}%`}
                      </span>
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${tono(f.precisionPct, 90, 75)}`}>
                    {f.precisionPct == null ? "—" : `${f.precisionPct.toFixed(0)}%`}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${tono(f.confirmacionPct, 90, 70)}`}>
                    {f.confirmacionPct == null ? "—" : `${f.confirmacionPct.toFixed(0)}%`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {f.adicionesM3 > 0 ? (
                      <span className="font-semibold text-amber-600">
                        +{f.adicionesM3.toFixed(1)} m³
                        <span className="ml-1 text-xs font-normal text-muted">
                          ({f.adicionesCount})
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {f.cancelacionesCount > 0 ? (
                      <span className="font-semibold text-danger">
                        {f.cancelacionesCount}
                        <span className="ml-1 text-xs font-normal text-muted">
                          ({f.cancelacionesM3.toFixed(0)} m³)
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Celda de meta: editable in situ por el Gerente/Admin. */
function MetaCelda({
  asesorId,
  anio,
  mes,
  metaM3,
  puedeEditar,
}: {
  asesorId: number;
  anio: number;
  mes: number;
  metaM3: number | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [val, setVal] = useState(metaM3 != null ? String(metaM3) : "");
  const [pendiente, startTransition] = useTransition();
  useEffect(() => {
    setVal(metaM3 != null ? String(metaM3) : "");
  }, [metaM3]);

  if (!puedeEditar) {
    return (
      <span className="w-20 text-right text-muted">
        {metaM3 != null ? `${metaM3.toFixed(0)} m³` : "—"}
      </span>
    );
  }

  const commit = () => {
    const n = val.trim() === "" ? null : Number.parseFloat(val);
    if (n != null && Number.isNaN(n)) {
      setVal(metaM3 != null ? String(metaM3) : "");
      return;
    }
    if ((n ?? 0) === (metaM3 ?? 0)) return;
    startTransition(async () => {
      const res = await guardarMetaAction(asesorId, anio, mes, n);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo guardar la meta.");
    });
  };

  return (
    <input
      type="number"
      min="0"
      step="1"
      value={val}
      disabled={pendiente}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="meta"
      title="Meta de m³ del mes (escribe para editar)"
      className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
    />
  );
}
