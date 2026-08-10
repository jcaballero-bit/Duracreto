"use client";

// MODO MANUAL de Programación. El Programador/Jefe de Planta arma el día a mano:
// tabla editable POR PLANTA (todos los clientes mezclados, ordenados por hora de
// carga), Gantt espejo en vivo con color por cliente, y validaciones que solo AVISAN.
// El sistema NUNCA reprograma: cada edición escribe ese viaje tal cual (server action
// sin cascada) y las columnas calculadas se derivan al instante con la misma
// matemática del motor.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import {
  agregarViajeManualAction,
  editarViajeManualAction,
  eliminarViajeManualAction,
} from "../actions";
import { tiemposDeViaje } from "@/lib/motor/tiempos";
import {
  capacidadExcedida,
  detectarTraslapesMixer,
  frecuenciaRealPorCliente,
  idsEnTraslape,
  margenApretado,
  type ViajeManual,
} from "@/lib/motor/validacion-manual";
import { colorPorCliente } from "@/lib/color-cliente";
import { GanttManual, type SeccionGanttM } from "./gantt-manual";

export interface MixerOpcionManual {
  id: number;
  label: string;
  capacidad: number;
  plantelBaseId: number;
}
export interface ClienteOpcionManual {
  id: number;
  empresa: string;
  proyecto: string;
  transporteMin: number;
}
export interface DisenoOpcionManual {
  id: number;
  etiqueta: string;
}
export interface PlantaManual {
  id: number;
  nombre: string;
  capacidadM3h: number;
  alistamientoMin: number;
}
export interface FilaManualSrv {
  id: number;
  plantaId: number;
  clienteId: number;
  empresa: string;
  proyecto: string;
  mixerId: number | null;
  volumen: number;
  inicioCargaMs: number;
  tipoDescarga: string;
  disenoId: number;
  transporteMin: number;
}
export interface PlantelManual {
  plantelId: number;
  nombre: string;
  zona: string;
  plantas: PlantaManual[];
  mixers: MixerOpcionManual[];
  filas: FilaManualSrv[];
}

type Override = { inicioCargaMs?: number; volumen?: number; mixerId?: number | null };

function fmtHM(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}
function hhmmDeMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** Reemplaza la hora (HH:mm) conservando la FECHA del ms base. */
function conNuevaHora(baseMs: number, hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(baseMs);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}
/** "YYYY-MM-DDTHH:mm" (local) a partir de un ms. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ManualView({
  planteles,
  clientes,
  disenos,
  fecha,
  margenMin,
  puedeEditar,
}: {
  planteles: PlantelManual[];
  clientes: ClienteOpcionManual[];
  disenos: DisenoOpcionManual[];
  fecha: string; // "YYYY-MM-DD"
  margenMin: number;
  puedeEditar: boolean;
}) {
  if (planteles.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
        No hay planteles en tu alcance para este día.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        <strong>Modo manual:</strong> tú decides todo. El sistema no mueve, no reordena ni
        reasigna nada — solo calcula las columnas y te avisa si detecta un problema. Puedes
        continuar aunque haya un aviso.
      </p>
      {planteles.map((pl) => (
        <PlantelManualBloque
          key={pl.plantelId}
          plantel={pl}
          clientes={clientes}
          disenos={disenos}
          fecha={fecha}
          margenMin={margenMin}
          puedeEditar={puedeEditar}
        />
      ))}
    </div>
  );
}

function PlantelManualBloque({
  plantel,
  clientes,
  disenos,
  fecha,
  margenMin,
  puedeEditar,
}: {
  plantel: PlantelManual;
  clientes: ClienteOpcionManual[];
  disenos: DisenoOpcionManual[];
  fecha: string;
  margenMin: number;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [ov, setOv] = useState<Map<number, Override>>(new Map());
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [agregarEn, setAgregarEn] = useState<number | null>(null); // plantaId destino

  const plantaPorId = useMemo(
    () => new Map(plantel.plantas.map((p) => [p.id, p])),
    [plantel.plantas],
  );
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);

  // Fila efectiva = servidor + override en vuelo (para que el Gantt reaccione al teclear).
  const filaEfectiva = (f: FilaManualSrv) => ({ ...f, ...(ov.get(f.id) ?? {}) });

  // Derivar tiempos de una fila con la misma matemática del motor.
  const calcular = (f: FilaManualSrv) => {
    const ef = filaEfectiva(f);
    const planta = plantaPorId.get(f.plantaId);
    if (!planta) return null;
    return tiemposDeViaje(ef.inicioCargaMs, {
      alistamientoMin: planta.alistamientoMin,
      capacidadPlantaM3h: planta.capacidadM3h,
      volumen: ef.volumen,
      tViajeMin: f.transporteMin,
      tRegresoMin: f.transporteMin,
      tipoDescarga: f.tipoDescarga,
    });
  };

  // Viajes para validaciones (todo el plantel; los mixers se comparten entre plantas).
  const viajesVal: ViajeManual[] = plantel.filas
    .map((f) => {
      const ef = filaEfectiva(f);
      const t = calcular(f);
      if (!t) return null;
      return {
        id: f.id,
        plantaId: f.plantaId,
        clienteId: f.clienteId,
        mixerId: ef.mixerId,
        volumen: ef.volumen,
        inicioCargaMs: t.inicioCargaMs,
        finCargaMs: t.finCargaMs,
        llegadaMs: t.llegadaMs,
        regresoMs: t.regresoMs,
      } as ViajeManual;
    })
    .filter((v): v is ViajeManual => v !== null);

  const traslapes = detectarTraslapesMixer(viajesVal);
  const idsRojos = idsEnTraslape(traslapes);
  const avisosCap = plantel.plantas.flatMap((p) =>
    capacidadExcedida(viajesVal.filter((v) => v.plantaId === p.id), p.capacidadM3h),
  );
  const avisosMargen = margenApretado(viajesVal, margenMin);
  const frecCliente = frecuenciaRealPorCliente(viajesVal);

  // Persistir un cambio de una fila (mixer/volumen/hora). Sin cascada en el servidor.
  const persistir = (viajeId: number, patch: { mixerId?: number; volumen?: number; horaCargaLocal?: string }) => {
    startTransition(async () => {
      const res = await editarViajeManualAction(viajeId, patch);
      if (!res.ok) alert(res.mensaje ?? "No se pudo guardar el cambio.");
      setOv((prev) => {
        const n = new Map(prev);
        n.delete(viajeId);
        return n;
      });
      router.refresh();
    });
  };

  const eliminar = (viajeId: number) => {
    if (!confirm("¿Eliminar este viaje? No se recalcula ningún otro.")) return;
    startTransition(async () => {
      const res = await eliminarViajeManualAction(viajeId);
      if (!res.ok) alert(res.mensaje ?? "No se pudo eliminar.");
      router.refresh();
    });
  };

  const mixerLabel = (id: number | null) =>
    id == null ? "—" : (plantel.mixers.find((m) => m.id === id)?.label ?? `#${id}`);

  // ── Gantt: secciones Plantas (cargas) + Mixers (ciclos), color por cliente ──
  const seccionesGantt: SeccionGanttM[] = useMemo(() => {
    const plantasSec = {
      titulo: "Plantas (cargas)",
      filas: plantel.plantas.map((p) => ({
        id: `pl-${p.id}`,
        label: p.nombre,
        barras: plantel.filas
          .filter((f) => f.plantaId === p.id)
          .map((f) => {
            const t = calcular(f);
            if (!t) return null;
            const cli = clientePorId.get(f.clienteId);
            return {
              id: f.id,
              inicioMs: t.inicioCargaMs,
              finMs: t.finCargaMs,
              etiqueta: cli?.empresa ?? "",
              colorHex: colorPorCliente(f.clienteId),
              titulo: `${cli?.empresa ?? ""} · carga ${fmtHM(t.inicioCargaMs)}–${fmtHM(t.finCargaMs)}`,
              arrastrable: true, // arrastrar mueve la hora de CARGA
            };
          })
          .filter((b): b is NonNullable<typeof b> => b !== null),
      })),
    };
    const mixersUsados = [...new Set(plantel.filas.map((f) => filaEfectiva(f).mixerId).filter((m): m is number => m != null))];
    const mixersSec = {
      titulo: "Mixers (ciclo carga → regreso)",
      filas: mixersUsados.map((mid) => ({
        id: `mx-${mid}`,
        label: mixerLabel(mid),
        barras: plantel.filas
          .filter((f) => filaEfectiva(f).mixerId === mid)
          .map((f) => {
            const t = calcular(f);
            if (!t) return null;
            const cli = clientePorId.get(f.clienteId);
            return {
              id: f.id,
              inicioMs: t.inicioCargaMs,
              finMs: t.regresoMs,
              etiqueta: cli?.empresa ?? "",
              colorHex: colorPorCliente(f.clienteId),
              titulo: `${cli?.empresa ?? ""} · ciclo ${fmtHM(t.inicioCargaMs)}–${fmtHM(t.regresoMs)}`,
            };
          })
          .filter((b): b is NonNullable<typeof b> => b !== null),
      })),
    };
    return [plantasSec, mixersSec];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantel.filas, ov, plantaPorId, clientePorId, plantel.mixers, plantel.plantas]);

  // Clientes presentes (leyenda de color).
  const clientesPresentes = [...new Set(plantel.filas.map((f) => f.clienteId))];

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3">
        <span className="text-lg font-semibold text-ink">{plantel.nombre}</span>{" "}
        <span className="text-sm text-muted">({plantel.zona})</span>
      </div>

      {plantel.plantas.map((planta) => {
        const filas = [...plantel.filas]
          .filter((f) => f.plantaId === planta.id)
          .sort((a, b) => filaEfectiva(a).inicioCargaMs - filaEfectiva(b).inicioCargaMs);
        return (
          <div key={planta.id} className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">
                Planta {planta.nombre}{" "}
                <span className="font-normal text-muted">· {planta.capacidadM3h} m³/h</span>
              </h3>
              {puedeEditar && (
                <button
                  onClick={() => setAgregarEn(planta.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  <Plus size={14} /> Agregar viaje
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-2 py-2 w-8">#</th>
                    <th className="px-2 py-2">Cliente / Proyecto</th>
                    <th className="px-2 py-2">Mixer</th>
                    <th className="px-2 py-2 w-24">Volumen</th>
                    <th className="px-2 py-2 w-24">Carga</th>
                    <th className="px-2 py-2">Salida</th>
                    <th className="px-2 py-2">Llegada</th>
                    <th className="px-2 py-2">Descarga</th>
                    <th className="px-2 py-2">Regreso</th>
                    {puedeEditar && <th className="px-2 py-2 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {filas.length === 0 ? (
                    <tr>
                      <td colSpan={puedeEditar ? 10 : 9} className="px-2 py-4 text-center text-xs text-muted">
                        Sin viajes en esta planta. Usa <strong>Agregar viaje</strong>.
                      </td>
                    </tr>
                  ) : (
                    filas.map((f, i) => {
                      const ef = filaEfectiva(f);
                      const t = calcular(f);
                      const cli = clientePorId.get(f.clienteId);
                      const rojo = idsRojos.has(f.id);
                      return (
                        <tr
                          key={f.id}
                          className={`border-b border-border/60 ${rojo ? "bg-red-50" : ""} ${
                            editandoId === f.id ? "ring-1 ring-inset ring-accent" : ""
                          }`}
                        >
                          <td className="px-2 py-1 text-muted">{i + 1}</td>
                          <td className="px-2 py-1">
                            <span className="flex items-center gap-1.5">
                              <span
                                className="inline-block h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: colorPorCliente(f.clienteId) }}
                              />
                              <span className="truncate">
                                <span className="font-medium text-ink">{cli?.empresa}</span>
                                {cli?.proyecto ? <span className="text-muted"> · {cli.proyecto}</span> : ""}
                              </span>
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            {puedeEditar ? (
                              <select
                                value={ef.mixerId ?? ""}
                                onFocus={() => setEditandoId(f.id)}
                                onChange={(e) => {
                                  const mid = e.target.value ? Number(e.target.value) : null;
                                  setOv((p) => new Map(p).set(f.id, { ...p.get(f.id), mixerId: mid }));
                                  if (mid != null) persistir(f.id, { mixerId: mid });
                                }}
                                className={selCls + (rojo ? " border-red-400" : "")}
                              >
                                <option value="">— sin mixer —</option>
                                {plantel.mixers.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              mixerLabel(ef.mixerId)
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {puedeEditar ? (
                              <input
                                type="number"
                                min="0.5"
                                step="0.5"
                                defaultValue={ef.volumen}
                                onFocus={() => setEditandoId(f.id)}
                                onChange={(e) =>
                                  setOv((p) => new Map(p).set(f.id, { ...p.get(f.id), volumen: Number(e.target.value) }))
                                }
                                onBlur={(e) => {
                                  const v = Number(e.target.value);
                                  if (v > 0 && v !== f.volumen) persistir(f.id, { volumen: v });
                                }}
                                className={inCls}
                              />
                            ) : (
                              `${ef.volumen} m³`
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {puedeEditar ? (
                              <input
                                type="time"
                                value={hhmmDeMs(ef.inicioCargaMs)}
                                onFocus={() => setEditandoId(f.id)}
                                onChange={(e) => {
                                  const nuevo = conNuevaHora(ef.inicioCargaMs, e.target.value);
                                  if (nuevo != null) setOv((p) => new Map(p).set(f.id, { ...p.get(f.id), inicioCargaMs: nuevo }));
                                }}
                                onBlur={(e) => {
                                  const nuevo = conNuevaHora(f.inicioCargaMs, e.target.value);
                                  if (nuevo != null && nuevo !== f.inicioCargaMs) {
                                    persistir(f.id, { horaCargaLocal: toLocalInput(nuevo) });
                                  }
                                }}
                                className={inCls + " w-24"}
                              />
                            ) : (
                              fmtHM(ef.inicioCargaMs)
                            )}
                          </td>
                          <td className="px-2 py-1 text-muted">{t ? fmtHM(t.salidaMs) : "—"}</td>
                          <td className="px-2 py-1 font-medium text-ink">{t ? fmtHM(t.llegadaMs) : "—"}</td>
                          <td className="px-2 py-1 text-muted">
                            {t ? `${fmtHM(t.inicioDescargaMs)}–${fmtHM(t.finDescargaMs)}` : "—"}
                          </td>
                          <td className="px-2 py-1 text-muted">{t ? fmtHM(t.regresoMs) : "—"}</td>
                          {puedeEditar && (
                            <td className="px-2 py-1">
                              <button
                                onClick={() => eliminar(f.id)}
                                className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600"
                                title="Eliminar viaje"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Gantt espejo en vivo */}
      <div className="mt-2 rounded-lg border border-border bg-content/30 p-3">
        <h3 className="mb-2 text-sm font-semibold text-ink">Línea de tiempo (en vivo)</h3>
        <GanttManual
          secciones={seccionesGantt}
          highlightId={editandoId}
          onMoverInicio={
            puedeEditar
              ? (viajeId, nuevoInicioMs) => {
                  const id = Number(viajeId);
                  setOv((p) => new Map(p).set(id, { ...p.get(id), inicioCargaMs: nuevoInicioMs }));
                  persistir(id, { horaCargaLocal: toLocalInput(nuevoInicioMs) });
                }
              : undefined
          }
        />
        {clientesPresentes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
            {clientesPresentes.map((cid) => (
              <span key={cid} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: colorPorCliente(cid) }} />
                {clientePorId.get(cid)?.empresa ?? `Cliente ${cid}`}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Barra de validaciones (avisos, nunca bloquean) */}
      <BarraValidaciones
        traslapes={traslapes.length}
        capacidad={avisosCap.length}
        margen={avisosMargen.length}
        frecuencias={[...frecCliente.entries()]
          .filter(([, v]) => v != null)
          .map(([cid, v]) => ({ empresa: clientePorId.get(cid)?.empresa ?? `Cliente ${cid}`, min: v as number }))}
        pendiente={pendiente}
      />

      {agregarEn != null && (
        <AgregarViajeModal
          plantelId={plantel.plantelId}
          plantaId={agregarEn}
          plantaNombre={plantel.plantas.find((p) => p.id === agregarEn)?.nombre ?? ""}
          clientes={clientes}
          disenos={disenos}
          mixers={plantel.mixers}
          fecha={fecha}
          onCerrar={() => setAgregarEn(null)}
          onExito={() => {
            setAgregarEn(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BarraValidaciones({
  traslapes,
  capacidad,
  margen,
  frecuencias,
  pendiente,
}: {
  traslapes: number;
  capacidad: number;
  margen: number;
  frecuencias: { empresa: string; min: number }[];
  pendiente: boolean;
}) {
  const problemas = traslapes + capacidad + margen;
  return (
    <div className="mt-3 space-y-1 text-sm">
      {problemas === 0 ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">
          ✓ Sin traslapes de mixer, sin exceso de planta ni márgenes apretados.
        </p>
      ) : (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
          {traslapes > 0 && <p>⚠️ {traslapes} traslape(s) de mixer (mismo mixer en 2 viajes que se enciman). Marcados en rojo.</p>}
          {capacidad > 0 && <p>⚠️ {capacidad} ventana(s) de 60 min superan la capacidad de la planta.</p>}
          {margen > 0 && <p>⚠️ {margen} margen(es) apretado(s) entre el regreso de un mixer y su siguiente carga.</p>}
          <p className="mt-1 text-xs text-amber-700">Son avisos: puedes continuar igual.</p>
        </div>
      )}
      {frecuencias.length > 0 && (
        <p className="rounded-md bg-content/50 px-3 py-2 text-muted">
          Frecuencia real entre camiones —{" "}
          {frecuencias.map((f, i) => (
            <span key={i}>
              {i > 0 ? " · " : ""}
              <span className="text-ink">{f.empresa}</span>: {f.min} min
            </span>
          ))}
        </p>
      )}
      {pendiente && <p className="text-xs text-muted">Guardando…</p>}
    </div>
  );
}

function AgregarViajeModal({
  plantelId,
  plantaId,
  plantaNombre,
  clientes,
  disenos,
  mixers,
  fecha,
  onCerrar,
  onExito,
}: {
  plantelId: number;
  plantaId: number;
  plantaNombre: string;
  clientes: ClienteOpcionManual[];
  disenos: DisenoOpcionManual[];
  mixers: MixerOpcionManual[];
  fecha: string; // "YYYY-MM-DD"
  onCerrar: () => void;
  onExito: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [clienteId, setClienteId] = useState<number>(clientes[0]?.id ?? 0);
  const [disenoId, setDisenoId] = useState<number>(disenos[0]?.id ?? 0);
  const [mixerId, setMixerId] = useState<number>(mixers[0]?.id ?? 0);
  const [volumen, setVolumen] = useState<string>("10");
  const [hora, setHora] = useState<string>("07:00");
  const [tipoDescarga, setTipoDescarga] = useState<string>("Canal directo");
  const [error, setError] = useState<string | null>(null);

  const guardar = () => {
    setError(null);
    const vol = Number(volumen);
    if (!(vol > 0)) return setError("Volumen inválido.");
    if (!clienteId || !disenoId || !mixerId) return setError("Elige cliente, diseño y mixer.");
    startTransition(async () => {
      const res = await agregarViajeManualAction({
        clienteId,
        disenoId,
        plantelId,
        plantaId,
        mixerId,
        volumen: vol,
        horaCargaLocal: `${fecha}T${hora}`,
        tipoDescarga,
      });
      if (res.ok) onExito();
      else setError(res.mensaje ?? "No se pudo agregar el viaje.");
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onClick={onCerrar}>
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-ink">Agregar viaje — Planta {plantaNombre}</h2>
          <button onClick={onCerrar} className="rounded-md p-1 text-muted hover:bg-content hover:text-ink" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          <Campo label="Cliente / Proyecto">
            <select value={clienteId} onChange={(e) => setClienteId(Number(e.target.value))} className={selCls}>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.empresa}
                  {c.proyecto ? ` — ${c.proyecto}` : ""}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Diseño de mezcla">
            <select value={disenoId} onChange={(e) => setDisenoId(Number(e.target.value))} className={selCls}>
              {disenos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.etiqueta}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Mixer">
            <select value={mixerId} onChange={(e) => setMixerId(Number(e.target.value))} className={selCls}>
              {mixers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Volumen (m³)">
            <input type="number" min="0.5" step="0.5" value={volumen} onChange={(e) => setVolumen(e.target.value)} className={inCls} />
          </Campo>
          <Campo label="Hora de carga">
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inCls} />
          </Campo>
          <Campo label="Tipo de descarga">
            <select value={tipoDescarga} onChange={(e) => setTipoDescarga(e.target.value)} className={selCls}>
              <option value="Canal directo">Canal directo</option>
              <option value="Bomba estacionaria">Bomba estacionaria</option>
              <option value="Bomba pluma">Bomba pluma</option>
            </select>
          </Campo>
          {error && <p className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button onClick={onCerrar} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content">
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={pendiente}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {pendiente ? "Agregando…" : "Agregar viaje"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

const inCls = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";
const selCls = inCls;
