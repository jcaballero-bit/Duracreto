import { Factory } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { calcularDesempeno, clientesAtendidos } from "@/lib/comercial/metricas";
import { colorPorAsesor } from "@/lib/color-asesor";
import { Card } from "../components/ui";
import { Saludo } from "../saludo";
import { FiltrosComercial } from "./filtros-comercial";
import { TablaDesempeno } from "./tabla-desempeno";
import { MapaFiltroAsesor } from "./mapa-controles";
import { MapaLeaflet, type PuntoMapa } from "../components/mapa-leaflet";

export const dynamic = "force-dynamic";

/** Escapa texto para insertarlo con seguridad en el HTML del popup del mapa. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fechaCortaMs(ms: number): string {
  return new Date(ms).toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

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
  searchParams: Promise<{ periodo?: string; zona?: string; mapAsesor?: string }>;
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

  // ── Mapa de cobertura ────────────────────────────────────────────────────
  const mapAsesorId = /^\d+$/.test(sp.mapAsesor ?? "") ? Number(sp.mapAsesor) : null;
  const [cobertura, asesoresLista, plantelesUbicados] = await Promise.all([
    clientesAtendidos({
      anio,
      mes,
      zona: zona === "todas" ? null : zona,
      asesorId: mapAsesorId,
    }),
    prisma.asesores.findMany({ orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
    prisma.planteles.findMany({
      where: {
        latitud: { not: null },
        longitud: { not: null },
        ...(zona !== "todas" ? { zona } : {}),
      },
      select: { id: true, nombre: true, zona: true, latitud: true, longitud: true },
      orderBy: { nombre: "asc" },
    }),
  ]);

  // Puntos del mapa (color determinista por asesor + popup con el detalle).
  const puntos: PuntoMapa[] = cobertura.clientes.map((c) => {
    const color = colorPorAsesor(c.asesorId);
    const proyecto = c.proyecto
      ? `<div style="color:#2563eb;font-size:12px">${esc(c.proyecto)}</div>`
      : "";
    const popupHtml =
      `<div style="min-width:190px;line-height:1.35">` +
      `<div style="font-weight:600;color:#0f172a">${esc(c.empresa)}</div>` +
      proyecto +
      `<div style="margin-top:5px;font-size:12px">Asesor: <b>${esc(c.asesorNombre)}</b></div>` +
      `<div style="font-size:12px">m³ suministrados: <b>${c.m3.toFixed(1)}</b></div>` +
      `<div style="font-size:12px">Pedidos completados: <b>${c.pedidosCompletados}</b></div>` +
      `<div style="font-size:12px">Último suministro: <b>${fechaCortaMs(c.ultimoSuministroMs)}</b></div>` +
      `</div>`;
    return { id: c.clienteId, lat: c.lat, lng: c.lng, color, popupHtml };
  });

  // Planteles con ubicación → marcador cuadrado (color navy fijo).
  const PLANTEL_COLOR = "#1e293b";
  const puntosPlanteles: PuntoMapa[] = plantelesUbicados
    .filter((p) => p.latitud != null && p.longitud != null)
    .map((p) => ({
      id: `plantel-${p.id}`,
      lat: p.latitud as number,
      lng: p.longitud as number,
      color: PLANTEL_COLOR,
      forma: "planta" as const,
      popupHtml:
        `<div style="min-width:150px;line-height:1.35">` +
        `<div style="font-weight:600;color:#0f172a">Plantel: ${esc(p.nombre)}</div>` +
        `<div style="font-size:12px">Zona: <b>${esc(p.zona)}</b></div>` +
        `</div>`,
    }));
  const puntosMapa = [...puntos, ...puntosPlanteles];

  // Leyenda: asesores presentes en el mapa filtrado (con su color fijo).
  const leyenda = [...new Map(
    cobertura.clientes.map((c) => [c.asesorId ?? -1, { nombre: c.asesorNombre, color: colorPorAsesor(c.asesorId) }]),
  ).values()].sort((a, b) => a.nombre.localeCompare(b.nombre));

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

      {/* ── Mapa de cobertura de clientes atendidos ─────────────────────── */}
      <Card className="mt-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Mapa de cobertura</h2>
          <MapaFiltroAsesor asesores={asesoresLista} valor={mapAsesorId != null ? String(mapAsesorId) : ""} />
        </div>

        {/* Resumen */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-ink">
            <strong>{cobertura.clientes.length}</strong> clientes atendidos
          </span>
          {cobertura.sinUbicacion > 0 && (
            <span className="text-amber-600">
              {cobertura.sinUbicacion} sin ubicación registrada
            </span>
          )}
          {puntosPlanteles.length > 0 && (
            <span className="text-ink">
              <strong>{puntosPlanteles.length}</strong> planteles ubicados
            </span>
          )}
          <span className="text-xs text-muted">
            (con concreto entregado en {periodo}
            {zona !== "todas" ? ` · ${zona}` : ""})
          </span>
        </div>

        {puntosMapa.length === 0 ? (
          <p className="rounded-lg border border-border bg-content/40 py-10 text-center text-sm text-muted">
            No hay ubicaciones que mostrar para estos filtros (ni clientes atendidos ni
            planteles con ubicación registrada).
          </p>
        ) : (
          <div className="relative">
            <MapaLeaflet puntos={puntosMapa} />
            {/* Leyenda: asesor → color + planteles */}
            {(leyenda.length > 0 || puntosPlanteles.length > 0) && (
              <div className="pointer-events-none absolute right-3 top-3 z-[400] max-w-[220px] rounded-lg bg-white/95 p-2.5 text-xs shadow ring-1 ring-black/5">
                {leyenda.length > 0 && (
                  <>
                    <div className="mb-1 font-semibold text-slate-700">Asesores</div>
                    <ul className="space-y-1">
                      {leyenda.map((l) => (
                        <li key={l.nombre} className="flex items-center gap-2 text-slate-700">
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: l.color }}
                          />
                          <span className="truncate">{l.nombre}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {puntosPlanteles.length > 0 && (
                  <div className={`flex items-center gap-2 text-slate-700 ${leyenda.length > 0 ? "mt-2 border-t border-slate-100 pt-2" : ""}`}>
                    <span
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: "#1e293b" }}
                    >
                      <Factory size={10} className="text-white" />
                    </span>
                    <span className="truncate">Planteles</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
