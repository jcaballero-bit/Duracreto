"use client";

import { useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { textoDuracion, tonoOcio } from "@/lib/asistencia/gantt";
import type { DatosGantt, DetalleViaje, FilaGantt } from "@/lib/asistencia/gantt-datos";

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const TONO_PCT: Record<string, string> = {
  ok: "text-emerald-600",
  warn: "text-amber-600",
  danger: "text-red-600",
};

/** Detalle abierto al hacer clic en un bloque o en un hueco. */
type Seleccion =
  | { tipo: "viaje"; fila: FilaGantt; viaje: DetalleViaje }
  | {
      tipo: "hueco";
      fila: FilaGantt;
      inicioMs: number;
      finMs: number;
      minutos: number;
      antes: DetalleViaje | null;
      despues: DetalleViaje | null;
    };

/**
 * Gantt de jornada vs. viajes: una fila por persona sobre un eje horizontal común.
 *
 * Tres capas por fila: la barra de jornada (el tiempo por el que se paga), los bloques
 * con viaje encima, y los tramos sin viaje asignado. El eje se ajusta al día real del
 * plantel, no a un horario fijo de 24 h.
 *
 * Los tramos sin viaje NO se leen como bajo rendimiento: pueden ser falta de pedidos, la
 * planta ocupada o una espera legítima. La vista muestra el dato; la lectura es de quien
 * la ve. Y los porcentajes NO son comparables entre puestos distintos.
 */
export function GanttJornada({ datos, fechaTexto }: { datos: DatosGantt; fechaTexto: string }) {
  const [sel, setSel] = useState<Seleccion | null>(null);
  const { ejeDesdeMs, ejeHastaMs } = datos;

  if (datos.filas.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        No hay personal activo en tu alcance para esta fecha.
      </p>
    );
  }
  if (ejeDesdeMs == null || ejeHastaMs == null) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        Nadie tiene jornada ni viajes registrados el {fechaTexto}. Captura las horas en la vista de
        tabla y aquí se verá el cruce con los viajes.
      </p>
    );
  }

  const total = ejeHastaMs - ejeDesdeMs;
  const pos = (ms: number) => ((ms - ejeDesdeMs) / total) * 100;
  const ancho = (a: number, b: number) => ((b - a) / total) * 100;

  // Líneas verticales en cada hora en punto.
  const horas: number[] = [];
  for (let t = ejeDesdeMs; t <= ejeHastaMs; t += 3_600_000) horas.push(t);

  const r = datos.resumen;

  return (
    <div>
      {/* ── Resumen del plantel ──────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Dato titulo="Horas de jornada" valor={`${r.horasJornada.toFixed(1)} h`} pie="tiempo pagado del día" />
        <Dato
          titulo="Horas con viaje"
          valor={`${r.horasProductivas.toFixed(1)} h`}
          pie={`${(100 - r.pctSinViaje).toFixed(1)} % de la jornada`}
        />
        <Dato
          titulo="Horas sin viaje asignado"
          valor={`${r.horasSinViaje.toFixed(1)} h`}
          pie={`${r.pctSinViaje.toFixed(1)} % de la jornada`}
        />
        <Dato
          titulo="Personas sobre su umbral"
          valor={String(r.personasEnRojo)}
          pie={`de ${r.personasMedidas} con medición por viaje`}
        />
      </div>

      {/* ── Advertencias y leyenda ───────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded bg-content ring-1 ring-border" /> Jornada
          pagada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded bg-accent" /> Con viaje
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded border border-dashed border-accent bg-accent/30" />{" "}
          Con viaje (horario estimado)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded border border-dashed border-amber-500 bg-amber-50" />{" "}
          Sin viaje asignado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded bg-accent ring-2 ring-red-400" /> Viaje fuera
          de la jornada marcada
        </span>
      </div>

      <p className="mb-4 flex items-start gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Los porcentajes <strong>no son comparables entre puestos</strong>: un motorista ocupa
          alrededor de 90 minutos por ciclo completo y un dosificador 15 a 20 por carga, así que con
          el mismo ritmo de trabajo el dosificador marca un porcentaje sin viaje mucho más alto. La
          comparación válida es entre personas del <strong>mismo puesto</strong>, y cada uno tiene su
          propia escala (Administración › Umbrales de tiempo sin viaje). Un tramo sin viaje puede
          deberse a falta de pedidos, a la planta ocupada o a una espera legítima.
        </span>
      </p>

      {/* ── Gantt ────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="min-w-[900px]">
          {/* Encabezado con las horas */}
          <div className="flex border-b border-border bg-content text-xs font-medium text-muted">
            <div className="w-[248px] shrink-0 px-3 py-2">Persona</div>
            <div className="relative flex-1 py-2">
              {horas.map((t) => (
                <span
                  key={t}
                  className="absolute -translate-x-1/2 tabular-nums"
                  style={{ left: `${pos(t)}%` }}
                >
                  {pad(new Date(t).getHours())}
                </span>
              ))}
            </div>
            <div className="w-[132px] shrink-0 px-3 py-2 text-right">Sin viaje</div>
          </div>

          {datos.filas.map((f) => {
            const tono = tonoOcio(f.resumen.pctSinViaje, f.umbrales);
            const viajePorId = new Map(f.viajes.map((v) => [v.id, v]));
            return (
              <div key={f.personaId} className="flex border-b border-border/60 last:border-b-0">
                {/* Izquierda: quién es */}
                <div className="w-[248px] shrink-0 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    {f.nombre}
                    {f.faltaJornada && (
                      <span title="Hizo viajes pero no tiene jornada capturada">
                        <AlertTriangle size={12} className="text-amber-600" />
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted">
                    {f.etiquetaPuesto} · <span className="tabular-nums">{f.jornadaTexto}</span>
                    {f.cruzaMedianoche && <span className="ml-1 text-amber-700">+1 día</span>}
                  </div>
                  <div className="truncate text-[11px] text-muted" title={f.unidad}>
                    {f.unidad}
                  </div>
                </div>

                {/* Centro: la línea de tiempo */}
                <div className="relative flex-1 py-3">
                  {/* Líneas de hora */}
                  {horas.map((t) => (
                    <span
                      key={t}
                      className="absolute inset-y-0 w-px bg-border/70"
                      style={{ left: `${pos(t)}%` }}
                    />
                  ))}

                  {/* Barra de jornada */}
                  {f.jornadaInicioMs != null && f.jornadaFinMs != null && (
                    <div
                      className="absolute top-1/2 h-6 -translate-y-1/2 rounded bg-content ring-1 ring-border"
                      style={{
                        left: `${pos(f.jornadaInicioMs)}%`,
                        width: `${ancho(f.jornadaInicioMs, f.jornadaFinMs)}%`,
                      }}
                      title={`Jornada ${f.jornadaTexto}`}
                    />
                  )}

                  {/* Huecos marcados */}
                  {f.resumen.huecos
                    .filter((h) => h.marcado)
                    .map((h) => (
                      <button
                        key={`h-${h.inicioMs}`}
                        type="button"
                        onClick={() =>
                          setSel({
                            tipo: "hueco",
                            fila: f,
                            inicioMs: h.inicioMs,
                            finMs: h.finMs,
                            minutos: h.minutos,
                            antes: h.viajeAntes != null ? viajePorId.get(h.viajeAntes) ?? null : null,
                            despues:
                              h.viajeDespues != null ? viajePorId.get(h.viajeDespues) ?? null : null,
                          })
                        }
                        className="absolute top-1/2 flex h-6 -translate-y-1/2 items-center justify-center overflow-hidden rounded border border-dashed border-amber-500 bg-amber-50 text-[10px] font-medium text-amber-800 hover:bg-amber-100"
                        style={{
                          left: `${pos(h.inicioMs)}%`,
                          width: `${ancho(h.inicioMs, h.finMs)}%`,
                        }}
                        title={`${textoDuracion(h.minutos)} sin viaje asignado (${hm(h.inicioMs)}–${hm(h.finMs)})`}
                      >
                        {ancho(h.inicioMs, h.finMs) > 7 ? `${textoDuracion(h.minutos)} sin viaje` : ""}
                      </button>
                    ))}

                  {/* Bloques con viaje */}
                  {f.resumen.tramos.map((t) => {
                    const v = viajePorId.get(t.viajeId);
                    return (
                      <button
                        key={`t-${t.inicioMs}-${t.viajeId}`}
                        type="button"
                        onClick={() => v && setSel({ tipo: "viaje", fila: f, viaje: v })}
                        className={
                          "absolute top-1/2 h-4 -translate-y-1/2 rounded hover:brightness-110 " +
                          (t.estimado
                            ? "border border-dashed border-accent bg-accent/30"
                            : "bg-accent")
                        }
                        style={{
                          left: `${pos(t.inicioMs)}%`,
                          width: `${Math.max(ancho(t.inicioMs, t.finMs), 0.4)}%`,
                        }}
                        title={`${v?.cliente ?? "Viaje"} · ${hm(t.inicioMs)}–${hm(t.finMs)}${t.estimado ? " (horario estimado)" : ""}`}
                      />
                    );
                  })}

                  {/* Tramos fuera de la jornada marcada */}
                  {f.resumen.fueraDeJornada.map((t) => (
                    <div
                      key={`fj-${t.inicioMs}`}
                      className="absolute top-1/2 h-4 -translate-y-1/2 rounded bg-accent ring-2 ring-red-400"
                      style={{
                        left: `${pos(t.inicioMs)}%`,
                        width: `${Math.max(ancho(t.inicioMs, t.finMs), 0.4)}%`,
                      }}
                      title={`Viaje fuera de la jornada marcada (${hm(t.inicioMs)}–${hm(t.finMs)}): revisa la marca del reloj`}
                    />
                  ))}
                </div>

                {/* Derecha: sin viaje */}
                <div className="w-[132px] shrink-0 px-3 py-2 text-right">
                  {f.mide ? (
                    f.resumen.minutosJornada > 0 ? (
                      <>
                        <div className="text-sm tabular-nums text-ink">
                          {textoDuracion(f.resumen.minutosSinViaje)}
                        </div>
                        <div className={"text-xs font-semibold tabular-nums " + TONO_PCT[tono]}>
                          {f.resumen.pctSinViaje.toFixed(1)} %
                        </div>
                        <div className="text-[10px] text-muted">
                          umbral {f.umbrales.verde_pct}/{f.umbrales.amarillo_pct} %
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-amber-700">
                        {f.faltaJornada ? "falta la jornada" : "sin jornada"}
                      </div>
                    )
                  ) : (
                    <div className="text-[11px] text-muted">{f.motivoNoMide}</div>
                  )}
                  {f.viajesSinHorario > 0 && (
                    <div className="text-[10px] text-amber-700">
                      {f.viajesSinHorario} viaje(s) sin horario
                    </div>
                  )}
                  {f.descargasCompartidas > 0 && (
                    <div
                      className="text-[10px] text-muted"
                      title="La descarga cayó también en la jornada de otro operador de la misma bomba (relevo traslapado): se cuenta para los dos"
                    >
                      {f.descargasCompartidas} en relevo
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Avisos de datos faltantes */}
      {r.personasSinJornada > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {r.personasSinJornada}{" "}
            {r.personasSinJornada === 1 ? "persona hizo viajes" : "personas hicieron viajes"} sin
            jornada capturada ese día. No es un cero: falta el dato, y hasta capturarlo no se puede
            saber cuánto de su tiempo pagado tuvo viaje. Se captura en la vista de tabla.
          </span>
        </p>
      )}

      {r.descargasSinOperador > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {r.descargasSinOperador} descarga(s) de bomba no cayeron en la jornada de ninguno de sus
            operadores. O falta capturar esa jornada, o falta registrar quién operó la bomba (se
            marca en Flota › Equipo › Bombas, donde se puede poner a varios: se relevan por turno).
          </span>
        </p>
      )}

      {/* ── Detalle ──────────────────────────────────────────────────────── */}
      {sel && <PanelDetalle sel={sel} cerrar={() => setSel(null)} />}
    </div>
  );
}

function Dato({ titulo, valor, pie }: { titulo: string; valor: string; pie?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs text-muted">{titulo}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{valor}</div>
      {pie && <div className="mt-0.5 text-xs text-muted">{pie}</div>}
    </div>
  );
}

function PanelDetalle({ sel, cerrar }: { sel: Seleccion; cerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/20 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {sel.tipo === "viaje" ? "Viaje" : "Tramo sin viaje asignado"}
            </h3>
            <p className="text-xs text-muted">
              {sel.fila.nombre} · {sel.fila.etiquetaPuesto}
            </p>
          </div>
          <button
            type="button"
            onClick={cerrar}
            className="rounded-lg p-1 text-muted hover:bg-content hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {sel.tipo === "viaje" ? (
          <div className="space-y-2 text-sm">
            <Campo etiqueta="Cliente">
              {sel.viaje.cliente}
              {sel.viaje.proyecto ? ` — ${sel.viaje.proyecto}` : ""}
            </Campo>
            <Campo etiqueta="Volumen">{sel.viaje.volumen.toFixed(2)} m³</Campo>
            <Campo etiqueta="Planta de carga">{sel.viaje.planta}</Campo>
            {sel.viaje.mixer && <Campo etiqueta="Mixer">{sel.viaje.mixer}</Campo>}
            <div className="mt-3 rounded-lg border border-border bg-content/40 p-3">
              <div className="mb-1 text-xs font-medium text-muted">Horarios del ciclo</div>
              <table className="w-full text-xs">
                <tbody>
                  {sel.viaje.ciclo.map((c) => (
                    <tr key={c.etiqueta}>
                      <td className="py-0.5 text-muted">{c.etiqueta}</td>
                      <td className="py-0.5 text-right tabular-nums text-ink">{c.hora}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sel.viaje.estimado && (
              <p className="text-xs text-amber-700">
                Este bloque se dibujó con horas <strong>programadas</strong>: falta el registro real
                del segmento.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <Campo etiqueta="Desde">{hm(sel.inicioMs)}</Campo>
            <Campo etiqueta="Hasta">{hm(sel.finMs)}</Campo>
            <Campo etiqueta="Duración">{textoDuracion(sel.minutos)}</Campo>
            <div className="mt-3 space-y-2">
              <div className="rounded-lg border border-border bg-content/40 p-3 text-xs">
                <div className="mb-0.5 font-medium text-muted">Viaje anterior</div>
                {sel.antes ? (
                  <span className="text-ink">
                    {sel.antes.cliente} · {sel.antes.volumen.toFixed(2)} m³
                  </span>
                ) : (
                  <span className="text-muted">Ninguno: el hueco arranca con la jornada.</span>
                )}
              </div>
              <div className="rounded-lg border border-border bg-content/40 p-3 text-xs">
                <div className="mb-0.5 font-medium text-muted">Viaje siguiente</div>
                {sel.despues ? (
                  <span className="text-ink">
                    {sel.despues.cliente} · {sel.despues.volumen.toFixed(2)} m³
                  </span>
                ) : (
                  <span className="text-muted">Ninguno: el hueco llega hasta el fin de la jornada.</span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted">
              Un tramo sin viaje no dice por qué pasó: puede ser falta de pedidos, la planta ocupada
              o una espera legítima.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{etiqueta}</span>
      <span className="text-right font-medium text-ink">{children}</span>
    </div>
  );
}
