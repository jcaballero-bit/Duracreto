// Línea de tiempo simple: una fila por mixer, una barra por viaje.
// Sirve para verificar VISUALMENTE que ningún mixer tiene viajes traslapados.

export interface BarraViaje {
  viajeId: number;
  inicioMs: number;
  finMs: number;
  etiqueta: string;
  origen: string;
}

export interface FilaMixer {
  mixerId: number;
  mixerLabel: string;
  barras: BarraViaje[];
}

const COLOR_ORIGEN: Record<string, string> = {
  "Flota propia": "bg-emerald-500",
  "Préstamo de zona": "bg-sky-500",
  "Refuerzo excepcional": "bg-amber-500",
};

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-HN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Timeline({ filas }: { filas: FilaMixer[] }) {
  if (filas.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Aún no hay viajes programados. Crea un pedido para verlos aquí.
      </p>
    );
  }

  const todas = filas.flatMap((f) => f.barras);
  const min = Math.min(...todas.map((b) => b.inicioMs));
  const max = Math.max(...todas.map((b) => b.finMs));
  const span = Math.max(1, max - min);
  const pct = (ms: number) => ((ms - min) / span) * 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-neutral-500">
        <span>{hhmm(min)}</span>
        <span>{hhmm(max)}</span>
      </div>
      <div className="space-y-1">
        {filas.map((fila) => (
          <div key={fila.mixerId} className="flex items-center gap-2">
            <div className="w-28 shrink-0 truncate text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {fila.mixerLabel}
            </div>
            <div className="relative h-7 flex-1 rounded bg-neutral-100 dark:bg-neutral-800">
              {fila.barras.map((b) => {
                const left = pct(b.inicioMs);
                const width = Math.max(1.5, pct(b.finMs) - left);
                return (
                  <div
                    key={b.viajeId}
                    title={`${b.etiqueta} · ${hhmm(b.inicioMs)}–${hhmm(b.finMs)} · ${b.origen}`}
                    className={`absolute top-0.5 h-6 overflow-hidden rounded px-1 text-[10px] leading-6 text-white ${
                      COLOR_ORIGEN[b.origen] ?? "bg-neutral-500"
                    }`}
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
      <div className="flex flex-wrap gap-3 pt-1 text-xs text-neutral-500">
        <Leyenda color="bg-emerald-500" texto="Flota propia" />
        <Leyenda color="bg-sky-500" texto="Préstamo de zona" />
        <Leyenda color="bg-amber-500" texto="Refuerzo excepcional" />
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
