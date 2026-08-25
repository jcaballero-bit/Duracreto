import type { FilaHora } from "@/lib/extraordinario/metricas";

/**
 * Distribución horaria del volumen despachado: una barra por franja de hora, partida
 * en la porción de horario normal y la de horario extraordinario.
 *
 * Dos categorías, dos tonos del sistema (navy = normal, ámbar = extraordinario, el
 * mismo ámbar que el resto de la app usa para "atención"), con 2 px de separación entre
 * segmentos. La identidad no depende solo del color: hay leyenda, el tooltip dice los
 * m³ de cada parte y debajo va la tabla con los mismos números.
 */
export function BarrasHora({ datos, alto = 200 }: { datos: FilaHora[]; alto?: number }) {
  if (datos.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Sin despachos en el periodo.</p>;
  }
  const max = Math.max(1, ...datos.map((d) => d.volumen));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" /> Horario normal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-500" /> Horario extraordinario
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <div
          className="flex items-end gap-1.5"
          style={{ height: alto, minWidth: datos.length > 12 ? datos.length * 42 : undefined }}
        >
          {datos.map((d) => {
            const hTotal = (d.volumen / max) * 100;
            const normal = d.volumen - d.volumenExtra;
            const pctExtra = d.volumen > 0 ? (d.volumenExtra / d.volumen) * 100 : 0;
            const pctNormal = 100 - pctExtra;
            return (
              <div
                key={d.hora}
                className="flex min-w-[26px] flex-1 flex-col items-center justify-end gap-1"
                style={{ height: "100%" }}
                title={`${d.etiqueta}: ${d.volumen} m³ en ${d.viajes} viaje(s) — normal ${Math.round(normal * 100) / 100} m³, extraordinario ${d.volumenExtra} m³`}
              >
                <span className="text-[10px] tabular-nums text-muted">
                  {d.volumen > 0 ? d.volumen : ""}
                </span>
                <div
                  className="flex w-full flex-col justify-end"
                  style={{ height: `${Math.max(hTotal, d.volumen > 0 ? 2 : 0)}%` }}
                >
                  {d.volumenExtra > 0 && (
                    <div
                      className="w-full rounded-t bg-amber-500"
                      style={{ height: `${pctExtra}%`, marginBottom: normal > 0 ? 2 : 0 }}
                    />
                  )}
                  {normal > 0 && (
                    <div
                      className={"w-full bg-accent " + (d.volumenExtra > 0 ? "" : "rounded-t")}
                      style={{ height: `${pctNormal}%` }}
                    />
                  )}
                </div>
                <span className="text-[10px] tabular-nums text-muted">
                  {String(d.hora).padStart(2, "0")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
