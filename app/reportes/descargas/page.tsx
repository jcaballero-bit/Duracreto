// Reporte de TIEMPOS DE DESCARGA Y ESPERAS EN OBRA.
//
// Mide con los timestamps reales del despacho: cuánto tardó cada descarga contra lo
// pactado, cuánto estuvo el mixer parado en obra sin poder descargar, y si los
// camiones llegaron al ritmo comprometido. El cálculo vive en `lib/reportes/`
// (`descargas.ts` puro + `descargas-datos.ts` la consulta), compartido con la ruta de
// exportación a CSV para que el archivo no pueda desviarse de lo que se ve.
import { requerirAcceso } from "@/lib/auth/guard";
import { alcanceDeParams, rangoDeParams } from "@/lib/reportes/filtro";
import { calcularDescargas } from "@/lib/reportes/descargas-datos";
import { leerUmbralesDescarga } from "@/lib/reportes/umbrales";
import { Card, PageHeader } from "../../components/ui";
import { ReportesTabs } from "../../components/reportes-tabs";
import { FiltrosDescargas } from "./filtros";
import { TablaDescargas, type FilaDescarga } from "./tabla";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
const fechaCorta = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
/** Hora del servidor, cuya zona está fijada a America/Tegucigalpa. */
const hora = (ms: number | null) => {
  if (ms == null) return "—";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const n1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));

export default async function ReporteDescargasPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const alcance = await requerirAcceso("/reportes/descargas");
  const sp = (await searchParams) ?? {};

  const rango = rangoDeParams(sp);
  const ambito = await alcanceDeParams(alcance, sp);
  const umbrales = await leerUmbralesDescarga();

  const clienteFiltro = Number(sp.cliente);
  const clienteId = Number.isInteger(clienteFiltro) && clienteFiltro > 0 ? clienteFiltro : null;

  const r = await calcularDescargas({
    desde: rango.desde,
    hasta: rango.hasta,
    plantelIds: ambito.plantelIds,
    clienteId,
    umbrales,
  });

  // El filtro de cliente puede haber quedado apuntando a un cliente que no está en el
  // periodo: se limpia para no mostrar un select con un valor que no existe.
  const clienteActual = r.clientes.some((c) => c.id === clienteId) ? String(clienteId) : "";

  const filas: FilaDescarga[] = r.detalle.map((v) => ({
    ...v,
    fechaTxt: fechaCorta(v.diaMs),
    llegadaTxt: hora(v.llegadaMs),
    inicioTxt: hora(v.inicioDescargaMs),
    finTxt: hora(v.finDescargaMs),
  }));

  const res = r.resumen;
  const irregulares = r.intervalos.filter((i) => i.irregular);

  return (
    <>
      <PageHeader
        titulo="Tiempos de descarga y esperas en obra"
        descripcion={`${ambito.etiqueta} · del ${fechaCorta(rango.desde.getTime())} al ${fechaCorta(
          new Date(rango.hasta.getTime() - 86400000).getTime(),
        )}`}
      />
      <ReportesTabs activo="/reportes/descargas" roles={alcance.roles} />

      <Card className="mb-5 p-4">
        <FiltrosDescargas
          desde={rango.desdeISO}
          hasta={rango.hastaISO}
          planteles={ambito.planteles}
          zonas={ambito.zonas}
          zonaActual={ambito.zona}
          plantelActual={ambito.plantel}
          clientes={r.clientes}
          clienteActual={clienteActual}
        />
      </Card>

      {/* ── Cobertura de datos (B6): se dice SIEMPRE sobre cuántos viajes se midió ── */}
      <Card className="mb-5 p-4">
        <p className="text-sm text-ink">
          <strong>{res.viajesMedidos}</strong> de <strong>{res.viajes}</strong> viajes
          tienen los datos completos ({res.coberturaPct}%).
          {res.viajesIncompletos > 0 && (
            <span className="text-muted">
              {" "}
              {res.viajesIncompletos === 1 ? (
                <>
                  Al viaje restante le falta algún registro de hora y{" "}
                  <strong className="text-ink">no entra a los promedios</strong>
                </>
              ) : (
                <>
                  A los {res.viajesIncompletos} restantes les falta algún registro de hora y{" "}
                  <strong className="text-ink">no entran a los promedios</strong>
                </>
              )}{" "}
              (se marcan con un triángulo en la tabla). No se cuentan como cero.
            </span>
          )}
        </p>
        {res.coberturaPct < 60 && res.viajes > 0 && (
          <p className="mt-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink">
            Con este nivel de captura los promedios describen menos de dos tercios de la
            operación: conviene leerlos como una señal, no como una medición cerrada.
          </p>
        )}
      </Card>

      {/* ── Resumen del periodo ── */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted">Descarga real vs. programada</div>
          <div className="mt-1 text-2xl font-bold text-ink">
            {n1(res.realProm)}{" "}
            <span className="text-sm font-normal text-muted">
              / {n1(res.programadaProm)} min
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">promedio de los viajes medidos</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Excedieron lo programado</div>
          <div
            className={`mt-1 text-2xl font-bold ${
              (res.excedieronPct ?? 0) > 25 ? "text-danger" : "text-ink"
            }`}
          >
            {res.excedieron}
            {res.excedieronPct != null && (
              <span className="text-sm font-normal text-muted"> ({res.excedieronPct}%)</span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted">
            {res.minutosExcedidos.toFixed(0)} min de más en total
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Mayor desviación acumulada</div>
          <div className="mt-1 truncate text-lg font-bold text-ink" title={res.peorCliente?.cliente}>
            {res.peorCliente?.cliente ?? "—"}
          </div>
          <div className="mt-1 text-xs text-muted">
            {res.peorCliente ? `${res.peorCliente.minutos.toFixed(0)} min de más` : "nadie excedió"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Espera en obra</div>
          <div className="mt-1 text-2xl font-bold text-ink">{n1(res.esperaProm)} min</div>
          <div className="mt-1 text-xs text-muted">
            promedio · {res.esperasSobreUmbral} viajes sobre {umbrales.esperaMin} min
          </div>
        </Card>
      </div>

      {/* ── B4: horas-mixer perdidas en espera, con su equivalencia ── */}
      <Card className="mb-5 p-5">
        <h2 className="mb-1 text-base font-semibold text-ink">
          Capacidad de flota consumida en esperas
        </h2>
        <p className="mb-3 text-sm text-muted">
          El mixer parado en obra, cargado, sin poder descargar. No agrega valor para nadie
          y alarga el ciclo: con la flota compartida de Santa Marta y Tegucigalpa, cada
          minuto de espera es menos disponibilidad para los planteles que dependen de ese
          préstamo. Además el concreto sigue envejeciendo dentro del tambor.
        </p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <span className="text-2xl font-bold text-ink">
              {res.horasMixerEspera.toFixed(1)}
            </span>{" "}
            <span className="text-sm text-muted">horas-mixer en espera</span>
          </div>
          {res.viajesEquivalentes != null && res.cicloPromMin != null ? (
            <div className="text-sm text-ink">
              {res.viajesEquivalentes === 0 ? (
                <>
                  <strong>menos de un viaje</strong>{" "}
                  <span className="text-muted">
                    equivalente, al ciclo promedio del periodo (
                    {res.cicloPromMin.toFixed(0)} min)
                  </span>
                </>
              ) : (
                <>
                  ≈{" "}
                  <strong>
                    {res.viajesEquivalentes} {res.viajesEquivalentes === 1 ? "viaje" : "viajes"}
                  </strong>{" "}
                  <span className="text-muted">
                    que no se pudieron hacer, al ciclo promedio del periodo (
                    {res.cicloPromMin.toFixed(0)} min)
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted">
              Sin ciclos completos medidos en el periodo no se puede traducir a viajes
              equivalentes.
            </div>
          )}
          <div className="text-xs text-muted">
            medido sobre {res.viajesConEspera} viajes con llegada e inicio de descarga
          </div>
        </div>
      </Card>

      {/* ── Resumen por cliente ── */}
      <Card className="mb-5 p-5">
        <h2 className="mb-1 text-base font-semibold text-ink">Resumen por cliente</h2>
        <p className="mb-3 text-sm text-muted">
          Ordenado por minutos excedidos: arriba quedan los proyectos que más capacidad de
          flota están consumiendo de más.
        </p>
        {r.porCliente.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Sin viajes en este periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-2 py-2">Cliente / proyecto</th>
                  <th className="px-2 py-2 text-right">Viajes</th>
                  <th className="px-2 py-2 text-right" title="Viajes con datos completos">
                    Medidos
                  </th>
                  <th className="px-2 py-2 text-right">Prog. prom.</th>
                  <th className="px-2 py-2 text-right">Real prom.</th>
                  <th className="px-2 py-2 text-right">Desv. prom.</th>
                  <th className="px-2 py-2 text-right">Fuera de prog.</th>
                  <th className="px-2 py-2 text-right">Min. excedidos</th>
                  <th className="px-2 py-2 text-right">Espera prom.</th>
                  <th className="px-2 py-2 text-right">Espera máx.</th>
                  <th className="px-2 py-2 text-right">Espera total</th>
                  <th className="px-2 py-2 text-right" title={`Esperas de ${umbrales.esperaMin} min o más`}>
                    {">"}
                    {umbrales.esperaMin} min
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.porCliente.map((c) => (
                  <tr key={c.clienteId} className="border-b border-border/60">
                    <td className="px-2 py-1.5 text-ink">
                      {c.cliente}
                      {c.proyecto && <span className="text-muted"> · {c.proyecto}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">{c.viajes}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {c.viajesMedidos}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {n1(c.programadaProm)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {n1(c.realProm)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        (c.desviacionProm ?? 0) > 0 ? "text-danger" : "text-ok"
                      }`}
                    >
                      {c.desviacionProm == null
                        ? "—"
                        : `${c.desviacionProm > 0 ? "+" : ""}${c.desviacionProm}`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {c.fueraDeProgramado}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink">
                      {c.minutosExcedidos.toFixed(0)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {n1(c.esperaProm)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {n1(c.esperaMax)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {c.esperaTotalMin.toFixed(0)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        c.esperasSobreUmbral > 0 ? "font-semibold text-danger" : "text-muted"
                      }`}
                    >
                      {c.esperasSobreUmbral}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── B5: cumplimiento del intervalo entre camiones ── */}
      <Card className="mb-5 p-5">
        <h2 className="mb-1 text-base font-semibold text-ink">
          Cumplimiento del intervalo entre camiones
        </h2>
        <p className="mb-3 text-sm text-muted">
          Solo pedidos con más de una llegada registrada. La cifra que importa es la{" "}
          <strong className="text-ink">variabilidad</strong> (el rango entre el hueco más
          corto y el más largo): un promedio de 15 min con llegadas de 5, 25, 8 y 22 obliga
          a la cuadrilla a esperar o genera cola de mixers, y eso es peor que un promedio de
          18 min constante. Se marcan los pedidos con variabilidad de{" "}
          {umbrales.variabilidadMin} min o más.
        </p>
        {r.intervalos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Ningún pedido del periodo tiene dos o más llegadas registradas.
          </p>
        ) : (
          <>
            {irregulares.length > 0 && (
              <p className="mb-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink">
                <strong>{irregulares.length}</strong> de {r.intervalos.length} pedidos
                llegaron a un ritmo irregular.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium text-muted">
                    <th className="px-2 py-2">Fecha</th>
                    <th className="px-2 py-2">Cliente / proyecto</th>
                    <th className="px-2 py-2 text-right">Llegadas</th>
                    <th className="px-2 py-2 text-right">Solicitado</th>
                    <th className="px-2 py-2 text-right">Real prom.</th>
                    <th className="px-2 py-2 text-right">Mín.</th>
                    <th className="px-2 py-2 text-right">Máx.</th>
                    <th className="px-2 py-2 text-right">Variabilidad</th>
                    <th className="px-2 py-2 text-right" title="Desviación estándar de los huecos">
                      σ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.intervalos.map((i) => (
                    <tr key={i.pedidoId} className="border-b border-border/60">
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted">
                        {fechaCorta(i.diaMs)}
                      </td>
                      <td className="px-2 py-1.5 text-ink">
                        {i.cliente}
                        {i.proyecto && <span className="text-muted"> · {i.proyecto}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {i.llegadas}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {i.solicitadoMin ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                        {n1(i.realPromMin)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {n1(i.minMin)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {n1(i.maxMin)}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right tabular-nums ${
                          i.irregular ? "font-semibold text-danger" : "text-ok"
                        }`}
                      >
                        {n1(i.variabilidadMin)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {n1(i.desviacionEstandarMin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* ── Detalle por viaje ── */}
      <Card className="p-5">
        <h2 className="mb-1 text-base font-semibold text-ink">Detalle por viaje</h2>
        <p className="mb-3 text-sm text-muted">
          Toca cualquier encabezado para ordenar. El semáforo de la desviación es verde
          dentro de lo programado, ámbar hasta +{Math.round(umbrales.toleranciaPct * 100)}% y
          rojo por encima.
        </p>
        <TablaDescargas filas={filas} />
      </Card>
    </>
  );
}
