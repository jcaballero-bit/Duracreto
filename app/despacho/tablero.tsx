"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { Ban, Check, ChevronRight, Lock, Pencil, Plus, RefreshCw } from "lucide-react";
import {
  avanzarEstadoAction,
  cambiarOperadorAction,
  cambiarPlantaViajeAction,
  corregirHoraRealAction,
  editarVolumenAction,
  reasignarMixerAction,
} from "../actions";
import { Badge } from "../components/ui";
import { BotonesMapa, type UbicacionCliente } from "../components/maps-buttons";
import { CancelarViajeModal } from "../components/cancelar-viaje-modal";
import { AgregarViajeModal } from "../components/agregar-viaje-modal";
import {
  CapturaCalidadViaje,
  FinalizarCalidadBoton,
  type GeneralCalidad,
} from "./calidad-captura";
import type { CampoTsReal } from "@/lib/motor/asignacion";

export interface HitoVista {
  label: string;
  estado: string;
  campoReal: CampoTsReal;
  progTxt: string;
  realTxt: string | null;
  realLocal: string | null;
  diffMin: number | null;
  tono: "ok" | "warn" | "danger" | null;
}
export interface MixerBadge {
  texto: string;
  tono: "ok" | "info" | "warn" | "neutro";
}
export interface ViajeDespacho {
  id: number;
  pedidoId: number;
  codigoViaje: string; // identificador del sistema, ej. "V-000045"
  numClienteDia: number; // número de viaje del cliente ESE DÍA (1..N, dinámico)
  totalClienteDia: number; // total de viajes del cliente ese día
  ordenCargaMs: number; // clave de orden cronológico (hora de carga real o programada)
  horaProgTxt: string;
  cliente: string;
  proyecto: string;
  disenoCodigo: string;
  disenoEspec: string;
  revenimiento: string;
  elemento: string;
  tipoDescarga: string;
  hieloTxt: string;
  volumen: number;
  volumenEditable: boolean;
  volumenBloqueoMsg: string | null;
  mixerId: number;
  mixerLabel: string;
  mixerBadge: MixerBadge;
  operadorId: number | null;
  operadorNombre: string | null;
  plantaId: number | null; // planta dosificadora del viaje
  plantaNombre: string; // nombre de la planta (STALO/SANY/…)
  plantasOpciones: { id: number; nombre: string }[]; // plantas del plantel (para mover)
  estado: string;
  hitos: HitoVista[];
  ubicacion: UbicacionCliente;
  // ── Control de calidad (captura del Laboratorista dentro de Despacho) ─────
  // El pedido tiene un Laboratorista asignado ese día (si no, no hay captura).
  tieneLab: boolean;
  // Lecturas ya guardadas de este viaje (control_calidad_viaje).
  revenimientoObra: number | null;
  temperaturaConcreto: number | null;
  // ¿La llegada real ya está sellada? (para auto-abrir la captura de la muestra).
  llegadaAlcanzada: boolean;
  // ¿Es el último viaje del PEDIDO? (ahí se muestra "Finalizar control de calidad").
  esUltimoDelPedido: boolean;
  // Preguntas generales ya guardadas del pedido (o null) + m³ sugerido (despachado).
  generalCalidad: GeneralCalidad | null;
  m3SugeridoCalidad: number;
}
export interface GrupoDespacho {
  plantelNombre: string;
  zona: string;
  viajes: ViajeDespacho[];
}
export interface MixerOpcion {
  id: number;
  etiqueta: string;
}
export interface OperadorOpcion {
  id: number;
  nombre: string;
}

const SIGUIENTE: Record<string, string | null> = {
  Programado: "En carga",
  "En carga": "En ruta",
  "En ruta": "Llegada",
  Llegada: "Descargando",
  Descargando: "Regresando",
  Regresando: "Completado",
  Completado: null,
  Cancelado: null,
};

function tonoEstado(estado: string): "neutro" | "info" | "warn" | "ok" | "danger" {
  switch (estado) {
    case "Programado":
      return "neutro";
    case "En carga":
    case "En ruta":
    case "Llegada":
      return "info";
    case "Descargando":
    case "Regresando":
      return "warn";
    case "Completado":
      return "ok";
    default:
      return "danger";
  }
}

const CLASE_DIFF: Record<"ok" | "warn" | "danger", string> = {
  ok: "text-emerald-600",
  warn: "text-amber-600",
  danger: "text-red-600",
};

export function TableroDespacho({
  grupos,
  mixers,
  operadores,
  soloLectura = false,
  estadosEditables = null,
  puedeCambiarPlanta = false,
  puedeAgregar = false,
  puedeCapturarCalidad = false,
  esAdmin = false,
}: {
  grupos: GrupoDespacho[];
  mixers: MixerOpcion[];
  operadores: OperadorOpcion[];
  // soloLectura: campos (volumen/mixer/motorista/hora) de solo lectura.
  soloLectura?: boolean;
  // estadosEditables: qué botones de estado se pueden tocar. null = todos;
  // [] = ninguno (solo lectura total); [lista] = solo esos (Laboratorista).
  estadosEditables?: string[] | null;
  // ¿Puede el usuario mover el viaje a otra planta del plantel? (Despachador/Admin/
  // Jefe de Planta; no el Dosificador). Solo aplica en planteles de 2+ plantas.
  puedeCambiarPlanta?: boolean;
  // ¿Puede AGREGAR viajes adicionales al pedido? (Admin/Programador/Despachador/
  // JefePlanta/Dosificador). Independiente de soloLectura (el Programador ve el
  // despacho en solo lectura pero sí puede agregar adiciones).
  puedeAgregar?: boolean;
  // ¿Puede CAPTURAR control de calidad (revenimiento/temperatura/preguntas)? Solo los
  // roles de calidad (Laboratorista/Admin/JefeLaboratorio/GerenteControlCalidad); y solo
  // aparece cuando el pedido tiene Laboratorista asignado. El Despachador NO.
  puedeCapturarCalidad?: boolean;
  // Solo el Admin puede ingresar volúmenes fuera del paso de 0.5 m³ (editar volumen /
  // agregar viaje con step libre). Los demás roles quedan con paso 0.5.
  esAdmin?: boolean;
}) {
  // En solo lectura no hay reasignación de mixer ni cambio de motorista, así que no
  // se necesitan (ni se envían al cliente) los catálogos de flota/operadores.
  const mixersUsables = soloLectura ? [] : mixers;
  const operadoresUsables = soloLectura ? [] : operadores;

  if (grupos.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        No hay viajes asignados para esta fecha.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {grupos.map((g) => (
        <div key={g.plantelNombre}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-semibold text-ink">{g.plantelNombre}</h3>
            <span className="text-sm text-muted">({g.zona})</span>
            <span className="text-xs text-muted">· {g.viajes.length} viaje(s)</span>
          </div>
          <div className="space-y-3">
            {g.viajes.map((v) => (
              <FilaViaje
                key={v.id}
                v={v}
                mixers={mixersUsables}
                operadores={operadoresUsables}
                soloLectura={soloLectura}
                estadosEditables={estadosEditables}
                puedeCambiarPlanta={puedeCambiarPlanta}
                puedeAgregar={puedeAgregar}
                puedeCapturarCalidad={puedeCapturarCalidad}
                esAdmin={esAdmin}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Etiqueta de campo (título pequeño gris + valor) ──────────────────────────
function Campo({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

function FilaViaje({
  v,
  mixers,
  operadores,
  soloLectura,
  estadosEditables,
  puedeCambiarPlanta,
  puedeAgregar,
  puedeCapturarCalidad,
  esAdmin,
}: {
  v: ViajeDespacho;
  mixers: MixerOpcion[];
  operadores: OperadorOpcion[];
  soloLectura: boolean;
  estadosEditables: string[] | null;
  puedeCambiarPlanta: boolean;
  puedeAgregar: boolean;
  puedeCapturarCalidad: boolean;
  esAdmin: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [cancelando, setCancelando] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const siguiente = SIGUIENTE[v.estado];

  const avanzar = (estado: string) =>
    startTransition(async () => {
      const res = await avanzarEstadoAction(v.id, estado);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo avanzar.");
    });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted">
          <span className="font-mono">{v.codigoViaje}</span>
          <span className="mx-1.5 text-muted/50">·</span>
          <span className="font-medium text-ink">
            Viaje {v.numClienteDia} de {v.totalClienteDia}
          </span>
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tono={tonoEstado(v.estado)}>{v.estado}</Badge>
          {/* Solo en el ÚLTIMO viaje del cliente ese día (evita repetir el botón en
              cada tarjeta): la adición se agrega al final de la secuencia del cliente. */}
          {puedeAgregar && v.numClienteDia === v.totalClienteDia && (
            <button
              onClick={() => setAgregando(true)}
              title="Agregar volumen adicional a este cliente (mismas características)"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
            >
              <Plus size={13} /> Agregar viaje
            </button>
          )}
          {!soloLectura && v.estado !== "Completado" && (
            <button
              onClick={() => setCancelando(true)}
              title="Cancelar SOLO este viaje (los demás del pedido se conservan)"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
            >
              <Ban size={13} /> Cancelar viaje
            </button>
          )}
          {/* Preguntas generales del pedido: en el ÚLTIMO viaje del pedido, solo si
              hay Laboratorista asignado y el usuario captura calidad. */}
          {puedeCapturarCalidad && v.tieneLab && v.esUltimoDelPedido && (
            <FinalizarCalidadBoton
              pedidoId={v.pedidoId}
              cliente={v.cliente}
              general={v.generalCalidad}
              m3Sugerido={v.m3SugeridoCalidad}
            />
          )}
        </div>
      </div>

      {cancelando && (
        <CancelarViajeModal
          viajeId={v.id}
          etiqueta={`${v.cliente} · Viaje ${v.numClienteDia} de ${v.totalClienteDia}`}
          onClose={() => setCancelando(false)}
          onCancelado={() => {
            setCancelando(false);
            router.refresh();
          }}
        />
      )}

      {agregando && (
        <AgregarViajeModal
          pedidoId={v.pedidoId}
          cliente={v.cliente}
          esAdmin={esAdmin}
          onClose={() => setAgregando(false)}
          onAgregado={(msg) => {
            setAgregando(false);
            if (msg) alert(msg);
            router.refresh();
          }}
        />
      )}

      {/* Línea de información: en celular grid de 2 columnas; en ≥sm fila que envuelve. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:items-start sm:gap-x-5">
        <Campo label="Hora">
          <span className="whitespace-nowrap font-mono text-sm text-ink">
            {v.horaProgTxt}
          </span>
        </Campo>

        <Campo label="Cliente / proyecto" className="col-span-2 sm:col-span-1 sm:min-w-[150px]">
          <div className="text-sm font-semibold text-ink">{v.cliente}</div>
          {v.proyecto && <div className="text-xs text-link">{v.proyecto}</div>}
          <div className="mt-1">
            <BotonesMapa ubicacion={v.ubicacion} compacto />
          </div>
        </Campo>

        <Campo label="Tipo de concreto">
          <div className="text-sm font-semibold text-ink">{v.disenoCodigo}</div>
          <div className="text-xs text-muted">{v.disenoEspec}</div>
          {v.revenimiento && <div className="text-xs text-muted">Rev: {v.revenimiento}</div>}
        </Campo>

        <Campo label="Elemento">
          <span className="text-sm text-ink">{v.elemento}</span>
        </Campo>

        <Campo label="Descarga">
          <span className="text-sm text-ink">{v.tipoDescarga}</span>
        </Campo>

        <Campo label="Hielo">
          <span className="text-sm text-ink">{v.hieloTxt}</span>
        </Campo>

        <Campo label="Volumen">
          <CampoVolumen
            viajeId={v.id}
            volumen={v.volumen}
            editable={v.volumenEditable}
            bloqueoMsg={v.volumenBloqueoMsg}
            soloLectura={soloLectura}
            esAdmin={esAdmin}
          />
        </Campo>

        <Campo label="Mixer">
          <CampoMixer
            viajeId={v.id}
            mixerId={v.mixerId}
            mixerLabel={v.mixerLabel}
            badge={v.mixerBadge}
            mixers={mixers}
            soloLectura={soloLectura}
          />
        </Campo>

        <Campo label="Motorista">
          <CampoOperador
            viajeId={v.id}
            operadorId={v.operadorId}
            operadorNombre={v.operadorNombre}
            operadores={operadores}
            soloLectura={soloLectura}
          />
        </Campo>

        <Campo label="Planta">
          <CampoPlanta
            viajeId={v.id}
            plantaId={v.plantaId}
            plantaNombre={v.plantaNombre}
            opciones={v.plantasOpciones}
            editable={puedeCambiarPlanta}
          />
        </Campo>
      </div>

      {/* Botones de avance de estado. En celular: grid de 3 columnas con targets
          táctiles grandes. En ≥sm: fila con conectores (solo el tramo EN CURSO se
          anima). */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap sm:items-start sm:justify-center sm:gap-x-1 sm:gap-y-3">
        {v.hitos.map((h, i) => (
          <Fragment key={h.estado}>
            <ColumnaHito
              viajeId={v.id}
              h={h}
              esSiguiente={siguiente === h.estado}
              alcanzado={h.realTxt != null}
              bloqueado={pendiente}
              onAvanzar={() => avanzar(h.estado)}
              soloLectura={soloLectura}
              estadoAvanzable={estadosEditables === null || estadosEditables.includes(h.estado)}
            />
            {i < v.hitos.length - 1 && (
              <Conector estado={estadoConector(v.hitos, siguiente, i)} />
            )}
          </Fragment>
        ))}
      </div>

      {/* Captura de la muestra (revenimiento + temperatura). Solo con Laboratorista
          asignado y rol de calidad. Se abre sola al marcar "Llegada"; NO bloquea el
          avance del viaje (Descargando/Regresando no dependen de estos valores). */}
      {puedeCapturarCalidad && v.tieneLab && (
        <CapturaCalidadViaje
          viajeId={v.id}
          revenimiento={v.revenimientoObra}
          temperatura={v.temperaturaConcreto}
          llegadaAlcanzada={v.llegadaAlcanzada}
        />
      )}
    </div>
  );
}

type EstadoConector = "activo" | "completado" | "futuro";

/** Estado del conector en el hueco i (entre hito i e i+1). */
function estadoConector(
  hitos: HitoVista[],
  siguiente: string | null,
  i: number,
): EstadoConector {
  const idxSig = siguiente ? hitos.findIndex((h) => h.estado === siguiente) : -1;
  if (idxSig !== -1 && i + 1 === idxSig) return "activo"; // en curso
  if (hitos[i].realTxt != null && hitos[i + 1].realTxt != null) return "completado";
  return "futuro";
}

function Conector({ estado }: { estado: EstadoConector }) {
  const cls =
    estado === "activo"
      ? "text-accent animate-pulse"
      : estado === "completado"
        ? "text-emerald-500"
        : "text-muted/30";
  return (
    <div className={`hidden shrink-0 items-center pt-1.5 lg:flex ${cls}`} aria-hidden>
      <ChevronRight size={18} strokeWidth={estado === "activo" ? 3 : 2} />
    </div>
  );
}

// ── Campo Volumen (editable con restricción) ─────────────────────────────────
function CampoVolumen({
  viajeId,
  volumen,
  editable,
  bloqueoMsg,
  soloLectura,
  esAdmin,
}: {
  viajeId: number;
  volumen: number;
  editable: boolean;
  bloqueoMsg: string | null;
  soloLectura: boolean;
  esAdmin: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const guardar = (valor: string) => {
    const n = Number(valor);
    if (!n || n === volumen) return setEditando(false);
    startTransition(async () => {
      const res = await editarVolumenAction(viajeId, n);
      if (res.ok) {
        setEditando(false);
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo editar el volumen.");
    });
  };

  if (soloLectura) {
    return (
      <span className="whitespace-nowrap text-sm font-semibold text-ink">
        {volumen} m³
      </span>
    );
  }

  if (editando) {
    return (
      <input
        type="number"
        min="0.5"
        step={esAdmin ? "any" : "0.5"}
        autoFocus
        defaultValue={volumen}
        onBlur={(e) => guardar(e.target.value)}
        disabled={pendiente}
        className="w-20 rounded border border-border bg-surface px-1 py-0.5 text-sm outline-none focus:border-accent"
      />
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="whitespace-nowrap text-sm font-semibold text-ink">
        {volumen} m³
      </span>
      {editable ? (
        <button
          onClick={() => setEditando(true)}
          title="Editar volumen"
          className="text-muted hover:text-accent"
        >
          <Pencil size={12} />
        </button>
      ) : (
        <span className="text-muted/50" title={bloqueoMsg ?? "No editable"}>
          <Lock size={12} />
        </span>
      )}
    </div>
  );
}

// ── Campo Mixer (reasignable) + badge de procedencia ─────────────────────────
function CampoMixer({
  viajeId,
  mixerId,
  mixerLabel,
  badge,
  mixers,
  soloLectura,
}: {
  viajeId: number;
  mixerId: number;
  mixerLabel: string;
  badge: MixerBadge;
  mixers: MixerOpcion[];
  soloLectura: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const reasignar = (nuevo: number) => {
    if (nuevo === mixerId) return setEditando(false);
    startTransition(async () => {
      const res = await reasignarMixerAction(viajeId, nuevo);
      if (res.ok) {
        setEditando(false);
        // Aviso informativo (p. ej. flota insuficiente al recuperar un viaje).
        if (res.mensaje) alert(res.mensaje);
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo reasignar.");
    });
  };

  if (soloLectura) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="whitespace-nowrap text-sm font-semibold text-ink">
          {mixerLabel}
        </span>
        <Badge tono={badge.tono}>{badge.texto}</Badge>
      </div>
    );
  }

  if (editando) {
    return (
      <select
        autoFocus
        defaultValue={mixerId}
        onChange={(e) => reasignar(Number(e.target.value))}
        onBlur={() => setEditando(false)}
        disabled={pendiente}
        className="rounded border border-border bg-surface px-1 py-0.5 text-sm outline-none focus:border-accent"
      >
        {mixers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.etiqueta}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="whitespace-nowrap text-sm font-semibold text-ink">
          {mixerLabel}
        </span>
        <button
          onClick={() => setEditando(true)}
          title="Reasignar mixer"
          className="text-muted hover:text-accent"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <Badge tono={badge.tono}>{badge.texto}</Badge>
    </div>
  );
}

// ── Campo Motorista (operador, editable) ─────────────────────────────────────
function CampoOperador({
  viajeId,
  operadorId,
  operadorNombre,
  operadores,
  soloLectura,
}: {
  viajeId: number;
  operadorId: number | null;
  operadorNombre: string | null;
  operadores: OperadorOpcion[];
  soloLectura: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const cambiar = (nuevo: number) => {
    if (nuevo === operadorId) return setEditando(false);
    startTransition(async () => {
      const res = await cambiarOperadorAction(viajeId, nuevo);
      if (res.ok) {
        setEditando(false);
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo cambiar el motorista.");
    });
  };

  if (soloLectura) {
    return (
      <span className="text-sm text-ink">{operadorNombre ?? "Sin asignar"}</span>
    );
  }

  if (editando) {
    return (
      <select
        autoFocus
        defaultValue={operadorId ?? ""}
        onChange={(e) => e.target.value && cambiar(Number(e.target.value))}
        onBlur={() => setEditando(false)}
        disabled={pendiente}
        className="rounded border border-border bg-surface px-1 py-0.5 text-sm outline-none focus:border-accent"
      >
        {operadores.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm text-ink">{operadorNombre ?? "Sin asignar"}</span>
      <button
        onClick={() => setEditando(true)}
        title="Cambiar motorista"
        className="text-muted hover:text-accent"
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}

// ── Campo Planta (dosificadora del viaje, editable en planteles de 2 plantas) ──
function CampoPlanta({
  viajeId,
  plantaId,
  plantaNombre,
  opciones,
  editable,
}: {
  viajeId: number;
  plantaId: number | null;
  plantaNombre: string;
  opciones: { id: number; nombre: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const cambiar = (nuevo: number) => {
    if (nuevo === plantaId) return setEditando(false);
    startTransition(async () => {
      const res = await cambiarPlantaViajeAction(viajeId, nuevo);
      if (res.ok) {
        setEditando(false);
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo cambiar la planta.");
    });
  };

  // Solo editable donde el plantel tiene 2+ plantas y el rol lo permite.
  const puedeEditar = editable && opciones.length > 1;
  if (!puedeEditar) {
    return <span className="whitespace-nowrap text-sm text-ink">{plantaNombre}</span>;
  }
  if (editando) {
    return (
      <select
        autoFocus
        defaultValue={plantaId ?? ""}
        onChange={(e) => cambiar(Number(e.target.value))}
        onBlur={() => setEditando(false)}
        disabled={pendiente}
        className="rounded border border-border bg-surface px-1 py-0.5 text-sm outline-none focus:border-accent"
      >
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="whitespace-nowrap text-sm font-semibold text-ink">{plantaNombre}</span>
      <button
        onClick={() => setEditando(true)}
        title="Cambiar planta dosificadora"
        className="text-muted hover:text-accent"
      >
        <RefreshCw size={12} />
      </button>
    </div>
  );
}

// ── Columna de una etapa: botón (encabezado) + programado/real/desvío ────────
function ColumnaHito({
  viajeId,
  h,
  esSiguiente,
  alcanzado,
  bloqueado,
  onAvanzar,
  soloLectura,
  estadoAvanzable,
}: {
  viajeId: number;
  h: HitoVista;
  esSiguiente: boolean;
  alcanzado: boolean;
  bloqueado: boolean;
  onAvanzar: () => void;
  soloLectura: boolean;
  // ¿Este rol puede avanzar ESTE estado? (Laboratorista solo algunos.)
  estadoAvanzable: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const guardar = (valor: string) => {
    if (!valor) return setEditando(false);
    startTransition(async () => {
      const res = await corregirHoraRealAction(viajeId, h.campoReal, valor);
      if (res.ok) {
        setEditando(false);
        router.refresh();
      } else alert(res.mensaje ?? "No se pudo corregir.");
    });
  };

  const botonCls = alcanzado
    ? "bg-emerald-100 text-emerald-700"
    : esSiguiente
      ? "bg-accent text-white hover:bg-accent-hover"
      : "bg-content text-muted";

  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <button
        disabled={!estadoAvanzable || !esSiguiente || bloqueado}
        onClick={onAvanzar}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors sm:w-auto sm:py-1.5 ${botonCls} ${!estadoAvanzable ? "cursor-default" : ""}`}
      >
        {alcanzado && <Check size={14} />}
        {h.label}
      </button>

      <div className="whitespace-nowrap text-[11px] text-muted">
        Prog <span className="font-medium text-ink">{h.progTxt}</span>
      </div>

      {editando ? (
        <input
          type="datetime-local"
          autoFocus
          defaultValue={h.realLocal ?? undefined}
          onBlur={(e) => guardar(e.target.value)}
          disabled={pendiente}
          className="rounded border border-border bg-surface px-1 py-0.5 text-[11px] outline-none focus:border-accent"
        />
      ) : h.realTxt ? (
        <div className="flex items-center justify-center gap-1 whitespace-nowrap text-[11px]">
          <span className="text-muted">Real</span>
          <span className="font-semibold text-ink">{h.realTxt}</span>
          {!soloLectura && (
            <button
              onClick={() => setEditando(true)}
              title="Corregir hora real"
              className="text-muted hover:text-accent"
            >
              <Pencil size={11} />
            </button>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-muted/50">Real —</div>
      )}

      {h.diffMin != null && h.tono && (
        <div className={`whitespace-nowrap text-[11px] font-semibold ${CLASE_DIFF[h.tono]}`}>
          {h.diffMin > 0 ? "+" : ""}
          {h.diffMin} min
        </div>
      )}
    </div>
  );
}
