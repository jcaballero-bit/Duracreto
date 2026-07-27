import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { ZONAS } from "@/lib/auth/roles";
import { Card, PageHeader } from "../components/ui";
import { Timeline, type FilaMixer } from "../timeline";
import { FiltroFecha } from "./filtro-fecha";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function hhmm(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}

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

  // Agrupar viajes por mixer.
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
    // Primero los que trabajaron ese día.
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

export default async function FlotaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  await requerirAcceso("/flota");
  const sp = await searchParams;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha ?? "") ? sp.fecha! : ymd(new Date());
  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  const zonas = await Promise.all(ZONAS.map((z) => resumenZona(z, ini, fin)));

  return (
    <>
      <PageHeader
        titulo="Flota"
        descripcion="Estado y uso de la flota de mixers y bombas, con las dos restricciones de zona por separado."
      />
      <FiltroFecha fecha={fecha} />

      <div className="space-y-6">
        {zonas.map((z) => (
          <ZonaFlota key={z.zona} r={z} />
        ))}
      </div>
    </>
  );
}

function ZonaFlota({ r }: { r: ResumenZona }) {
  const usoPct = r.mixersDisp > 0 ? Math.round((r.mixersEnUso / r.mixersDisp) * 100) : null;
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-lg font-semibold text-ink">
        Zona {r.zona}
        <span className="ml-2 text-sm font-normal text-muted">
          · restricción de flota independiente
        </span>
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

      {/* Reporte por mixer */}
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
                    <span className={f.estado === "Disponible" ? "text-ok" : "text-warn"}>
                      {f.estado}
                    </span>
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

      {/* Línea de tiempo por mixer del día */}
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
