"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, ChevronRight, Handshake, Undo2 } from "lucide-react";
import { TIPOS_PRESTABLES, etiquetaTipo, participaEnMotor } from "@/lib/flota/prestamos";
import type { PrestamoVista, UnidadPrestable } from "@/lib/flota/prestamos-datos";
import { devolverUnidadAction, prestarUnidadAction, revisarPrestamoAction } from "./prestamos-actions";

const ctrl =
  "rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

export interface PlantelOpcion {
  id: number;
  nombre: string;
  zona: string;
}

/**
 * Préstamo de unidades a otro plantel, por día.
 *
 * Práctica a propósito: todo en una fila de desplegables — tipo, unidad, plantel
 * destino — y un botón. Al elegir la unidad se consulta al servidor qué pasaría
 * (mantenimiento, viajes ya comprometidos) y se avisa ANTES de confirmar.
 */
export function PrestamosFlota({
  fechaISO,
  unidades,
  planteles,
  prestamos,
  puedeEditar,
  sinPlanteles,
}: {
  fechaISO: string;
  unidades: UnidadPrestable[];
  planteles: PlantelOpcion[];
  prestamos: PrestamoVista[];
  puedeEditar: boolean;
  /** El usuario no tiene planteles asignados: no hay nada que prestar. */
  sinPlanteles: boolean;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<string>("Mixer");
  const [unidadId, setUnidadId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<{ error?: string; advertencias: string[] } | null>(null);
  const [msg, setMsg] = useState("");
  const [pendiente, iniciar] = useTransition();

  const delTipo = useMemo(() => unidades.filter((u) => u.tipo === tipo), [unidades, tipo]);
  const unidad = delTipo.find((u) => String(u.id) === unidadId) ?? null;

  // El destino puede ser cualquier plantel MENOS el de la propia unidad: prestársela
  // a su propio plantel no significa nada.
  const destinos = planteles.filter((p) => p.id !== unidad?.plantelBaseId);

  /** Al cambiar de unidad se consulta qué pasaría, sin escribir nada. */
  const elegirUnidad = (v: string) => {
    setUnidadId(v);
    setAviso(null);
    if (!v) return;
    iniciar(async () => {
      const r = await revisarPrestamoAction({
        unidadTipo: tipo,
        unidadId: Number(v),
        fechaISO,
      });
      setAviso(
        r.ok
          ? { advertencias: r.advertencias ?? [] }
          : { error: r.mensaje ?? "No se puede prestar.", advertencias: [] },
      );
    });
  };

  const prestar = () => {
    if (!unidad || !destinoId) return;
    iniciar(async () => {
      const r = await prestarUnidadAction({
        unidadTipo: tipo,
        unidadId: unidad.id,
        destinoId: Number(destinoId),
        fechaISO,
        motivo,
      });
      if (r.ok) {
        setMsg(`${etiquetaTipo(tipo)} ${unidad.etiqueta.split(" ·")[0]} prestado.`);
        setUnidadId("");
        setDestinoId("");
        setMotivo("");
        setAviso(null);
        router.refresh();
      } else setMsg(r.mensaje ?? "No se pudo prestar la unidad.");
    });
  };

  const devolver = (p: PrestamoVista) => {
    if (
      !confirm(
        `¿Cancelar el préstamo de ${p.unidad} a ${p.destino}?\n\n` +
          `La unidad vuelve a estar disponible en ${p.origen} ese día.`,
      )
    ) {
      return;
    }
    iniciar(async () => {
      const r = await devolverUnidadAction(p.id);
      setMsg(r.ok ? "Préstamo cancelado." : (r.mensaje ?? "No se pudo cancelar."));
      if (r.ok) router.refresh();
    });
  };

  const otroDia = (delta: number) => {
    const [a, m, d] = fechaISO.split("-").map(Number);
    const f = new Date(a, m - 1, d + delta);
    const p = (n: number) => String(n).padStart(2, "0");
    return `/flota?tab=prestamos&fecha=${f.getFullYear()}-${p(f.getMonth() + 1)}-${p(f.getDate())}`;
  };

  return (
    <div className="space-y-5">
      {/* ── Día ── */}
      <div className="flex flex-wrap items-center gap-2">
        <a href={otroDia(-1)} className="rounded-lg border border-border p-2 text-muted hover:text-ink" aria-label="Día anterior">
          <ChevronLeft size={16} />
        </a>
        <input
          type="date"
          value={fechaISO}
          onChange={(e) => {
            if (e.target.value) router.push(`/flota?tab=prestamos&fecha=${e.target.value}`);
          }}
          className={ctrl}
        />
        <a href={otroDia(1)} className="rounded-lg border border-border p-2 text-muted hover:text-ink" aria-label="Día siguiente">
          <ChevronRight size={16} />
        </a>
        <span className="text-xs text-muted">
          El préstamo vale solo para este día. Para varios días, se registra uno por día.
        </span>
      </div>

      {/* ── Prestar ── */}
      {puedeEditar && (
        <div className="rounded-lg border border-border bg-content/40 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <Handshake size={16} /> Prestar una unidad a otro plantel
          </h3>

          {sinPlanteles ? (
            <p className="text-sm text-muted">
              No tienes planteles asignados, así que no hay unidades tuyas que prestar. Pídele
              a un Administrador que te asigne tu plantel.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-muted">
                  Tipo de unidad
                  <select
                    value={tipo}
                    onChange={(e) => {
                      setTipo(e.target.value);
                      setUnidadId("");
                      setDestinoId("");
                      setAviso(null);
                    }}
                    className={`mt-0.5 block ${ctrl}`}
                  >
                    {TIPOS_PRESTABLES.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.etiqueta}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-muted">
                  Unidad
                  <select
                    value={unidadId}
                    onChange={(e) => elegirUnidad(e.target.value)}
                    className={`mt-0.5 block min-w-[13rem] ${ctrl}`}
                  >
                    <option value="">
                      {delTipo.length === 0 ? `Sin ${etiquetaTipo(tipo).toLowerCase()} en tus planteles` : "Elige la unidad…"}
                    </option>
                    {delTipo.map((u) => (
                      <option key={u.id} value={u.id} disabled={u.prestadaA != null}>
                        {u.etiqueta} · {u.plantelBase}
                        {u.prestadaA ? ` (ya prestada a ${u.prestadaA})` : ""}
                        {u.estado !== "Disponible" ? ` (${u.estado})` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <span className="pb-2 text-muted">
                  <ArrowRight size={16} />
                </span>

                <label className="text-xs text-muted">
                  Prestar a
                  <select
                    value={destinoId}
                    onChange={(e) => setDestinoId(e.target.value)}
                    disabled={!unidad}
                    className={`mt-0.5 block min-w-[11rem] ${ctrl} disabled:opacity-50`}
                  >
                    <option value="">Elige el plantel…</option>
                    {destinos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} ({p.zona})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="min-w-[10rem] flex-1 text-xs text-muted">
                  Motivo (opcional)
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Refuerzo por vaciado grande…"
                    className={`mt-0.5 block w-full ${ctrl}`}
                  />
                </label>

                <button
                  type="button"
                  onClick={prestar}
                  disabled={pendiente || !unidad || !destinoId || !!aviso?.error}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  <Handshake size={16} /> {pendiente ? "…" : "Prestar"}
                </button>
              </div>

              {/* Lo que pasaría: se dice ANTES de confirmar. */}
              {aviso?.error && (
                <p className="mt-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-ink">
                  {aviso.error}
                </p>
              )}
              {aviso && !aviso.error && aviso.advertencias.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink">
                  {aviso.advertencias.map((a) => (
                    <li key={a}>· {a}</li>
                  ))}
                </ul>
              )}
              {unidad && !participaEnMotor(tipo) && !aviso?.error && (
                <p className="mt-2 text-xs text-muted">
                  Nota: los {etiquetaTipo(tipo).toLowerCase()} no los asigna el motor de
                  programación; este registro sirve para coordinar el traslado.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {msg && <p className="text-sm text-accent">{msg}</p>}

      {/* ── Préstamos del día ── */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          Préstamos de este día{" "}
          <span className="font-normal text-muted">({prestamos.length})</span>
        </h3>
        {prestamos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Ninguna unidad prestada este día.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-2 py-2">Tipo</th>
                  <th className="px-2 py-2">Unidad</th>
                  <th className="px-2 py-2">Sale de</th>
                  <th className="px-2 py-2">Va a</th>
                  <th className="px-2 py-2">Motivo</th>
                  <th className="px-2 py-2">Registró</th>
                  {puedeEditar && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {prestamos.map((p) => (
                  <tr key={p.id} className="border-b border-border/60">
                    <td className="px-2 py-2 text-muted">{etiquetaTipo(p.unidadTipo)}</td>
                    <td className="px-2 py-2 font-medium text-ink">
                      {p.unidad}
                      {p.detalle && <span className="font-normal text-muted"> · {p.detalle}</span>}
                    </td>
                    <td className="px-2 py-2 text-muted">{p.origen}</td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                        <ArrowRight size={12} /> {p.destino}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted">{p.motivo ?? "—"}</td>
                    <td className="px-2 py-2 text-xs text-muted">{p.creadoPor}</td>
                    {puedeEditar && (
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => devolver(p)}
                          disabled={pendiente}
                          title="Cancelar el préstamo (la unidad vuelve a su plantel)"
                          className="inline-flex items-center gap-1 rounded p-1 text-xs text-muted hover:bg-content hover:text-danger disabled:opacity-40"
                        >
                          <Undo2 size={14} /> Devolver
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="border-t border-border pt-3 text-xs text-muted">
        Una unidad prestada queda <strong className="text-ink">fijada</strong> en el plantel
        destino ese día: el motor de programación la ofrece ahí y deja de ofrecerla en su
        plantel base y en el resto de la zona. Es distinto del préstamo automático entre un
        plantel y su hub, que comparte la flota sin comprometerla con nadie.
      </p>
    </div>
  );
}
