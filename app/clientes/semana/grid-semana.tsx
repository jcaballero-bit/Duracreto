"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { guardarSolicitudAction } from "../solicitudes-actions";
import { ClienteFormModal, type Opcion } from "../cliente-form-modal";
import { REVENIMIENTOS, TIPOS_SERVICIO } from "@/lib/revenimiento";

export interface DiaSemana {
  iso: string;
  label: string;
}
export interface PlantelOpc {
  id: number;
  nombre: string;
  abbr: string;
}
export interface Celda {
  id: number;
  volumen: number | null;
  tipoConcreto: string;
  revenimiento: string;
  tipoServicio: string;
  tipoDescarga: string;
  sacosHielo: number | null;
  elemento: string;
  frecuencia: number | null;
  observaciones: string;
  plantelId: number | null;
  estado: string;
}
export interface ClienteFila {
  id: number;
  empresa: string;
  proyecto: string;
  asesorNombre: string;
  editable: boolean;
  // Cada día puede tener VARIAS proyecciones (distintos concretos/elementos).
  celdas: Record<string, Celda[]>;
}
/** Cliente candidato para agregar a la semana (o crear uno nuevo). */
export interface ClienteOpc {
  id: number;
  empresa: string;
  proyecto: string;
  asesorNombre: string;
}

const inputCls =
  "w-full rounded border border-border bg-surface px-1.5 py-1 text-xs text-ink outline-none focus:border-accent";

export function GridSemana({
  dias,
  filas,
  candidatos,
  planteles,
  esAdmin,
  resaltarEditables,
  puedeCrearCliente,
  asesores,
  prevIso,
  nextIso,
  rotuloSemana,
  soloLectura = false,
  basePath = "/clientes/semana",
  paramsExtra = "",
}: {
  dias: DiaSemana[];
  filas: ClienteFila[];
  candidatos: ClienteOpc[];
  planteles: PlantelOpc[];
  esAdmin: boolean;
  // true para el Asesor: resalta sutilmente su área editable (sus clientes).
  resaltarEditables: boolean;
  puedeCrearCliente: boolean;
  asesores: Opcion[];
  prevIso: string;
  nextIso: string;
  rotuloSemana: string;
  // Modo supervisión: sin edición ni altas (p. ej. Gerencia Comercial).
  soloLectura?: boolean;
  // Ruta base y query extra para la navegación de semana (reutilizable).
  basePath?: string;
  paramsExtra?: string;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<{
    clienteId: number;
    iso: string;
    solicitudId: number | null; // null = agregar una nueva proyección
  } | null>(null);
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [agregarAbierto, setAgregarAbierto] = useState(false);
  const [agregados, setAgregados] = useState<number[]>([]);
  const [filtroPlantel, setFiltroPlantel] = useState<number>(0); // 0 = todos

  const abbrDe = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of planteles) m.set(p.id, p.abbr);
    return m;
  }, [planteles]);

  // Filas visibles = las que ya tienen proyección esta semana + las agregadas a
  // mano (solo en esta vista). Nunca la lista completa de clientes.
  const filasVisibles = useMemo(() => {
    const porId = new Map(filas.map((f) => [f.id, f]));
    const extra: ClienteFila[] = [];
    for (const id of agregados) {
      if (porId.has(id)) continue;
      const c = candidatos.find((x) => x.id === id);
      if (!c) continue;
      extra.push({
        id: c.id,
        empresa: c.empresa,
        proyecto: c.proyecto,
        asesorNombre: c.asesorNombre,
        editable: true, // los candidatos son siempre editables por quien los ve
        celdas: Object.fromEntries(dias.map((d) => [d.iso, [] as Celda[]])),
      });
    }
    return [...filas, ...extra];
  }, [filas, agregados, candidatos, dias]);

  // ¿La entrada cuenta / se muestra según el filtro de plantel?
  const visibleCelda = (c: Celda): boolean =>
    filtroPlantel === 0 || c.plantelId === filtroPlantel;

  // Totales (respetan el filtro de plantel; suman TODAS las entradas del día).
  const totalPorDia: Record<string, number> = {};
  for (const d of dias) totalPorDia[d.iso] = 0;
  let totalGeneral = 0;
  const totalPorFila = new Map<number, number>();
  for (const f of filasVisibles) {
    let suma = 0;
    for (const d of dias) {
      for (const c of f.celdas[d.iso] ?? []) {
        if (visibleCelda(c) && c.volumen != null) {
          totalPorDia[d.iso] += c.volumen;
          suma += c.volumen;
        }
      }
    }
    totalPorFila.set(f.id, suma);
    totalGeneral += suma;
  }

  // Desglose por planta de cada día (SIEMPRE sobre todas las plantas, para ver
  // si una planta específica está sobrecargada ese día).
  const desglosePorDia: Record<string, { abbr: string; m3: number }[]> = {};
  for (const d of dias) {
    const porPlantel = new Map<number, number>();
    for (const f of filasVisibles) {
      for (const c of f.celdas[d.iso] ?? []) {
        if (c.plantelId != null && c.volumen != null) {
          porPlantel.set(c.plantelId, (porPlantel.get(c.plantelId) ?? 0) + c.volumen);
        }
      }
    }
    desglosePorDia[d.iso] = [...porPlantel.entries()]
      .map(([id, m3]) => ({ abbr: abbrDe.get(id) ?? "?", m3 }))
      .sort((a, b) => b.m3 - a.m3);
  }

  // Agrupar filas por asesor.
  const grupos = useMemo(() => {
    const m = new Map<string, ClienteFila[]>();
    for (const f of filasVisibles) {
      const arr = m.get(f.asesorNombre) ?? [];
      arr.push(f);
      m.set(f.asesorNombre, arr);
    }
    return [...m.entries()]
      .map(([asesorNombre, clientes]) => ({
        asesorNombre,
        clientes: clientes.sort((a, b) => a.empresa.localeCompare(b.empresa)),
      }))
      .sort((a, b) => {
        if (a.asesorNombre === "Sin asesor") return 1;
        if (b.asesorNombre === "Sin asesor") return -1;
        return a.asesorNombre.localeCompare(b.asesorNombre);
      });
  }, [filasVisibles]);

  const totalCols = dias.length + 2; // cliente + días + total semana
  const yaEnGrid = new Set(filasVisibles.map((f) => f.id));
  // Sufijo de query para la navegación de semana (preserva contexto en el detalle).
  const suf = paramsExtra ? `&${paramsExtra}` : "";

  return (
    <>
      {/* Barra superior: navegación de semana + total general + filtro + alta */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`${basePath}?inicio=${prevIso}${suf}`}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-ink hover:bg-content"
          >
            <ChevronLeft size={16} /> Anterior
          </Link>
          <span className="text-sm font-medium text-ink">{rotuloSemana}</span>
          <Link
            href={`${basePath}?inicio=${nextIso}${suf}`}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-ink hover:bg-content"
          >
            Siguiente <ChevronRight size={16} />
          </Link>
          <span className="ml-2 rounded-lg bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent">
            Total semana: {totalGeneral.toFixed(1)} m³
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filtroPlantel}
            onChange={(e) => setFiltroPlantel(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
            title="Filtrar por planta"
          >
            <option value={0}>Todas las plantas</option>
            {planteles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          {!soloLectura && (
            <button
              onClick={() => setAgregarAbierto(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              <Plus size={16} /> Agregar cliente a esta semana
            </button>
          )}
        </div>
      </div>

      {resaltarEditables && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-ink">
          <span className="inline-block h-3.5 w-3.5 shrink-0 rounded border border-accent/50 bg-accent/10" />
          <span>
            <strong className="font-medium text-accent">Tu área editable</strong> está
            resaltada: aquí registras la proyección de tus clientes. Las filas de otros
            asesores se muestran solo como referencia (solo lectura).
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Cliente</th>
              {dias.map((d) => (
                <th key={d.iso} className="px-2 py-2 text-center align-top">
                  <div>{d.label}</div>
                  <div className="text-[10px] font-normal normal-case text-link">
                    {totalPorDia[d.iso].toFixed(1)} m³
                  </div>
                  {desglosePorDia[d.iso].length > 0 && (
                    <div className="mt-0.5 text-[10px] font-normal normal-case leading-tight text-muted">
                      {desglosePorDia[d.iso]
                        .map((x) => `${x.abbr}: ${x.m3.toFixed(0)}`)
                        .join(" · ")}
                    </div>
                  )}
                </th>
              ))}
              <th className="px-2 py-2 text-center">Total semana</th>
            </tr>
          </thead>
          <tbody>
            {grupos.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="px-3 py-8 text-center text-muted">
                  {soloLectura ? (
                    "Este asesor no tiene proyecciones esta semana."
                  ) : (
                    <>
                      Ningún cliente proyectado esta semana. Usa{" "}
                      <strong>+ Agregar cliente a esta semana</strong>.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              grupos.map((g) => (
                <FragmentoGrupo
                  key={g.asesorNombre}
                  asesorNombre={g.asesorNombre}
                  clientes={g.clientes}
                  dias={dias}
                  totalCols={totalCols}
                  abbrDe={abbrDe}
                  totalPorFila={totalPorFila}
                  filtroPlantel={filtroPlantel}
                  planteles={planteles}
                  resaltarEditables={resaltarEditables}
                  soloLectura={soloLectura}
                  editando={editando}
                  onEditar={(clienteId, iso, solicitudId) =>
                    setEditando({ clienteId, iso, solicitudId })
                  }
                  onCerrar={() => setEditando(null)}
                  onGuardado={() => {
                    setEditando(null);
                    router.refresh();
                  }}
                />
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-content text-sm font-semibold text-ink">
              <td className="px-3 py-2">Total por día</td>
              {dias.map((d) => (
                <td key={d.iso} className="px-2 py-2 text-center">
                  {totalPorDia[d.iso].toFixed(1)}
                </td>
              ))}
              <td className="px-2 py-2 text-center">{totalGeneral.toFixed(1)} m³</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Modal: agregar cliente a la semana (elegir existente o crear nuevo). */}
      {agregarAbierto && (
        <AgregarClienteModal
          candidatos={candidatos.filter((c) => !yaEnGrid.has(c.id))}
          puedeCrearCliente={puedeCrearCliente}
          onAgregar={(id) => {
            setAgregados((prev) => (prev.includes(id) ? prev : [...prev, id]));
            setAgregarAbierto(false);
          }}
          onCrearNuevo={() => {
            setAgregarAbierto(false);
            setNuevoCliente(true);
          }}
          onClose={() => setAgregarAbierto(false)}
        />
      )}

      {nuevoCliente && (
        <ClienteFormModal
          editando={null}
          esAdmin={esAdmin}
          asesores={asesores}
          onClose={() => setNuevoCliente(false)}
          onExito={(nuevoId) => {
            setNuevoCliente(false);
            if (nuevoId) setAgregados((prev) => [...prev, nuevoId]);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function FragmentoGrupo({
  asesorNombre,
  clientes,
  dias,
  totalCols,
  abbrDe,
  totalPorFila,
  filtroPlantel,
  planteles,
  resaltarEditables,
  soloLectura,
  editando,
  onEditar,
  onCerrar,
  onGuardado,
}: {
  asesorNombre: string;
  clientes: ClienteFila[];
  dias: DiaSemana[];
  totalCols: number;
  abbrDe: Map<number, string>;
  totalPorFila: Map<number, number>;
  filtroPlantel: number;
  planteles: PlantelOpc[];
  resaltarEditables: boolean;
  soloLectura: boolean;
  editando: { clienteId: number; iso: string; solicitudId: number | null } | null;
  onEditar: (clienteId: number, iso: string, solicitudId: number | null) => void;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  // ¿Este grupo es el área del asesor (tiene filas editables) y hay que resaltarlo?
  const grupoPropio = resaltarEditables && clientes.some((c) => c.editable);
  return (
    <>
      <tr className={grupoPropio ? "bg-accent/10" : "bg-content/60"}>
        <td
          colSpan={totalCols}
          className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
            grupoPropio ? "text-accent" : "text-muted"
          }`}
        >
          {asesorNombre}
          {grupoPropio && (
            <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium normal-case text-white">
              Tu área
            </span>
          )}
        </td>
      </tr>
      {clientes.map((c) => {
        const resaltada = resaltarEditables && c.editable;
        const editable = c.editable && !soloLectura; // supervisión = solo lectura
        return (
        <tr
          key={c.id}
          className={`border-b border-border/60 align-top${resaltada ? " bg-accent/5" : ""}`}
        >
          <td className={`px-3 py-2${resaltada ? " border-l-2 border-l-accent/60" : ""}`}>
            <div className="font-medium break-words text-ink">{c.empresa}</div>
            {c.proyecto && <div className="break-words text-xs text-link">{c.proyecto}</div>}
          </td>
          {dias.map((d) => {
            // Entradas del día (filtradas por planta si hay filtro activo).
            const entradas = (c.celdas[d.iso] ?? []).filter(
              (e) => filtroPlantel === 0 || e.plantelId === filtroPlantel,
            );
            const enEsteDia = editando?.clienteId === c.id && editando?.iso === d.iso;
            const agregando = enEsteDia && editando?.solicitudId === null;
            return (
              <td key={d.iso} className="border-l border-border/50 px-1.5 py-1.5 align-top">
                <div className="space-y-1">
                  {entradas.map((entrada) =>
                    enEsteDia && editando?.solicitudId === entrada.id ? (
                      <CeldaEditor
                        key={entrada.id}
                        clienteId={c.id}
                        iso={d.iso}
                        solicitudId={entrada.id}
                        celda={entrada}
                        planteles={planteles}
                        onCancelar={onCerrar}
                        onGuardado={onGuardado}
                      />
                    ) : (
                      <CeldaVista
                        key={entrada.id}
                        celda={entrada}
                        editable={editable}
                        abbrDe={abbrDe}
                        onClick={() => editable && onEditar(c.id, d.iso, entrada.id)}
                      />
                    ),
                  )}

                  {agregando && (
                    <CeldaEditor
                      clienteId={c.id}
                      iso={d.iso}
                      solicitudId={null}
                      celda={null}
                      planteles={planteles}
                      onCancelar={onCerrar}
                      onGuardado={onGuardado}
                    />
                  )}

                  {/* Botón para agregar OTRA proyección ese día. Si no hay ninguna
                      y no es editable, muestra un guion tenue. */}
                  {editable && !agregando ? (
                    <button
                      onClick={() => onEditar(c.id, d.iso, null)}
                      className="w-full rounded border border-dashed border-border px-2 py-0.5 text-[10px] text-muted hover:border-accent hover:text-accent"
                    >
                      {entradas.length === 0 ? "+ Agregar" : "+"}
                    </button>
                  ) : (
                    entradas.length === 0 && !agregando && (
                      <div className="px-2 py-1 text-xs text-muted/40">—</div>
                    )
                  )}
                </div>
              </td>
            );
          })}
          <td className="px-2 py-2 text-center font-semibold text-ink">
            {(totalPorFila.get(c.id) ?? 0).toFixed(1)}
          </td>
        </tr>
        );
      })}
    </>
  );
}

function CeldaVista({
  celda,
  editable,
  abbrDe,
  onClick,
}: {
  celda: Celda | null;
  editable: boolean;
  abbrDe: Map<number, string>;
  onClick: () => void;
}) {
  const base = "min-h-[46px] w-full rounded px-2 py-1 text-left text-xs";
  if (!celda) {
    return editable ? (
      <button
        onClick={onClick}
        className={`${base} border border-dashed border-border text-muted hover:border-accent hover:text-accent`}
      >
        +
      </button>
    ) : (
      <div className={`${base} text-muted/40`}>—</div>
    );
  }
  const contenido = (
    <>
      <div className="flex items-center gap-1">
        {celda.plantelId != null && (
          <span className="rounded bg-accent/10 px-1 text-[10px] font-semibold text-accent">
            {abbrDe.get(celda.plantelId) ?? "?"}
          </span>
        )}
        <span className="font-semibold text-ink">
          {celda.volumen != null ? `${celda.volumen} m³` : "—"}
        </span>
      </div>
      {(celda.tipoConcreto || celda.revenimiento) && (
        <div className="text-muted">
          {celda.tipoConcreto}
          {celda.revenimiento ? `${celda.tipoConcreto ? " · " : ""}Rev ${celda.revenimiento}` : ""}
        </div>
      )}
      {celda.tipoServicio === "Servicio de Construcción" && (
        <div className="text-[10px] font-medium text-accent">Servicio de Construcción</div>
      )}
      {celda.elemento && <div className="text-[10px] text-muted">{celda.elemento}</div>}
      <div className="text-[10px] text-muted">
        {celda.tipoDescarga && <span>{celda.tipoDescarga}</span>}
        {celda.sacosHielo != null && celda.sacosHielo > 0 && (
          <span> · ❄ {celda.sacosHielo}</span>
        )}
        {celda.frecuencia != null && <span> · cada {celda.frecuencia}m</span>}
      </div>
      {celda.observaciones && (
        <div className="truncate text-[10px] italic text-muted" title={celda.observaciones}>
          {celda.observaciones}
        </div>
      )}
      {celda.estado !== "Pendiente" && (
        <div className="mt-0.5 inline-block rounded bg-content px-1 text-[10px] text-muted">
          {celda.estado}
        </div>
      )}
    </>
  );
  const editableAhora = editable && celda.estado === "Pendiente";
  return editableAhora ? (
    <button onClick={onClick} className={`${base} border border-border hover:border-accent`}>
      {contenido}
    </button>
  ) : (
    <div className={`${base} border border-transparent`}>{contenido}</div>
  );
}

function CeldaEditor({
  clienteId,
  iso,
  solicitudId,
  celda,
  planteles,
  onCancelar,
  onGuardado,
}: {
  clienteId: number;
  iso: string;
  solicitudId: number | null; // null = nueva proyección
  celda: Celda | null;
  planteles: PlantelOpc[];
  onCancelar: () => void;
  onGuardado: () => void;
}) {
  const [plantelId, setPlantelId] = useState(celda?.plantelId != null ? String(celda.plantelId) : "");
  const [tipoConcreto, setTipoConcreto] = useState(celda?.tipoConcreto ?? "");
  const [revenimiento, setRevenimiento] = useState(celda?.revenimiento ?? "");
  const [tipoServicio, setTipoServicio] = useState(celda?.tipoServicio ?? "");
  const [tipoDescarga, setTipoDescarga] = useState(celda?.tipoDescarga ?? "");
  const [volumen, setVolumen] = useState(celda?.volumen != null ? String(celda.volumen) : "");
  const [hielo, setHielo] = useState(celda?.sacosHielo != null ? String(celda.sacosHielo) : "");
  const [elemento, setElemento] = useState(celda?.elemento ?? "");
  const [frecuencia, setFrecuencia] = useState(celda?.frecuencia != null ? String(celda.frecuencia) : "");
  const [observaciones, setObservaciones] = useState(celda?.observaciones ?? "");
  const [pendiente, startTransition] = useTransition();

  const guardar = () => {
    startTransition(async () => {
      const res = await guardarSolicitudAction(
        clienteId,
        iso,
        {
          tipo_concreto_estimado: tipoConcreto,
          revenimiento,
          tipo_servicio: tipoServicio,
          tipo_descarga_estimado: tipoDescarga,
          volumen_estimado_m3: volumen,
          sacos_hielo_por_m3: hielo,
          elemento,
          frecuencia_entre_camiones_min: frecuencia,
          observaciones,
          plantel_id: plantelId,
        },
        solicitudId ?? undefined,
      );
      if (res.ok) onGuardado();
      else alert(res.mensaje ?? "No se pudo guardar.");
    });
  };

  return (
    <div className="w-full min-w-0 space-y-1.5 rounded-lg border border-accent bg-surface p-2 shadow-lg">
      <select className={inputCls} value={plantelId} onChange={(e) => setPlantelId(e.target.value)}>
        <option value="">Planta…</option>
        {planteles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      <input
        className={inputCls}
        placeholder="Tipo de concreto"
        value={tipoConcreto}
        onChange={(e) => setTipoConcreto(e.target.value)}
      />
      <select
        className={inputCls}
        value={revenimiento}
        onChange={(e) => setRevenimiento(e.target.value)}
        title="Revenimiento"
      >
        <option value="">Revenimiento…</option>
        {REVENIMIENTOS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <select
        className={inputCls}
        value={tipoServicio}
        onChange={(e) => setTipoServicio(e.target.value)}
        title="Tipo de servicio"
      >
        <option value="">Tipo de servicio…</option>
        {TIPOS_SERVICIO.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input
        className={inputCls}
        placeholder="Elemento (pavimento, losa…)"
        value={elemento}
        onChange={(e) => setElemento(e.target.value)}
      />
      <select className={inputCls} value={tipoDescarga} onChange={(e) => setTipoDescarga(e.target.value)}>
        <option value="">Descarga…</option>
        <option value="Directo">Directo</option>
        <option value="Bomba">Bomba</option>
      </select>
      <input
        className={inputCls}
        type="number"
        step="0.5"
        placeholder="Volumen (m³)"
        value={volumen}
        onChange={(e) => setVolumen(e.target.value)}
      />
      <input
        className={inputCls}
        type="number"
        min="0"
        max="10"
        step="1"
        placeholder="Hielo (sacos/m³)"
        value={hielo}
        onChange={(e) => setHielo(e.target.value)}
      />
      <input
        className={inputCls}
        type="number"
        step="1"
        placeholder="Frecuencia (min)"
        value={frecuencia}
        onChange={(e) => setFrecuencia(e.target.value)}
      />
      <input
        className={inputCls}
        placeholder="Observaciones"
        value={observaciones}
        onChange={(e) => setObservaciones(e.target.value)}
      />
      <div className="flex justify-between gap-1.5 pt-0.5">
        <button
          onClick={onCancelar}
          className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-content"
        >
          Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={pendiente}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {pendiente ? "…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

function AgregarClienteModal({
  candidatos,
  puedeCrearCliente,
  onAgregar,
  onCrearNuevo,
  onClose,
}: {
  candidatos: ClienteOpc[];
  puedeCrearCliente: boolean;
  onAgregar: (id: number) => void;
  onCrearNuevo: () => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<string>("");

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Agregar cliente a esta semana</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Cliente existente</span>
            <select
              value={sel}
              onChange={(e) => setSel(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
            >
              <option value="">Selecciona un cliente…</option>
              {candidatos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.proyecto ? `${c.empresa} — ${c.proyecto}` : c.empresa}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between">
            {puedeCrearCliente ? (
              <button onClick={onCrearNuevo} className="text-sm font-medium text-accent hover:underline">
                + Crear cliente nuevo
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={() => sel && onAgregar(Number(sel))}
              disabled={!sel}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
          <p className="text-xs text-muted">
            El cliente se agrega solo a la semana que estás viendo. Si lo necesitas
            otra semana, vuelve a agregarlo ahí.
          </p>
        </div>
      </div>
    </div>
  );
}
