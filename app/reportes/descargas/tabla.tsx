"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, AlertTriangle } from "lucide-react";
import {
  ordenarDetalle,
  type ColumnaDetalle,
  type Tono,
  type ViajeAnalizado,
} from "@/lib/reportes/descargas";

/**
 * Fila de la tabla: el análisis + los textos ya formateados.
 *
 * Las horas se formatean en el SERVIDOR, donde la zona horaria está fijada a
 * America/Tegucigalpa (`instrumentation.ts`). Si se formatearan aquí, cada navegador
 * las mostraría en su propia zona y un reporte abierto desde otro país diría horas
 * distintas para el mismo viaje. El orden sí se hace aquí, sobre los milisegundos.
 */
export interface FilaDescarga extends ViajeAnalizado {
  fechaTxt: string;
  llegadaTxt: string;
  inicioTxt: string;
  finTxt: string;
}

const COLS: { key: ColumnaDetalle; label: string; num?: boolean; ayuda?: string }[] = [
  { key: "fecha", label: "Fecha" },
  { key: "cliente", label: "Cliente / proyecto" },
  { key: "numero", label: "Viaje", num: true },
  { key: "mixer", label: "Mixer" },
  { key: "volumen", label: "Vol.", num: true },
  { key: "llegada", label: "Llegada a obra", ayuda: "Hora real de llegada al proyecto" },
  { key: "inicioDescarga", label: "Inicio descarga" },
  { key: "finDescarga", label: "Fin descarga" },
  {
    key: "programada",
    label: "Prog. (min)",
    num: true,
    ayuda: "Tiempo de descarga pactado = frecuencia entre camiones del pedido",
  },
  { key: "real", label: "Real (min)", num: true },
  { key: "desviacion", label: "Desviación", num: true, ayuda: "Real menos programado" },
  {
    key: "espera",
    label: "Espera en obra",
    num: true,
    ayuda: "De la llegada al inicio de descarga: el mixer parado, cargado, sin descargar",
  },
];

const TONO: Record<Tono, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger font-semibold",
  neutro: "text-muted",
};

export function TablaDescargas({ filas }: { filas: FilaDescarga[] }) {
  const [col, setCol] = useState<ColumnaDetalle>("fecha");
  const [desc, setDesc] = useState(false);

  const ordenadas = useMemo(() => ordenarDetalle(filas, col, desc) as FilaDescarga[], [filas, col, desc]);

  const clic = (c: ColumnaDetalle) => {
    if (c === col) setDesc(!desc);
    else {
      setCol(c);
      // Las columnas de tiempo se leen mejor de mayor a menor: lo primero que
      // interesa es la desviación o la espera más grande.
      setDesc(c === "desviacion" || c === "espera" || c === "real");
    }
  };

  if (filas.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        No hay viajes con mixer asignado en este periodo y alcance.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="sticky top-0 bg-content">
          <tr className="text-left text-xs font-medium text-muted">
            {COLS.map((c) => (
              <th
                key={c.key}
                onClick={() => clic(c.key)}
                title={c.ayuda ?? `Ordenar por ${c.label}`}
                className={`cursor-pointer select-none px-2 py-2 hover:text-ink ${c.num ? "text-right" : ""}`}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {col === c.key &&
                    (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((f) => (
            <tr key={f.viajeId} className="border-t border-border/60">
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted">{f.fechaTxt}</td>
              <td className="px-2 py-1.5 text-ink">
                {f.cliente}
                {f.proyecto && <span className="text-muted"> · {f.proyecto}</span>}
                {!f.completo && (
                  <span
                    className="ml-1 inline-flex align-middle text-warn"
                    title={`Sin ${f.faltantes.join(", ")}: este viaje no entra a los promedios`}
                  >
                    <AlertTriangle size={12} />
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                {f.numero} de {f.totalDelPedido}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-ink">{f.mixer}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                {f.volumen.toFixed(1)}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-ink">{f.llegadaTxt}</td>
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-ink">{f.inicioTxt}</td>
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-ink">{f.finTxt}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                {f.programadaMin ?? "—"}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink">{f.realMin ?? "—"}</td>
              <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${TONO[f.tono]}`}>
                {f.desviacionMin == null ? (
                  "—"
                ) : (
                  <>
                    {f.desviacionMin > 0 ? "+" : ""}
                    {f.desviacionMin}
                    {f.desviacionPct != null && (
                      <span className="ml-1 text-[11px]">
                        ({f.desviacionPct > 0 ? "+" : ""}
                        {f.desviacionPct}%)
                      </span>
                    )}
                  </>
                )}
              </td>
              <td
                className={`px-2 py-1.5 text-right tabular-nums ${
                  f.esperaExcesiva ? "font-semibold text-danger" : "text-ink"
                }`}
              >
                {f.esperaMin ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
