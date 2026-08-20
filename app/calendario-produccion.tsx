"use client";

// Calendario de producción del Panel Principal: mapa de calor mensual de los m³
// realmente despachados, con el acumulado por semana y el desglose por plantel al
// tocar un día. Reemplaza el cuadro que se llevaba a mano en Excel.
//
// Es cliente solo por la selección del día (el desglose se despliega sin recargar);
// los datos y los permisos los resuelve el servidor (ver `lib/produccion/consulta.ts`)
// y el mes/zona viajan por la URL, así que el estado compartible sigue en el servidor.

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DIAS_SEMANA, MESES, type SemanaCalendario } from "@/lib/produccion/calendario";

/** Desglose de un día. El primer nivel es por plantel y el segundo (`hijos`) por
 *  planta dosificadora. La forma es genérica a propósito: cuando exista la
 *  clasificación por LÍNEA DE VENTA se cuelga igual, sin rehacer el panel. */
export interface DesgloseDia {
  etiqueta: string;
  m3: number;
  viajes: number;
  /** Sub-desglose que se abre al hacer clic en la fila (las plantas del plantel). */
  hijos?: DesgloseDia[];
}

export interface CalendarioProps {
  semanas: SemanaCalendario[];
  /** Nivel de intensidad 1..5 por día ("YYYY-MM-DD" → nivel). 0/ausente = sin producción. */
  niveles: Record<string, number>;
  /** Desglose por plantel de cada día con producción. */
  desglose: Record<string, DesgloseDia[]>;
  anio: number;
  mes: number;
  /** URLs ya armadas por el servidor (conservan el resto de los parámetros). */
  hrefMesAnterior: string;
  hrefMesSiguiente: string;
  /** Resumen discreto del encabezado. */
  totalMes: number;
  promedioPorDia: number;
  diasConProduccion: number;
  /** Alcance de lo que se muestra ("Zona Norte", "Tus clientes"…). null = todo. */
  alcanceTxt: string | null;
  /** Zona activa ("" = todas) y las opciones que el usuario puede elegir, con su URL. */
  zona: string;
  zonas: { valor: string; etiqueta: string; href: string }[];
  /** "YYYY-MM-DD" de hoy: la celda del día en curso se marca. */
  hoyIso: string;
}

/**
 * Escala secuencial de UNA sola tinta (la familia azul del sistema, terminando en el
 * acento `--color-accent`), de claro a oscuro. El texto salta a blanco en los dos
 * niveles oscuros: así cada celda mantiene contraste de texto ≥ 5:1 (verificado con el
 * validador de contraste, no a ojo). El número del día y el volumen SIEMPRE se
 * imprimen, así que el color nunca es el único canal de información.
 */
const ESCALA = [
  { fondo: "#dbeafe", texto: "text-ink" },
  { fondo: "#93c5fd", texto: "text-ink" },
  { fondo: "#60a5fa", texto: "text-ink" },
  { fondo: "#2563eb", texto: "text-white" },
  { fondo: "#1e3a8a", texto: "text-white" },
] as const;

export function CalendarioProduccion(p: CalendarioProps) {
  const router = useRouter();
  const [diaSel, setDiaSel] = useState<string | null>(null);
  // Planteles abiertos dentro del desglose (se ven sus plantas). Se limpia al cambiar
  // de día: lo que se abrió para un día no tiene por qué quedar abierto en otro.
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const desgloseSel = diaSel ? (p.desglose[diaSel] ?? []) : [];

  const elegirDia = (iso: string | null) => {
    setDiaSel(iso);
    setAbiertos(new Set());
  };
  const alternarPlantel = (etiqueta: string) =>
    setAbiertos((prev) => {
      const n = new Set(prev);
      if (n.has(etiqueta)) n.delete(etiqueta);
      else n.add(etiqueta);
      return n;
    });

  return (
    <div>
      {/* ── Encabezado: mes, navegación, resumen discreto y filtro de zona ── */}
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Producción despachada
          {p.alcanceTxt && <span className="ml-1.5 font-normal text-muted">· {p.alcanceTxt}</span>}
        </h2>
      </div>

      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-1">
          <Link
            href={p.hrefMesAnterior}
            aria-label="Mes anterior"
            className="rounded-lg border border-border p-1.5 text-muted hover:text-ink"
          >
            <ChevronLeft size={16} />
          </Link>
          <span className="min-w-[8.5rem] text-center text-base font-semibold text-ink capitalize">
            {MESES[p.mes - 1]} {p.anio}
          </span>
          <Link
            href={p.hrefMesSiguiente}
            aria-label="Mes siguiente"
            className="rounded-lg border border-border p-1.5 text-muted hover:text-ink"
          >
            <ChevronRight size={16} />
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted">
            Total:{" "}
            <strong className="text-sm font-bold text-ink">{p.totalMes.toFixed(1)} m³</strong>
          </span>
          <span className="text-muted">
            Prom./día:{" "}
            <strong className="text-sm font-bold text-ink">{p.promedioPorDia.toFixed(1)} m³</strong>{" "}
            <span className="text-[11px]">({p.diasConProduccion} d)</span>
          </span>
          {p.zonas.length > 2 && (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-muted">Zona</span>
              <select
                value={p.zona}
                onChange={(e) => {
                  const opcion = p.zonas.find((z) => z.valor === e.target.value);
                  if (opcion) router.push(opcion.href);
                }}
                className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
              >
                {p.zonas.map((z) => (
                  <option key={z.valor} value={z.valor}>
                    {z.etiqueta}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>
      </div>

      {/* ── Cuadrícula: una fila por semana, columnas domingo→sábado ── */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] table-fixed border-separate border-spacing-[2px] text-sm">
          <thead>
            <tr className="text-[11px] tracking-wide text-muted">
              <th className="w-11 font-medium" />
              {DIAS_SEMANA.map((d) => (
                <th key={d} className="pb-0.5 font-medium">
                  {d}
                </th>
              ))}
              <th className="w-16 pb-0.5 text-right font-medium">total</th>
            </tr>
          </thead>
          <tbody>
            {p.semanas.map((sem) => (
              <tr key={sem.semanaIso + "-" + sem.dias[0].iso}>
                <td className="pr-1 text-right text-[11px] whitespace-nowrap text-muted">
                  Sem {sem.semanaIso}
                </td>

                {sem.dias.map((d) => {
                  // Celda de relleno (otro mes) o día sin producción: va VACÍA. Nunca
                  // "0.00 m³" repetido — esto es producción ejecutada, no planeación.
                  if (!d.delMes) return <td key={d.iso} className="h-10 rounded-md" />;
                  const nivel = p.niveles[d.iso] ?? 0;
                  const paso = nivel > 0 ? ESCALA[nivel - 1] : null;
                  const esHoy = d.iso === p.hoyIso;
                  const sel = d.iso === diaSel;
                  return (
                    <td key={d.iso} className="p-0 align-top">
                      <button
                        type="button"
                        onClick={() => elegirDia(sel ? null : d.iso)}
                        disabled={nivel === 0}
                        title={
                          nivel === 0
                            ? `${d.dia} — sin producción`
                            : `${d.dia}: ${d.m3.toFixed(1)} m³ en ${d.viajes} viaje(s) — toca para ver el desglose`
                        }
                        style={paso ? { backgroundColor: paso.fondo } : undefined}
                        className={
                          "flex h-10 w-full flex-col justify-between rounded-md border px-1 py-[3px] text-left transition-shadow " +
                          (paso ? `${paso.texto} border-transparent` : "border-border bg-surface text-muted") +
                          (nivel > 0 ? " cursor-pointer hover:shadow-md" : " cursor-default") +
                          (sel ? " ring-2 ring-accent ring-offset-1" : "") +
                          (esHoy && !sel ? " ring-1 ring-accent/60" : "")
                        }
                      >
                        <span className={"text-[10px] leading-none " + (paso ? "opacity-80" : "")}>
                          {d.dia}
                        </span>
                        <span className="text-[13px] leading-none font-semibold tabular-nums">
                          {nivel > 0 ? d.m3.toFixed(1) : ""}
                        </span>
                      </button>
                    </td>
                  );
                })}

                <td className="pl-1 text-right text-sm font-semibold tabular-nums whitespace-nowrap text-ink">
                  {sem.totalM3 > 0 ? `${sem.totalM3.toFixed(1)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Leyenda de la escala ── */}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
        <span>menor</span>
        {ESCALA.map((e) => (
          <span
            key={e.fondo}
            className="h-3 w-6 rounded-sm border border-black/5"
            style={{ backgroundColor: e.fondo }}
          />
        ))}
        <span>mayor</span>
        <span className="ml-2">· m³ despachados (viajes completados)</span>
      </div>

      {/* ── Desglose del día seleccionado ── */}
      {diaSel && (
        <div className="mt-3 rounded-lg border border-border bg-content/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">
              Desglose del {fechaLegible(diaSel)}
            </h3>
            <button
              onClick={() => elegirDia(null)}
              className="text-xs text-muted hover:text-ink"
            >
              Cerrar
            </button>
          </div>
          {desgloseSel.length === 0 ? (
            <p className="text-sm text-muted">Sin producción ese día.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-1">Plantel / planta</th>
                  <th className="w-24 py-1 text-right">Viajes</th>
                  <th className="w-28 py-1 text-right">m³</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {desgloseSel.map((d) => {
                  const conPlantas = (d.hijos?.length ?? 0) > 0;
                  const abierto = abiertos.has(d.etiqueta);
                  return (
                    <Fragment key={d.etiqueta}>
                      <tr className="border-b border-border/50">
                        <td className="py-1 text-ink">
                          {conPlantas ? (
                            <button
                              onClick={() => alternarPlantel(d.etiqueta)}
                              title={abierto ? "Ocultar las plantas" : "Ver el detalle por planta"}
                              className="flex items-center gap-1 text-left hover:text-accent"
                            >
                              {abierto ? (
                                <ChevronDown size={13} className="shrink-0 text-muted" />
                              ) : (
                                <ChevronRight size={13} className="shrink-0 text-muted" />
                              )}
                              {d.etiqueta}
                            </button>
                          ) : (
                            <span className="pl-[18px]">{d.etiqueta}</span>
                          )}
                        </td>
                        <td className="py-1 text-right text-muted">{d.viajes}</td>
                        <td className="py-1 text-right font-medium text-ink">{d.m3.toFixed(1)}</td>
                      </tr>

                      {/* Segundo nivel: las plantas dosificadoras de ese plantel. */}
                      {abierto &&
                        d.hijos!.map((h) => (
                          <tr key={h.etiqueta} className="border-b border-border/50 bg-surface/60">
                            <td className="py-1 pl-[26px] text-xs text-muted">{h.etiqueta}</td>
                            <td className="py-1 text-right text-xs text-muted">{h.viajes}</td>
                            <td className="py-1 text-right text-xs font-medium text-ink">
                              {h.m3.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
                <tr>
                  <td className="pt-1.5 text-sm font-semibold text-ink">Total del día</td>
                  <td className="pt-1.5 text-right text-sm font-semibold text-ink">
                    {desgloseSel.reduce((s, d) => s + d.viajes, 0)}
                  </td>
                  <td className="pt-1.5 text-right text-sm font-bold text-ink">
                    {(Math.round(desgloseSel.reduce((s, d) => s + d.m3, 0) * 10) / 10).toFixed(1)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** "19 de agosto de 2026" a partir de "YYYY-MM-DD". */
function fechaLegible(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}
