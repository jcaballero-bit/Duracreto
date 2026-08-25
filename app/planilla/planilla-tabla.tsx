"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { textoLempiras } from "@/lib/planilla/salario";
import { ETIQUETA_AUSENCIA, TIPOS_AUSENCIA } from "@/lib/planilla/ausencias";
import type { PersonaPlanilla } from "@/lib/planilla/consulta";
import { guardarAsistenciaAction, guardarSalarioAction } from "./actions";

const inCls =
  "w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent";

const hs = (v: number) => (v === 0 ? "—" : v.toFixed(2));

/**
 * Tabla de planilla de un grupo de puestos. Cada persona se puede expandir para
 * capturar/editar la entrada, la salida o la ausencia de cada uno de los 14 días del
 * periodo; al guardar, el servidor recalcula las horas por nivel de recargo y los
 * totales se actualizan al instante (router.refresh()).
 */
export function PlanillaTabla({
  personas,
  periodoCerrado,
}: {
  personas: PersonaPlanilla[];
  periodoCerrado: boolean;
}) {
  const [abierto, setAbierto] = useState<number | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-muted">
            <th className="w-8 px-2 py-2" />
            <th className="px-2 py-2">Persona</th>
            <th className="hidden px-2 py-2 lg:table-cell">Plantel</th>
            <th className="w-[124px] px-2 py-2">Salario mensual</th>
            <th className="hidden w-[86px] px-2 py-2 xl:table-cell">L / hora</th>
            <th className="w-[74px] px-2 py-2 text-right">Normales</th>
            <th className="w-[64px] px-2 py-2 text-right">25 %</th>
            <th className="w-[64px] px-2 py-2 text-right">50 %</th>
            <th className="w-[64px] px-2 py-2 text-right">75 %</th>
            <th className="w-[64px] px-2 py-2 text-right">100 %</th>
            <th className="px-2 py-2">Ausencias</th>
            <th className="w-[112px] px-2 py-2 text-right">Costo total</th>
          </tr>
        </thead>
        <tbody>
          {personas.map((p) => {
            const exp = abierto === p.id;
            return (
              <Fragment key={p.id}>
                <tr className="border-b border-border/60 align-middle hover:bg-content/60">
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => setAbierto(exp ? null : p.id)}
                      title={exp ? "Cerrar los días" : "Ver y capturar los días del periodo"}
                      className="text-muted hover:text-accent"
                    >
                      {exp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  </td>
                  <td className="px-2 py-2 font-medium text-ink">{p.nombre}</td>
                  <td className="hidden px-2 py-2 text-xs text-muted lg:table-cell">{p.plantel}</td>
                  <td className="px-2 py-2">
                    <SalarioCelda
                      key={`sal-${p.id}-${p.salarioMensual ?? "x"}`}
                      personaId={p.id}
                      valor={p.salarioMensual}
                      bloqueado={periodoCerrado}
                    />
                  </td>
                  <td className="hidden px-2 py-2 text-right text-xs tabular-nums text-muted xl:table-cell">
                    {p.salarioHora > 0 ? p.salarioHora.toFixed(2) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {hs(p.totales.normales)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{hs(p.totales.extra25)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{hs(p.totales.extra50)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{hs(p.totales.extra75)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{hs(p.totales.extra100)}</td>
                  <td className="px-2 py-2 text-xs text-muted">
                    {p.ausencias.length === 0
                      ? "—"
                      : p.ausencias
                          .map((a) => `${a.etiqueta}: ${a.dias} ${a.dias === 1 ? "día" : "días"}`)
                          .join(" · ")}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-ink">
                    {textoLempiras(p.costoTotal)}
                  </td>
                </tr>

                {exp && (
                  <tr className="border-b border-border bg-content/40">
                    <td colSpan={12} className="px-3 py-3">
                      <DiasPersona persona={p} bloqueado={periodoCerrado} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Salario mensual editable en la celda (dato sensible: pantalla solo de Admin). */
function SalarioCelda({
  personaId,
  valor,
  bloqueado,
}: {
  personaId: number;
  valor: number | null;
  bloqueado: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [texto, setTexto] = useState(valor == null ? "" : String(valor));

  const original = valor == null ? "" : String(valor);
  const guardar = () => {
    if (texto.trim() === original) return;
    startTransition(async () => {
      const r = await guardarSalarioAction(personaId, texto);
      if (!r.ok) {
        alert(r.mensaje ?? "No se pudo guardar el salario.");
        setTexto(original);
      } else router.refresh();
    });
  };

  return (
    <input
      value={texto}
      disabled={bloqueado || pendiente}
      placeholder="—"
      inputMode="decimal"
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setTexto(original);
      }}
      className={inCls + " text-right tabular-nums disabled:opacity-60"}
      title="Salario mensual. El diario (÷30) y el horario (÷30÷8) se derivan de este valor."
    />
  );
}

/** Los 14 días del periodo de una persona, capturables. */
function DiasPersona({
  persona,
  bloqueado,
}: {
  persona: PersonaPlanilla;
  bloqueado: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Captura de <strong className="text-ink">{persona.nombre}</strong>. Si la salida es igual o
          anterior a la entrada se entiende que el turno cruzó la medianoche y las horas se reparten
          entre los dos días.
        </p>
        {bloqueado && (
          <span className="flex items-center gap-1 text-xs text-amber-700">
            <Lock size={12} /> El periodo no está Abierto: la captura está bloqueada.
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[860px] text-xs">
          <thead>
            <tr className="border-b border-border text-left font-medium text-muted">
              <th className="w-[104px] px-2 py-1.5">Día</th>
              <th className="w-[84px] px-2 py-1.5">Entrada</th>
              <th className="w-[104px] px-2 py-1.5">Salida</th>
              <th className="w-[132px] px-2 py-1.5">Ausencia</th>
              <th className="w-[104px] px-2 py-1.5">Costo ausencia</th>
              <th className="px-2 py-1.5">Observaciones</th>
              <th className="w-[168px] px-2 py-1.5 text-right">Horas (N / 25 / 50 / 75 / 100)</th>
            </tr>
          </thead>
          <tbody>
            {persona.dias.map((d) => (
              <FilaDia
                key={`${persona.id}-${d.fechaISO}-${d.entrada}-${d.salida}-${d.tipoAusencia}-${d.costoAusencia ?? ""}`}
                personaId={persona.id}
                dia={d}
                bloqueado={bloqueado}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaDia({
  personaId,
  dia,
  bloqueado,
}: {
  personaId: number;
  dia: PersonaPlanilla["dias"][number];
  bloqueado: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [entrada, setEntrada] = useState(dia.entrada);
  const [salida, setSalida] = useState(dia.salida);
  const [ausencia, setAusencia] = useState(dia.tipoAusencia);
  const [costo, setCosto] = useState(dia.costoAusencia == null ? "" : String(dia.costoAusencia));
  const [obs, setObs] = useState(dia.observaciones);

  const guardar = (extra?: { ausencia?: string }) => {
    const aus = extra?.ausencia ?? ausencia;
    startTransition(async () => {
      const r = await guardarAsistenciaAction(personaId, dia.fechaISO, {
        entrada,
        salida,
        tipoAusencia: aus,
        costoAusencia: costo,
        observaciones: obs,
      });
      if (!r.ok) alert(r.mensaje ?? "No se pudo guardar.");
      router.refresh();
    });
  };

  const dd = dia.fechaISO.slice(8, 10);
  const mm = dia.fechaISO.slice(5, 7);
  const hayAusencia = ausencia !== "";

  return (
    <tr className={"border-b border-border/50 " + (dia.esFinDeSemana ? "bg-content/50" : "")}>
      <td className="px-2 py-1 text-ink">
        <span className="text-muted">{dia.diaSemana}</span> {dd}/{mm}
      </td>
      <td className="px-2 py-1">
        <input
          value={entrada}
          disabled={bloqueado || pendiente || hayAusencia}
          placeholder="07:00"
          onChange={(e) => setEntrada(e.target.value)}
          onBlur={() => entrada !== dia.entrada && guardar()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={inCls + " tabular-nums disabled:opacity-50"}
        />
      </td>
      <td className="px-2 py-1">
        <span className="flex items-center gap-1">
          <input
            value={salida}
            disabled={bloqueado || pendiente || hayAusencia}
            placeholder="15:00"
            onChange={(e) => setSalida(e.target.value)}
            onBlur={() => salida !== dia.salida && guardar()}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className={inCls + " tabular-nums disabled:opacity-50"}
          />
          {dia.cruzaMedianoche && (
            <span className="shrink-0 text-[10px] text-muted" title="La salida cayó el día siguiente">
              +1d
            </span>
          )}
        </span>
      </td>
      <td className="px-2 py-1">
        <select
          value={ausencia}
          disabled={bloqueado || pendiente}
          onChange={(e) => {
            const v = e.target.value;
            setAusencia(v);
            // Al marcar una ausencia se limpia el turno; el costo lo sugiere el servidor.
            if (v !== "") {
              setEntrada("");
              setSalida("");
              setCosto("");
            }
            guardar({ ausencia: v });
          }}
          className={inCls + " disabled:opacity-50"}
        >
          <option value="">Trabajó</option>
          {TIPOS_AUSENCIA.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_AUSENCIA[t]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1">
        <input
          value={costo}
          disabled={bloqueado || pendiente || !hayAusencia}
          placeholder={hayAusencia ? "sugerido" : "—"}
          inputMode="decimal"
          onChange={(e) => setCosto(e.target.value)}
          onBlur={() => costo !== (dia.costoAusencia == null ? "" : String(dia.costoAusencia)) && guardar()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={inCls + " text-right tabular-nums disabled:opacity-50"}
        />
      </td>
      <td className="px-2 py-1">
        <input
          value={obs}
          disabled={bloqueado || pendiente}
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => obs !== dia.observaciones && guardar()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={inCls + " disabled:opacity-50"}
        />
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-ink">
        {dia.normales + dia.extra25 + dia.extra50 + dia.extra75 + dia.extra100 === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          `${hs(dia.normales)} / ${hs(dia.extra25)} / ${hs(dia.extra50)} / ${hs(dia.extra75)} / ${hs(dia.extra100)}`
        )}
      </td>
    </tr>
  );
}
