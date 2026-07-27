import { auth } from "@/auth";
import { requerirAcceso } from "@/lib/auth/guard";
import { calcularDesempeno } from "@/lib/comercial/metricas";
import { Card } from "../components/ui";
import { Saludo } from "../saludo";
import { FiltrosComercial } from "./filtros-comercial";
import { TablaDesempeno } from "./tabla-desempeno";

export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function tono(pct: number | null, verde: number, amarillo: number): string {
  if (pct == null) return "text-ink";
  if (pct >= verde) return "text-ok";
  if (pct >= amarillo) return "text-warn";
  return "text-danger";
}

export default async function ComercialPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; zona?: string }>;
}) {
  const alcance = await requerirAcceso("/comercial");
  const sesion = await auth();
  const nombre = (sesion?.user?.name ?? "").trim().split(/\s+/)[0] || "usuario";
  const fechaHoy = new Date()
    .toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .replace(",", "");

  const sp = await searchParams;
  const periodo = /^\d{4}-\d{2}$/.test(sp.periodo ?? "") ? sp.periodo! : periodoActual();
  const [anio, mes] = periodo.split("-").map(Number);
  const zona = sp.zona === "Norte" || sp.zona === "Centro Sur" ? sp.zona : "todas";

  const resumen = await calcularDesempeno({
    anio,
    mes,
    zona: zona === "todas" ? null : zona,
  });
  const puedeEditar = alcance.esAdmin || alcance.esGerenteComercial;

  return (
    <>
      <Saludo nombre={nombre} fecha={fechaHoy} />

      <FiltrosComercial periodo={periodo} zona={zona} />

      {/* ── Tarjetas de métrica ─────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm text-muted">m³ vendidos (mes)</div>
          <div className="mt-1 text-3xl font-bold text-ink">
            {resumen.m3VendidosTotal.toFixed(1)} m³
          </div>
          <div className="mt-1 text-xs">
            {resumen.cumplimientoPct == null ? (
              <span className="text-muted">Sin metas configuradas</span>
            ) : (
              <span className={tono(resumen.cumplimientoPct, 95, 80)}>
                {resumen.cumplimientoPct.toFixed(0)}% de la meta ({resumen.metaTotal.toFixed(0)} m³)
              </span>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm text-muted">Precisión de proyección</div>
          <div className={`mt-1 text-3xl font-bold ${tono(resumen.precisionPct, 90, 75)}`}>
            {resumen.precisionPct == null ? "—" : `${resumen.precisionPct.toFixed(0)}%`}
          </div>
          <div className="mt-1 text-xs text-muted">Proyectado vs. real (Programa Semana)</div>
        </Card>

        <Card className="p-4">
          <div className="text-sm text-muted">Confirmación a tiempo</div>
          <div className={`mt-1 text-3xl font-bold ${tono(resumen.confirmacionPct, 90, 70)}`}>
            {resumen.confirmacionPct == null ? "—" : `${resumen.confirmacionPct.toFixed(0)}%`}
          </div>
          <div className="mt-1 text-xs text-muted">Confirmados antes de la hora de llegada</div>
        </Card>
      </div>

      {/* ── Adiciones y cancelaciones del día/mes ───────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-sm text-muted">Adiciones del día (mes)</div>
          <div className="mt-1 text-3xl font-bold text-amber-600">
            +{resumen.adicionesM3Total.toFixed(1)} m³
          </div>
          <div className="mt-1 text-xs text-muted">
            Suministros nuevos del día + volumen por encima de lo programado (impacta el resto del programa).
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm text-muted">Cancelaciones (mes)</div>
          <div className="mt-1 text-3xl font-bold text-danger">
            {resumen.cancelacionesTotal}
            <span className="ml-2 text-base font-normal text-muted">
              {resumen.cancelacionesM3Total.toFixed(0)} m³
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            {Object.entries(resumen.cancelacionesPorMotivo).length === 0 ? (
              <span>Sin cancelaciones este mes</span>
            ) : (
              Object.entries(resumen.cancelacionesPorMotivo).map(([m, n]) => (
                <span key={m}>
                  {m}: <span className="font-medium text-ink">{n}</span>
                </span>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── Tabla de desempeño por asesor ───────────────────────────────── */}
      <Card className="p-5">
        <h2 className="mb-4 text-lg font-semibold text-ink">Desempeño por asesor</h2>
        <TablaDesempeno
          filas={resumen.asesores}
          anio={anio}
          mes={mes}
          periodo={periodo}
          zonaParam={zona}
          puedeEditar={puedeEditar}
        />
      </Card>
    </>
  );
}
