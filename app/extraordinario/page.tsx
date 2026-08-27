import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { Card, PageHeader } from "../components/ui";
import { calcularExtraordinario } from "@/lib/extraordinario/metricas";
import { alcanceDeParams, rangoDeParams } from "@/lib/extraordinario/filtro";
import { textoMin } from "@/lib/planilla/recargos";
import { textoLempiras } from "@/lib/planilla/salario";
import { FiltrosExtraordinario } from "./filtros";
import { BarrasHora } from "./barras-hora";
import { Cobros, type CobroVista } from "./cobros";
import { PersonalTabs } from "../components/personal-tabs";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const m3 = (v: number) => `${v.toFixed(2)} m³`;
const pctTxt = (v: number) => `${v.toFixed(1)} %`;
const hora = (min: number | null) => (min == null ? "—" : textoMin(min));

/**
 * Control de despachos en horario extraordinario. Reemplaza el reporte que se armaba a
 * mano en Excel: cuánto volumen sale fuera de horario, en qué plantas, con qué
 * motoristas y cuánto cuesta ese sobretiempo comparado con lo que la ficha absorbe.
 *
 * Administrador (todo) y Jefe de Planta (acotado a sus planteles asignados; el filtro
 * de la URL no amplía su alcance — ver `alcanceDeParams`).
 */
export default async function ExtraordinarioPage({
  searchParams,
}: {
  searchParams: Promise<{
    desde?: string;
    hasta?: string;
    zona?: string;
    plantel?: string;
  }>;
}) {
  const alcance = await requerirAcceso("/extraordinario");
  const sp = await searchParams;

  const rango = rangoDeParams(sp);
  const ambito = await alcanceDeParams(alcance, sp);
  const r = await calcularExtraordinario({
    desde: rango.desde,
    hasta: rango.hasta,
    plantelIds: ambito.plantelIds,
  });

  const [cobrosRaw, clientes] = await Promise.all([
    prisma.cobros_sobretiempo.findMany({
      where: { fecha: { gte: rango.desde, lt: rango.hasta } },
      orderBy: { fecha: "asc" },
      include: { cliente: { select: { empresa: true, proyecto: true } } },
    }),
    prisma.clientes.findMany({
      where: { activo: true },
      orderBy: { empresa: "asc" },
      select: { id: true, empresa: true, proyecto: true },
    }),
  ]);
  const cobros: CobroVista[] = cobrosRaw.map((c) => ({
    id: c.id,
    fechaISO: iso(c.fecha),
    monto: c.monto,
    cliente: c.cliente
      ? c.cliente.proyecto
        ? `${c.cliente.empresa} — ${c.cliente.proyecto}`
        : c.cliente.empresa
      : "Sin especificar",
    observaciones: c.observaciones ?? "",
  }));

  const e = r.ejecutivo;
  const a = r.absorcion;
  const sobreUmbral = (p: number) => p > r.umbralPct;
  const filaResalta = "bg-amber-50";

  return (
    <>
      <PageHeader
        titulo="Horario extraordinario"
        descripcion="Despachos fuera de la jornada normal de cada planta, y cuánto de ese sobretiempo absorbe la ficha de costos."
      />

      <PersonalTabs activo="/extraordinario" roles={alcance.roles} />

      <Card className="mb-4 p-4">
        <FiltrosExtraordinario
          desde={rango.desdeISO}
          hasta={rango.hastaISO}
          planteles={ambito.planteles}
          zonas={ambito.zonas}
          zonaActual={ambito.zona}
          plantelActual={ambito.plantel}
        />
        <p className="mt-2 text-xs text-muted">
          {ambito.etiqueta} · del {rango.desdeISO} al {rango.hastaISO}
          {e.viajesEstimados > 0 && (
            <>
              {" · "}
              <span className="text-amber-700">
                {e.viajesEstimados}{" "}
                {e.viajesEstimados === 1 ? "viaje sin hora real" : "viajes sin hora real"} de salida
                (se clasificaron con la hora programada)
              </span>
            </>
          )}
        </p>
      </Card>

      {/* ── B3. Resumen ejecutivo ─────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi titulo="Volumen despachado" valor={m3(e.volumenTotal)} pie={`${e.viajesTotal} viajes`} />
        <Kpi
          titulo="En horario normal"
          valor={pctTxt(e.pctNormal)}
          pie={`${m3(e.volumenNormal)} · ${e.viajesNormal} viajes`}
          tono="ok"
        />
        <Kpi
          titulo="En horario extraordinario"
          valor={pctTxt(e.pctExtra)}
          pie={`${m3(e.volumenExtra)} · ${e.viajesExtra} viajes`}
          tono={sobreUmbral(e.pctExtra) ? "danger" : "warn"}
        />
        <Kpi titulo="Motoristas activos" valor={String(e.motoristasActivos)} pie="con al menos un viaje" />
        <Kpi titulo="Días con despacho" valor={String(e.diasConDespacho)} pie="en el rango" />
        <Kpi
          titulo="Viajes por día"
          valor={e.promedioViajesDia.toFixed(1)}
          pie="promedio sobre días con despacho"
        />
      </div>

      {/* ── B2. Volumen extra por banda de recargo ────────────────────────── */}
      <Card className="mb-4 p-5">
        <h2 className="text-lg font-semibold text-ink">
          Volumen extraordinario por banda de recargo
        </h2>
        <p className="mb-3 text-xs text-muted">
          No todo el sobretiempo cuesta igual: una hora dominical al 100 % vale el doble que una de
          las 15:30 al 25 %. La banda sale de la <strong>hora de salida</strong> del viaje según las
          bandas de ley (Administración › Recargos de ley).
        </p>
        {r.bandasExtra.length === 0 ? (
          <p className="py-4 text-sm text-muted">Sin volumen en horario extraordinario.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {r.bandasExtra.map((b) => (
              <div
                key={b.porcentaje}
                className="min-w-[140px] rounded-lg border border-border bg-content/40 px-3 py-2"
              >
                <div className="text-xs text-muted">
                  {b.porcentaje === 0 ? "Sin recargo de ley" : `Recargo ${b.porcentaje} %`}
                </div>
                <div className="text-lg font-semibold tabular-nums text-ink">{m3(b.volumen)}</div>
                <div className="text-xs text-muted">{b.viajes} viajes</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── B4. Resumen por planta ────────────────────────────────────────── */}
      <Card className="mb-4 p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">Resumen por planta</h2>
          <span className="text-xs text-muted">
            Resaltadas las plantas con más de {r.umbralPct} % de volumen extraordinario
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                <th className="px-2 py-2">Plantel</th>
                <th className="px-2 py-2">Planta</th>
                <th className="hidden px-2 py-2 xl:table-cell">Horario normal configurado</th>
                <th className="px-2 py-2 text-right">Viajes</th>
                <th className="px-2 py-2 text-right">Volumen</th>
                <th className="px-2 py-2 text-right">Normal</th>
                <th className="px-2 py-2 text-right">Extra</th>
                <th className="px-2 py-2 text-right">% extra</th>
                <th className="px-2 py-2 text-right">Viajes N / E</th>
              </tr>
            </thead>
            <tbody>
              {r.porPlanta.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-sm text-muted">
                    Sin despachos en el periodo.
                  </td>
                </tr>
              )}
              {r.porPlanta.map((p) => (
                <tr
                  key={p.plantaId}
                  className={
                    "border-b border-border/60 " + (sobreUmbral(p.pctExtra) ? filaResalta : "")
                  }
                >
                  <td className="px-2 py-2 text-xs text-muted">{p.plantel}</td>
                  <td className="px-2 py-2 font-medium text-ink">{p.planta}</td>
                  <td className="hidden px-2 py-2 text-xs text-muted xl:table-cell">{p.horarios}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{p.viajes}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{p.volumen.toFixed(2)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {p.volumenNormal.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {p.volumenExtra.toFixed(2)}
                  </td>
                  <td
                    className={
                      "px-2 py-2 text-right font-semibold tabular-nums " +
                      (sobreUmbral(p.pctExtra) ? "text-amber-700" : "text-ink")
                    }
                  >
                    {pctTxt(p.pctExtra)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">
                    {p.viajesNormal} / {p.viajesExtra}
                  </td>
                </tr>
              ))}
              {r.porPlanta.length > 0 && (
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-2 py-2 text-ink" colSpan={3}>
                    TOTAL
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{e.viajesTotal}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {e.volumenTotal.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {e.volumenNormal.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {e.volumenExtra.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{pctTxt(e.pctExtra)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">
                    {e.viajesNormal} / {e.viajesExtra}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── B5. Tendencia diaria ──────────────────────────────────────────── */}
      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-lg font-semibold text-ink">Tendencia diaria</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                <th className="px-2 py-2">Fecha</th>
                <th className="px-2 py-2 text-right">Viajes</th>
                <th className="px-2 py-2 text-right">Volumen</th>
                <th className="px-2 py-2 text-right">Normal</th>
                <th className="px-2 py-2 text-right">Extra</th>
                <th className="px-2 py-2 text-right">% extra</th>
              </tr>
            </thead>
            <tbody>
              {r.porDia.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-muted">
                    Sin despachos en el periodo.
                  </td>
                </tr>
              )}
              {r.porDia.map((d) => (
                <tr
                  key={d.fechaISO}
                  className={
                    "border-b border-border/60 " + (sobreUmbral(d.pctExtra) ? filaResalta : "")
                  }
                >
                  <td className="px-2 py-2 text-ink">
                    <span className="text-muted">{d.diaSemana}</span> {d.etiqueta}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{d.viajes}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{d.volumen.toFixed(2)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {d.volumenNormal.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {d.volumenExtra.toFixed(2)}
                  </td>
                  <td
                    className={
                      "px-2 py-2 text-right font-semibold tabular-nums " +
                      (sobreUmbral(d.pctExtra) ? "text-amber-700" : "text-ink")
                    }
                  >
                    {pctTxt(d.pctExtra)}
                  </td>
                </tr>
              ))}
              {r.porDia.length > 0 && (
                <>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="px-2 py-2 text-ink">TOTAL</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{e.viajesTotal}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">
                      {e.volumenTotal.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">
                      {e.volumenNormal.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">
                      {e.volumenExtra.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">
                      {pctTxt(e.pctExtra)}
                    </td>
                  </tr>
                  <tr className="text-xs text-muted">
                    <td className="px-2 py-1.5">PROMEDIO POR DÍA</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {e.promedioViajesDia.toFixed(1)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {(e.volumenTotal / r.porDia.length).toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {(e.volumenNormal / r.porDia.length).toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {(e.volumenExtra / r.porDia.length).toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5" />
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── B8. Distribución horaria ──────────────────────────────────────── */}
      <Card className="mb-4 p-5">
        <h2 className="text-lg font-semibold text-ink">Distribución horaria</h2>
        <p className="mb-3 text-xs text-muted">
          Volumen por franja de hora de salida. La porción ámbar es la que salió fuera del horario
          normal de su planta.
        </p>
        <BarrasHora datos={r.distribucion} />
        {r.distribucion.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-2 py-2">Franja</th>
                  <th className="px-2 py-2 text-right">Viajes</th>
                  <th className="px-2 py-2 text-right">Volumen</th>
                  <th className="px-2 py-2 text-right">Viajes extra</th>
                  <th className="px-2 py-2 text-right">Volumen extra</th>
                </tr>
              </thead>
              <tbody>
                {r.distribucion.map((d) => (
                  <tr
                    key={d.hora}
                    className={
                      "border-b border-border/60 " + (d.volumenExtra > 0 ? filaResalta : "")
                    }
                  >
                    <td className="px-2 py-1.5 tabular-nums text-ink">{d.etiqueta}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">{d.viajes}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {d.volumen.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {d.viajesExtra}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {d.volumenExtra.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── B6. Análisis por motorista ────────────────────────────────────── */}
      <Card className="mb-4 p-5">
        <h2 className="text-lg font-semibold text-ink">Análisis por motorista</h2>
        <p className="mb-3 text-xs text-muted">
          Agrupado por el motorista registrado en el viaje, no por su nombre escrito: nadie aparece
          dos veces por una variante de escritura.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                <th className="px-2 py-2">Motorista</th>
                <th className="px-2 py-2 text-right">Viajes</th>
                <th className="px-2 py-2 text-right">Volumen</th>
                <th className="px-2 py-2 text-right">Días</th>
                <th className="px-2 py-2 text-right">Viajes/día</th>
                <th className="px-2 py-2 text-right">Viajes en hora extra</th>
                <th className="px-2 py-2">Plantas donde operó</th>
              </tr>
            </thead>
            <tbody>
              {r.porMotorista.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-muted">
                    Sin despachos en el periodo.
                  </td>
                </tr>
              )}
              {r.porMotorista.map((m) => (
                <tr key={m.operadorId ?? "sin"} className="border-b border-border/60">
                  <td className="px-2 py-2 font-medium text-ink">{m.nombre}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{m.viajes}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {m.volumen.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{m.diasTrabajados}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {m.promedioViajesDia.toFixed(1)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{m.viajesExtra}</td>
                  <td className="px-2 py-2 text-xs text-muted">{m.plantas.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── B7. Estadísticas de hora de salida ────────────────────────────── */}
      <Card className="mb-4 p-5">
        <h2 className="text-lg font-semibold text-ink">Hora de salida por planta</h2>
        <p className="mb-3 text-xs text-muted">
          Calculado solo con las salidas que tienen hora <strong>real</strong> registrada. La
          columna de viajes sin hora importa: señala dónde el registro operativo está fallando y,
          por tanto, dónde este análisis es menos confiable.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                <th className="px-2 py-2">Planta</th>
                <th className="px-2 py-2 text-right">Mínima</th>
                <th className="px-2 py-2 text-right">Máxima</th>
                <th className="px-2 py-2 text-right">Promedio</th>
                <th className="px-2 py-2 text-right">Mediana</th>
                <th className="px-2 py-2 text-right">Con hora</th>
                <th className="px-2 py-2 text-right">Sin hora</th>
              </tr>
            </thead>
            <tbody>
              {r.horaSalida.map((h) => (
                <tr
                  key={h.plantaId ?? "global"}
                  className={
                    h.plantaId == null
                      ? "border-t-2 border-border font-semibold"
                      : "border-b border-border/60"
                  }
                >
                  <td className="px-2 py-2 text-ink">{h.planta}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{hora(h.minMin)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{hora(h.maxMin)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{hora(h.promedioMin)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{hora(h.medianaMin)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{h.conHora}</td>
                  <td
                    className={
                      "px-2 py-2 text-right tabular-nums " +
                      (h.sinHora > 0 ? "font-semibold text-amber-700" : "text-muted")
                    }
                  >
                    {h.sinHora}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── B9. Absorción de costo ────────────────────────────────────────── */}
      <Card className="mb-4 p-5">
        <h2 className="text-lg font-semibold text-ink">Absorción del costo de sobretiempo</h2>
        <p className="mb-4 text-xs text-muted">
          Compara lo que la ficha de costos absorbe de sobretiempo contra lo que realmente se pagó
          en planilla en el periodo.
        </p>

        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Kpi
            titulo={`Considerado en ficha (L ${a.costoFicha.toFixed(2)}/m³)`}
            valor={textoLempiras(a.consideradoEnFicha)}
            pie={`${a.costoFicha.toFixed(2)} × ${m3(a.volumenTotal)} (volumen TOTAL)`}
          />
          <Kpi
            titulo="Pago actual de sobretiempo"
            valor={textoLempiras(a.pagoActual)}
            pie={`${a.personasConSobretiempo} persona(s) con horas extra`}
          />
          <Kpi
            titulo="Diferencia"
            valor={textoLempiras(a.diferencia)}
            pie={
              a.pctDesviacion == null
                ? "sin base para comparar"
                : `${a.diferencia < 0 ? "" : "+"}${a.pctDesviacion.toFixed(1)} % vs. la ficha`
            }
            tono={a.diferencia < 0 ? "danger" : "ok"}
          />
          <Kpi
            titulo="Diferencia neta"
            valor={textoLempiras(a.diferenciaNeta)}
            pie={
              a.cobroCliente > 0
                ? `incluye ${textoLempiras(a.cobroCliente)} cobrados a clientes`
                : "sin cobros a clientes en el periodo"
            }
            tono={a.diferenciaNeta < 0 ? "danger" : "ok"}
          />
        </div>

        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <strong>Qué incluye el pago actual:</strong> las horas extra de{" "}
          <strong>todo el personal operativo</strong> (dosificadores, operadores de cargadora y de
          bomba, motoristas de camión y de mixer), no solo los puestos atribuibles al despacho. Es
          el sobretiempo total que paga la operación, comparado contra un costo por m³ que la ficha
          calculó para el despacho.
          {a.excluidoSinPlantel && (
            <>
              {" "}
              <span className="text-amber-800">
                Este reporte está filtrado por plantel y quedaron fuera{" "}
                {a.excluidoSinPlantel.personas} persona(s) con sobretiempo sin plantel asignado, por{" "}
                {textoLempiras(a.excluidoSinPlantel.monto)}: asígnales plantel en Flota › Operadores
                para que entren.
              </span>
            </>
          )}
        </div>

        {a.diferencia < 0 && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            La diferencia es negativa: se está pagando más sobretiempo del que la ficha absorbe, o
            sea que ese exceso sale del margen.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Horas extra del periodo</h3>
            {a.horasExtraPorNivel.length === 0 ? (
              <p className="text-sm text-muted">Sin horas extra registradas en planilla.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium text-muted">
                    <th className="px-2 py-1.5">Nivel</th>
                    <th className="px-2 py-1.5 text-right">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {a.horasExtraPorNivel.map((h) => (
                    <tr key={h.porcentaje} className="border-b border-border/60">
                      <td className="px-2 py-1.5 text-ink">{h.porcentaje} %</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                        {h.horas.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">De dónde viene el sobretiempo</h3>
            {a.pagoPorPuesto.length === 0 ? (
              <p className="text-sm text-muted">Sin sobretiempo pagado en el periodo.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium text-muted">
                    <th className="px-2 py-1.5">Puesto</th>
                    <th className="px-2 py-1.5 text-right">Personas</th>
                    <th className="px-2 py-1.5 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {a.pagoPorPuesto.map((p) => (
                    <tr key={p.puesto} className="border-b border-border/60">
                      <td className="px-2 py-1.5 text-ink">{p.puesto}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-ink">{p.personas}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                        {textoLempiras(p.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Cobro realizado a cliente</h3>
          <Cobros
            cobros={cobros}
            clientes={clientes.map((c) => ({
              id: c.id,
              nombre: c.proyecto ? `${c.empresa} — ${c.proyecto}` : c.empresa,
            }))}
            puedeCapturar={alcance.esAdmin}
            fechaSugerida={rango.hastaISO}
          />
        </div>
      </Card>

      <Card className="p-4 text-xs leading-relaxed text-muted">
        <p className="mb-2 font-semibold text-ink">Cómo se clasifica</p>
        <p className="mb-1">
          Un viaje es <strong>extraordinario</strong> si su hora de salida cae fuera del horario
          normal de la planta donde cargó, según el tipo de día. Ese horario es{" "}
          <strong>por planta</strong> y se configura en Administración › Horario de planta: es
          distinto de las bandas de recargo de ley, que aplican a las personas.
        </p>
        <p className="mb-1">
          Se usa la hora <strong>real</strong> de salida; si un viaje no la tiene, se usa la
          programada y ese viaje se cuenta como estimado (se reporta arriba). El volumen es el que
          realmente salió de la planta, y cada viaje se atribuye al día de su salida.
        </p>
        <p className="mb-1">
          Solo se cuentan los viajes que <strong>ya salieron de la planta</strong> (En ruta,
          Llegada, Descargando, Regresando o Completado). Un viaje todavía programado o en carga no
          aparece aquí: no ha salido, así que no causó trabajo fuera de horario.
        </p>
        <p className="mb-1">
          Por eso este total <strong>no es el mismo</strong> que los &ldquo;m³ vendidos&rdquo; de
          Gerencia Comercial, y no tiene por qué serlo: allá se cuenta solo lo{" "}
          <strong>entregado</strong> (viajes Completado) y atribuido al día del pedido, mientras que
          aquí se cuenta todo lo que <strong>salió de planta</strong> —incluido lo que aún va en
          ruta— atribuido al día de la salida.
        </p>
        <p>
          El pago de sobretiempo es <strong>costo bruto</strong>: no incluye deducciones (IHSS,
          RAP, INFOP, impuesto sobre la renta) ni neto a pagar.
        </p>
      </Card>
    </>
  );
}

/** Tarjeta de indicador, con semáforo opcional (mismo lenguaje visual que /reportes). */
function Kpi({
  titulo,
  valor,
  pie,
  tono,
}: {
  titulo: string;
  valor: string;
  pie?: string;
  tono?: "ok" | "warn" | "danger";
}) {
  const color =
    tono === "ok"
      ? "text-emerald-600"
      : tono === "warn"
        ? "text-amber-600"
        : tono === "danger"
          ? "text-red-600"
          : "text-ink";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs text-muted">{titulo}</div>
      <div className={"mt-0.5 text-xl font-semibold tabular-nums " + color}>{valor}</div>
      {pie && <div className="mt-0.5 text-xs text-muted">{pie}</div>}
    </div>
  );
}
