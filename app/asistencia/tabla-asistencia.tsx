"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Clock, Lock, Radio } from "lucide-react";
import { calcularHorasTurno } from "@/lib/planilla/horas";
import type { BandaRecargo } from "@/lib/planilla/recargos";
import { ETIQUETA_AUSENCIA, TIPOS_AUSENCIA } from "@/lib/planilla/ausencias";
import { guardarAsistenciaCapturaAction } from "./actions";

export interface PersonaAsistencia {
  id: number;
  nombre: string;
  puesto: string;
  plantel: string;
  entrada: string; // "HH:MM" o ""
  salida: string;
  cruzaMedianoche: boolean;
  normales: number;
  extra25: number;
  extra50: number;
  extra75: number;
  extra100: number;
  tipoAusencia: string;
  observaciones: string;
  /** "Manual" | "Biometrico" | null (sin registro). */
  origen: string | null;
  registrado: boolean;
  puedeEditar: boolean;
}

const inCls =
  "w-full rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:bg-content disabled:text-muted";

const hs = (v: number) => (v === 0 ? "—" : v.toFixed(2));

/** "HH:MM" a minutos del día; null si no está completa o no se entiende. */
function minutos(texto: string): number | null {
  const m = texto.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Tabla de captura de asistencia de un grupo de puestos.
 *
 * Los totales se recalculan AL ESCRIBIR con `calcularHorasTurno` — la misma función que
 * usa el servidor al guardar, así que lo que se ve en pantalla es exactamente lo que se
 * va a guardar. Así, si alguien aparece con 14 horas extra, se nota antes de guardar.
 *
 * Esta tabla no muestra salarios ni costos: solo horas.
 */
export function TablaAsistencia({
  personas,
  fechaISO,
  bandas,
  mostrarPlantel,
}: {
  personas: PersonaAsistencia[];
  fechaISO: string;
  bandas: BandaRecargo[];
  mostrarPlantel: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-muted">
            <th className="px-2 py-2">Persona</th>
            {mostrarPlantel && <th className="hidden px-2 py-2 lg:table-cell">Plantel</th>}
            <th className="w-[104px] px-2 py-2">Entrada</th>
            <th className="w-[124px] px-2 py-2">Salida</th>
            <th className="w-[70px] px-2 py-2 text-right">Normales</th>
            <th className="w-[62px] px-2 py-2 text-right">25 %</th>
            <th className="w-[62px] px-2 py-2 text-right">50 %</th>
            <th className="w-[62px] px-2 py-2 text-right">75 %</th>
            <th className="w-[62px] px-2 py-2 text-right">100 %</th>
            <th className="w-[70px] px-2 py-2 text-right">Total</th>
            <th className="w-[150px] px-2 py-2">Ausencia</th>
            <th className="px-2 py-2">Observaciones</th>
          </tr>
        </thead>
        <tbody>
          {personas.map((p) => (
            <FilaPersona
              key={`${p.id}-${p.entrada}-${p.salida}-${p.tipoAusencia}-${p.observaciones}`}
              persona={p}
              fechaISO={fechaISO}
              bandas={bandas}
              mostrarPlantel={mostrarPlantel}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilaPersona({
  persona,
  fechaISO,
  bandas,
  mostrarPlantel,
}: {
  persona: PersonaAsistencia;
  fechaISO: string;
  bandas: BandaRecargo[];
  mostrarPlantel: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [entrada, setEntrada] = useState(persona.entrada);
  const [salida, setSalida] = useState(persona.salida);
  const [ausencia, setAusencia] = useState(persona.tipoAusencia);
  const [obs, setObs] = useState(persona.observaciones);
  const [error, setError] = useState<string | null>(null);

  const bloqueado = !persona.puedeEditar;
  const hayAusencia = ausencia !== "";

  // Cálculo EN VIVO con lo que está escrito ahora mismo.
  const calculo = useMemo(() => {
    if (hayAusencia) return null;
    const mEntrada = minutos(entrada);
    const mSalida = minutos(salida);
    if (mEntrada == null || mSalida == null) return null;

    const [a, m, d] = fechaISO.split("-").map(Number);
    const base = new Date(a, m - 1, d);
    const ini = new Date(a, m - 1, d, Math.floor(mEntrada / 60), mEntrada % 60);
    // Salida anterior o igual a la entrada: el turno cruzó la medianoche.
    const cruza = mSalida <= mEntrada;
    const fin = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + (cruza ? 1 : 0),
      Math.floor(mSalida / 60),
      mSalida % 60,
    );
    const h = calcularHorasTurno(ini, fin, bandas);
    const total =
      h.horas_normales + h.horas_extra_25 + h.horas_extra_50 + h.horas_extra_75 + h.horas_extra_100;
    return { ...h, total: Math.round(total * 100) / 100, cruza };
  }, [entrada, salida, hayAusencia, fechaISO, bandas]);

  // Lo que se muestra: el cálculo en vivo si hay dos horas escritas; si no, lo guardado.
  const v = calculo ?? {
    horas_normales: hayAusencia ? 0 : persona.normales,
    horas_extra_25: hayAusencia ? 0 : persona.extra25,
    horas_extra_50: hayAusencia ? 0 : persona.extra50,
    horas_extra_75: hayAusencia ? 0 : persona.extra75,
    horas_extra_100: hayAusencia ? 0 : persona.extra100,
    total: hayAusencia
      ? 0
      : Math.round(
          (persona.normales + persona.extra25 + persona.extra50 + persona.extra75 + persona.extra100) *
            100,
        ) / 100,
    cruza: persona.cruzaMedianoche,
  };

  const guardar = (extra?: { ausencia?: string }) => {
    const aus = extra?.ausencia ?? ausencia;
    setError(null);
    startTransition(async () => {
      const r = await guardarAsistenciaCapturaAction(persona.id, fechaISO, {
        entrada: aus === "" ? entrada : "",
        salida: aus === "" ? salida : "",
        tipoAusencia: aus,
        observaciones: obs,
      });
      if (!r.ok) setError(r.mensaje ?? "No se pudo guardar.");
      router.refresh();
    });
  };

  // Una jornada larguísima casi siempre es una hora mal digitada, no un turno real.
  const sospechoso = v.total > 16;

  return (
    <tr className={"border-b border-border/60 " + (hayAusencia ? "bg-content/40" : "")}>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 font-medium text-ink">
          {persona.nombre}
          {persona.origen === "Biometrico" && (
            <span title="El dato vino del reloj biométrico">
              <Radio size={12} className="text-muted" />
            </span>
          )}
          {bloqueado && (
            <span title="Fuera de tu alcance: solo lectura">
              <Lock size={12} className="text-muted" />
            </span>
          )}
        </div>
        {error && <div className="text-[11px] text-red-600">{error}</div>}
      </td>
      {mostrarPlantel && (
        <td className="hidden px-2 py-1.5 text-xs text-muted lg:table-cell">{persona.plantel}</td>
      )}

      <td className="px-2 py-1.5">
        <input
          type="time"
          value={entrada}
          disabled={bloqueado || pendiente || hayAusencia}
          onChange={(e) => setEntrada(e.target.value)}
          onBlur={() => entrada !== persona.entrada && guardar()}
          className={inCls + " tabular-nums"}
        />
      </td>
      <td className="px-2 py-1.5">
        <span className="flex items-center gap-1">
          <input
            type="time"
            value={salida}
            disabled={bloqueado || pendiente || hayAusencia}
            onChange={(e) => setSalida(e.target.value)}
            onBlur={() => salida !== persona.salida && guardar()}
            className={inCls + " tabular-nums"}
          />
          {v.cruza && !hayAusencia && (
            <span
              className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800"
              title="La salida es del día siguiente"
            >
              +1 día
            </span>
          )}
        </span>
      </td>

      <td className="px-2 py-1.5 text-right tabular-nums text-ink">{hs(v.horas_normales)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-ink">{hs(v.horas_extra_25)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-ink">{hs(v.horas_extra_50)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-ink">{hs(v.horas_extra_75)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-ink">{hs(v.horas_extra_100)}</td>
      <td
        className={
          "px-2 py-1.5 text-right font-semibold tabular-nums " +
          (sospechoso ? "text-amber-700" : "text-ink")
        }
        title={sospechoso ? "Jornada muy larga: revisa que las horas estén bien escritas" : undefined}
      >
        <span className="inline-flex items-center gap-1">
          {sospechoso && <Clock size={12} />}
          {hs(v.total)}
        </span>
      </td>

      <td className="px-2 py-1.5">
        <select
          value={ausencia}
          disabled={bloqueado || pendiente}
          onChange={(e) => {
            const nueva = e.target.value;
            setAusencia(nueva);
            // Al marcar una ausencia se limpian las horas (y los campos se deshabilitan).
            if (nueva !== "") {
              setEntrada("");
              setSalida("");
            }
            guardar({ ausencia: nueva });
          }}
          className={inCls}
        >
          <option value="">Trabajó</option>
          {TIPOS_AUSENCIA.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_AUSENCIA[t]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input
          value={obs}
          disabled={bloqueado || pendiente}
          placeholder="—"
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => obs !== persona.observaciones && guardar()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={inCls}
        />
      </td>
    </tr>
  );
}
