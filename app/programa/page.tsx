import { prisma } from "@/lib/prisma";
import type { Alcance } from "@/lib/auth/acceso";
import { requerirAcceso } from "@/lib/auth/guard";
import { ZONAS } from "@/lib/auth/roles";
import { textoResistencia } from "@/lib/formato";
import { compararPlanteles } from "@/lib/planteles-orden";
import { ProgramaControles } from "./programa-controles";

export const dynamic = "force-dynamic";

// Datos fijos del encabezado ISO (documento controlado).
const DOC = {
  codigo: "DPCR-08",
  titulo: "PROGRAMA DE ENTREGA DE CONCRETO",
  elaboradoPor: "Jefe de Producción de Concreto",
  aprobadoPor: "Gestor de Calidad",
  edicion: "01",
  fechaEdicion: "1 Junio 2016",
};

// Paleta ejecutiva (sobria) para diferenciar las bombas: franja + etiqueta.
const PALETA_BOMBA = ["#1F4E79", "#2F6F4E", "#B0730D", "#5B4B8A", "#1C6E7D", "#8A3B3B"];

/**
 * Zonas cuyo Programa DPCR-08 puede ver el usuario (enforcement server-side).
 * Admin: ambas. Programador/Despachador/Laboratorista: su `zona` directa.
 * Dosificador: la zona de su plantel asignado (derivada de planteles.zona, sin
 * duplicar el dato en el usuario).
 */
async function zonasParaPrograma(alcance: Alcance): Promise<string[]> {
  if (alcance.esAdmin) return [...ZONAS];
  const zonas = new Set<string>();
  if (alcance.zona) zonas.add(alcance.zona);
  if (alcance.plantelAsignadoId != null) {
    const pl = await prisma.planteles.findUnique({
      where: { id: alcance.plantelAsignadoId },
      select: { zona: true },
    });
    if (pl) zonas.add(pl.zona);
  }
  return [...zonas];
}

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

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 8mm; }
  html, body { background: #fff !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body * { visibility: hidden; }
  .programa-doc, .programa-doc * { visibility: visible; }
  .programa-doc { position: absolute; left: 0; top: 0; width: 100%; font-size: 10px; }
  .no-print { display: none !important; }
  /* En vertical las tablas deben ajustarse al ancho de la página (no forzar min-width). */
  .programa-doc table { min-width: 0 !important; width: 100% !important; }
  .programa-doc .overflow-x-auto { overflow: visible !important; }
  .plantel-tabla { break-inside: auto; }
  tr { break-inside: avoid; }
}
.programa-doc { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

export default async function ProgramaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; zona?: string }>;
}) {
  const alcance = await requerirAcceso("/programa");
  const sp = await searchParams;

  // Zonas que el usuario puede ver (server-side, no solo la UI). El Programa es un
  // documento POR ZONA: Admin ve ambas; Programador/Despachador/Laboratorista por
  // su zona directa; Dosificador por la zona de su plantel asignado.
  const zonasPermitidas = await zonasParaPrograma(alcance);
  const fecha = sp.fecha ?? ymd(new Date());

  if (zonasPermitidas.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-muted">
          No tienes una zona asignada para ver el Programa DPCR-08. Pide al
          administrador que te asigne una zona (o un plantel, si eres Dosificador).
        </p>
      </div>
    );
  }

  const zonaPedida = sp.zona && zonasPermitidas.includes(sp.zona) ? sp.zona : null;
  const zona = zonaPedida ?? zonasPermitidas[0];

  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  const [planteles, pedidos] = await Promise.all([
    prisma.planteles.findMany({
      where: { zona },
      include: { plantas: { select: { id: true } } },
    }),
    prisma.pedidos.findMany({
      where: {
        hora_solicitada: { gte: ini, lt: fin },
        estado_pedido: "Activo", // el programa no incluye pedidos cancelados
        plantel: { zona },
      },
      include: {
        cliente: { include: { asesor: { select: { nombre: true } } } },
        diseno: true,
        planta: { select: { nombre: true } },
        bomba: { select: { identificador: true } },
        viajes: {
          include: {
            mixer: { select: { identificador: true } },
            operador: { select: { nombre: true } },
          },
          orderBy: { hora_inicio_carga: "asc" },
        },
      },
      orderBy: [{ orden_dia: "asc" }, { hora_solicitada: "asc" }],
    }),
  ]);

  const plantelesOrd = [...planteles].sort((a, b) => compararPlanteles(a.nombre, b.nombre));

  // Color por bomba (una tonalidad por bomba en toda la zona/día).
  const colorBomba = new Map<number, string>();
  for (const p of pedidos) {
    if (p.bomba_id != null && !colorBomba.has(p.bomba_id)) {
      colorBomba.set(p.bomba_id, PALETA_BOMBA[colorBomba.size % PALETA_BOMBA.length]);
    }
  }

  const totalZona = pedidos.reduce((s, p) => s + p.volumen_total_m3, 0);

  const th = "border border-slate-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700";
  const td = "border border-slate-300 px-2 py-1 align-middle text-[11px] text-slate-800";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <ProgramaControles fecha={fecha} zona={zona} zonas={zonasPermitidas} />

      <div className="programa-doc mx-auto max-w-[1120px] bg-white p-4 text-slate-900">
        {/* ── Encabezado ISO ─────────────────────────────────────────────── */}
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <td className="w-[220px] border border-slate-400 p-2 align-middle" rowSpan={2}>
                {/* Logo ORIGINAL de la empresa. Deja el archivo en public/logo-duracreto.png. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-duracreto.png" alt="DURACRETO" className="mx-auto h-16 w-auto" />
              </td>
              <td className="border border-slate-400 p-2 text-center align-middle">
                <div className="text-lg font-bold tracking-wide text-slate-900">{DOC.titulo}</div>
              </td>
              <td className="w-[150px] border border-slate-400 p-2 text-center align-middle">
                <div className="text-[11px] text-slate-600">Código:</div>
                <div className="text-base font-bold text-slate-900">{DOC.codigo}</div>
              </td>
            </tr>
            <tr>
              <td className="border border-slate-400 p-2 text-[11px] text-slate-700">
                <div>
                  <span className="font-semibold">Elaborado por:</span> {DOC.elaboradoPor}
                </div>
                <div>
                  <span className="font-semibold">Aprobado por:</span> {DOC.aprobadoPor}
                </div>
              </td>
              <td className="border border-slate-400 p-2 text-right text-[11px] text-slate-700">
                <div>Edición: {DOC.edicion}</div>
                <div>Fecha: {DOC.fechaEdicion}</div>
                <div className="mt-1 italic">Página 1 de 1</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Franja de fecha + zona ─────────────────────────────────────── */}
        <div className="mt-3 flex items-center justify-between rounded-sm bg-slate-800 px-3 py-1.5 text-white">
          <span className="text-sm font-semibold capitalize">{fechaLarga(fecha)}</span>
          <span className="text-sm font-semibold uppercase tracking-wide">Zona {zona}</span>
          <span className="text-xs">Probabilidad de lluvia: ______ %</span>
        </div>

        {/* ── Leyenda de bombas ──────────────────────────────────────────── */}
        {colorBomba.size > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-700">
            <span className="font-semibold">Bombas:</span>
            {[...colorBomba.entries()].map(([id, color]) => {
              const b = pedidos.find((p) => p.bomba_id === id)?.bomba;
              return (
                <span key={id} className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
                  {b?.identificador ?? `#${id}`}
                </span>
              );
            })}
            <span className="text-slate-400">· descarga directa sin marca</span>
          </div>
        )}

        {/* ── Una tabla por plantel de la zona ───────────────────────────── */}
        <div className="mt-3 space-y-5 overflow-x-auto">
          {plantelesOrd.map((pl) => {
            const suyos = pedidos.filter((p) => p.plantel_id === pl.id);
            const totalPl = suyos.reduce((s, p) => s + p.volumen_total_m3, 0);
            // La planta solo se indica en planteles con 2+ plantas (para saber
            // dónde cargar); en los de una sola planta no aporta.
            const mostrarPlanta = pl.plantas.length >= 2;
            return (
              <div key={pl.id} className="plantel-tabla">
                <div className="rounded-t-sm bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-800">
                  {pl.nombre}
                </div>
                <table className="w-full min-w-[1000px] border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className={`${th} text-left`}>Cliente</th>
                      <th className={th}>Viaje</th>
                      <th className={`${th} text-left`}>Motorista</th>
                      <th className={th}>Mixer</th>
                      <th className={th}>Carga</th>
                      <th className={th}>Llegada</th>
                      <th className={th}>Finaliza</th>
                      <th className={th}>Regreso</th>
                      <th className={`${th} text-left`}>Tipo de concreto</th>
                      <th className={th}>Vol. m³</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suyos.length === 0 ? (
                      <tr>
                        <td className={`${td} text-center text-slate-400`} colSpan={10}>
                          Sin pedidos programados.
                        </td>
                      </tr>
                    ) : (
                      // Orden ASCENDENTE por hora de llegada a obra del primer viaje
                      // (sin agrupar por planta). Línea en blanco entre cliente y cliente.
                      [...suyos]
                        .sort((a, b) => primeraLlegadaMs(a) - primeraLlegadaMs(b))
                        .flatMap((p, idx, arr) => {
                          const filas = renderPedido(p, colorBomba, td, mostrarPlanta);
                          if (idx < arr.length - 1) {
                            filas.push(
                              <tr key={`sep-${p.id}`}>
                                <td colSpan={10} className="h-3" />
                              </tr>,
                            );
                          }
                          return filas;
                        })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-bold text-slate-800">
                      <td className="border border-slate-400 px-2 py-1 text-right text-[11px]" colSpan={9}>
                        Total {pl.nombre}
                      </td>
                      <td className="border border-slate-400 px-2 py-1 text-center text-[11px]">
                        {totalPl.toFixed(2)} m³
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })}
        </div>

        {/* ── Total de la zona ───────────────────────────────────────────── */}
        <div className="mt-4 flex justify-end">
          <div className="rounded-sm bg-slate-800 px-4 py-2 text-sm font-bold text-white">
            Total Zona {zona}: {totalZona.toFixed(2)} m³
          </div>
        </div>
      </div>
    </>
  );
}

// Pedido con sus relaciones (include). Firma laxa para no repetir el tipo Prisma.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PedidoDoc = any;

/** Hora de llegada del PRIMER viaje del pedido (la más temprana), en ms. */
function primeraLlegadaMs(p: PedidoDoc): number {
  const llegadas = p.viajes
    .filter((v: { mixer_id: number | null; hora_llegada_proyecto: Date | null }) =>
      v.mixer_id != null && v.hora_llegada_proyecto != null,
    )
    .map((v: { hora_llegada_proyecto: Date }) => v.hora_llegada_proyecto.getTime());
  return llegadas.length ? Math.min(...llegadas) : 0;
}

// ── Render de un pedido (bloque de filas: una por viaje) ──────────────────────
function renderPedido(
  p: PedidoDoc,
  colorBomba: Map<number, string>,
  td: string,
  mostrarPlanta: boolean,
) {
  const trips = p.viajes.filter((v: { mixer_id: number | null }) => v.mixer_id != null);
  const filas = trips.length > 0 ? trips : [null];
  const color = p.bomba_id != null ? colorBomba.get(p.bomba_id) : undefined;

  const codigoDescarga = p.tipo_descarga === "Canal directo" ? "C/C" : "C/B";
  const resistencia = `${textoResistencia(p.diseno)} ${p.diseno.tamano_agregado ?? ""} ${codigoDescarga}`.trim();
  const hielo = p.sacos_hielo_por_m3 > 0 ? `Temp: ${p.sacos_hielo_por_m3} sacos/m³` : "Sin control temp.";

  const cliente = (
    <>
      <div className="font-semibold">{p.cliente.empresa}</div>
      {p.cliente.proyecto && <div className="text-slate-600">{p.cliente.proyecto}</div>}
      {p.elemento && (
        <div className="text-[10px] text-slate-600">Elemento: {p.elemento}</div>
      )}
      {mostrarPlanta && (
        <div className="mt-1 inline-block rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
          Planta: {p.planta?.nombre ?? "—"}
        </div>
      )}
      {p.cliente.asesor?.nombre && (
        <div className="mt-0.5 text-[10px] text-slate-500">{p.cliente.asesor.nombre}</div>
      )}
    </>
  );

  const tipo = (
    <>
      <div className="font-bold">{resistencia}</div>
      <div>{hielo}</div>
      {p.diseno.revenimiento && <div>Rev: {p.diseno.revenimiento}</div>}
      <div className="font-semibold">Total: {p.volumen_total_m3.toFixed(2)} m³</div>
      {color && (
        <span
          className="mt-1 inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-white"
          style={{ background: color }}
        >
          Bomba {p.bomba?.identificador ?? ""}
        </span>
      )}
    </>
  );

  // Franja izquierda de color en la celda del cliente (diferencia la bomba).
  const franja = color ? { borderLeft: `4px solid ${color}` } : undefined;

  return filas.map((v: unknown, i: number) => {
    const viaje = v as null | {
      volumen_asignado_m3: number;
      operador: { nombre: string } | null;
      mixer: { identificador: string | null } | null;
      hora_inicio_carga: Date | null;
      hora_llegada_proyecto: Date | null;
      hora_fin_descarga: Date | null;
      hora_regreso_planta: Date | null;
    };
    return (
      <tr key={`${p.id}-${i}`}>
        {i === 0 && (
          <td className={td} rowSpan={filas.length} style={franja}>
            {cliente}
          </td>
        )}
        <td className={`${td} text-center`}>{viaje ? i + 1 : "—"}</td>
        <td className={td}>{viaje?.operador?.nombre ?? "—"}</td>
        <td className={`${td} text-center`}>{viaje?.mixer?.identificador ?? "—"}</td>
        <td className={`${td} text-center whitespace-nowrap`}>{hhmm(viaje?.hora_inicio_carga ?? null)}</td>
        <td className={`${td} text-center whitespace-nowrap font-semibold`}>
          {hhmm(viaje?.hora_llegada_proyecto ?? null)}
        </td>
        <td className={`${td} text-center whitespace-nowrap`}>{hhmm(viaje?.hora_fin_descarga ?? null)}</td>
        <td className={`${td} text-center whitespace-nowrap`}>{hhmm(viaje?.hora_regreso_planta ?? null)}</td>
        {i === 0 && (
          <td className={`${td} text-center`} rowSpan={filas.length}>
            {tipo}
          </td>
        )}
        <td className={`${td} text-center whitespace-nowrap`}>
          {viaje ? `${viaje.volumen_asignado_m3.toFixed(2)} m³` : "—"}
        </td>
      </tr>
    );
  });
}
