"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Ban, ChevronDown, ChevronRight, Clock, Lock, Pencil, Trash2, X } from "lucide-react";
import {
  confirmarRefuerzoAction,
  eliminarPedidoAction,
  fijarHoraCargaManualAction,
  reordenarPedidoAction,
} from "../actions";
import {
  PedidoForm,
  type ClienteOpcion,
  type DisenoOpcion,
  type ValoresPedido,
} from "../pedido-form";
import { Badge } from "../components/ui";
import { BotonesMapa, type UbicacionCliente } from "../components/maps-buttons";
import { CancelarPedidoModal } from "../components/cancelar-pedido-modal";

interface Opcion {
  id: number;
  etiqueta: string;
}
interface PlantelOpcion {
  id: number;
  nombre: string;
  zona: string;
  hubId: number | null;
  plantas: Opcion[];
}
interface BombaOpcion {
  id: number;
  etiqueta: string;
  plantelId: number | null;
}
export interface OpcionesModal {
  clientes: ClienteOpcion[];
  disenos: DisenoOpcion[];
  planteles: PlantelOpcion[];
  bombas: BombaOpcion[];
  asesores: Opcion[];
}

export interface ViajeVista {
  id: number;
  codigoViaje: string; // identificador del sistema, ej. "V-000045"
  numClienteDia: number | null; // número de viaje del cliente ese día (1..N); null si no aplica
  totalClienteDia: number; // total de viajes del cliente ese día
  plantaNombre: string; // planta dosificadora del viaje (STALO/SANY/…)
  mixerLabel: string | null;
  flota: string | null; // nombre del plantel base del mixer
  flotaPropia: boolean; // true si el mixer es del mismo plantel del pedido
  volumen: number;
  rutaPorDefecto: boolean;
  cargaTxt: string;
  salidaTxt: string;
  llegadaTxt: string;
  descargaTxt: string;
  regresoTxt: string;
}
export interface SugerenciaVista {
  mixerId: number;
  identificador: string | null;
  capacidad: number;
  plantelNombre: string;
}
export interface PedidoVista {
  id: number;
  orden: number | null;
  horaFija: boolean;
  // TEMPORAL/REVERSIBLE — override de hora de carga (Admin). `horaCargaLocal` es la
  // hora de carga base (para prellenar el control); `horaCargaManualLocal` es el
  // override vigente en formato datetime-local, o null si está en automático.
  horaCargaLocal: string;
  horaCargaManualLocal: string | null;
  horaTxt: string;
  empresa: string;
  proyecto: string;
  disenoCodigo: string;
  disenoEspec: string;
  revenimiento: string;
  elemento: string;
  tipoDescarga: string;
  hieloTxt: string;
  volumen: number;
  confirmado: boolean;
  sinCubrir: boolean;
  sinCubrirVol: number;
  sugerencias: SugerenciaVista[];
  viajes: ViajeVista[];
  ubicacion: UbicacionCliente;
  valores: ValoresPedido;
}

export function TablaPedidos({
  pedidos,
  opciones,
  puedeEditar = true,
  esAdmin = false,
  permitirHoraCargaManual = false,
}: {
  pedidos: PedidoVista[];
  opciones: OpcionesModal;
  puedeEditar?: boolean;
  // TEMPORAL/REVERSIBLE — habilita el control de hora de carga manual (solo Admin).
  esAdmin?: boolean;
  permitirHoraCargaManual?: boolean;
}) {
  const router = useRouter();
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [editando, setEditando] = useState<PedidoVista | null>(null);
  const [cancelando, setCancelando] = useState<PedidoVista | null>(null);
  const [borrando, startBorrar] = useTransition();

  const toggle = (id: number) =>
    setExpandidos((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  const eliminar = (id: number) => {
    if (!confirm(`¿Eliminar el pedido #${id} y todos sus viajes?`)) return;
    startBorrar(async () => {
      const res = await eliminarPedidoAction(id);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo eliminar.");
    });
  };

  const reordenar = (id: number, actual: number | null, nuevo: number) => {
    if (!Number.isFinite(nuevo) || nuevo < 1 || nuevo === actual) return;
    startBorrar(async () => {
      const res = await reordenarPedidoAction(id, nuevo);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo reordenar.");
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="w-8 px-2 py-2" />
            <th className="px-2 py-2" title="Orden de atención en el plantel">#</th>
            <th className="px-3 py-2" title="Hora de llegada al proyecto">Llegada</th>
            <th className="px-3 py-2">Cliente / proyecto</th>
            <th className="hidden px-3 py-2 sm:table-cell">Tipo de concreto</th>
            <th className="hidden px-3 py-2 lg:table-cell">Elemento</th>
            <th className="hidden px-3 py-2 md:table-cell">Descarga</th>
            <th className="hidden px-3 py-2 sm:table-cell">Hielo</th>
            <th className="px-3 py-2">Vol.</th>
            <th className="px-3 py-2">Confirmación</th>
            <th className="px-3 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.map((p) => {
            const abierto = expandidos.has(p.id);
            return (
              <FragmentoPedido
                key={p.id}
                p={p}
                abierto={abierto}
                onToggle={() => toggle(p.id)}
                onEditar={() => setEditando(p)}
                onEliminar={() => eliminar(p.id)}
                onCancelar={() => setCancelando(p)}
                onReordenar={(nuevo) => reordenar(p.id, p.orden, nuevo)}
                borrando={borrando}
                puedeEditar={puedeEditar}
                horaCargaManualHabilitada={esAdmin && permitirHoraCargaManual}
              />
            );
          })}
        </tbody>
      </table>

      {editando && (
        <ModalEdicion
          pedido={editando}
          opciones={opciones}
          onCerrar={() => setEditando(null)}
          onExito={() => router.refresh()}
        />
      )}

      {cancelando && (
        <CancelarPedidoModal
          pedidoId={cancelando.id}
          etiqueta={cancelando.proyecto ? `${cancelando.empresa} — ${cancelando.proyecto}` : cancelando.empresa}
          onClose={() => setCancelando(null)}
          onCancelado={() => {
            setCancelando(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Numeral del orden de atención. Editable por el Programador (reacomoda la cola). */
function OrdenNumeral({
  orden,
  puedeEditar,
  onReordenar,
}: {
  orden: number | null;
  puedeEditar: boolean;
  onReordenar: (nuevo: number) => void;
}) {
  const [val, setVal] = useState(orden != null ? String(orden) : "");
  useEffect(() => {
    setVal(orden != null ? String(orden) : "");
  }, [orden]);

  if (!puedeEditar) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
        {orden ?? "—"}
      </span>
    );
  }

  const commit = () => {
    const n = Number.parseInt(val, 10);
    if (Number.isNaN(n)) {
      setVal(orden != null ? String(orden) : "");
      return;
    }
    onReordenar(n);
  };

  return (
    <input
      type="number"
      min="1"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      title="Orden de atención (escribe un número para reacomodar la cola)"
      className="h-7 w-11 rounded-full border border-accent/40 bg-accent/10 text-center text-xs font-semibold text-accent outline-none focus:border-accent"
    />
  );
}

function FragmentoPedido({
  p,
  abierto,
  onToggle,
  onEditar,
  onEliminar,
  onCancelar,
  onReordenar,
  borrando,
  puedeEditar,
  horaCargaManualHabilitada,
}: {
  p: PedidoVista;
  abierto: boolean;
  onToggle: () => void;
  onEditar: () => void;
  onEliminar: () => void;
  onCancelar: () => void;
  onReordenar: (nuevo: number) => void;
  borrando: boolean;
  puedeEditar: boolean;
  // TEMPORAL/REVERSIBLE — muestra el control de hora de carga manual (Admin + flag).
  horaCargaManualHabilitada: boolean;
}) {
  return (
    <>
      <tr className="border-b border-border/60 align-top">
        <td className="px-2 py-2">
          <button
            onClick={onToggle}
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
            aria-label={abierto ? "Contraer" : "Expandir"}
          >
            {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="px-2 py-2">
          <OrdenNumeral orden={p.orden} puedeEditar={puedeEditar} onReordenar={onReordenar} />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="inline-flex items-center gap-1">
            {p.horaTxt}
            {p.horaFija && (
              <Lock size={12} className="text-accent" aria-label="Hora fija" />
            )}
            {p.horaCargaManualLocal && (
              <Clock
                size={12}
                className="text-amber-600"
                aria-label="Hora de carga fijada manualmente"
              />
            )}
          </span>
        </td>
        <td className="px-3 py-2">
          <div className="font-medium text-ink">{p.empresa}</div>
          {p.proyecto && <div className="text-xs text-link">{p.proyecto}</div>}
        </td>
        <td className="hidden px-3 py-2 sm:table-cell">
          <div className="font-medium text-ink">{p.disenoCodigo}</div>
          <div className="text-xs text-muted">{p.disenoEspec}</div>
          {p.revenimiento && <div className="text-xs text-muted">Rev: {p.revenimiento}</div>}
        </td>
        <td className="hidden px-3 py-2 text-ink lg:table-cell">{p.elemento}</td>
        <td className="hidden px-3 py-2 md:table-cell">{p.tipoDescarga}</td>
        <td className="hidden px-3 py-2 text-xs sm:table-cell">{p.hieloTxt}</td>
        <td className="px-3 py-2 whitespace-nowrap font-medium">
          {p.volumen.toFixed(1)} m³
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            <Badge tono={p.confirmado ? "ok" : "neutro"}>
              {p.confirmado ? "Confirmado" : "Pendiente"}
            </Badge>
            {p.sinCubrir && <Badge tono="danger">Sin cubrir</Badge>}
          </div>
        </td>
        <td className="px-3 py-2">
          {puedeEditar ? (
            <div className="flex items-center gap-1">
              <button
                title="Editar pedido"
                onClick={onEditar}
                className="rounded-md p-1.5 text-muted hover:bg-content"
              >
                <Pencil size={16} />
              </button>
              <button
                title="Cancelar pedido (con motivo)"
                disabled={borrando}
                onClick={onCancelar}
                className="rounded-md p-1.5 text-amber-600 hover:bg-amber-50 disabled:opacity-50"
              >
                <Ban size={16} />
              </button>
              <button
                title="Eliminar pedido"
                disabled={borrando}
                onClick={onEliminar}
                className="rounded-md p-1.5 text-danger hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
      </tr>

      {abierto && (
        <tr className="border-b border-border/60 bg-content/60">
          <td />
          <td colSpan={10} className="px-3 py-3">
            {/* Info del pedido (visible aquí para pantallas angostas donde la
                fila oculta columnas secundarias). */}
            <div className="mb-2 text-xs text-muted lg:hidden">
              <span className="font-medium text-ink">{p.disenoCodigo}</span>{" "}
              {p.disenoEspec}
              {p.revenimiento ? ` · Rev: ${p.revenimiento}` : ""} · {p.elemento} ·{" "}
              {p.tipoDescarga} · {p.hieloTxt}
            </div>
            <div className="mb-2 flex items-center gap-2 text-xs text-muted">
              <span className="font-medium text-ink">Ubicación:</span>
              <BotonesMapa ubicacion={p.ubicacion} />
            </div>
            <DetalleViajes viajes={p.viajes} />
            {horaCargaManualHabilitada && (
              <HoraCargaManualAdmin
                pedidoId={p.id}
                base={p.horaCargaManualLocal ?? p.horaCargaLocal}
                overrideActivo={p.horaCargaManualLocal}
              />
            )}
            {p.sinCubrir && (
              <RefuerzoBlock
                pedidoId={p.id}
                faltante={p.sinCubrirVol}
                sugerencias={p.sugerencias}
                puedeEditar={puedeEditar}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function RefuerzoBlock({
  pedidoId,
  faltante,
  sugerencias,
  puedeEditar,
}: {
  pedidoId: number;
  faltante: number;
  sugerencias: SugerenciaVista[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  const confirmar = (mixerId: number) => {
    startTransition(async () => {
      const res = await confirmarRefuerzoAction(pedidoId, mixerId);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo confirmar el refuerzo.");
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="mb-1 text-sm font-semibold text-amber-800">
        Refuerzo excepcional — faltan {faltante} m³ sin cubrir
      </div>
      <p className="mb-2 text-xs text-amber-700">
        Mixers sugeridos de otros planteles (requiere confirmación). Al confirmar
        se asigna como &quot;Refuerzo excepcional&quot; y se agenda en la cascada.
      </p>
      {sugerencias.length === 0 ? (
        <p className="text-xs text-amber-700">
          No hay mixers de refuerzo disponibles en otros planteles.
        </p>
      ) : (
        <ul className="space-y-1">
          {sugerencias.map((s) => (
            <li
              key={s.mixerId}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="text-ink">
                Mixer {s.identificador ?? `#${s.mixerId}`} ({s.capacidad} m³) —{" "}
                <span className="text-muted">Flota {s.plantelNombre}</span>
              </span>
              {puedeEditar && (
                <button
                  disabled={pendiente}
                  onClick={() => confirmar(s.mixerId)}
                  className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Confirmar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * TEMPORAL/REVERSIBLE — Control (solo Admin, cuando el flag está activo) para FIJAR
 * la hora de carga de un pedido a cualquier horario, aunque choque con la carga de
 * otro pedido. Vacío / "Volver a automático" devuelve el pedido al control de la
 * cascada. Al desactivar el flag este control no se renderiza.
 */
function HoraCargaManualAdmin({
  pedidoId,
  base,
  overrideActivo,
}: {
  pedidoId: number;
  base: string; // datetime-local para prellenar el input
  overrideActivo: string | null; // override vigente, o null = automático
}) {
  const router = useRouter();
  const [valor, setValor] = useState(base);
  const [pendiente, startTransition] = useTransition();

  useEffect(() => {
    setValor(overrideActivo ?? base);
  }, [overrideActivo, base]);

  const guardar = (horaLocal: string | null) => {
    startTransition(async () => {
      const res = await fijarHoraCargaManualAction(pedidoId, horaLocal);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo fijar la hora de carga.");
    });
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
      <Clock size={14} className="shrink-0 text-amber-700" />
      <span className="font-medium text-amber-900">Hora de carga manual (Admin):</span>
      <input
        type="datetime-local"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="rounded border border-amber-300 bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      />
      <button
        onClick={() => guardar(valor)}
        disabled={pendiente || !valor}
        className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {pendiente ? "…" : "Fijar"}
      </button>
      {overrideActivo && (
        <button
          onClick={() => guardar(null)}
          disabled={pendiente}
          className="rounded border border-amber-400 px-3 py-1 font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          Volver a automático
        </button>
      )}
      <span className="w-full text-amber-700 sm:w-auto">
        {overrideActivo
          ? "Fijada manualmente — puede chocar con otros pedidos."
          : "Automático (la programación manda)."}
      </span>
    </div>
  );
}

function DetalleViajes({ viajes }: { viajes: ViajeVista[] }) {
  if (viajes.length === 0) {
    return <p className="text-xs text-muted">Este pedido no tiene viajes.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 pr-3">Viaje</th>
            <th className="pr-3">Planta</th>
            <th className="pr-3">Mixer</th>
            <th className="pr-3">Vol.</th>
            <th className="pr-3">Flota</th>
            <th className="pr-3">Carga</th>
            <th className="pr-3">Salida</th>
            <th className="pr-3">Llega</th>
            <th className="pr-3">Descarga</th>
            <th className="pr-3">Regreso</th>
          </tr>
        </thead>
        <tbody>
          {viajes.map((v) => (
            <tr key={v.id} className="border-t border-border/60">
              <td className="py-1 pr-3">
                <span className="font-mono">{v.codigoViaje}</span>
                {v.numClienteDia != null && (
                  <div className="text-muted">
                    Viaje {v.numClienteDia} de {v.totalClienteDia}
                  </div>
                )}
              </td>
              <td className="pr-3">{v.plantaNombre}</td>
              <td className="pr-3">{v.mixerLabel ?? "—"}</td>
              <td className="pr-3">{v.volumen} m³</td>
              <td className="pr-3">
                {v.flota ? (
                  <Badge tono={v.flotaPropia ? "neutro" : "info"}>
                    Flota {v.flota}
                  </Badge>
                ) : (
                  <Badge tono="danger">Sin cubrir</Badge>
                )}
                {v.rutaPorDefecto && (
                  <span className="ml-1 text-amber-600" title="Cliente sin ruta: tiempos por defecto">
                    ·ruta def.
                  </span>
                )}
              </td>
              <td className="pr-3">{v.cargaTxt}</td>
              <td className="pr-3">{v.salidaTxt}</td>
              <td className="pr-3">{v.llegadaTxt}</td>
              <td className="pr-3">{v.descargaTxt}</td>
              <td className="pr-3">{v.regresoTxt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModalEdicion({
  pedido,
  opciones,
  onCerrar,
  onExito,
}: {
  pedido: PedidoVista;
  opciones: OpcionesModal;
  onCerrar: () => void;
  onExito: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-3xl rounded-xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Editar pedido #{pedido.id}</h2>
          <button
            onClick={onCerrar}
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5">
          <PedidoForm
            {...opciones}
            pedidoId={pedido.id}
            valores={pedido.valores}
            onExito={onExito}
          />
        </div>
      </div>
    </div>
  );
}
