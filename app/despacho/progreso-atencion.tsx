// Barra de progreso de los clientes que se están atendiendo AHORA en el despacho:
// muestra el % ya DESPACHADO (m³ de viajes Completado) contra lo PROGRAMADO.
// Es solo presentación; se refresca con el AutoRefresh de la página.

export interface AtencionCliente {
  pedidoId: number;
  cliente: string;
  proyecto: string;
  plantelNombre: string;
  total: number; // m³ programados
  despachado: number; // m³ ya despachados (viajes que salieron de planta)
  pct: number; // 0-100
  viajesDespachados: number;
  viajesTotales: number;
  enCurso: boolean; // hay un viaje activo en este momento (cargando/en ruta/…)
}

export function ProgresoAtencion({ items }: { items: AtencionCliente[] }) {
  if (items.length === 0) {
    return (
      <p className="py-2 text-sm text-muted">
        Ningún cliente en atención en este momento.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((a) => (
        <div key={a.pedidoId} className="rounded-lg border border-border p-3">
          <div className="mb-1.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-ink">
                  {a.cliente}
                </span>
                {a.enCurso && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    En curso
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-muted">
                {a.plantelNombre}
                {a.proyecto && <span> · {a.proyecto}</span>} · {a.viajesDespachados}/
                {a.viajesTotales} viajes despachados
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold text-ink">{a.pct}%</div>
              <div className="text-xs text-muted">
                {a.despachado} / {a.total} m³
              </div>
            </div>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-content">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${a.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
