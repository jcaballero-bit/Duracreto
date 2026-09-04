// Desempeño de los laboratoristas: llenado de la información y finalización del
// control de calidad de cada cliente.
//
// Solo para el Gerente de Control de Calidad y el Jefe de Laboratorio (y el
// Administrador). El Laboratorista NO entra: es una evaluación de su trabajo, y quién
// la ve es una decisión de la organización, no del sistema.
//
// El cálculo vive en `lib/calidad/desempeno.ts` (puro) + `desempeno-datos.ts` (la
// consulta); aquí solo se arma la vista.
import { requerirAcceso } from "@/lib/auth/guard";
import { rangoDeParams } from "@/lib/reportes/filtro";
import {
  calcularDesempenoLaboratorio,
  pendientesDeFinalizar,
} from "@/lib/calidad/desempeno-datos";
import { CORTES_CALIFICACION, PESOS, tonoPct } from "@/lib/calidad/desempeno";
import { Card, PageHeader } from "../../components/ui";
import { CalidadTabs } from "../../components/calidad-tabs";
import { FiltrosDesempeno } from "./filtros";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
const fecha = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const p1 = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const TONO: Record<string, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  neutro: "text-muted",
};

export default async function DesempenoLaboratoristasPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const alcance = await requerirAcceso("/calidad/desempeno");
  const sp = (await searchParams) ?? {};
  const rango = rangoDeParams(sp);

  // El Jefe de Laboratorio está limitado a SU zona (la misma regla que `/laboratorio`);
  // el Gerente de Control de Calidad y el Admin ven las dos.
  const zona =
    alcance.esAdmin || alcance.esGerenteControlCalidad ? null : (alcance.zona ?? null);

  const { filas, resumen } = await calcularDesempenoLaboratorio({
    desde: rango.desde,
    hasta: rango.hasta,
    zona,
  });
  const pendientes = await pendientesDeFinalizar({
    desde: rango.desde,
    hasta: rango.hasta,
    zona,
  });

  const ultimoDia = new Date(rango.hasta.getTime() - 86400000).getTime();

  return (
    <>
      <PageHeader
        titulo="Desempeño de laboratoristas"
        descripcion={`${zona ? `Zona ${zona}` : "Las dos zonas"} · del ${fecha(
          rango.desde.getTime(),
        )} al ${fecha(ultimoDia)}`}
      />
      <CalidadTabs activo="/calidad/desempeno" roles={alcance.roles} />

      <Card className="mb-5 p-4">
        <FiltrosDesempeno desde={rango.desdeISO} hasta={rango.hastaISO} />
      </Card>

      {/* ── Cómo se califica: se dice antes de mostrar la nota ── */}
      <Card className="mb-5 p-4">
        <p className="text-sm text-muted">
          La calificación combina las dos cosas que se le piden al laboratorista:{" "}
          <strong className="text-ink">llenado de la información</strong> (
          {Math.round(PESOS.llenado * 100)}%) y{" "}
          <strong className="text-ink">finalización del control de calidad</strong> (
          {Math.round(PESOS.finalizacion * 100)}%). El llenado se cuenta por lectura, no
          por viaje: un viaje con revenimiento y sin temperatura cuenta como medio. Solo
          entran los viajes que él pudo medir —los que llegaron a obra, o los que
          terminaron de cargar en su planta— y los programas que ya tuvieron despacho, que
          son los que se pueden cerrar. Verde desde {CORTES_CALIFICACION.bueno}%, ámbar
          desde {CORTES_CALIFICACION.aceptable}%.
        </p>
      </Card>

      {/* ── Resumen del equipo ── */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted">Llenado de información</div>
          <div className={`mt-1 text-2xl font-bold ${TONO[tonoPct(resumen.llenadoPct)]}`}>
            {p1(resumen.llenadoPct)}
          </div>
          <div className="mt-1 text-xs text-muted">
            {resumen.lecturasFaltantes} viajes sin ninguna lectura
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Controles finalizados</div>
          <div className={`mt-1 text-2xl font-bold ${TONO[tonoPct(resumen.finalizacionPct)]}`}>
            {p1(resumen.finalizacionPct)}
          </div>
          <div className="mt-1 text-xs text-muted">
            {resumen.sinFinalizar} clientes sin cerrar el control
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Oportunidad de la captura</div>
          <div className="mt-1 text-2xl font-bold text-ink">
            {resumen.demoraMedianaMin == null ? "—" : `${resumen.demoraMedianaMin} min`}
          </div>
          <div className="mt-1 text-xs text-muted">
            mediana entre el hecho y el registro
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Laboratoristas</div>
          <div className="mt-1 text-2xl font-bold text-ink">
            {resumen.evaluados}
            <span className="text-sm font-normal text-muted"> de {resumen.laboratoristas}</span>
          </div>
          <div className="mt-1 text-xs text-muted">con trabajo asignado en el periodo</div>
        </Card>
      </div>

      {/* ── Tabla por laboratorista ── */}
      <Card className="mb-5 p-5">
        <h2 className="mb-1 text-base font-semibold text-ink">Calificación por laboratorista</h2>
        <p className="mb-3 text-sm text-muted">
          De menor a mayor calificación: arriba queda lo que hay que atender. Quien no tuvo
          nada asignado en el periodo aparece al final, sin nota — la ausencia de trabajo no
          es un incumplimiento.
        </p>
        {filas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No hay laboratoristas activos{zona ? ` en la zona ${zona}` : ""}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-2 py-2">Laboratorista</th>
                  <th className="px-2 py-2 text-right">Calificación</th>
                  <th className="px-2 py-2 text-right" title="Lecturas capturadas sobre las esperadas">
                    Llenado
                  </th>
                  <th className="px-2 py-2 text-right" title="Viajes con las dos lecturas">
                    Completas
                  </th>
                  <th className="px-2 py-2 text-right" title="Viajes con una sola de las dos">
                    Parciales
                  </th>
                  <th className="px-2 py-2 text-right" title="Viajes medibles sin ninguna lectura">
                    Sin lectura
                  </th>
                  <th className="px-2 py-2 text-right">Finalización</th>
                  <th className="px-2 py-2 text-right" title="Programas con despacho que quedaron sin cerrar">
                    Sin cerrar
                  </th>
                  <th className="px-2 py-2 text-right" title="Programas asignados en el periodo">
                    Programas
                  </th>
                  <th className="px-2 py-2 text-right" title="Días-planta asignado a la salida de una planta">
                    Turnos planta
                  </th>
                  <th className="px-2 py-2 text-right" title="Mediana entre el hecho y el registro de la lectura">
                    Demora
                  </th>
                  <th className="px-2 py-2 text-right" title="Muestras (testigos) que marcó. No es obligatorio.">
                    Muestras
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr
                    key={f.laboratoristaId}
                    className={`border-b border-border/60 ${f.sinAsignaciones ? "opacity-60" : ""}`}
                  >
                    <td className="px-2 py-1.5 text-ink">
                      {f.nombre}
                      {f.zona && <span className="text-muted"> · {f.zona}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {f.sinAsignaciones ? (
                        <span className="text-xs text-muted">sin asignaciones</span>
                      ) : (
                        <span
                          className={`font-bold tabular-nums ${TONO[tonoPct(f.calificacion)]}`}
                        >
                          {f.calificacion == null ? "—" : f.calificacion.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${TONO[tonoPct(f.llenadoPct)]}`}>
                      {p1(f.llenadoPct)}
                      {f.camposEsperados > 0 && (
                        <span className="ml-1 text-[11px] text-muted">
                          ({f.camposCapturados}/{f.camposEsperados})
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {f.lecturasCompletas}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        f.lecturasParciales > 0 ? "text-warn" : "text-muted"
                      }`}
                    >
                      {f.lecturasParciales}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        f.lecturasFaltantes > 0 ? "font-semibold text-danger" : "text-muted"
                      }`}
                    >
                      {f.lecturasFaltantes}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${TONO[tonoPct(f.finalizacionPct)]}`}
                    >
                      {p1(f.finalizacionPct)}
                      {f.programasFinalizables > 0 && (
                        <span className="ml-1 text-[11px] text-muted">
                          ({f.programasFinalizados}/{f.programasFinalizables})
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        f.sinFinalizar > 0 ? "font-semibold text-danger" : "text-muted"
                      }`}
                    >
                      {f.sinFinalizar}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {f.programasAsignados}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {f.turnosPlanta}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {f.demoraMedianaMin == null ? "—" : `${f.demoraMedianaMin} min`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                      {f.muestras}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Lo accionable: qué cliente quedó sin cerrar ── */}
      <Card className="p-5">
        <h2 className="mb-1 text-base font-semibold text-ink">
          Controles sin finalizar{" "}
          <span className="font-normal text-muted">({pendientes.length})</span>
        </h2>
        <p className="mb-3 text-sm text-muted">
          Programas que ya despacharon concreto y siguen sin el formulario general cerrado:
          mientras falte, el reporte de calidad de ese cliente no se puede emitir.
        </p>
        {pendientes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Todos los controles del periodo están cerrados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">Cliente / proyecto</th>
                  <th className="px-2 py-2">Plantel</th>
                  <th className="px-2 py-2">Laboratorista(s)</th>
                  <th className="px-2 py-2 text-right">Viajes despachados</th>
                  <th className="px-2 py-2 text-right" title="Viajes que llegaron y les falta alguna lectura">
                    Sin lectura completa
                  </th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((p) => (
                  <tr key={p.pedidoId} className="border-b border-border/60">
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted">
                      {fecha(p.diaMs)}
                    </td>
                    <td className="px-2 py-1.5 text-ink">
                      {p.cliente}
                      {p.proyecto && <span className="text-muted"> · {p.proyecto}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-muted">{p.plantel}</td>
                    <td className="px-2 py-1.5 text-ink">{p.laboratoristas.join(", ")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {p.viajesDespachados}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        p.viajesSinLectura > 0 ? "font-semibold text-warn" : "text-muted"
                      }`}
                    >
                      {p.viajesSinLectura}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
