// Gantt de recursos del día: 3 secciones (Plantas, Mixers, Bombas) compartiendo el
// MISMO eje horizontal de horas, con líneas verticales por hora en punto que cruzan
// todo el alto (para ver de un vistazo los tiempos muertos entre bloques). El rango
// del eje se ajusta al primer y último bloque del día (redondeado a la hora = margen).

export interface BarraGantt {
  id: string | number;
  inicioMs: number;
  finMs: number;
  etiqueta: string;
  color: string; // clase Tailwind bg-*
  titulo?: string; // tooltip
}
export interface FilaGantt {
  id: string | number;
  label: string;
  barras: BarraGantt[];
}
export interface SeccionGantt {
  titulo: string;
  filas: FilaGantt[];
}

const HORA_MS = 3_600_000;

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}

export function GanttRecursos({ secciones }: { secciones: SeccionGantt[] }) {
  const todas = secciones.flatMap((s) => s.filas.flatMap((f) => f.barras));
  if (todas.length === 0) {
    return (
      <p className="text-sm text-muted">
        Aún no hay viajes programados este día para graficar.
      </p>
    );
  }

  // Rango del eje = primer inicio → último fin, redondeado a la hora (margen natural).
  const min = Math.min(...todas.map((b) => b.inicioMs));
  const max = Math.max(...todas.map((b) => b.finMs));
  const desde = Math.floor(min / HORA_MS) * HORA_MS;
  const hasta = Math.max(desde + HORA_MS, Math.ceil(max / HORA_MS) * HORA_MS);
  const span = hasta - desde;
  const pct = (ms: number) => ((ms - desde) / span) * 100;

  const horas: number[] = [];
  for (let t = desde; t <= hasta; t += HORA_MS) horas.push(t);

  return (
    <div>
      {/* Encabezado de horas (alineado con las pistas) */}
      <div className="flex">
        <div className="w-28 shrink-0" />
        <div className="relative h-5 flex-1">
          {horas.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 text-[10px] text-muted"
              style={{ left: `${pct(t)}%` }}
            >
              {hhmm(t)}
            </span>
          ))}
        </div>
      </div>

      {/* Cuerpo: secciones + overlay de líneas de hora que cruza todo el alto */}
      <div className="relative">
        {secciones.map((sec) => (
          <div key={sec.titulo}>
            <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
              {sec.titulo}
            </div>
            {sec.filas.length === 0 ? (
              <div className="pl-28 text-xs text-muted">Sin actividad este día.</div>
            ) : (
              <div className="space-y-1">
                {sec.filas.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <div className="w-28 shrink-0 truncate text-xs font-medium text-ink" title={f.label}>
                      {f.label}
                    </div>
                    <div className="relative h-7 flex-1 rounded bg-neutral-100 dark:bg-neutral-800">
                      {f.barras.map((b) => {
                        const left = pct(b.inicioMs);
                        const width = Math.max(1.2, pct(b.finMs) - left);
                        return (
                          <div
                            key={b.id}
                            title={b.titulo ?? `${b.etiqueta} · ${hhmm(b.inicioMs)}–${hhmm(b.finMs)}`}
                            className={`absolute top-0.5 h-6 overflow-hidden rounded px-1 text-[10px] leading-6 text-white ${b.color}`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                          >
                            {b.etiqueta}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Overlay de líneas de hora: sutiles, cruzan las 3 secciones (arriba del
            fondo de pista pero sin bloquear interacción). left-28 = ancho de la
            columna de etiquetas, para alinear con el inicio de las pistas. */}
        <div className="pointer-events-none absolute inset-y-0 left-28 right-0">
          {horas.map((t) => (
            <div
              key={t}
              className="absolute inset-y-0 w-px bg-neutral-300/60 dark:bg-neutral-600/60"
              style={{ left: `${pct(t)}%` }}
            />
          ))}
        </div>
      </div>

      {/* Leyenda */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        <Leyenda color="bg-emerald-500" texto="Flota propia" />
        <Leyenda color="bg-sky-500" texto="Préstamo de zona" />
        <Leyenda color="bg-amber-500" texto="Refuerzo excepcional" />
        <Leyenda color="bg-indigo-500" texto="Carga en planta" />
        <Leyenda color="bg-violet-500" texto="Bomba" />
      </div>
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded ${color}`} />
      {texto}
    </span>
  );
}
