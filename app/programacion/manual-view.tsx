"use client";

// MODO MANUAL de Programación. El Programador/Jefe de Planta arma el día a mano:
// tabla editable POR PLANTA (todos los clientes mezclados, ordenados por hora de
// carga), Gantt espejo en vivo con color por cliente, y validaciones que solo AVISAN.
// El sistema NUNCA reprograma: cada edición escribe ese viaje tal cual (server action
// sin cascada) y las columnas calculadas se derivan al instante.
//
// Productividad (mejoras): Deshacer/Rehacer de la sesión (Ctrl+Z / Ctrl+Shift+Z),
// navegación tipo hoja de cálculo (Enter/flechas/Escape) + pegar desde Excel/Sheets,
// generar N viajes en serie, y validación de traslape de CARGA en planta.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Lock, LockOpen, MessageSquare, Plus, Redo2, Sunrise, Trash2, Truck, Undo2, Wand2, X } from "lucide-react";
import {
  agregarViajeManualAction,
  ajustarLlegadaManualAction,
  editarViajeManualAction,
  eliminarViajesManualAction,
  fijarAperturaPlantaAction,
  fijarHoraViajeAction,
  generarViajesEnSerieAction,
  guardarObservacionPlantelAction,
} from "../actions";
import { inicioCargaDesdeLlegada, tiemposDeViaje } from "@/lib/motor/tiempos";
import {
  capacidadExcedida,
  detectarTraslapesCarga,
  detectarTraslapesMixer,
  frecuenciaRealPorCliente,
  idsEnTraslape,
  idsEnTraslapeCarga,
  margenApretado,
  type ViajeManual,
} from "@/lib/motor/validacion-manual";
import { colorPorCliente } from "@/lib/color-cliente";
import { parsePortapapeles } from "@/lib/portapapeles";
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
  /** Apertura vigente ESE dia, "HH:MM" (excepcion del dia o valor por defecto). */
  aperturaHHMM: string;
  /** true si la apertura es una excepcion puesta para ese dia. */
  aperturaEsExcepcion: boolean;
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
  /** Hora clavada a mano: el reajuste por frecuencia NO mueve este viaje. */
  horaFija: boolean;
}
/** Mixer para el PANEL lateral (incluye no disponibles, con su estado). */
export interface MixerPanel {
  id: number;
  label: string;
  capacidad: number;
  estado: string; // "Disponible" | "En mantenimiento" | "Fuera de servicio" | "Dañado"
  enMantenimiento: boolean; // rango de disponibilidad_flota que cubre el día
  esHub: boolean; // préstamo (base distinta del plantel)
}
export interface PlantelManual {
  plantelId: number;
  nombre: string;
  zona: string;
  /** Nota operativa del plantel para ese dia (vacia = no se muestra en ningun lado). */
  observaciones: string;
  plantas: PlantaManual[];
  mixers: MixerOpcionManual[]; // seleccionables (Disponibles, sin mantenimiento)
  mixersPanel: MixerPanel[]; // TODOS los del plantel+hub, para el panel lateral
  filas: FilaManualSrv[];
}

/** Una acción deshacible de la sesión. `hacer` la aplica (y re-aplica al rehacer);
 *  `deshacer` la revierte. Ambas persisten en el servidor (sin cascada). */
interface Comando {
  etiqueta: string;
  hacer: () => Promise<void>;
  deshacer: () => Promise<void>;
}
type PatchEdit = { mixerId?: number; volumen?: number; horaCargaLocal?: string };

function fmtHM(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}
function hhmmDeMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function conNuevaHora(baseMs: number, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const d = new Date(baseMs);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}
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
  const router = useRouter();
  // Pilas de deshacer/rehacer en ESTADO (el render las lee de forma reactiva). Los
  // handlers se recrean en cada render (cierran sobre el estado fresco) y el efecto de
  // teclado los invoca vía refs, para no re-suscribir el listener en cada render.
  const [pasado, setPasado] = useState<Comando[]>([]);
  const [futuro, setFuturo] = useState<Comando[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [errorCmd, setErrorCmd] = useState<string | null>(null);
  // Avisos NO bloqueantes que devuelve el servidor al ajustar horarios.
  const [avisos, setAvisos] = useState<string[]>([]);

  const ejecutar = async (cmd: Comando) => {
    setOcupado(true);
    setErrorCmd(null);
    try {
      await cmd.hacer();
      setPasado((p) => [...p, cmd]);
      setFuturo([]);
    } catch (e) {
      setErrorCmd((e as Error).message || "No se pudo aplicar la acción.");
    } finally {
      setOcupado(false);
      router.refresh();
    }
  };

  const deshacer = async () => {
    if (pasado.length === 0) return;
    const cmd = pasado[pasado.length - 1];
    setOcupado(true);
    setErrorCmd(null);
    try {
      await cmd.deshacer();
      setPasado((p) => p.slice(0, -1));
      setFuturo((f) => [cmd, ...f]);
    } catch (e) {
      setErrorCmd((e as Error).message);
    } finally {
      setOcupado(false);
      router.refresh();
    }
  };

  const rehacer = async () => {
    if (futuro.length === 0) return;
    const cmd = futuro[0];
    setOcupado(true);
    setErrorCmd(null);
    try {
      await cmd.hacer();
      setFuturo((f) => f.slice(1));
      setPasado((p) => [...p, cmd]);
    } catch (e) {
      setErrorCmd((e as Error).message);
    } finally {
      setOcupado(false);
      router.refresh();
    }
  };

  // Refs a los handlers más recientes (para un listener de teclado estable).
  const deshacerRef = useRef(deshacer);
  const rehacerRef = useRef(rehacer);
  useEffect(() => {
    deshacerRef.current = deshacer;
    rehacerRef.current = rehacer;
  });

  // Atajos de teclado estándar (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y).
  useEffect(() => {
    if (!puedeEditar) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        void deshacerRef.current();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        void rehacerRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [puedeEditar]);

  if (planteles.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
        No hay planteles en tu alcance para este día.
      </p>
    );
  }

  const etiquetaDeshacer = pasado.at(-1)?.etiqueta;
  const etiquetaRehacer = futuro[0]?.etiqueta;
  const hayPasado = pasado.length > 0;
  const hayFuturo = futuro.length > 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <strong>Modo manual:</strong> tú decides todo. El sistema no mueve, no reordena ni
          reasigna nada — solo calcula las columnas y te avisa. Puedes continuar aunque haya un aviso.
        </p>
        {puedeEditar && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void deshacer()}
              disabled={ocupado || !hayPasado}
              title={etiquetaDeshacer ? `Deshacer: ${etiquetaDeshacer}` : "Nada que deshacer"}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-ink hover:bg-content disabled:opacity-40"
            >
              <Undo2 size={15} /> Deshacer
            </button>
            <button
              onClick={() => void rehacer()}
              disabled={ocupado || !hayFuturo}
              title={etiquetaRehacer ? `Rehacer: ${etiquetaRehacer}` : "Nada que rehacer"}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-ink hover:bg-content disabled:opacity-40"
            >
              <Redo2 size={15} /> Rehacer
            </button>
          </div>
        )}
      </div>
      {errorCmd && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorCmd}</p>}

      {/* Avisos del ultimo ajuste de horarios: nunca bloquean, solo informan. */}
      {avisos.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={15} /> Avisos del ajuste
            </span>
            <button
              onClick={() => setAvisos([])}
              className="rounded p-0.5 text-amber-700 hover:bg-amber-100"
              aria-label="Cerrar avisos"
            >
              <X size={14} />
            </button>
          </div>
          <ul className="ml-5 list-disc space-y-0.5">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {planteles.map((pl) => (
        <PlantelManualBloque
          key={pl.plantelId}
          plantel={pl}
          clientes={clientes}
          disenos={disenos}
          fecha={fecha}
          margenMin={margenMin}
          puedeEditar={puedeEditar}
          ejecutar={ejecutar}
          ocupado={ocupado}
          onAvisos={setAvisos}
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
  ejecutar,
  ocupado,
  onAvisos,
}: {
  plantel: PlantelManual;
  clientes: ClienteOpcionManual[];
  disenos: DisenoOpcionManual[];
  fecha: string;
  margenMin: number;
  puedeEditar: boolean;
  ejecutar: (cmd: Comando) => Promise<void>;
  ocupado: boolean;
  /** Reporta al padre los avisos NO bloqueantes del ultimo ajuste de horarios. */
  onAvisos: (avisos: string[]) => void;
}) {
  const [ov, setOv] = useState<Map<number, { inicioCargaMs?: number; volumen?: number; mixerId?: number | null }>>(new Map());
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [agregarEn, setAgregarEn] = useState<number | null>(null);
  const [serieAbierta, setSerieAbierta] = useState(false);
  const celdas = useRef<Map<string, HTMLInputElement>>(new Map());
  const escapando = useRef(false); // Escape canceló: el onBlur siguiente NO debe confirmar

  // Al refrescar del servidor (props nuevas) se limpia el estado en vuelo.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOv(new Map());
  }, [plantel.filas]);

  const plantaPorId = useMemo(() => new Map(plantel.plantas.map((p) => [p.id, p])), [plantel.plantas]);
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);

  const filaEfectiva = useCallback(
    (f: FilaManualSrv) => ({ ...f, ...(ov.get(f.id) ?? {}) }),
    [ov],
  );
  const calcular = useCallback(
    (f: FilaManualSrv) => {
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
    },
    [filaEfectiva, plantaPorId],
  );
  /**
   * Tiempos con los valores TAL COMO ESTAN EN EL SERVIDOR, ignorando el override
   * optimista de edicion. Es el valor "antes" contra el que hay que comparar al
   * confirmar: si se compara contra la fila efectiva (que ya trae lo tecleado), el
   * cambio parece nulo y no se guarda nada.
   */
  const calcularServidor = useCallback(
    (f: FilaManualSrv) => {
      const planta = plantaPorId.get(f.plantaId);
      if (!planta) return null;
      return tiemposDeViaje(f.inicioCargaMs, {
        alistamientoMin: planta.alistamientoMin,
        capacidadPlantaM3h: planta.capacidadM3h,
        volumen: f.volumen,
        tViajeMin: f.transporteMin,
        tRegresoMin: f.transporteMin,
        tipoDescarga: f.tipoDescarga,
      });
    },
    [plantaPorId],
  );

  // Viajes para validaciones (todo el plantel).
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

  const traslapesMixer = detectarTraslapesMixer(viajesVal);
  const traslapesCarga = detectarTraslapesCarga(viajesVal);
  const idsRojos = useMemo(() => {
    const s = new Set<number | string>();
    idsEnTraslape(traslapesMixer).forEach((x) => s.add(x));
    idsEnTraslapeCarga(traslapesCarga).forEach((x) => s.add(x));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, plantel.filas]);
  const avisosCap = plantel.plantas.flatMap((p) =>
    capacidadExcedida(viajesVal.filter((v) => v.plantaId === p.id), p.capacidadM3h),
  );
  const avisosMargen = margenApretado(viajesVal, margenMin);
  const frecCliente = frecuenciaRealPorCliente(viajesVal);

  // Panel lateral: por mixer, cuántos viajes tiene asignados hoy y a qué hora queda
  // libre (fin de su último ciclo). Se deriva de las filas EFECTIVAS (refleja lo que el
  // usuario está editando en vivo). Solo informa; no reprograma nada.
  const infoMixer = useMemo(() => {
    const m = new Map<number, { viajes: number; libreMs: number | null }>();
    for (const f of plantel.filas) {
      const ef = filaEfectiva(f);
      if (ef.mixerId == null) continue;
      const t = calcular(f);
      const prev = m.get(ef.mixerId) ?? { viajes: 0, libreMs: null };
      prev.viajes += 1;
      if (t) prev.libreMs = Math.max(prev.libreMs ?? 0, t.regresoMs);
      m.set(ef.mixerId, prev);
    }
    return m;
  }, [plantel.filas, filaEfectiva, calcular]);

  // Mapa: por cada viaje, con quién choca su carga y cuánto (para el mensaje en la fila).
  const chocaCargaCon = new Map<number, { conMs: number; solapeMin: number }>();
  for (const c of traslapesCarga) {
    if (typeof c.viajeId === "number") chocaCargaCon.set(c.viajeId, { conMs: c.conInicioCargaMs, solapeMin: c.solapeMin });
    if (typeof c.conViajeId === "number") chocaCargaCon.set(c.conViajeId, { conMs: c.inicioCargaMs, solapeMin: c.solapeMin });
  }

  const mixerLabel = (id: number | null) =>
    id == null ? "—" : plantel.mixers.find((m) => m.id === id)?.label ?? `#${id}`;

  // ── Comandos (deshacibles) ──
  const cmdEditar = (f: FilaManualSrv, despues: PatchEdit, antes: PatchEdit, etiqueta: string): Comando => ({
    etiqueta,
    hacer: async () => {
      const r = await editarViajeManualAction(f.id, despues);
      if (!r.ok) throw new Error(r.mensaje ?? "No se pudo editar.");
    },
    deshacer: async () => {
      await editarViajeManualAction(f.id, antes);
    },
  });

  const commitHora = (f: FilaManualSrv, nuevoMs: number) => {
    if (nuevoMs === f.inicioCargaMs) return;
    void ejecutar(
      cmdEditar(
        f,
        { horaCargaLocal: toLocalInput(nuevoMs) },
        { horaCargaLocal: toLocalInput(f.inicioCargaMs) },
        `mover carga a ${fmtHM(nuevoMs)}`,
      ),
    );
  };
  /**
   * Fija la hora de LLEGADA a obra. El servidor calcula hacia atras la carga y hacia
   * adelante la descarga/regreso, y recorre los demas viajes DE ESE CLIENTE segun su
   * frecuencia. Devuelve avisos (apertura, hora fija, simultaneidad) que se muestran
   * arriba sin bloquear.
   */
  const commitLlegada = (f: FilaManualSrv, nuevaLlegadaMs: number, llegadaActualMs: number) => {
    if (nuevaLlegadaMs === llegadaActualMs) return;
    void ejecutar({
      etiqueta: `llegada a ${fmtHM(nuevaLlegadaMs)}`,
      hacer: async () => {
        const r = await ajustarLlegadaManualAction(f.id, toLocalInput(nuevaLlegadaMs));
        if (!r.ok) throw new Error(r.mensaje ?? "No se pudo ajustar la llegada.");
        onAvisos(r.avisos ?? []);
      },
      deshacer: async () => {
        const r = await ajustarLlegadaManualAction(f.id, toLocalInput(llegadaActualMs));
        onAvisos(r.avisos ?? []);
      },
    });
  };

  /** Clava (o libera) la hora de un viaje: los reajustes por frecuencia lo saltan. */
  const commitHoraFija = (f: FilaManualSrv, fija: boolean) => {
    void ejecutar({
      etiqueta: fija ? "fijar hora del viaje" : "liberar hora del viaje",
      hacer: async () => {
        const r = await fijarHoraViajeAction(f.id, fija);
        if (!r.ok) throw new Error(r.mensaje ?? "No se pudo cambiar la hora fija.");
      },
      deshacer: async () => {
        await fijarHoraViajeAction(f.id, !fija);
      },
    });
  };

  const commitVolumen = (f: FilaManualSrv, nuevo: number) => {
    if (!(nuevo > 0) || nuevo === f.volumen) return;
    void ejecutar(cmdEditar(f, { volumen: nuevo }, { volumen: f.volumen }, `volumen ${nuevo} m³`));
  };
  const commitMixer = (f: FilaManualSrv, nuevo: number | null) => {
    if (nuevo == null || nuevo === f.mixerId) return;
    void ejecutar(cmdEditar(f, { mixerId: nuevo }, { mixerId: f.mixerId ?? undefined }, `mixer ${mixerLabel(nuevo)}`));
  };

  const eliminarUno = (f: FilaManualSrv) => {
    if (!confirm("¿Eliminar este viaje? No se recalcula ningún otro.")) return;
    let idActual = f.id;
    void ejecutar({
      etiqueta: `eliminar viaje de ${clientePorId.get(f.clienteId)?.empresa ?? ""}`,
      hacer: async () => {
        await eliminarViajesManualAction([idActual]);
      },
      deshacer: async () => {
        const r = await agregarViajeManualAction({
          clienteId: f.clienteId,
          disenoId: f.disenoId,
          plantelId: plantel.plantelId,
          plantaId: f.plantaId,
          mixerId: f.mixerId ?? plantel.mixers[0]?.id ?? 0,
          volumen: f.volumen,
          horaCargaLocal: toLocalInput(f.inicioCargaMs),
          tipoDescarga: f.tipoDescarga,
        });
        if (r.ok && r.viajeId != null) idActual = r.viajeId; // el recreado tiene id nuevo
      },
    });
  };

  // ── Pegar desde Excel/Sheets: distribuye un bloque en las columnas Volumen/Hora ──
  const columnasPegado = ["volumen", "hora"] as const;
  const pegar = (
    filasOrdenadas: FilaManualSrv[],
    filaInicio: number,
    colInicio: "volumen" | "hora",
    texto: string,
  ) => {
    const matriz = parsePortapapeles(texto);
    if (matriz.length === 0) return;
    const colIdx0 = columnasPegado.indexOf(colInicio);
    const cambios: { viajeId: number; antes: PatchEdit; despues: PatchEdit }[] = [];
    matriz.forEach((filaVals, r) => {
      const destino = filasOrdenadas[filaInicio + r];
      if (!destino) return;
      filaVals.forEach((valor, c) => {
        const col = columnasPegado[colIdx0 + c];
        if (!col) return;
        const v = valor.trim();
        if (col === "volumen") {
          const num = Number(v.replace(",", "."));
          if (num > 0) cambios.push({ viajeId: destino.id, antes: { volumen: destino.volumen }, despues: { volumen: num } });
        } else {
          const ms = conNuevaHora(destino.inicioCargaMs, v);
          if (ms != null)
            cambios.push({
              viajeId: destino.id,
              antes: { horaCargaLocal: toLocalInput(destino.inicioCargaMs) },
              despues: { horaCargaLocal: toLocalInput(ms) },
            });
        }
      });
    });
    if (cambios.length === 0) return;
    void ejecutar({
      etiqueta: `pegar ${cambios.length} valor(es)`,
      hacer: async () => {
        for (const c of cambios) {
          const r = await editarViajeManualAction(c.viajeId, c.despues);
          if (!r.ok) throw new Error(r.mensaje ?? "No se pudo pegar.");
        }
      },
      deshacer: async () => {
        for (const c of cambios) await editarViajeManualAction(c.viajeId, c.antes);
      },
    });
  };

  // Navegación tipo hoja de cálculo entre las celdas Volumen/Hora de una planta.
  const moverFoco = (plantaId: number, fila: number, col: "volumen" | "hora") => {
    const el = celdas.current.get(`${plantaId}:${fila}:${col}`);
    if (el) {
      el.focus();
      el.select?.();
    }
  };
  const onKeyCelda = (
    e: React.KeyboardEvent,
    f: FilaManualSrv,
    plantaId: number,
    fila: number,
    col: "volumen" | "hora",
    filasLen: number,
  ) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur(); // dispara onBlur → confirma
      if (fila + 1 < filasLen) moverFoco(plantaId, fila + 1, col);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
      if (fila > 0) moverFoco(plantaId, fila - 1, col);
    } else if (e.key === "Escape") {
      e.preventDefault();
      escapando.current = true; // el onBlur que sigue NO debe confirmar
      setOv((p) => {
        const n = new Map(p);
        n.delete(f.id); // descarta lo tecleado → vuelve al valor del servidor
        return n;
      });
      (e.target as HTMLInputElement).blur();
    }
  };

  // ── Gantt (Plantas = cargas, Mixers = ciclos), color por cliente ──
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
              arrastrable: true,
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

  const clientesPresentes = [...new Set(plantel.filas.map((f) => f.clienteId))];

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-lg font-semibold text-ink">{plantel.nombre}</span>{" "}
          <span className="text-sm text-muted">({plantel.zona})</span>
          <ObservacionPlantel
            plantelId={plantel.plantelId}
            fecha={fecha}
            texto={plantel.observaciones}
            puedeEditar={puedeEditar}
            ocupado={ocupado}
          />
        </div>
        {puedeEditar && (
          <button
            onClick={() => setSerieAbierta(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10"
          >
            <Wand2 size={14} /> Generar en serie
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
      {plantel.plantas.map((planta) => {
        const filas = [...plantel.filas]
          .filter((f) => f.plantaId === planta.id)
          .sort((a, b) => filaEfectiva(a).inicioCargaMs - filaEfectiva(b).inicioCargaMs);
        return (
          <div key={planta.id} className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">
                Planta {planta.nombre} <span className="font-normal text-muted">· {planta.capacidadM3h} m³/h</span>
              </h3>
              <div className="flex items-center gap-2">
                <AperturaPlanta
                  planta={planta}
                  fecha={fecha}
                  puedeEditar={puedeEditar}
                  ocupado={ocupado}
                  onAviso={(m) => onAvisos([m])}
                />
                {puedeEditar && (
                  <button
                    onClick={() => setAgregarEn(planta.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    <Plus size={14} /> Agregar viaje
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-2 py-2 w-8">#</th>
                    <th className="w-[220px] px-2 py-2">Cliente / Proyecto</th>
                    <th className="px-2 py-2">Mixer</th>
                    <th className="px-2 py-2 w-24">Volumen</th>
                    <th className="px-2 py-2 w-24">
                      Carga{puedeEditar && <span className="ml-1 normal-case text-[10px] text-accent">editable</span>}
                    </th>
                    <th className="px-2 py-2">Salida</th>
                    <th className="px-2 py-2 w-24">
                      Llegada{puedeEditar && <span className="ml-1 normal-case text-[10px] text-accent">editable</span>}
                    </th>
                    <th className="px-2 py-2">Descarga</th>
                    <th className="px-2 py-2">Regreso</th>
                    {puedeEditar && <th className="px-2 py-2 w-8" title="Hora fija" />}
                    {puedeEditar && <th className="px-2 py-2 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {filas.length === 0 ? (
                    <tr>
                      <td colSpan={puedeEditar ? 11 : 9} className="px-2 py-4 text-center text-xs text-muted">
                        Sin viajes en esta planta. Usa <strong>Agregar viaje</strong> o <strong>Generar en serie</strong>.
                      </td>
                    </tr>
                  ) : (
                    filas.map((f, i) => {
                      const ef = filaEfectiva(f);
                      const t = calcular(f);
                      const cli = clientePorId.get(f.clienteId);
                      const rojo = idsRojos.has(f.id);
                      const choca = chocaCargaCon.get(f.id);
                      return (
                        <tr
                          key={f.id}
                          className={`border-b border-border/60 ${rojo ? "bg-red-50" : ""} ${
                            editandoId === f.id ? "ring-1 ring-inset ring-accent" : ""
                          }`}
                        >
                          <td className="px-2 py-1 text-muted">{i + 1}</td>
                          {/* Cliente/proyecto en un ancho ACOTADO: un nombre largo se
                              parte en varias líneas en vez de estirar la columna y
                              empujar las horas del ciclo fuera de la pantalla. */}
                          <td className="w-[220px] max-w-[220px] px-2 py-1 align-top">
                            <span className="flex items-start gap-1.5">
                              <span
                                className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: colorPorCliente(f.clienteId) }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block leading-tight font-medium break-words text-ink">
                                  {cli?.empresa}
                                </span>
                                {cli?.proyecto && (
                                  <span className="block text-[11px] leading-tight break-words text-muted">
                                    {cli.proyecto}
                                  </span>
                                )}
                              </span>
                            </span>
                            {choca && (
                              <span className="mt-0.5 block text-[11px] font-medium text-red-600">
                                Choca con la carga de las {fmtHM(choca.conMs)} — se encima {choca.solapeMin} min
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {puedeEditar ? (
                              <select
                                value={ef.mixerId ?? ""}
                                disabled={ocupado}
                                onFocus={() => setEditandoId(f.id)}
                                onChange={(e) => {
                                  const mid = e.target.value ? Number(e.target.value) : null;
                                  setOv((p) => new Map(p).set(f.id, { ...p.get(f.id), mixerId: mid }));
                                  commitMixer(f, mid);
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
                                ref={(el) => {
                                  if (el) celdas.current.set(`${planta.id}:${i}:volumen`, el);
                                }}
                                type="number"
                                min="0.5"
                                step="0.5"
                                value={ef.volumen}
                                disabled={ocupado}
                                onFocus={() => setEditandoId(f.id)}
                                onChange={(e) => setOv((p) => new Map(p).set(f.id, { ...p.get(f.id), volumen: Number(e.target.value) }))}
                                onBlur={(e) => {
                                  if (escapando.current) {
                                    escapando.current = false;
                                    return;
                                  }
                                  commitVolumen(f, Number(e.target.value));
                                }}
                                onKeyDown={(e) => onKeyCelda(e, f, planta.id, i, "volumen", filas.length)}
                                onPaste={(e) => {
                                  e.preventDefault();
                                  pegar(filas, i, "volumen", e.clipboardData.getData("text"));
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
                                ref={(el) => {
                                  if (el) celdas.current.set(`${planta.id}:${i}:hora`, el);
                                }}
                                type="time"
                                value={hhmmDeMs(ef.inicioCargaMs)}
                                disabled={ocupado}
                                onFocus={() => setEditandoId(f.id)}
                                onChange={(e) => {
                                  const nuevo = conNuevaHora(ef.inicioCargaMs, e.target.value);
                                  if (nuevo != null) setOv((p) => new Map(p).set(f.id, { ...p.get(f.id), inicioCargaMs: nuevo }));
                                }}
                                onBlur={(e) => {
                                  if (escapando.current) {
                                    escapando.current = false;
                                    return;
                                  }
                                  const nuevo = conNuevaHora(f.inicioCargaMs, e.target.value);
                                  if (nuevo != null) commitHora(f, nuevo);
                                }}
                                onKeyDown={(e) => onKeyCelda(e, f, planta.id, i, "hora", filas.length)}
                                onPaste={(e) => {
                                  e.preventDefault();
                                  pegar(filas, i, "hora", e.clipboardData.getData("text"));
                                }}
                                className={inCls + " w-24"}
                              />
                            ) : (
                              fmtHM(ef.inicioCargaMs)
                            )}
                          </td>
                          <td className="px-2 py-1 text-muted">{t ? fmtHM(t.salidaMs) : "—"}</td>
                          <td className="px-2 py-1">
                            {puedeEditar && t ? (
                              /* Hora comprometida con el cliente: al escribirla, el servidor
                                 calcula hacia atras la carga y recorre la cola del cliente. */
                              <input
                                type="time"
                                value={hhmmDeMs(t.llegadaMs)}
                                disabled={ocupado}
                                onFocus={() => setEditandoId(f.id)}
                                onChange={(e) => {
                                  const nuevaLlegada = conNuevaHora(t.llegadaMs, e.target.value);
                                  const planta = plantaPorId.get(f.plantaId);
                                  if (nuevaLlegada == null || !planta) return;
                                  // Vista previa inmediata: se traduce a su hora de carga.
                                  const inicio = inicioCargaDesdeLlegada(nuevaLlegada, {
                                    alistamientoMin: planta.alistamientoMin,
                                    capacidadPlantaM3h: planta.capacidadM3h,
                                    volumen: ef.volumen,
                                    tViajeMin: f.transporteMin,
                                    tRegresoMin: f.transporteMin,
                                    tipoDescarga: f.tipoDescarga,
                                  });
                                  setOv((p) => new Map(p).set(f.id, { ...p.get(f.id), inicioCargaMs: inicio }));
                                }}
                                onBlur={(e) => {
                                  if (escapando.current) {
                                    escapando.current = false;
                                    return;
                                  }
                                  // La referencia "antes" es la del SERVIDOR: el override
                                  // optimista ya contiene lo tecleado y compararse contra
                                  // el haria que el cambio pareciera nulo.
                                  const base = calcularServidor(f);
                                  if (!base) return;
                                  const nuevaLlegada = conNuevaHora(base.llegadaMs, e.target.value);
                                  if (nuevaLlegada != null) commitLlegada(f, nuevaLlegada, base.llegadaMs);
                                }}
                                className={inCls + " w-24 font-medium"}
                                title="Hora de llegada a obra: se calcula la carga hacia atras"
                              />
                            ) : (
                              <span className="font-medium text-ink">{t ? fmtHM(t.llegadaMs) : "—"}</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-muted">{t ? `${fmtHM(t.inicioDescargaMs)}–${fmtHM(t.finDescargaMs)}` : "—"}</td>
                          <td className="px-2 py-1 text-muted">{t ? fmtHM(t.regresoMs) : "—"}</td>
                          {puedeEditar && (
                            <td className="px-2 py-1">
                              <button
                                onClick={() => commitHoraFija(f, !f.horaFija)}
                                disabled={ocupado}
                                className={`rounded p-1 disabled:opacity-40 ${
                                  f.horaFija ? "text-accent" : "text-muted hover:bg-content"
                                }`}
                                title={
                                  f.horaFija
                                    ? "Hora fija: los reajustes por frecuencia no mueven este viaje"
                                    : "Fijar la hora de este viaje"
                                }
                              >
                                {f.horaFija ? <Lock size={14} /> : <LockOpen size={14} />}
                              </button>
                            </td>
                          )}
                          {puedeEditar && (
                            <td className="px-2 py-1">
                              <button
                                onClick={() => eliminarUno(f)}
                                disabled={ocupado}
                                className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
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
        </div>

        {/* Panel lateral colapsable: mixers y a qué hora queda libre cada uno */}
        <PanelMixers mixers={plantel.mixersPanel} info={infoMixer} />
      </div>

      {/* Gantt espejo en vivo */}
      <div className="mt-2 rounded-lg border border-border bg-content/30 p-3">
        <h3 className="mb-2 text-sm font-semibold text-ink">Línea de tiempo (en vivo)</h3>
        <GanttManual
          secciones={seccionesGantt}
          highlightId={editandoId}
          rojos={idsRojos}
          onMoverInicio={
            puedeEditar
              ? (viajeId, nuevoInicioMs) => {
                  const id = Number(viajeId);
                  const f = plantel.filas.find((x) => x.id === id);
                  if (f) commitHora(f, nuevoInicioMs);
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

      <BarraValidaciones
        traslapesMixer={traslapesMixer.length}
        traslapesCarga={traslapesCarga}
        capacidad={avisosCap.length}
        margen={avisosMargen.length}
        plantaNombre={(id) => plantaPorId.get(id)?.nombre ?? `Planta ${id}`}
        frecuencias={[...frecCliente.entries()]
          .filter(([, v]) => v != null)
          .map(([cid, v]) => ({ empresa: clientePorId.get(cid)?.empresa ?? `Cliente ${cid}`, min: v as number }))}
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
          onAgregar={(input, etiqueta) => {
            setAgregarEn(null);
            let idCreado: number | null = null;
            void ejecutar({
              etiqueta,
              hacer: async () => {
                const r = await agregarViajeManualAction(input);
                if (!r.ok || r.viajeId == null) throw new Error(r.mensaje ?? "No se pudo agregar.");
                idCreado = r.viajeId;
              },
              deshacer: async () => {
                if (idCreado != null) await eliminarViajesManualAction([idCreado]);
              },
            });
          }}
        />
      )}

      {serieAbierta && (
        <GenerarSerieModal
          plantel={plantel}
          clientes={clientes}
          disenos={disenos}
          fecha={fecha}
          onCerrar={() => setSerieAbierta(false)}
          onGenerar={(input, etiqueta) => {
            setSerieAbierta(false);
            let ids: number[] = [];
            void ejecutar({
              etiqueta,
              hacer: async () => {
                const r = await generarViajesEnSerieAction(input);
                if (!r.ok) throw new Error(r.mensaje ?? "No se pudo generar.");
                ids = r.viajeIds ?? [];
              },
              deshacer: async () => {
                await eliminarViajesManualAction(ids);
              },
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * Panel lateral COLAPSABLE de mixers para el día/plantel en contexto. Solo informa
 * (no reprograma nada): por cada mixer muestra identificador + capacidad, a qué hora
 * queda libre (fin de su último ciclo) o "Libre todo el día", su estado si no está
 * disponible, y cuántos viajes ya tiene asignados hoy. Ordena por "quién queda libre
 * más pronto" para ubicar de inmediato con qué mixer contar para el siguiente hueco.
 */
/**
 * Nota operativa del PLANTEL para el día (p. ej. "Enviar 5 mixers a Choloma"). La
 * escriben el Programador / Jefe de Planta / Admin aquí; se muestra al lado del nombre
 * del plantel en Despacho en vivo y en el Programa DPCR-08. Vacía = no se muestra nada
 * en ninguna pantalla.
 */
function ObservacionPlantel({
  plantelId,
  fecha,
  texto,
  puedeEditar,
  ocupado,
}: {
  plantelId: number;
  fecha: string;
  texto: string;
  puedeEditar: boolean;
  ocupado: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(texto);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await guardarObservacionPlantelAction(plantelId, fecha, valor);
      if (!r.ok) alert(r.mensaje ?? "No se pudo guardar la observación.");
      else {
        setEditando(false);
        router.refresh();
      }
    } finally {
      setGuardando(false);
    }
  };

  if (!puedeEditar) {
    // Sin permiso de edición: solo se muestra si hay algo escrito.
    return texto ? (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
        <MessageSquare size={12} /> {texto}
      </span>
    ) : null;
  }

  if (!editando) {
    return (
      <button
        onClick={() => {
          setValor(texto);
          setEditando(true);
        }}
        disabled={ocupado}
        title="Nota del plantel para este día (se ve en Despacho y en el DPCR-08)"
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs disabled:opacity-40 ${
          texto
            ? "bg-amber-50 text-amber-900 hover:bg-amber-100"
            : "border border-dashed border-border text-muted hover:text-accent"
        }`}
      >
        <MessageSquare size={12} /> {texto || "Observaciones"}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        value={valor}
        autoFocus
        disabled={guardando}
        placeholder="Ej. enviar 5 mixers a Choloma"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void guardar();
          if (e.key === "Escape") setEditando(false);
        }}
        className="w-64 rounded border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      />
      <button
        onClick={() => void guardar()}
        disabled={guardando}
        className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        Guardar
      </button>
      <button
        onClick={() => setEditando(false)}
        className="rounded p-1 text-muted hover:bg-content"
        aria-label="Cancelar"
      >
        <X size={13} />
      </button>
    </span>
  );
}

/**
 * Hora de APERTURA de la planta para ESTE día. Por defecto rige el valor de
 * Administración (7:00 a.m.); aquí el Programador puede adelantarla cuando la
 * operación lo pide (un vaciado que arranca a las 5:00), solo para este día y esta
 * planta. Es una excepción puntual, no un cambio global que haya que revertir.
 */
function AperturaPlanta({
  planta,
  fecha,
  puedeEditar,
  ocupado,
  onAviso,
}: {
  planta: PlantaManual;
  fecha: string;
  puedeEditar: boolean;
  ocupado: boolean;
  onAviso: (mensaje: string) => void;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(planta.aperturaHHMM);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (hhmm: string | null) => {
    setGuardando(true);
    try {
      const r = await fijarAperturaPlantaAction(planta.id, fecha, hhmm);
      if (!r.ok) onAviso(r.mensaje ?? "No se pudo cambiar la apertura.");
      else {
        setEditando(false);
        router.refresh();
      }
    } finally {
      setGuardando(false);
    }
  };

  if (!puedeEditar) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <Sunrise size={13} /> Apertura {planta.aperturaHHMM}
      </span>
    );
  }

  if (!editando) {
    return (
      <button
        onClick={() => {
          setValor(planta.aperturaHHMM);
          setEditando(true);
        }}
        disabled={ocupado}
        title="Hora a partir de la cual esta planta puede cargar este día"
        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-40 ${
          planta.aperturaEsExcepcion
            ? "border-accent text-accent"
            : "border-border text-muted hover:bg-content"
        }`}
      >
        <Sunrise size={13} /> Apertura {planta.aperturaHHMM}
        {planta.aperturaEsExcepcion && <span className="font-medium">· este día</span>}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="time"
        value={valor}
        disabled={guardando}
        onChange={(e) => setValor(e.target.value)}
        className="rounded border border-border bg-surface px-1.5 py-1 text-xs text-ink outline-none focus:border-accent"
      />
      <button
        onClick={() => void guardar(valor)}
        disabled={guardando}
        className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        Guardar
      </button>
      {planta.aperturaEsExcepcion && (
        <button
          onClick={() => void guardar(null)}
          disabled={guardando}
          title="Volver a la apertura por defecto"
          className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:bg-content disabled:opacity-50"
        >
          Quitar
        </button>
      )}
      <button
        onClick={() => setEditando(false)}
        className="rounded p-1 text-muted hover:bg-content"
        aria-label="Cancelar"
      >
        <X size={13} />
      </button>
    </span>
  );
}

function PanelMixers({
  mixers,
  info,
}: {
  mixers: MixerPanel[];
  info: Map<number, { viajes: number; libreMs: number | null }>;
}) {
  // Arranca MINIMIZADO: es un panel de consulta ("¿qué mixer queda libre y cuándo?"),
  // no algo que se necesite todo el tiempo, y abierto le come ancho a la tabla. El
  // Programador / Jefe de Planta / Admin lo abre con la pestaña lateral cuando lo pide.
  const [abierto, setAbierto] = useState(false);

  const disponibleHoy = (m: MixerPanel) => m.estado === "Disponible" && !m.enMantenimiento;
  const libreMsDe = (m: MixerPanel) => info.get(m.id)?.libreMs ?? null;

  const orden = [...mixers].sort((a, b) => {
    const da = disponibleHoy(a);
    const db = disponibleHoy(b);
    if (da !== db) return da ? -1 : 1; // no disponibles al final
    if (da) {
      // Disponibles: el que queda libre más pronto arriba (sin viajes = libre ya).
      const la = libreMsDe(a) ?? -Infinity;
      const lb = libreMsDe(b) ?? -Infinity;
      if (la !== lb) return la - lb;
    }
    return a.label.localeCompare(b.label);
  });

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        title="Mostrar mixers disponibles"
        className="flex shrink-0 items-center gap-1 self-start rounded-lg border border-border bg-content/40 px-2 py-2 text-xs font-medium text-muted hover:text-ink lg:flex-col lg:py-3"
      >
        <Truck size={15} />
        <span className="lg:[writing-mode:vertical-rl]">Mixers</span>
      </button>
    );
  }

  return (
    <div className="shrink-0 rounded-lg border border-border bg-content/30 p-3 lg:w-72">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Truck size={15} /> Mixers ({mixers.length})
        </h3>
        <button
          onClick={() => setAbierto(false)}
          title="Ocultar panel"
          className="rounded p-1 text-muted hover:bg-content hover:text-ink"
          aria-label="Ocultar panel de mixers"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <p className="mb-2 text-[11px] text-muted">
        Ordenados por quién queda libre más pronto (para el siguiente hueco).
      </p>
      {orden.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted">No hay mixers para este plantel.</p>
      ) : (
        <ul className="space-y-1.5">
          {orden.map((m) => {
            const inf = info.get(m.id);
            const viajes = inf?.viajes ?? 0;
            const disp = disponibleHoy(m);
            const libreMs = inf?.libreMs ?? null;
            // Estado/línea principal.
            let estadoTxt: string;
            let tono: string;
            if (!disp) {
              estadoTxt = m.enMantenimiento && m.estado === "Disponible" ? "En mantenimiento (hoy)" : m.estado;
              tono = "text-danger";
            } else if (libreMs == null) {
              estadoTxt = "Libre todo el día";
              tono = "text-ok";
            } else {
              estadoTxt = `Queda libre ~${fmtHM(libreMs)}`;
              tono = "text-ink";
            }
            return (
              <li
                key={m.id}
                className={`rounded-md border px-2 py-1.5 text-xs ${
                  disp ? "border-border bg-surface" : "border-red-200 bg-red-50/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">
                    {m.label} <span className="font-normal text-muted">· {m.capacidad} m³</span>
                    {m.esHub && <span className="ml-1 text-[10px] text-sky-600">(préstamo)</span>}
                  </span>
                  <span className="text-muted">{viajes} viaje{viajes === 1 ? "" : "s"}</span>
                </div>
                <div className={`mt-0.5 font-medium ${tono}`}>{estadoTxt}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BarraValidaciones({
  traslapesMixer,
  traslapesCarga,
  capacidad,
  margen,
  plantaNombre,
  frecuencias,
}: {
  traslapesMixer: number;
  traslapesCarga: { plantaId: number; inicioCargaMs: number }[];
  capacidad: number;
  margen: number;
  plantaNombre: (id: number) => string;
  frecuencias: { empresa: string; min: number }[];
}) {
  const problemas = traslapesMixer + traslapesCarga.length + capacidad + margen;
  // Agrupar traslapes de carga por planta ("STALO: 2 cargas encimadas a las 07:41").
  const cargaPorPlanta = new Map<number, number[]>();
  for (const c of traslapesCarga) {
    (cargaPorPlanta.get(c.plantaId) ?? cargaPorPlanta.set(c.plantaId, []).get(c.plantaId)!).push(c.inicioCargaMs);
  }
  return (
    <div className="mt-3 space-y-1 text-sm">
      {problemas === 0 ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">
          ✓ Sin traslapes de carga ni de mixer, sin exceso de planta ni márgenes apretados.
        </p>
      ) : (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
          {[...cargaPorPlanta.entries()].map(([pid, msList]) => (
            <p key={pid} className="font-medium text-red-700">
              ⛔ {plantaNombre(pid)}: {msList.length} carga(s) encimada(s) — la planta no puede cargar 2 mixers a la vez
              {msList[0] != null ? ` (p. ej. a las ${fmtHM(Math.min(...msList))})` : ""}.
            </p>
          ))}
          {traslapesMixer > 0 && <p>⚠️ {traslapesMixer} traslape(s) de mixer (mismo mixer en 2 viajes que se enciman).</p>}
          {capacidad > 0 && <p>⚠️ {capacidad} ventana(s) de 60 min superan la capacidad m³/h de la planta.</p>}
          {margen > 0 && <p>⚠️ {margen} margen(es) apretado(s) entre el regreso de un mixer y su siguiente carga.</p>}
          <p className="mt-1 text-xs text-amber-700">Son avisos: puedes continuar igual si sabes lo que haces.</p>
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
  onAgregar,
}: {
  plantelId: number;
  plantaId: number;
  plantaNombre: string;
  clientes: ClienteOpcionManual[];
  disenos: DisenoOpcionManual[];
  mixers: MixerOpcionManual[];
  fecha: string;
  onCerrar: () => void;
  onAgregar: (
    input: {
      clienteId: number;
      disenoId: number;
      plantelId: number;
      plantaId: number;
      mixerId: number;
      volumen: number;
      horaCargaLocal: string;
      tipoDescarga: string;
    },
    etiqueta: string,
  ) => void;
}) {
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
    const cli = clientes.find((c) => c.id === clienteId);
    onAgregar(
      { clienteId, disenoId, plantelId, plantaId, mixerId, volumen: vol, horaCargaLocal: `${fecha}T${hora}`, tipoDescarga },
      `agregar viaje de ${cli?.empresa ?? ""} a las ${hora}`,
    );
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
            <button onClick={guardar} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
              Agregar viaje
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GenerarSerieModal({
  plantel,
  clientes,
  disenos,
  fecha,
  onCerrar,
  onGenerar,
}: {
  plantel: PlantelManual;
  clientes: ClienteOpcionManual[];
  disenos: DisenoOpcionManual[];
  fecha: string;
  onCerrar: () => void;
  onGenerar: (
    input: {
      clienteId: number;
      disenoId: number;
      plantelId: number;
      plantaIds: number[];
      mixerIds: number[];
      volumen: number;
      cantidad: number;
      frecuenciaMin: number;
      horaCargaLocal: string;
      tipoDescarga: string;
    },
    etiqueta: string,
  ) => void;
}) {
  const [clienteId, setClienteId] = useState<number>(clientes[0]?.id ?? 0);
  const [disenoId, setDisenoId] = useState<number>(disenos[0]?.id ?? 0);
  const [tipoDescarga, setTipoDescarga] = useState<string>("Canal directo");
  const [volumen, setVolumen] = useState<string>("10");
  const [cantidad, setCantidad] = useState<string>("10");
  const [frecuencia, setFrecuencia] = useState<string>("15");
  const [hora, setHora] = useState<string>("07:00");
  const [plantaSel, setPlantaSel] = useState<number[]>(plantel.plantas.map((p) => p.id));
  const [mixerSel, setMixerSel] = useState<number[]>(plantel.mixers.map((m) => m.id));
  const [error, setError] = useState<string | null>(null);

  const toggle = (arr: number[], id: number, set: (a: number[]) => void) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const generar = () => {
    setError(null);
    const vol = Number(volumen);
    const cant = Number(cantidad);
    const freq = Number(frecuencia);
    if (!(vol > 0)) return setError("Volumen inválido.");
    if (!(cant > 0) || cant > 200) return setError("Cantidad entre 1 y 200.");
    if (!(freq > 0)) return setError("Frecuencia inválida.");
    if (!clienteId || !disenoId) return setError("Elige cliente y diseño.");
    const plantaIds = plantel.plantas.filter((p) => plantaSel.includes(p.id)).map((p) => p.id);
    const mixerIds = plantel.mixers.filter((m) => mixerSel.includes(m.id)).map((m) => m.id);
    if (plantaIds.length === 0) return setError("Elige al menos una planta.");
    if (mixerIds.length === 0) return setError("Elige al menos un mixer.");
    const cli = clientes.find((c) => c.id === clienteId);
    onGenerar(
      {
        clienteId,
        disenoId,
        plantelId: plantel.plantelId,
        plantaIds,
        mixerIds,
        volumen: vol,
        cantidad: cant,
        frecuenciaMin: freq,
        horaCargaLocal: `${fecha}T${hora}`,
        tipoDescarga,
      },
      `generar ${cant} viajes de ${cli?.empresa ?? ""}`,
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onClick={onCerrar}>
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-ink">Generar en serie — {plantel.nombre}</h2>
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
          <Campo label="Volumen por viaje (m³)">
            <input type="number" min="0.5" step="0.5" value={volumen} onChange={(e) => setVolumen(e.target.value)} className={inCls} />
          </Campo>
          <Campo label="Tipo de descarga">
            <select value={tipoDescarga} onChange={(e) => setTipoDescarga(e.target.value)} className={selCls}>
              <option value="Canal directo">Canal directo</option>
              <option value="Bomba estacionaria">Bomba estacionaria</option>
              <option value="Bomba pluma">Bomba pluma</option>
            </select>
          </Campo>
          <Campo label="Cantidad de viajes">
            <input type="number" min="1" max="200" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className={inCls} />
          </Campo>
          <Campo label="Frecuencia (min entre cargas)">
            <input type="number" min="1" step="1" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)} className={inCls} />
          </Campo>
          <Campo label="Hora de carga del primero">
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inCls} />
          </Campo>
          <div />
          <div className="sm:col-span-1">
            <span className="mb-1 block text-sm font-medium text-ink">Plantas a alternar</span>
            <div className="flex flex-wrap gap-2">
              {plantel.plantas.map((p) => (
                <label key={p.id} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm">
                  <input type="checkbox" checked={plantaSel.includes(p.id)} onChange={() => toggle(plantaSel, p.id, setPlantaSel)} className="h-3.5 w-3.5 accent-accent" />
                  {p.nombre}
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-1">
            <span className="mb-1 block text-sm font-medium text-ink">Mixers a rotar ({mixerSel.length})</span>
            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              {plantel.mixers.map((m) => (
                <label key={m.id} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                  <input type="checkbox" checked={mixerSel.includes(m.id)} onChange={() => toggle(mixerSel, m.id, setMixerSel)} className="h-3.5 w-3.5 accent-accent" />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <p className="sm:col-span-2 text-xs text-muted">
            Se crean {cantidad || "N"} viajes cada {frecuencia || "?"} min a partir de las {hora}, alternando las plantas
            marcadas y rotando los mixers marcados. Puedes deshacerlo todo con Ctrl+Z en un solo paso.
          </p>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button onClick={onCerrar} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content">
              Cancelar
            </button>
            <button onClick={generar} className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
              <Wand2 size={15} /> Generar
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
// El selector de mixer necesita un ancho mínimo: con la tabla apretada se encogía
// tanto que no se alcanzaba a leer el identificador de la unidad.
const selCls = `${inCls} min-w-[5.5rem]`;
