"use client";

// Gantt ESPEJO del modo manual: mismas 2 secciones (Plantas = cargas, Mixers =
// ciclos completos) en el mismo eje de horas con líneas verticales por hora. A
// diferencia del Gantt automático, aquí el color es por CLIENTE (hex determinista),
// el bloque en edición se resalta, y los bloques son ARRASTRABLES para ajuste fino
// (al soltar, avisa la nueva hora de carga — no reprograma a nadie más).
import { useRef } from "react";

export interface BarraManual {
  id: number | string; // = id del viaje (para arrastrar/resaltar)
  inicioMs: number;
  finMs: number;
  etiqueta: string;
  colorHex: string;
  titulo?: string;
  arrastrable?: boolean; // solo la sección de plantas mueve la hora de carga
}
export interface FilaGanttM {
  id: string | number;
  label: string;
  barras: BarraManual[];
}
export interface SeccionGanttM {
  titulo: string;
  filas: FilaGanttM[];
}

const HORA_MS = 3_600_000;

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}

export function GanttManual({
  secciones,
  highlightId,
  onMoverInicio,
}: {
  secciones: SeccionGanttM[];
  highlightId?: number | string | null;
  // Al soltar un bloque arrastrable: nuevo inicio de carga (ms, ya redondeado al minuto).
  onMoverInicio?: (viajeId: number | string, nuevoInicioMs: number) => void;
}) {
  const todas = secciones.flatMap((s) => s.filas.flatMap((f) => f.barras));
  if (todas.length === 0) {
    return <p className="text-sm text-muted">Aún no hay viajes este día para graficar.</p>;
  }
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
      {/* Encabezado de horas */}
      <div className="flex">
        <div className="w-28 shrink-0" />
        <div className="relative h-5 flex-1">
          {horas.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 text-[10px] text-muted" style={{ left: `${pct(t)}%` }}>
              {hhmm(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        {secciones.map((sec) => (
          <div key={sec.titulo}>
            <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{sec.titulo}</div>
            {sec.filas.length === 0 ? (
              <div className="pl-28 text-xs text-muted">Sin actividad este día.</div>
            ) : (
              <div className="space-y-1">
                {sec.filas.map((f) => (
                  <Pista
                    key={f.id}
                    fila={f}
                    desde={desde}
                    span={span}
                    highlightId={highlightId}
                    onMoverInicio={onMoverInicio}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Overlay de líneas de hora */}
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
    </div>
  );
}

function Pista({
  fila,
  desde,
  span,
  highlightId,
  onMoverInicio,
}: {
  fila: FilaGanttM;
  desde: number;
  span: number;
  highlightId?: number | string | null;
  onMoverInicio?: (viajeId: number | string, nuevoInicioMs: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = (ms: number) => ((ms - desde) / span) * 100;

  const iniciarArrastre = (
    ev: React.PointerEvent,
    barra: BarraManual,
  ) => {
    if (!barra.arrastrable || !onMoverInicio) return;
    const track = trackRef.current;
    if (!track) return;
    ev.preventDefault();
    const anchoPx = track.getBoundingClientRect().width;
    const startX = ev.clientX;
    const startInicio = barra.inicioMs;
    const mover = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dt = (dx / anchoPx) * span;
      // Vista previa opcional: aquí solo movemos al soltar (evita spam de guardados).
      void dt;
    };
    const soltar = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dt = (dx / anchoPx) * span;
      const nuevo = Math.round((startInicio + dt) / 60_000) * 60_000; // snap al minuto
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      if (Math.abs(nuevo - startInicio) >= 60_000) onMoverInicio(barra.id, nuevo);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-28 shrink-0 truncate text-xs font-medium text-ink" title={fila.label}>
        {fila.label}
      </div>
      <div ref={trackRef} className="relative h-7 flex-1 rounded bg-neutral-100 dark:bg-neutral-800">
        {fila.barras.map((b) => {
          const left = pct(b.inicioMs);
          const width = Math.max(1.2, pct(b.finMs) - left);
          const resaltado = highlightId != null && b.id === highlightId;
          return (
            <div
              key={`${b.id}-${b.inicioMs}`}
              title={b.titulo ?? `${b.etiqueta} · ${hhmm(b.inicioMs)}–${hhmm(b.finMs)}`}
              onPointerDown={(e) => iniciarArrastre(e, b)}
              className={`absolute top-0.5 h-6 overflow-hidden rounded px-1 text-[10px] leading-6 text-white ${
                b.arrastrable && onMoverInicio ? "cursor-ew-resize" : ""
              } ${resaltado ? "ring-2 ring-offset-1 ring-accent" : ""}`}
              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: b.colorHex }}
            >
              {b.etiqueta}
            </div>
          );
        })}
      </div>
    </div>
  );
}
