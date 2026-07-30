import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { ZONAS } from "@/lib/auth/roles";
import { Card, PageHeader } from "../components/ui";
import { Timeline, type FilaMixer } from "../timeline";
import { FiltroFecha } from "./filtro-fecha";
import { FlotaTabs } from "./flota-tabs";
import { EquipoCatalogos } from "./equipo-catalogos";
import { CalendarioMantenimiento, type TipoConUnidades } from "./calendario-mantenimiento";
import { MantenimientoLista, type ItemMantenimiento } from "./mantenimiento-lista";
import { HistorialFlota, type UnidadHist, type DiaCelda } from "./historial-flota";

export const dynamic = "force-dynamic";

// ── Metadatos de los 4 tipos de equipo ───────────────────────────────────────
const TIPOS_META = [
  { tipo: "Mixer", label: "Mixers" },
  { tipo: "Bomba", label: "Bombas" },
  { tipo: "Camion", label: "Camiones" },
  { tipo: "Pickup", label: "Pickups" },
];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const pad = (n: number) => String(n).padStart(2, "0");
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hhmm(d: Date | null): string {
  return d ? d.toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" }) : "—";
}
function ddmm(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
function etiquetaEvento(e: string): string {
  if (e === "Mantenimiento_Programado") return "Mantenimiento programado";
  if (e === "Fuera_de_Servicio") return "Fuera de servicio";
  return "Otro";
}

/** Unidades de un tipo con su etiqueta y estado de catálogo. */
async function unidadesDeTipo(tipo: string): Promise<{ id: number; label: string; estado: string }[]> {
  if (tipo === "Mixer")
    return (await prisma.mixers.findMany({ orderBy: { id: "asc" } })).map((m) => ({
      id: m.id, label: m.identificador ?? `#${m.id}`, estado: m.estado,
    }));
  if (tipo === "Bomba")
    return (await prisma.bombas.findMany({ orderBy: { id: "asc" } })).map((b) => ({
      id: b.id, label: b.identificador, estado: b.estado,
    }));
  if (tipo === "Camion")
    return (await prisma.camiones.findMany({ orderBy: { id: "asc" } })).map((c) => ({
      id: c.id, label: c.identificador, estado: c.estado,
    }));
  return (await prisma.pickups.findMany({ orderBy: { id: "asc" } })).map((p) => ({
    id: p.id, label: p.identificador, estado: p.estado,
  }));
}

/** Auto-transición de estados por fecha (al primer acceso del día). Idempotente. */
async function autoTransicionar() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  await prisma.disponibilidad_flota.updateMany({
    where: { estado: { in: ["Programado", "En_curso"] }, fecha_fin: { lt: hoy } },
    data: { estado: "Completado" },
  });
  await prisma.disponibilidad_flota.updateMany({
    where: { estado: "Programado", fecha_inicio: { lte: hoy }, fecha_fin: { gte: hoy } },
    data: { estado: "En_curso" },
  });
}

export default async function FlotaPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; fecha?: string; equipo?: string; histTipo?: string; mes?: string }>;
}) {
  await requerirAcceso("/flota");
  await autoTransicionar();
  const sp = await searchParams;
  const tab = ["panel", "equipo", "mantenimiento", "historial"].includes(sp.tab ?? "")
    ? sp.tab!
    : "panel";

  return (
    <>
      <PageHeader
        titulo="Flota"
        descripcion="Equipo, uso diario y mantenimiento de la flota (las dos restricciones de zona por separado)."
      />
      <FlotaTabs activo={tab} />

      {tab === "panel" && <PanelTab fecha={sp.fecha} />}
      {tab === "equipo" && (
        <Card className="p-5">
          <EquipoCatalogos equipo={sp.equipo ?? "mixers"} />
        </Card>
      )}
      {tab === "mantenimiento" && <MantenimientoTab />}
      {tab === "historial" && <HistorialTab histTipo={sp.histTipo} mes={sp.mes} />}
    </>
  );
}

// ══ PANEL (dashboard del día + alertas) ══════════════════════════════════════
async function PanelTab({ fecha: fechaParam }: { fecha?: string }) {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaParam ?? "") ? fechaParam! : ymd(new Date());
  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  const [zonas, alertas] = await Promise.all([
    Promise.all(ZONAS.map((z) => resumenZona(z, ini, fin))),
    proximosMantenimientos(),
  ]);

  return (
    <>
      {alertas.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4">
          <div className="mb-1 text-sm font-semibold text-amber-800">
            ⚠️ Mantenimientos que inician en los próximos 3 días
          </div>
          <ul className="space-y-0.5 text-sm text-amber-800">
            {alertas.map((a) => (
              <li key={a.id}>
                <strong>{a.unidad}</strong> ({a.tipoUnidad}) — {a.rango}
                {a.motivo ? ` · ${a.motivo}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <FiltroFecha fecha={fecha} />
      <div className="space-y-6">
        {zonas.map((z) => (
          <ZonaFlota key={z.zona} r={z} />
        ))}
      </div>
    </>
  );
}

/** Mantenimientos programados que inician dentro de los próximos 3 días. */
async function proximosMantenimientos() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const limite = new Date(hoy);
  limite.setDate(limite.getDate() + 3);
  const regs = await prisma.disponibilidad_flota.findMany({
    where: {
      estado: "Programado",
      tipo_evento: "Mantenimiento_Programado",
      fecha_inicio: { gte: hoy, lte: limite },
    },
    orderBy: { fecha_inicio: "asc" },
  });
  const label = await mapaLabels();
  return regs.map((r) => ({
    id: r.id,
    unidad: label(r.unidad_tipo, r.unidad_id),
    tipoUnidad: r.unidad_tipo,
    rango: `${ddmm(r.fecha_inicio)} – ${ddmm(r.fecha_fin)}`,
    motivo: r.motivo ?? "",
  }));
}

/** Resuelve etiquetas de unidad por (tipo, id) para todos los tipos. */
async function mapaLabels(): Promise<(tipo: string, id: number) => string> {
  const [mix, bom, cam, pic] = await Promise.all(TIPOS_META.map((t) => unidadesDeTipo(t.tipo)));
  const mapa = new Map<string, string>();
  const meter = (tipo: string, arr: { id: number; label: string }[]) =>
    arr.forEach((u) => mapa.set(`${tipo}:${u.id}`, u.label));
  meter("Mixer", mix);
  meter("Bomba", bom);
  meter("Camion", cam);
  meter("Pickup", pic);
  return (tipo, id) => mapa.get(`${tipo}:${id}`) ?? `#${id}`;
}

// ══ MANTENIMIENTO (programar + lista) ════════════════════════════════════════
async function MantenimientoTab() {
  const tiposUnid = await Promise.all(
    TIPOS_META.map(async (t) => ({
      tipo: t.tipo,
      label: t.label,
      unidades: (await unidadesDeTipo(t.tipo)).map((u) => ({ id: u.id, label: u.label })),
    })),
  );
  const tiposCalendario: TipoConUnidades[] = tiposUnid;

  const [regs, label] = await Promise.all([
    prisma.disponibilidad_flota.findMany({ orderBy: { fecha_inicio: "desc" }, take: 200 }),
    mapaLabels(),
  ]);
  const ordenEstado: Record<string, number> = { En_curso: 0, Programado: 1, Completado: 2, Cancelado: 3 };
  const items: ItemMantenimiento[] = regs
    .sort(
      (a, b) =>
        (ordenEstado[a.estado] ?? 9) - (ordenEstado[b.estado] ?? 9) ||
        b.fecha_inicio.getTime() - a.fecha_inicio.getTime(),
    )
    .map((r) => ({
      id: r.id,
      unidad: label(r.unidad_tipo, r.unidad_id),
      tipoUnidad: r.unidad_tipo,
      evento: etiquetaEvento(r.tipo_evento),
      rango: `${ddmm(r.fecha_inicio)} → ${ddmm(r.fecha_fin)}`,
      motivo: r.motivo ?? "",
      estado: r.estado,
    }));

  return (
    <>
      <Card className="mb-6 p-5">
        <h2 className="mb-4 text-lg font-semibold text-ink">Programar mantenimiento</h2>
        <CalendarioMantenimiento tipos={tiposCalendario} />
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 text-lg font-semibold text-ink">Mantenimientos registrados</h2>
        <MantenimientoLista items={items} />
      </Card>
    </>
  );
}

// ══ HISTORIAL (mapa de calor + promedio) ═════════════════════════════════════
async function HistorialTab({ histTipo, mes }: { histTipo?: string; mes?: string }) {
  const tipo = TIPOS_META.some((t) => t.tipo === histTipo) ? histTipo! : "Mixer";
  const ahora = new Date();
  const mesStr = /^\d{4}-\d{2}$/.test(mes ?? "") ? mes! : `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}`;
  const [y, m] = mesStr.split("-").map(Number);
  const iniMes = new Date(y, m - 1, 1);
  const finMes = new Date(y, m, 1);
  const diasMes = new Date(y, m, 0).getDate();

  const unidades = await unidadesDeTipo(tipo);
  const ids = unidades.map((u) => u.id);
  const regs = ids.length
    ? await prisma.disponibilidad_flota.findMany({
        where: {
          unidad_tipo: tipo,
          unidad_id: { in: ids },
          estado: { not: "Cancelado" },
          fecha_inicio: { lt: finMes },
          fecha_fin: { gte: iniMes },
        },
      })
    : [];

  // Matriz por unidad × día + conteo de activas por día para el promedio.
  const activasPorDia = new Array(diasMes + 1).fill(0);
  const unidadesHist: UnidadHist[] = unidades.map((u) => {
    const suyos = regs.filter((r) => r.unidad_id === u.id);
    const dias: DiaCelda[] = [];
    for (let d = 1; d <= diasMes; d++) {
      const dia = new Date(y, m - 1, d).getTime();
      const cubren = suyos.filter(
        (r) => r.fecha_inicio.getTime() <= dia && r.fecha_fin.getTime() >= dia,
      );
      let estado: DiaCelda["estado"] = "activo";
      let detalle = "";
      if (cubren.length > 0) {
        const fuera = cubren.find((r) => r.tipo_evento === "Fuera_de_Servicio");
        const r = fuera ?? cubren[0];
        estado = fuera ? "fuera" : "mant";
        detalle = `${etiquetaEvento(r.tipo_evento)}${r.motivo ? `: ${r.motivo}` : ""} · ${r.creado_por}`;
      } else {
        activasPorDia[d] += 1;
      }
      dias.push({ d, estado, detalle });
    }
    return { id: u.id, label: u.label, dias };
  });

  let sumaActivas = 0;
  for (let d = 1; d <= diasMes; d++) sumaActivas += activasPorDia[d];
  const promedio = diasMes > 0 ? sumaActivas / diasMes : 0;

  const mesPrev = new Date(y, m - 2, 1);
  const mesNext = new Date(y, m, 1);
  const mesQ = (dd: Date) => `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}`;

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-lg font-semibold text-ink">Historial de disponibilidad</h2>
      <HistorialFlota
        tipos={TIPOS_META.map((t) => ({
          tipo: t.tipo,
          label: t.label,
          href: `/flota?tab=historial&histTipo=${t.tipo}&mes=${mesStr}`,
          activo: t.tipo === tipo,
        }))}
        unidades={unidadesHist}
        diasMes={diasMes}
        promedio={promedio}
        totalUnidades={unidades.length}
        mesLabel={`${MESES[m - 1]} ${y}`}
        hrefMesPrev={`/flota?tab=historial&histTipo=${tipo}&mes=${mesQ(mesPrev)}`}
        hrefMesNext={`/flota?tab=historial&histTipo=${tipo}&mes=${mesQ(mesNext)}`}
      />
    </Card>
  );
}

// ══ Resumen por zona (dashboard del día — sin cambios) ═══════════════════════
interface FilaMixerReporte {
  id: number;
  identificador: string;
  base: string;
  capacidad: number;
  estado: string;
  viajes: number;
  m3: number;
  desde: Date | null;
  hasta: Date | null;
  horasOcupado: number;
}
interface ResumenZona {
  zona: string;
  mixersTotal: number;
  mixersDisp: number;
  mixersEnUso: number;
  bombasTotal: number;
  bombasDisp: number;
  m3Dia: number;
  viajesDia: number;
  reporte: FilaMixerReporte[];
  timeline: FilaMixer[];
}

async function resumenZona(zona: string, ini: Date, fin: Date): Promise<ResumenZona> {
  const [mixers, bombas] = await Promise.all([
    prisma.mixers.findMany({
      where: { plantel_base: { zona } },
      include: { plantel_base: { select: { nombre: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.bombas.findMany({ where: { plantel_base: { zona } } }),
  ]);
  const mixerIds = mixers.map((m) => m.id);

  const viajes = mixerIds.length
    ? await prisma.viajes.findMany({
        where: {
          mixer_id: { in: mixerIds },
          estado: { not: "Cancelado" },
          hora_inicio_carga: { gte: ini, lt: fin },
        },
        include: { pedido: { select: { cliente: { select: { empresa: true } } } } },
        orderBy: { hora_inicio_carga: "asc" },
      })
    : [];

  const porMixer = new Map<number, typeof viajes>();
  for (const v of viajes) {
    if (v.mixer_id == null) continue;
    if (!porMixer.has(v.mixer_id)) porMixer.set(v.mixer_id, []);
    porMixer.get(v.mixer_id)!.push(v);
  }

  const reporte: FilaMixerReporte[] = mixers
    .map((m) => {
      const vs = porMixer.get(m.id) ?? [];
      const m3 = vs.reduce((s, v) => s + v.volumen_asignado_m3, 0);
      const inicios = vs.map((v) => v.hora_inicio_carga?.getTime()).filter((t): t is number => t != null);
      const regresos = vs.map((v) => v.hora_regreso_planta?.getTime()).filter((t): t is number => t != null);
      const horasOcupado =
        vs.reduce((s, v) => {
          const a = v.hora_inicio_carga?.getTime();
          const b = v.hora_regreso_planta?.getTime();
          return a != null && b != null ? s + (b - a) : s;
        }, 0) / 3_600_000;
      return {
        id: m.id,
        identificador: m.identificador ?? `#${m.id}`,
        base: m.plantel_base.nombre,
        capacidad: m.capacidad_m3,
        estado: m.estado,
        viajes: vs.length,
        m3: Math.round(m3 * 100) / 100,
        desde: inicios.length ? new Date(Math.min(...inicios)) : null,
        hasta: regresos.length ? new Date(Math.max(...regresos)) : null,
        horasOcupado: Math.round(horasOcupado * 10) / 10,
      };
    })
    .sort((a, b) => b.viajes - a.viajes || a.identificador.localeCompare(b.identificador));

  const timeline: FilaMixer[] = [...porMixer.entries()].map(([mixerId, vs]) => {
    const m = mixers.find((x) => x.id === mixerId)!;
    return {
      mixerId,
      mixerLabel: m.identificador ?? `#${mixerId}`,
      barras: vs
        .filter((v) => v.hora_inicio_carga && v.hora_regreso_planta)
        .map((v) => ({
          viajeId: v.id,
          inicioMs: v.hora_inicio_carga!.getTime(),
          finMs: v.hora_regreso_planta!.getTime(),
          etiqueta: `${v.pedido.cliente.empresa.slice(0, 10)} ${v.volumen_asignado_m3}m³`,
          origen: v.motivo_asignacion ?? "",
        })),
    };
  });

  return {
    zona,
    mixersTotal: mixers.length,
    mixersDisp: mixers.filter((m) => m.estado === "Disponible").length,
    mixersEnUso: porMixer.size,
    bombasTotal: bombas.length,
    bombasDisp: bombas.filter((b) => b.estado === "Disponible").length,
    m3Dia: Math.round(viajes.reduce((s, v) => s + v.volumen_asignado_m3, 0) * 100) / 100,
    viajesDia: viajes.length,
    reporte,
    timeline,
  };
}

function ZonaFlota({ r }: { r: ResumenZona }) {
  const usoPct = r.mixersDisp > 0 ? Math.round((r.mixersEnUso / r.mixersDisp) * 100) : null;
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-lg font-semibold text-ink">
        Zona {r.zona}
        <span className="ml-2 text-sm font-normal text-muted">· restricción de flota independiente</span>
      </h2>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Mixers disponibles" valor={`${r.mixersDisp} / ${r.mixersTotal}`} />
        <Mini
          label="En uso hoy"
          valor={usoPct == null ? `${r.mixersEnUso}` : `${r.mixersEnUso} (${usoPct}%)`}
        />
        <Mini label="m³ despachados hoy" valor={`${r.m3Dia.toFixed(1)} m³`} />
        <Mini label="Bombas disponibles" valor={`${r.bombasDisp} / ${r.bombasTotal}`} />
      </div>

      <div className="mb-5 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Mixer</th>
              <th className="px-3 py-2">Base</th>
              <th className="px-3 py-2 text-center">Cap.</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-center">Viajes hoy</th>
              <th className="px-3 py-2 text-right">m³ hoy</th>
              <th className="px-3 py-2 text-center">Ventana</th>
              <th className="px-3 py-2 text-right">Horas ocupado</th>
            </tr>
          </thead>
          <tbody>
            {r.reporte.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted">
                  Esta zona no tiene mixers registrados.
                </td>
              </tr>
            ) : (
              r.reporte.map((f) => (
                <tr key={f.id} className="border-b border-border/60">
                  <td className="px-3 py-2 font-medium text-ink">{f.identificador}</td>
                  <td className="px-3 py-2 text-muted">{f.base}</td>
                  <td className="px-3 py-2 text-center">{f.capacidad} m³</td>
                  <td className="px-3 py-2">
                    <span className={f.estado === "Disponible" ? "text-ok" : "text-warn"}>{f.estado}</span>
                  </td>
                  <td className="px-3 py-2 text-center">{f.viajes}</td>
                  <td className="px-3 py-2 text-right">{f.m3.toFixed(1)}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap text-muted">
                    {f.viajes > 0 ? `${hhmm(f.desde)}–${hhmm(f.hasta)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{f.viajes > 0 ? f.horasOcupado.toFixed(1) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 text-sm font-semibold text-ink">Línea de tiempo del día</h3>
      <Timeline filas={r.timeline} />
    </Card>
  );
}

function Mini({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border bg-content/40 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold text-ink">{valor}</div>
    </div>
  );
}
