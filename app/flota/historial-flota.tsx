import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";

export interface DiaCelda {
  d: number;
  estado: "activo" | "mant" | "fuera";
  detalle: string; // texto para el tooltip (motivo / quién)
}
export interface UnidadHist {
  id: number;
  label: string;
  dias: DiaCelda[];
}
export interface TipoOpcion {
  tipo: string;
  label: string;
  href: string;
  activo: boolean;
}

const COLOR: Record<DiaCelda["estado"], string> = {
  activo: "bg-emerald-200",
  mant: "bg-blue-300",
  fuera: "bg-red-300",
};

/** Mapa de calor del historial de disponibilidad por unidad (una fila por unidad,
 *  columnas = días del mes). Presentacional (server component). */
export function HistorialFlota({
  tipos,
  unidades,
  diasMes,
  promedio,
  totalUnidades,
  mesLabel,
  hrefMesPrev,
  hrefMesNext,
}: {
  tipos: TipoOpcion[];
  unidades: UnidadHist[];
  diasMes: number;
  promedio: number;
  totalUnidades: number;
  mesLabel: string;
  hrefMesPrev: string;
  hrefMesNext: string;
}) {
  const cols = Array.from({ length: diasMes }, (_, i) => i + 1);

  return (
    <div>
      {/* Promedio de unidades activas por día */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-content/40 p-4">
        <div>
          <div className="flex items-center gap-1 text-xs text-muted">
            Promedio de unidades activas por día
            <span
              title="Aproximación: usa la flota ACTUAL del catálogo para todo el mes. Si se agregó o dio de baja una unidad a mitad del periodo, los días previos/posteriores no son exactos. Es una referencia operativa, no un dato contable."
              className="cursor-help"
            >
              <Info size={13} />
            </span>
          </div>
          <div className="mt-1 text-3xl font-bold text-ink">
            {promedio.toFixed(1)}
            <span className="ml-2 text-base font-normal text-muted">de {totalUnidades}</span>
          </div>
        </div>
      </div>

      {/* Controles: tipo + navegación de mes */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {tipos.map((t) => (
            <Link
              key={t.tipo}
              href={t.href}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
                (t.activo ? "bg-accent text-white" : "bg-content/60 text-ink hover:bg-content")
              }
            >
              {t.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href={hrefMesPrev} className="rounded-md p-1 text-muted hover:bg-content hover:text-ink" aria-label="Mes anterior">
            <ChevronLeft size={18} />
          </Link>
          <span className="min-w-[140px] text-center text-sm font-semibold capitalize text-ink">{mesLabel}</span>
          <Link href={hrefMesNext} className="rounded-md p-1 text-muted hover:bg-content hover:text-ink" aria-label="Mes siguiente">
            <ChevronRight size={18} />
          </Link>
        </div>
      </div>

      {/* Leyenda */}
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-200" /> Activo</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-blue-300" /> Mantenimiento</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-300" /> Fuera de servicio</span>
      </div>

      {/* Mapa de calor */}
      {unidades.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No hay unidades de este tipo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-[2px] text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface px-2 text-left font-medium text-muted">Unidad</th>
                {cols.map((d) => (
                  <th key={d} className="w-5 text-center font-normal text-muted">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unidades.map((u) => (
                <tr key={u.id}>
                  <td className="sticky left-0 bg-surface px-2 py-0.5 whitespace-nowrap font-medium text-ink">
                    {u.label}
                  </td>
                  {u.dias.map((c) => (
                    <td key={c.d}>
                      <div
                        title={c.detalle}
                        className={`h-5 w-5 rounded ${COLOR[c.estado]} ${c.estado !== "activo" ? "cursor-help" : ""}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
