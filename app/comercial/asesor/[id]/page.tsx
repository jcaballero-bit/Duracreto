import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { registroAdicionesCancelaciones, type RegistroAsesor } from "@/lib/comercial/metricas";
import { Badge, Card, PageHeader } from "../../../components/ui";
import { SelectorMesRegistro } from "./selector-mes";
import { BorrarCancelacion } from "./borrar-cancelacion";
import { EditarEvento } from "./editar-evento";
import {
  GridSemana,
  type Celda,
  type ClienteFila,
  type DiaSemana,
} from "../../../clientes/semana/grid-semana";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "programacion", label: "Programación" },
  { key: "clientes", label: "Clientes" },
  { key: "confirmaciones", label: "Confirmaciones" },
] as const;

function periodoActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Lunes de la semana que contiene `d` (semana Lun–Dom, como Programa Semana). */
function lunesDe(d: Date): Date {
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = base.getDay();
  base.setDate(base.getDate() + (dow === 0 ? -6 : 1 - dow));
  return base;
}
function abreviar(nombre: string): string {
  const limpio = nombre.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
  const palabras = limpio.split(/\s+/).filter(Boolean);
  return (palabras.length > 1 ? palabras.map((p) => p[0]).join("") : limpio.slice(0, 3)).toUpperCase();
}
const DIAS_LABEL = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
function fmtFecha(d: Date): string {
  return d.toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtFechaHora(d: Date | null): string {
  return d
    ? d.toLocaleString("es-HN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";
}

export default async function DetalleAsesorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; periodo?: string; zona?: string; inicio?: string; regMes?: string }>;
}) {
  const alcance = await requerirAcceso("/comercial");
  const esAdmin = alcance.esAdmin;
  const { id } = await params;
  const asesorId = Number(id);
  const sp = await searchParams;
  const periodo = /^\d{4}-\d{2}$/.test(sp.periodo ?? "") ? sp.periodo! : periodoActual();
  const zona = sp.zona === "Norte" || sp.zona === "Centro Sur" ? sp.zona : null;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "programacion";
  const regMes = /^\d{4}-\d{2}$/.test(sp.regMes ?? "") ? sp.regMes! : "";

  const asesor = await prisma.asesores.findUnique({ where: { id: asesorId } });
  if (!asesor) notFound();

  const [anio, mes] = periodo.split("-").map(Number);
  const ini = new Date(anio, mes - 1, 1);
  const fin = new Date(anio, mes, 1);

  // Semana para el grid de Programación (Lun–Dom). Default: la SEMANA ACTUAL.
  const inicioParam = /^\d{4}-\d{2}-\d{2}$/.test(sp.inicio ?? "")
    ? new Date(`${sp.inicio}T00:00:00`)
    : new Date();
  const lunes = lunesDe(isNaN(inicioParam.getTime()) ? new Date() : inicioParam);

  const volverUrl = () => {
    const p = new URLSearchParams({ periodo });
    if (zona) p.set("zona", zona);
    return `/comercial?${p.toString()}`;
  };
  const tabUrl = (key: string) => {
    const p = new URLSearchParams({ tab: key, periodo });
    if (zona) p.set("zona", zona);
    return `/comercial/asesor/${asesorId}?${p.toString()}`;
  };

  return (
    <>
      <div className="mb-3">
        <Link href={volverUrl()} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
          <ArrowLeft size={14} /> Volver al desempeño
        </Link>
      </div>
      <PageHeader
        titulo={asesor.nombre}
        descripcion="Vista de supervisión (solo lectura) del desempeño del asesor."
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border text-sm">
        {TABS.map((t) =>
          t.key === tab ? (
            <span key={t.key} className="border-b-2 border-accent px-3 py-2 font-medium text-accent">
              {t.label}
            </span>
          ) : (
            <Link key={t.key} href={tabUrl(t.key)} className="px-3 py-2 text-muted hover:text-ink">
              {t.label}
            </Link>
          ),
        )}
      </div>

      <Card className="p-5">
        {tab === "programacion" && (
          <ProgramacionSemana
            asesorId={asesorId}
            lunes={lunes}
            periodo={periodo}
            zona={zona}
            regMes={regMes}
            esAdmin={esAdmin}
          />
        )}
        {tab === "clientes" && <Clientes asesorId={asesorId} />}
        {tab === "confirmaciones" && (
          <Confirmaciones asesorId={asesorId} ini={ini} fin={fin} zona={zona} />
        )}
      </Card>
    </>
  );
}

const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-muted";
const td = "px-3 py-2 text-ink";

/**
 * Programación del asesor como la cuadrícula de Programa Semana (solo lectura),
 * mostrando ÚNICAMENTE los clientes de ese asesor.
 */
async function ProgramacionSemana({
  asesorId,
  lunes,
  periodo,
  zona,
  regMes,
  esAdmin,
}: {
  asesorId: number;
  lunes: Date;
  periodo: string;
  zona: string | null;
  regMes: string;
  esAdmin: boolean;
}) {
  const dias: DiaSemana[] = DIAS_LABEL.map((etq, i) => {
    const f = new Date(lunes);
    f.setDate(lunes.getDate() + i);
    return { iso: ymd(f), label: `${etq} ${f.getDate()}/${String(f.getMonth() + 1).padStart(2, "0")}` };
  });
  const finSemana = new Date(lunes);
  finSemana.setDate(finSemana.getDate() + 7);
  const prev = new Date(lunes);
  prev.setDate(prev.getDate() - 7);
  const next = new Date(lunes);
  next.setDate(next.getDate() + 7);

  const [solicitudes, planteles] = await Promise.all([
    prisma.solicitudes_anticipadas.findMany({
      where: { fecha_requerida: { gte: new Date(lunes), lt: finSemana }, cliente: { asesor_id: asesorId } },
      include: { cliente: { include: { asesor: { select: { nombre: true } } } } },
    }),
    prisma.planteles.findMany({ orderBy: { nombre: "asc" } }),
  ]);

  const filasMap = new Map<number, ClienteFila>();
  for (const s of solicitudes) {
    let fila = filasMap.get(s.cliente_id);
    if (!fila) {
      fila = {
        id: s.cliente_id,
        empresa: s.cliente.empresa,
        proyecto: s.cliente.proyecto ?? "",
        asesorNombre: s.cliente.asesor?.nombre ?? "Sin asesor",
        editable: false, // supervisión
        celdas: Object.fromEntries(dias.map((d) => [d.iso, [] as Celda[]])),
      };
      filasMap.set(s.cliente_id, fila);
    }
    (fila.celdas[ymd(s.fecha_requerida)] ??= []).push({
      id: s.id,
      volumen: s.volumen_estimado_m3,
      tipoConcreto: s.tipo_concreto_estimado ?? "",
      revenimiento: s.revenimiento ?? "",
      tipoServicio: s.tipo_servicio ?? "",
      tipoDescarga: s.tipo_descarga_estimado ?? "",
      sacosHielo: s.sacos_hielo_por_m3,
      elemento: s.elemento ?? "",
      frecuencia: s.frecuencia_entre_camiones_min,
      observaciones: s.observaciones ?? "",
      plantelId: s.plantel_id,
      estado: s.estado,
      creadoEn: s.creado_en ? s.creado_en.toISOString() : null,
      actualizadoEn: s.actualizado_en ? s.actualizado_en.toISOString() : null,
    });
  }

  const p = new URLSearchParams({ tab: "programacion", periodo });
  if (zona) p.set("zona", zona);

  const registro = await registroAdicionesCancelaciones(asesorId);

  return (
    <>
      <GridSemana
        dias={dias}
        filas={[...filasMap.values()]}
        candidatos={[]}
        planteles={planteles.map((pl) => ({ id: pl.id, nombre: pl.nombre, abbr: abreviar(pl.nombre) }))}
        esAdmin={false}
        resaltarEditables={false}
        puedeCrearCliente={false}
        asesores={[]}
        prevIso={ymd(prev)}
        nextIso={ymd(next)}
        rotuloSemana={`${dias[0].label} – ${dias[6].label}`}
        soloLectura
        basePath={`/comercial/asesor/${asesorId}`}
        paramsExtra={p.toString()}
      />
      <RegistroMensual registro={registro} mesSel={regMes} esAdmin={esAdmin} />
    </>
  );
}

/** Capitaliza la primera letra (los labels de mes vienen en minúscula). */
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Registro de adiciones y cancelaciones del asesor, tabulado por mes con totales.
 *  Con selector de mes (vacío = todos). */
function RegistroMensual({
  registro,
  mesSel,
  esAdmin,
}: {
  registro: RegistroAsesor;
  mesSel: string;
  esAdmin: boolean;
}) {
  // Meses mostrados según el selector (vacío = todos); los totales del encabezado
  // reflejan lo mostrado.
  const mesesMostrados =
    mesSel && registro.meses.some((m) => m.clave === mesSel)
      ? registro.meses.filter((m) => m.clave === mesSel)
      : registro.meses;
  const totalAdic = mesesMostrados.reduce((s, m) => s + m.totalAdicionadoM3, 0);
  const totalCanc = mesesMostrados.reduce((s, m) => s + m.totalCanceladoM3, 0);
  const opcionesMes = registro.meses.map((m) => ({ value: m.clave, label: capitalizar(m.label) }));

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-ink">
            Adiciones y cancelaciones (por mes)
          </h3>
          <SelectorMesRegistro opciones={opcionesMes} valor={mesSel} />
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-muted">
            Total adicionado:{" "}
            <span className="font-semibold text-amber-600">+{totalAdic.toFixed(1)} m³</span>
          </span>
          <span className="text-muted">
            Total cancelado:{" "}
            <span className="font-semibold text-danger">{totalCanc.toFixed(1)} m³</span>
          </span>
        </div>
      </div>

      {mesesMostrados.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">
          Este asesor no tiene adiciones ni cancelaciones registradas.
        </p>
      ) : (
        <div className="space-y-6">
          {mesesMostrados.map((m) => (
            <div key={m.clave}>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium capitalize text-ink">{m.label}</span>
                <span className="text-xs text-amber-600">
                  Adicionado +{m.totalAdicionadoM3.toFixed(1)} m³
                </span>
                <span className="text-xs text-danger">
                  Cancelado {m.totalCanceladoM3.toFixed(1)} m³
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Cancelaciones del mes */}
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    Cancelaciones
                  </div>
                  {m.cancelaciones.length === 0 ? (
                    <p className="py-2 text-xs text-muted">Sin cancelaciones.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                          <th className="px-2 py-1.5">Fecha</th>
                          <th className="px-2 py-1.5">Cliente</th>
                          <th className="px-2 py-1.5 text-right">m³</th>
                          <th className="px-2 py-1.5">Motivo</th>
                          {esAdmin && <th className="px-2 py-1.5 text-right">Acción</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {m.cancelaciones.map((c, i) => (
                          <tr key={i} className="border-b border-border/60 align-top">
                            <td className="px-2 py-1.5 whitespace-nowrap text-muted">{fmtFechaCorta(c.fechaMs)}</td>
                            <td className="px-2 py-1.5 text-ink">{c.cliente}</td>
                            <td className="px-2 py-1.5 text-right font-medium text-ink">{c.m3.toFixed(1)}</td>
                            <td className="px-2 py-1.5">
                              <span className="text-ink">{c.motivo}</span>
                              {c.detalle && <span className="block text-xs text-muted">{c.detalle}</span>}
                            </td>
                            {esAdmin && (
                              <td className="px-2 py-1.5">
                                {c.pedidoId != null && (
                                  <span className="flex items-center justify-end gap-1">
                                    <EditarEvento
                                      pedidoId={c.pedidoId}
                                      tipo="cancelacion"
                                      fechaMs={c.fechaMs}
                                      m3={c.m3}
                                      cliente={c.cliente}
                                    />
                                    <BorrarCancelacion pedidoId={c.pedidoId} cliente={c.cliente} />
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Adiciones del mes */}
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    Adiciones
                  </div>
                  {m.adiciones.length === 0 ? (
                    <p className="py-2 text-xs text-muted">Sin adiciones.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                          <th className="px-2 py-1.5">Fecha</th>
                          <th className="px-2 py-1.5">Cliente</th>
                          <th className="px-2 py-1.5 text-right">m³</th>
                          <th className="px-2 py-1.5">Tipo</th>
                          {esAdmin && <th className="px-2 py-1.5 text-right">Acción</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {m.adiciones.map((a, i) => (
                          <tr key={i} className="border-b border-border/60">
                            <td className="px-2 py-1.5 whitespace-nowrap text-muted">{fmtFechaCorta(a.fechaMs)}</td>
                            <td className="px-2 py-1.5 text-ink">{a.cliente}</td>
                            <td className="px-2 py-1.5 text-right font-medium text-amber-600">+{a.m3.toFixed(1)}</td>
                            <td className="px-2 py-1.5 text-muted">{a.tipo}</td>
                            {esAdmin && (
                              <td className="px-2 py-1.5 text-right">
                                {a.pedidoId != null && (
                                  <EditarEvento
                                    pedidoId={a.pedidoId}
                                    tipo="adicion"
                                    fechaMs={a.fechaMs}
                                    m3={a.m3}
                                    cliente={a.cliente}
                                  />
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtFechaCorta(ms: number): string {
  return new Date(ms).toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function Clientes({ asesorId }: { asesorId: number }) {
  const clientes = await prisma.clientes.findMany({
    where: { asesor_id: asesorId },
    orderBy: { empresa: "asc" },
  });
  if (clientes.length === 0)
    return <p className="py-6 text-center text-sm text-muted">Este asesor no tiene clientes.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={th}>Cliente</th>
            <th className={th}>Proyecto</th>
            <th className={th}>Ubicación</th>
            <th className={th}>Teléfono</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id} className="border-b border-border/60">
              <td className={`${td} font-medium`}>{c.empresa}</td>
              <td className={td}>{c.proyecto ?? "—"}</td>
              <td className={td}>{c.ubicacion}</td>
              <td className={td}>{c.telefono ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Confirmaciones({
  asesorId,
  ini,
  fin,
  zona,
}: {
  asesorId: number;
  ini: Date;
  fin: Date;
  zona: string | null;
}) {
  const pedidos = await prisma.pedidos.findMany({
    where: {
      hora_solicitada: { gte: ini, lt: fin },
      cliente: { asesor_id: asesorId },
      ...(zona ? { plantel: { zona } } : {}),
    },
    include: {
      cliente: true,
      viajes: {
        select: { estado_confirmacion: true, fecha_hora_confirmacion: true, usuario_confirmo: true },
      },
    },
    orderBy: { hora_solicitada: "asc" },
  });
  if (pedidos.length === 0)
    return <p className="py-6 text-center text-sm text-muted">Sin pedidos en el período.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={th}>Fecha</th>
            <th className={th}>Cliente / proyecto</th>
            <th className={th}>Confirmación</th>
            <th className={th}>Confirmado</th>
            <th className={th}>Por</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.map((p) => {
            const confirmado =
              p.viajes.length > 0 &&
              p.viajes.every((v) => v.estado_confirmacion === "Confirmado");
            const fechas = p.viajes
              .map((v) => v.fecha_hora_confirmacion?.getTime())
              .filter((t): t is number => t != null);
            const ultima = fechas.length ? new Date(Math.max(...fechas)) : null;
            const quien = p.viajes.find((v) => v.usuario_confirmo)?.usuario_confirmo ?? "—";
            return (
              <tr key={p.id} className="border-b border-border/60">
                <td className={`${td} whitespace-nowrap`}>{fmtFecha(p.hora_solicitada)}</td>
                <td className={td}>
                  <div className="font-medium">{p.cliente.empresa}</div>
                  {p.cliente.proyecto && <div className="text-xs text-link">{p.cliente.proyecto}</div>}
                </td>
                <td className={td}>
                  <Badge tono={confirmado ? "ok" : "neutro"}>
                    {confirmado ? "Confirmado" : "Pendiente"}
                  </Badge>
                </td>
                <td className={`${td} whitespace-nowrap`}>{fmtFechaHora(ultima)}</td>
                <td className={td}>{confirmado ? quien : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
