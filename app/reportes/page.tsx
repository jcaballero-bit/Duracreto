// Panel de indicadores operativos (Hito 7). Para Administrador (todos los
// planteles, con selector) y Jefe de Planta (fijado a SU plantel). 6 KPIs +
// volumen por día + ciclo real vs referencia por plantel. Todo el cálculo vive
// en lib/reportes/metricas.ts; aquí solo se arma la vista.
import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { compararPlanteles } from "@/lib/planteles-orden";
import { calcularReportes, type ResumenReportes } from "@/lib/reportes/metricas";
import { Card, PageHeader } from "../components/ui";
import { FiltrosReportes } from "./filtros-reportes";
import { BarChart } from "./bar-chart";

export const dynamic = "force-dynamic";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const pad = (n: number) => String(n).padStart(2, "0");
const fmtCorto = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

function rangoFechas(rango: string, hoy: Date): { desde: Date; hasta: Date; etiqueta: string } {
  const d0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (rango === "semana") {
    const dow = (d0.getDay() + 6) % 7; // 0 = lunes (semana Lun–Dom, como el resto del sistema)
    const lunes = new Date(d0);
    lunes.setDate(d0.getDate() - dow);
    const finExcl = new Date(lunes);
    finExcl.setDate(lunes.getDate() + 7);
    const domingo = new Date(finExcl);
    domingo.setDate(finExcl.getDate() - 1);
    return { desde: lunes, hasta: finExcl, etiqueta: `Semana del ${fmtCorto(lunes)} al ${fmtCorto(domingo)}` };
  }
  if (rango === "mes") {
    const ini = new Date(d0.getFullYear(), d0.getMonth(), 1);
    const finExcl = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
    return { desde: ini, hasta: finExcl, etiqueta: `${MESES[d0.getMonth()]} ${d0.getFullYear()}` };
  }
  const finExcl = new Date(d0);
  finExcl.setDate(d0.getDate() + 1);
  return { desde: d0, hasta: finExcl, etiqueta: fmtCorto(d0) };
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; plantel?: string }>;
}) {
  const alcance = await requerirAcceso("/reportes");
  const sp = await searchParams;
  const rango = sp.rango === "semana" || sp.rango === "mes" ? sp.rango : "hoy";

  const { desde, hasta, etiqueta } = rangoFechas(rango, new Date());

  // Alcance de plantel: Admin elige (o todos); Jefe de Planta va fijado al suyo.
  const puedeElegirPlantel = alcance.esAdmin;
  let plantelId: number | null = null;
  let plantelFijoNombre: string | undefined;

  const planteles = await prisma.planteles.findMany({ orderBy: { nombre: "asc" } });

  if (puedeElegirPlantel) {
    const pedido = sp.plantel ? Number(sp.plantel) : NaN;
    plantelId = Number.isFinite(pedido) ? pedido : null;
  } else {
    // Jefe de Planta: siempre su plantel asignado (si no tiene, no ve nada).
    plantelId = alcance.plantelAsignadoId ?? -1;
    plantelFijoNombre = planteles.find((p) => p.id === plantelId)?.nombre ?? "Sin plantel asignado";
  }

  const resumen = await calcularReportes({ desde, hasta, plantelId });

  const opcPlanteles = planteles
    .slice()
    .sort((a, b) => compararPlanteles(a.nombre, b.nombre))
    .map((p) => ({ id: p.id, nombre: p.nombre }));

  return (
    <>
      <PageHeader
        titulo="Indicadores operativos"
        descripcion={`Desempeño de despacho — ${etiqueta}.`}
      />

      <FiltrosReportes
        rango={rango}
        plantelId={plantelId != null && puedeElegirPlantel ? String(plantelId) : ""}
        planteles={opcPlanteles}
        puedeElegirPlantel={puedeElegirPlantel}
        plantelFijo={plantelFijoNombre}
      />

      <Tarjetas resumen={resumen} />

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <h2 className="mb-1 text-sm font-semibold text-ink">Volumen despachado por día</h2>
          <p className="mb-4 text-xs text-muted">m³ suministrados (viajes completados).</p>
          <BarChart datos={resumen.volumenPorDia.map((d) => ({ label: d.label, valor: d.m3 }))} unidad="m³" />
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-ink">Ciclo promedio por plantel</h2>
          <p className="mb-4 text-xs text-muted">Tiempo real de carga a regreso vs. la referencia programada.</p>
          <CicloComparativa ciclos={resumen.cicloPorPlantel} />
        </Card>
      </div>
    </>
  );
}

// ── Tarjetas KPI ─────────────────────────────────────────────────────────────
type Tono = "ok" | "warn" | "danger";
const DOT: Record<Tono, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
};

function tonoPct(pct: number | null, ok: number, warn: number): Tono | undefined {
  if (pct == null) return undefined;
  if (pct >= ok) return "ok";
  if (pct >= warn) return "warn";
  return "danger";
}

function Kpi({
  titulo,
  valor,
  sub,
  tono,
}: {
  titulo: string;
  valor: string;
  sub?: string;
  tono?: Tono;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        {tono && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[tono]}`} />}
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{titulo}</span>
      </div>
      <p className="mt-2 text-3xl font-bold text-ink">{valor}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

function Tarjetas({ resumen: r }: { resumen: ResumenReportes }) {
  const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Kpi
        titulo="Llegadas a tiempo"
        valor={pct(r.llegadasATiempoPct)}
        sub={r.llegadasTotal > 0 ? `${r.llegadasTotal} llegadas registradas` : "Sin llegadas registradas"}
        tono={tonoPct(r.llegadasATiempoPct, 90, 75)}
      />
      <Kpi
        titulo="Cargas en tiempo y forma"
        valor={pct(r.cargasEnFormaPct)}
        sub={r.cargasTotal > 0 ? `${r.cargasTotal} cargas registradas` : "Sin cargas registradas"}
        tono={tonoPct(r.cargasEnFormaPct, 90, 75)}
      />
      <Kpi
        titulo="Cumplimiento de programación"
        valor={pct(r.cumplimientoPct)}
        sub={`${r.pedidosCompletados} de ${r.pedidosTotal} pedidos completados`}
        tono={tonoPct(r.cumplimientoPct, 90, 70)}
      />
      <Kpi
        titulo="Volumen despachado"
        valor={`${r.volumenM3} m³`}
        sub={r.pedidosCancelados > 0 ? `${r.pedidosCancelados} pedidos cancelados en el periodo` : "Sin cancelaciones"}
      />
      <Kpi
        titulo="Utilización de flota"
        valor={pct(r.utilizacionPct)}
        sub="Horas ocupadas vs. jornada de 10 h por mixer"
      />
      <Kpi
        titulo="Pedidos del periodo"
        valor={String(r.pedidosTotal)}
        sub={`${r.pedidosCompletados} completados · ${r.pedidosCancelados} cancelados`}
      />
    </div>
  );
}

// ── Comparativa de ciclo real vs referencia ─────────────────────────────────
function CicloComparativa({
  ciclos,
}: {
  ciclos: ResumenReportes["cicloPorPlantel"];
}) {
  if (ciclos.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Sin viajes con tiempos registrados en el periodo.</p>;
  }
  const max = Math.max(
    1,
    ...ciclos.flatMap((c) => [c.realMin ?? 0, c.refMin ?? 0]),
  );
  return (
    <div className="space-y-4">
      {/* Leyenda (2 series → siempre presente) */}
      <div className="flex gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Real
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Referencia
        </span>
      </div>
      {ciclos.map((c) => (
        <div key={c.plantel}>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink">{c.plantel}</span>
            <span className="text-xs text-muted">{c.viajes} viajes</span>
          </div>
          <Barra valor={c.realMin} max={max} color="bg-accent" />
          <div className="h-0.5" />
          <Barra valor={c.refMin} max={max} color="bg-amber-500" />
        </div>
      ))}
    </div>
  );
}

function Barra({ valor, max, color }: { valor: number | null; max: number; color: string }) {
  if (valor == null) {
    return <div className="flex h-4 items-center text-[10px] text-muted">sin dato</div>;
  }
  const pct = Math.max(2, (valor / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 flex-1 rounded-sm bg-content">
        <div className={`h-3 rounded-sm ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ink">{valor} min</span>
    </div>
  );
}
