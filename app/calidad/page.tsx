import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requerirAcceso } from "@/lib/auth/guard";
import { textoTemperatura } from "@/lib/calidad/config";
import { formatearRevenimiento } from "@/lib/calidad/fraccion";
import {
  dosificadoresPorPlanta,
  laboratoristasPorPlanta,
  textoMuestraViaje,
  ubicacionDeMuestras,
} from "@/lib/calidad/asignados";
import { volumenDespachadoDe } from "@/lib/calidad/volumen";
import { textoResistencia } from "@/lib/formato";
import { PageHeader } from "../components/ui";
import { CalidadFiltros } from "./calidad-filtros";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function hhmm(d: Date | null): string {
  if (!d) return "—";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suf = h < 12 ? "a.m." : "p.m.";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suf}`;
}
function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
const siNo = (b: boolean) => (b ? "Sí" : "No");

const PRINT_CSS = `
@media print {
  /* HORIZONTAL: la tabla lleva 10 columnas (mixer, tiempos, muestra, planta…) y en
     vertical se aprieta. */
  @page { size: A4 landscape; margin: 8mm; }
  html, body { background: #fff !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body * { visibility: hidden; }
  .calidad-doc, .calidad-doc * { visibility: visible; }
  .calidad-doc { position: absolute; left: 0; top: 0; width: 100%; font-size: 10px; }
  .no-print { display: none !important; }
  .calidad-pedido { break-inside: avoid; }
}
.calidad-doc { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

export default async function CalidadPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; fecha?: string }>;
}) {
  const alcance = await requerirAcceso("/calidad");
  const sesion = await auth();
  const userId = sesion?.user?.id ?? "";

  const sp = await searchParams;
  const fecha = sp.fecha ?? ymd(new Date());
  const clienteSel = sp.cliente ? Number(sp.cliente) : null;
  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  // Alcance de pedidos: Laboratorista → solo SUS programas asignados; JefeLaboratorio
  // → su zona; Admin / Gerente de Control de Calidad → todos.
  let scopePedido: Record<string, unknown> = {};
  if (alcance.esLaboratorista && !alcance.esAdmin && !alcance.esGerenteControlCalidad) {
    scopePedido = { asignaciones_lab: { some: { laboratorista_id: userId } } };
  } else if (alcance.esJefeLaboratorio && !alcance.esAdmin && !alcance.esGerenteControlCalidad) {
    scopePedido = { plantel: { zona: alcance.zona ?? "" } };
  }

  const pedidos = await prisma.pedidos.findMany({
    where: {
      hora_solicitada: { gte: ini, lt: fin },
      estado_pedido: "Activo",
      AND: [scopePedido, clienteSel ? { cliente_id: clienteSel } : {}],
    },
    orderBy: [{ cliente_id: "asc" }, { orden_dia: "asc" }],
    include: {
      cliente: { select: { empresa: true, proyecto: true } },
      diseno: true,
      plantel: { select: { nombre: true } },
      asignaciones_lab: { include: { laboratorista: { select: { name: true, email: true } } } },
      control_calidad_general: {
        include: { laboratorista: { select: { name: true, email: true } } },
      },
      viajes: {
        where: { mixer_id: { not: null } },
        orderBy: [{ hora_inicio_carga: "asc" }, { id: "asc" }],
        include: {
          mixer: { select: { identificador: true, id: true } },
          planta: { select: { id: true, nombre: true } },
          control_calidad: true,
        },
      },
    },
  });

  // Opciones del selector de cliente = clientes con programa ese día en el alcance.
  // (Se consulta aparte, sin el filtro de cliente, para poblar el desplegable.)
  const paraDropdown = clienteSel
    ? await prisma.pedidos.findMany({
        where: { hora_solicitada: { gte: ini, lt: fin }, estado_pedido: "Activo", AND: [scopePedido] },
        select: { cliente_id: true, cliente: { select: { empresa: true } } },
      })
    : pedidos.map((p) => ({ cliente_id: p.cliente_id, cliente: { empresa: p.cliente.empresa } }));
  const clientesMap = new Map<number, string>();
  for (const p of paraDropdown) clientesMap.set(p.cliente_id, p.cliente.empresa);
  const clientes = [...clientesMap.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const pedidosVista = clienteSel ? pedidos : [];
  // Quién dosificó cada planta ese día y quién controló su salida (para el pie del
  // documento). Se consulta una sola vez para toda la fecha.
  const [dosifPorPlanta, labPorPlanta] = pedidosVista.length
    ? await Promise.all([dosificadoresPorPlanta(ini), laboratoristasPorPlanta(ini)])
    : [new Map<number, string[]>(), new Map<number, { nombre: string; observaciones: string }>()];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="no-print">
        <PageHeader
          titulo="Reporte de calidad"
          descripcion="Vista y generación del PDF de control de calidad por cliente y fecha (solo lectura). La CAPTURA de revenimiento, temperatura y preguntas generales se hace en Despacho en vivo. Elige cliente y fecha y toca Descargar PDF."
        />
      </div>

      <CalidadFiltros
        clientes={clientes}
        clienteSel={clienteSel ? String(clienteSel) : ""}
        fecha={fecha}
        puedeImprimir={pedidosVista.length > 0}
      />

      {!clienteSel ? (
        <p className="no-print rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
          Elige un cliente para ver su reporte de control de calidad del día.
        </p>
      ) : pedidosVista.length === 0 ? (
        <p className="no-print rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
          No hay programas de ese cliente en esta fecha (dentro de tu alcance).
        </p>
      ) : (
        <>

          {/* Documento formal (esto es lo que se imprime a PDF) */}
          <div className="calidad-doc rounded-lg border border-border bg-white p-6 text-ink">
            <div className="mb-4 flex items-center gap-4 border-b border-slate-300 pb-4">
              {/* Logo ORIGINAL de la empresa (public/logo-duracreto.png). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-duracreto.png" alt="DURACRETO" className="h-14 w-auto" />
              <div>
                <h1 className="text-lg font-bold">Reporte de Control de Calidad</h1>
                <p className="text-sm text-slate-600">{fechaLarga(fecha)}</p>
              </div>
            </div>

            {pedidosVista.map((p) => {
              const cg = p.control_calidad_general;
              // "Elaborado por": el que capturó el general, o los laboratoristas
              // asignados (pueden ser varios).
              const labsAsignados = p.asignaciones_lab
                .map((a) => a.laboratorista?.name ?? a.laboratorista?.email)
                .filter((n): n is string => !!n);
              const elaborado =
                cg?.laboratorista?.name ??
                cg?.laboratorista?.email ??
                (labsAsignados.length > 0 ? labsAsignados.join(", ") : "—");
              // m³ del PROGRAMA y m³ DESPACHADOS de planta; el laboratorio puede
              // ajustar los colocados y entonces manda su valor.
              const programados = cg?.m3_programados ?? p.volumen_programado ?? p.volumen_total_m3;
              const colocados = cg?.m3_colocados ?? volumenDespachadoDe(p.viajes);
              // Dónde se tomaron las muestras (lo marcado viaje por viaje); si nadie
              // marcó nada todavía, se cae a la instrucción del jefe de laboratorio.
              const ubicacionMuestras =
                ubicacionDeMuestras(p.viajes) ?? p.muestras_ubicacion ?? "—";
              // Plantas que cargaron este programa (para el pie de responsables).
              const plantasUsadas = [
                ...new Map(
                  p.viajes
                    .filter((v) => v.planta)
                    .map((v) => [v.planta!.id, { id: v.planta!.id, nombre: v.planta!.nombre }]),
                ).values(),
              ].sort((a, b) => a.nombre.localeCompare(b.nombre));
              return (
                <section key={`doc-${p.id}`} className="calidad-pedido mb-6">
                  <div className="mb-2">
                    <div className="text-base font-semibold">
                      {p.cliente.empresa}
                      {p.cliente.proyecto ? ` — ${p.cliente.proyecto}` : ""}
                    </div>
                    <div className="text-xs text-slate-600">
                      Plantel {p.plantel.nombre} · Descarga: {p.tipo_descarga}
                      {p.elemento ? ` · Elemento: ${p.elemento}` : ""} · Concreto:{" "}
                      {`${textoResistencia(p.diseno)}${p.diseno.tamano_agregado ? ` · ${p.diseno.tamano_agregado}` : ""}`}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-300 text-left">
                          <th className="px-2 py-1">Mixer</th>
                          <th className="px-2 py-1">Planta</th>
                          <th className="px-2 py-1">Carga</th>
                          <th className="px-2 py-1">Salida</th>
                          <th className="px-2 py-1">Llegada</th>
                          <th className="px-2 py-1">Inicio descarga</th>
                          <th className="px-2 py-1">Fin descarga</th>
                          <th className="px-2 py-1">Rev. planta</th>
                          <th className="px-2 py-1">Temp. planta</th>
                          <th className="px-2 py-1">Rev. obra</th>
                          <th className="px-2 py-1">Temp. obra</th>
                          <th className="px-2 py-1">Muestra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.viajes.map((v) => (
                          <tr key={v.id} className="border-b border-slate-200">
                            <td className="px-2 py-1 font-medium">{v.mixer?.identificador ?? `#${v.mixer_id}`}</td>
                            <td className="px-2 py-1">{v.planta?.nombre ?? "—"}</td>
                            <td className="px-2 py-1">{hhmm(v.ts_inicio_carga_real)}</td>
                            <td className="px-2 py-1">{hhmm(v.ts_salida_real)}</td>
                            <td className="px-2 py-1">{hhmm(v.ts_llegada_real)}</td>
                            <td className="px-2 py-1">{hhmm(v.ts_inicio_descarga_real)}</td>
                            <td className="px-2 py-1">{hhmm(v.ts_fin_descarga_real)}</td>
                            <td className="px-2 py-1">
                              {formatearRevenimiento(v.control_calidad?.revenimiento_planta)}
                            </td>
                            <td className="px-2 py-1">
                              {textoTemperatura(v.control_calidad?.temperatura_planta)}
                            </td>
                            <td className="px-2 py-1">
                              {formatearRevenimiento(v.control_calidad?.revenimiento_obra)}
                            </td>
                            <td className="px-2 py-1">
                              {textoTemperatura(v.control_calidad?.temperatura_concreto)}
                            </td>
                            <td className="px-2 py-1 font-medium">{textoMuestraViaje(v.control_calidad)}</td>
                          </tr>
                        ))}
                        {p.viajes.length === 0 && (
                          <tr>
                            <td colSpan={12} className="px-2 py-3 text-center text-slate-500">
                              Sin viajes con mixer asignado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Preguntas generales */}
                  <div className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <div>¿Se humedeció el área?: <strong>{siNo(!!cg?.humedecio_area)}</strong></div>
                    <div>¿Se vibró el concreto?: <strong>{siNo(!!cg?.vibro_concreto)}</strong></div>
                    <div>¿Se usó curador?: <strong>{siNo(!!cg?.uso_curador)}</strong></div>
                    <div>
                      ¿Se aplicó aditivo?: <strong>{siNo(!!cg?.aplico_aditivo)}</strong>
                      {cg?.aplico_aditivo && cg.aditivo_unidades ? ` (${cg.aditivo_unidades})` : ""}
                    </div>
                    <div>
                      m³ programados: <strong>{programados.toFixed(2)}</strong>{" "}
                      <span className="text-slate-500">(del programa)</span>
                    </div>
                    <div>
                      m³ colocados: <strong>{colocados.toFixed(2)}</strong>{" "}
                      <span className="text-slate-500">
                        {cg?.m3_colocados != null ? "(ajustado por laboratorio)" : "(despachado de planta)"}
                      </span>
                    </div>
                    <div className="sm:col-span-2">
                      Ubicación del muestreo: <strong>{ubicacionMuestras}</strong>
                    </div>
                    <div className="sm:col-span-2">
                      ¿Existe reclamo?: <strong>{siNo(!!cg?.existe_reclamo)}</strong>
                      {cg?.existe_reclamo && cg.detalle_reclamo ? ` — ${cg.detalle_reclamo}` : ""}
                    </div>
                    {cg?.observaciones && (
                      <div className="sm:col-span-2">Observaciones: {cg.observaciones}</div>
                    )}
                  </div>

                  {/* Responsables: quién dosificó y quién controló en cada planta que
                      cargó este programa, y quién estuvo en la obra. */}
                  <div className="mt-3 grid gap-x-6 gap-y-1 border-t border-slate-200 pt-2 text-xs sm:grid-cols-2">
                    {plantasUsadas.map((pl) => (
                      <div key={pl.id}>
                        <strong>Planta {pl.nombre}</strong> — Dosificó:{" "}
                        {dosifPorPlanta.get(pl.id)?.join(", ") ?? "—"} · Laboratorista en planta:{" "}
                        {labPorPlanta.get(pl.id)?.nombre ?? "—"}
                      </div>
                    ))}
                    <div className="sm:col-span-2">
                      Laboratorista en obra (proyecto):{" "}
                      <strong>{labsAsignados.length ? labsAsignados.join(", ") : "—"}</strong>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-slate-600">
                    Elaborado por: <strong>{elaborado}</strong> · Generado el{" "}
                    {new Date().toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
