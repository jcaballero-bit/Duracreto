"use client";

// Gráfico de tendencia de producción, a la derecha del calendario del Panel Principal.
//
// Grafica la MISMA producción que el calendario (viajes Completado, volumen real,
// atribuidos al día del pedido), agrupada por semana, mes o año. Dibujado en SVG a mano:
// el proyecto no tiene librería de gráficos (el registro corporativo bloquea
// `npm install`) y una línea es geometría simple.
//
// Tres decisiones de lectura que conviene no deshacer:
//
//  · **Total y planteles nunca se mezclan.** El total es la suma de las líneas, así que
//    en la misma escala las aplastaría a todas contra el piso. Por eso "Total" es
//    excluyente con la selección individual.
//  · **Sin relleno bajo las líneas.** Con varias series las áreas se superponen y no se
//    distingue cuál está arriba.
//  · **Un periodo futuro corta la línea**, no vale cero. La distinción entre "no se
//    produjo" y "todavía no ocurre" es justamente lo que hace útil una tendencia.

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Info, TrendingUp } from "lucide-react";
import { datosTendenciaAction } from "./tendencia-actions";
import {
  cortesEjeY,
  GRANULARIDADES,
  LINEAS_COMODAS,
  maximoVisible,
  type DatosTendencia,
  type Granularidad,
} from "@/lib/produccion/tendencia";

export interface PlantelOpcion {
  id: number;
  nombre: string;
  color: string;
}

// Geometría del lienzo. `viewBox` fijo + `width:100%`: el SVG escala con la tarjeta sin
// tener que medir el contenedor.
const W = 560;
const H = 260;
const M = { arriba: 12, derecha: 12, abajo: 26, izquierda: 44 };
const AREA_W = W - M.izquierda - M.derecha;
const AREA_H = H - M.arriba - M.abajo;

export function TendenciaProduccion({
  inicial,
  planteles,
  etiquetaTotal,
  seleccionInicial,
}: {
  /** Datos con los que se renderizó en el servidor (sin parpadeo al abrir). */
  inicial: DatosTendencia;
  /** Planteles que el usuario puede graficar (ya acotados por el servidor). */
  planteles: PlantelOpcion[];
  etiquetaTotal: string;
  /** Selección con la que abre: `null` = total. */
  seleccionInicial: number[] | null;
}) {
  const [datos, setDatos] = useState<DatosTendencia>(inicial);
  const [seleccion, setSeleccion] = useState<number[] | null>(seleccionInicial);
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [cargando, iniciar] = useTransition();
  const [hover, setHover] = useState<number | null>(null);
  // Evita pisar el resultado de una petición con el de otra más vieja.
  const peticion = useRef(0);

  const pedir = useCallback(
    (g: Granularidad, refMs: number | undefined, sel: number[] | null) => {
      const mia = ++peticion.current;
      iniciar(async () => {
        const r = await datosTendenciaAction({
          granularidad: g,
          refMs,
          plantelIds: sel,
          recordar: true,
        });
        if (mia !== peticion.current) return; // llegó tarde: hay una más nueva
        if (r.ok && r.datos) {
          setDatos(r.datos);
          setError(null);
        } else {
          setError(r.mensaje ?? "No se pudo cargar la tendencia.");
        }
      });
    },
    [iniciar],
  );

  const cambiarGranularidad = (g: Granularidad) => {
    if (g === datos.granularidad) return;
    // Al cambiar de granularidad se vuelve al presente: el ancla anterior puede no
    // tener sentido en la nueva escala (una semana de hace un año en modo Año). Sin
    // `refMs` el servidor usa SU reloj, que es el autoritativo (la zona horaria está
    // fijada ahí) — el del navegador puede estar mal.
    setHover(null);
    pedir(g, undefined, seleccion);
  };

  const navegar = (dir: -1 | 1) => {
    const d = new Date(datos.refMs);
    // Semana muestra las semanas de UN mes, así que se navega por mes; Mes muestra los
    // 12 meses de un año, así que se navega por año.
    const nuevo =
      datos.granularidad === "semana"
        ? new Date(d.getFullYear(), d.getMonth() + dir, 1)
        : new Date(d.getFullYear() + dir, d.getMonth(), 1);
    setHover(null);
    pedir(datos.granularidad, nuevo.getTime(), seleccion);
  };

  const elegirTotal = () => {
    if (seleccion === null) return;
    setSeleccion(null);
    setOcultas(new Set());
    pedir(datos.granularidad, datos.refMs, null);
  };

  const alternarPlantel = (id: number) => {
    // Elegir un plantel apaga el total (y viceversa): no se mezclan en la misma escala.
    const base = seleccion ?? [];
    const siguiente = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    const sel = siguiente.length ? siguiente.sort((a, b) => a - b) : null;
    setSeleccion(sel);
    setOcultas(new Set());
    pedir(datos.granularidad, datos.refMs, sel);
  };

  // ── Geometría ────────────────────────────────────────────────────────────────
  const visibles = useMemo(
    () => datos.series.filter((s) => !ocultas.has(String(s.plantelId))),
    [datos.series, ocultas],
  );
  const max = useMemo(() => maximoVisible(visibles), [visibles]);
  const cortes = useMemo(() => cortesEjeY(max), [max]);
  const techo = cortes[cortes.length - 1];
  const n = datos.periodos.length;
  // Con un solo punto no hay línea: se centra para que el marcador no quede en el borde.
  const x = (i: number) => (n <= 1 ? M.izquierda + AREA_W / 2 : M.izquierda + (i * AREA_W) / (n - 1));
  const y = (v: number) => M.arriba + AREA_H - (v / techo) * AREA_H;

  /** Tramos continuos de una serie (un `null` de futuro parte la línea). */
  const tramos = (valores: (number | null)[]) => {
    const out: { i: number; v: number }[][] = [];
    let actual: { i: number; v: number }[] = [];
    valores.forEach((v, i) => {
      if (v == null) {
        if (actual.length) out.push(actual);
        actual = [];
      } else actual.push({ i, v });
    });
    if (actual.length) out.push(actual);
    return out;
  };

  // Etiquetas del eje X: con muchos periodos se muestran salteadas.
  const pasoX = n <= 13 ? 1 : Math.ceil(n / 12);

  const hayDatos = visibles.some((s) => s.valores.some((v) => v != null));
  const demasiadas = visibles.length > LINEAS_COMODAS;

  return (
    <div>
      {/* ── Encabezado y controles ───────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <TrendingUp size={15} className="text-accent" />
          Tendencia de producción
        </h2>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {GRANULARIDADES.map((g) => (
            <button
              key={g.valor}
              onClick={() => cambiarGranularidad(g.valor)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                datos.granularidad === g.valor
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-muted/10 hover:text-ink"
              }`}
            >
              {g.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* Navegación de periodo. En modo Año no hay a dónde ir: ya se ve toda la historia. */}
      <div className="mb-2 flex items-center gap-1">
        <button
          onClick={() => navegar(-1)}
          disabled={!datos.hayAnterior || cargando}
          title="Periodo anterior"
          className="rounded p-1 text-muted transition-colors hover:bg-muted/10 hover:text-ink disabled:opacity-30"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="min-w-[9rem] text-center text-xs font-semibold text-ink tabular-nums">
          {datos.titulo}
        </span>
        <button
          onClick={() => navegar(1)}
          disabled={!datos.haySiguiente || cargando}
          title="Periodo siguiente"
          className="rounded p-1 text-muted transition-colors hover:bg-muted/10 hover:text-ink disabled:opacity-30"
        >
          <ChevronRight size={15} />
        </button>
        {cargando && <span className="ml-1 text-[11px] text-muted">actualizando…</span>}
      </div>

      {/* ── Selector de planteles ────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <button
          onClick={elegirTotal}
          title="Una sola línea con la suma de todos los planteles de tu alcance"
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            seleccion === null
              ? "border-transparent bg-accent text-white"
              : "border-border text-muted hover:text-ink"
          }`}
        >
          {etiquetaTotal}
        </button>
        {planteles.map((p) => {
          const activo = seleccion?.includes(p.id) ?? false;
          return (
            <button
              key={p.id}
              onClick={() => alternarPlantel(p.id)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                activo ? "border-transparent text-white" : "border-border text-muted hover:text-ink"
              }`}
              style={activo ? { backgroundColor: p.color } : undefined}
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: activo ? "#fff" : p.color }}
              />
              {p.nombre}
            </button>
          );
        })}
      </div>

      {demasiadas && (
        <p className="mb-2 flex items-start gap-1 text-[11px] text-muted">
          <Info size={12} className="mt-0.5 shrink-0" />
          Con {visibles.length} líneas el gráfico cuesta de leer; puedes ocultar algunas
          haciendo clic en la leyenda.
        </p>
      )}

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      {/* ── Lienzo ───────────────────────────────────────────────────────── */}
      {!hayDatos ? (
        <p className="py-10 text-center text-sm text-muted">
          Sin producción registrada en este periodo.
        </p>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ height: H }}
            role="img"
            aria-label="Gráfico de líneas de producción por periodo"
            onMouseLeave={() => setHover(null)}
          >
            {/* Cuadrícula HORIZONTAL punteada y etiquetas del eje vertical en m³. */}
            {cortes.map((c) => (
              <g key={c}>
                <line
                  x1={M.izquierda}
                  x2={W - M.derecha}
                  y1={y(c)}
                  y2={y(c)}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text
                  x={M.izquierda - 6}
                  y={y(c) + 3.5}
                  textAnchor="end"
                  className="fill-[var(--color-muted)] text-[9px] tabular-nums"
                >
                  {c >= 1000 ? `${Math.round(c / 100) / 10}k` : c}
                </text>
              </g>
            ))}

            {/* Etiquetas del eje horizontal. */}
            {datos.periodos.map((p, i) =>
              i % pasoX === 0 ? (
                <text
                  key={p.clave}
                  x={x(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className={`text-[9px] ${p.futuro ? "fill-[var(--color-border)]" : "fill-[var(--color-muted)]"}`}
                >
                  {p.etiqueta}
                </text>
              ) : null,
            )}

            {/* Guía vertical del punto apuntado. */}
            {hover != null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={M.arriba}
                y2={M.arriba + AREA_H}
                stroke="var(--color-accent)"
                strokeWidth={1}
                strokeOpacity={0.25}
              />
            )}

            {/* Líneas: 2px, uniones y extremos redondeados, sin relleno. */}
            {visibles.map((s) =>
              tramos(s.valores).map((tramo, k) => (
                <polyline
                  key={`${s.plantelId}-${k}`}
                  points={tramo.map((pt) => `${x(pt.i)},${y(pt.v)}`).join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )),
            )}

            {/* Punto en el ÚLTIMO valor de cada línea (dónde terminó la tendencia). */}
            {visibles.map((s) => {
              const t = tramos(s.valores);
              const ult = t[t.length - 1]?.[t[t.length - 1].length - 1];
              if (!ult) return null;
              return (
                <circle
                  key={`ult-${s.plantelId}`}
                  cx={x(ult.i)}
                  cy={y(ult.v)}
                  r={3.5}
                  fill={s.color}
                  stroke="var(--color-content)"
                  strokeWidth={1.5}
                />
              );
            })}

            {/* Marcadores del punto apuntado. */}
            {hover != null &&
              visibles.map((s) => {
                const v = s.valores[hover];
                if (v == null) return null;
                return (
                  <circle
                    key={`hv-${s.plantelId}`}
                    cx={x(hover)}
                    cy={y(v)}
                    r={3}
                    fill={s.color}
                    stroke="var(--color-content)"
                    strokeWidth={1.5}
                  />
                );
              })}

            {/* Zonas sensibles: una banda por periodo, más anchas que los puntos para
                que apuntar (o tocar en celular) sea fácil. */}
            {datos.periodos.map((p, i) => (
              <rect
                key={`hit-${p.clave}`}
                x={x(i) - AREA_W / Math.max(1, (n - 1) * 2) - 2}
                y={M.arriba}
                width={AREA_W / Math.max(1, n - 1) + 4}
                height={AREA_H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
              />
            ))}
          </svg>

          {/* Tooltip: periodo + una línea por serie con su volumen. */}
          {hover != null && (
            <div
              className="pointer-events-none absolute top-2 z-10 rounded-md border border-border bg-content px-2 py-1.5 text-[11px] shadow-md"
              style={
                // Se coloca del lado contrario al punto para no taparlo.
                hover > n / 2 ? { left: 8 } : { right: 8 }
              }
            >
              <div className="mb-0.5 font-semibold text-ink">
                {datos.periodos[hover].etiquetaLarga}
              </div>
              {datos.periodos[hover].futuro ? (
                <div className="text-muted">Todavía no ocurre</div>
              ) : (
                visibles.map((s) => (
                  <div key={`tt-${s.plantelId}`} className="flex items-center gap-1.5">
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-muted">{s.nombre}</span>
                    <strong className="ml-auto pl-2 font-semibold text-ink tabular-nums">
                      {(s.valores[hover] ?? 0).toFixed(1)} m³
                    </strong>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Leyenda (clic para ocultar una línea sin cambiar la selección) ── */}
      {datos.series.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {datos.series.map((s) => {
            const clave = String(s.plantelId);
            const oculta = ocultas.has(clave);
            return (
              <button
                key={clave}
                onClick={() =>
                  setOcultas((prev) => {
                    const n2 = new Set(prev);
                    if (n2.has(clave)) n2.delete(clave);
                    else n2.add(clave);
                    return n2;
                  })
                }
                title={oculta ? "Mostrar esta línea" : "Ocultar esta línea"}
                className={`flex items-center gap-1 text-[11px] transition-opacity ${
                  oculta ? "opacity-35" : ""
                }`}
              >
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className={oculta ? "text-muted line-through" : "text-ink"}>{s.nombre}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
