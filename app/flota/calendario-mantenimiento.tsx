"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import { programarMantenimientoAction } from "./actions";

export interface TipoConUnidades {
  tipo: string; // "Mixer" | "Bomba" | "Camion" | "Pickup"
  label: string;
  unidades: { id: number; label: string }[];
}

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Índice de columna Lun–Dom (0=Lun … 6=Dom) del día de la semana JS (0=Dom). */
const colLun = (dow: number) => (dow === 0 ? 6 : dow - 1);

export function CalendarioMantenimiento({ tipos }: { tipos: TipoConUnidades[] }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const hoy = new Date();

  const [tipo, setTipo] = useState(tipos[0]?.tipo ?? "Mixer");
  const [unidadId, setUnidadId] = useState<string>("");
  const [cursor, setCursor] = useState(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [inicio, setInicio] = useState<string | null>(null);
  const [fin, setFin] = useState<string | null>(null);
  const [tipoEvento, setTipoEvento] = useState("Mantenimiento_Programado");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const unidades = tipos.find((t) => t.tipo === tipo)?.unidades ?? [];

  // Celdas del mes (con huecos al inicio para alinear al lunes).
  const celdas = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const primero = new Date(y, m, 1);
    const dias = new Date(y, m + 1, 0).getDate();
    const arr: (string | null)[] = [];
    for (let i = 0; i < colLun(primero.getDay()); i++) arr.push(null);
    for (let d = 1; d <= dias; d++) arr.push(iso(new Date(y, m, d)));
    return arr;
  }, [cursor]);

  const enRango = (d: string) => {
    if (!inicio) return false;
    const f = fin ?? inicio;
    const lo = inicio < f ? inicio : f;
    const hi = inicio < f ? f : inicio;
    return d >= lo && d <= hi;
  };

  const clicDia = (d: string) => {
    setMsg(null);
    // Sin inicio, o ya había rango completo → empezar de nuevo.
    if (!inicio || (inicio && fin)) {
      setInicio(d);
      setFin(null);
    } else {
      // Segundo clic: fija el fin (ordena si quedó al revés).
      if (d < inicio) {
        setFin(inicio);
        setInicio(d);
      } else {
        setFin(d);
      }
    }
  };

  const programar = () => {
    setMsg(null);
    if (!unidadId) return setMsg({ ok: false, texto: "Selecciona la unidad." });
    if (!inicio) return setMsg({ ok: false, texto: "Selecciona el rango de fechas en el calendario." });
    const finReal = fin ?? inicio;
    startTransition(async () => {
      const res = await programarMantenimientoAction(
        tipo,
        Number(unidadId),
        inicio,
        finReal,
        tipoEvento,
        motivo,
      );
      if (res.ok) {
        setMsg({ ok: true, texto: "Mantenimiento programado." });
        setInicio(null);
        setFin(null);
        setMotivo("");
        router.refresh();
      } else {
        setMsg({ ok: false, texto: res.mensaje ?? "No se pudo programar." });
      }
    });
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";
  const rango =
    inicio && fin ? `${inicio} → ${fin}` : inicio ? `${inicio} (elige el día de fin)` : "—";

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      {/* Calendario */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
            aria-label="Mes anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold capitalize text-ink">
            {MESES[cursor.getMonth()]} {cursor.getFullYear()}
          </span>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
            aria-label="Mes siguiente"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-muted">
          {DIAS.map((d) => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {celdas.map((d, i) =>
            d == null ? (
              <div key={`e${i}`} />
            ) : (
              <button
                key={d}
                onClick={() => clicDia(d)}
                className={
                  "aspect-square rounded-md text-sm transition-colors " +
                  (enRango(d)
                    ? "bg-accent text-white"
                    : "bg-content/50 text-ink hover:bg-content")
                }
              >
                {Number(d.slice(8))}
              </button>
            ),
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          Haz clic en el día de inicio y luego en el día de fin (puede ser el mismo día).
        </p>
      </div>

      {/* Formulario */}
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Tipo de equipo</span>
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value);
              setUnidadId("");
            }}
            className={inputCls}
          >
            {tipos.map((t) => (
              <option key={t.tipo} value={t.tipo}>{t.label}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Unidad</span>
          <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} className={inputCls}>
            <option value="">Selecciona…</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Tipo de evento</span>
          <select value={tipoEvento} onChange={(e) => setTipoEvento(e.target.value)} className={inputCls}>
            <option value="Mantenimiento_Programado">Mantenimiento programado</option>
            <option value="Fuera_de_Servicio">Fuera de servicio</option>
            <option value="Otro">Otro</option>
          </select>
        </label>

        <div className="rounded-lg border border-border bg-content/40 px-3 py-2 text-sm">
          <span className="text-muted">Rango: </span>
          <span className="font-medium text-ink">{rango}</span>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Motivo</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Ej. Cambio de llantas, revisión de motor…"
            className={inputCls}
          />
        </label>

        {msg && (
          <p
            className={
              "rounded-md px-2.5 py-1.5 text-xs " +
              (msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")
            }
          >
            {msg.texto}
          </p>
        )}

        <button
          onClick={programar}
          disabled={pendiente}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          <Wrench size={16} />
          {pendiente ? "Programando…" : "Programar mantenimiento"}
        </button>
      </div>
    </div>
  );
}
