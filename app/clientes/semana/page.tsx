import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { filtroClientePorAsesor } from "@/lib/auth/acceso";
import { requerirAcceso } from "@/lib/auth/guard";
import { Card, PageHeader } from "../../components/ui";
import { VentasTabs } from "../../components/ventas-tabs";
import {
  GridSemana,
  type ClienteOpc,
  type ClienteFila,
  type DiaSemana,
  type PlantelOpc,
} from "./grid-semana";

export const dynamic = "force-dynamic";

const DIAS_LABEL = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Lunes de la semana que contiene `d` (semana Lun–Dom). */
function lunesDe(d: Date): Date {
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = base.getDay(); // 0=Dom … 6=Sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  base.setDate(base.getDate() + diff);
  return base;
}
/** Abreviatura de un plantel para las etiquetas de celda (SM, CHO, PC…). */
function abreviar(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
  const palabras = limpio.split(/\s+/).filter(Boolean);
  if (palabras.length > 1) {
    return palabras.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
  }
  return limpio.slice(0, 3).toUpperCase();
}

export default async function ProgramaSemanaPage({
  searchParams,
}: {
  searchParams: Promise<{ inicio?: string }>;
}) {
  const alcance = await requerirAcceso("/clientes/semana");
  const sesion = await auth();
  const userId = sesion?.user?.id ?? "";
  const roles = sesion?.user?.roles ?? [];
  const puedeEditarTodo = alcance.esAdmin || alcance.esProgramador;
  const puedeCrearCliente = alcance.esAdmin || alcance.esAsesor;

  const sp = await searchParams;
  const hoy = new Date();
  const inicioParam = sp.inicio ? new Date(`${sp.inicio}T00:00:00`) : hoy;
  const lunes = lunesDe(isNaN(inicioParam.getTime()) ? hoy : inicioParam);

  // 7 días Lun–Dom.
  const dias: DiaSemana[] = DIAS_LABEL.map((etq, i) => {
    const f = new Date(lunes);
    f.setDate(lunes.getDate() + i);
    return {
      iso: ymd(f),
      label: `${etq} ${f.getDate()}/${String(f.getMonth() + 1).padStart(2, "0")}`,
    };
  });
  const finSemana = new Date(lunes);
  finSemana.setDate(finSemana.getDate() + 7);
  const rango = { gte: new Date(lunes), lt: finSemana };
  const prev = new Date(lunes); prev.setDate(prev.getDate() - 7);
  const next = new Date(lunes); next.setDate(next.getDate() + 7);

  const [solicitudes, planteles, candidatosRaw, asesores] = await Promise.all([
    // Proyecciones de la semana (de TODOS los asesores: se leen para ver la carga).
    prisma.solicitudes_anticipadas.findMany({
      where: { fecha_requerida: rango },
      include: {
        cliente: {
          include: { asesor: { select: { nombre: true, usuario_auth_id: true } } },
        },
      },
    }),
    prisma.planteles.findMany({ orderBy: { nombre: "asc" } }),
    // Candidatos para "agregar a la semana": solo clientes ACTIVOS (el Asesor
    // solo los suyos). Los inactivos no se ofrecen para programar.
    prisma.clientes.findMany({
      where: { activo: true, ...(puedeEditarTodo ? {} : filtroClientePorAsesor(userId)) },
      orderBy: { empresa: "asc" },
      include: { asesor: { select: { nombre: true } } },
    }),
    alcance.esAdmin
      ? prisma.asesores.findMany({ orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
  ]);

  const plantelesOpc: PlantelOpc[] = planteles.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    abbr: abreviar(p.nombre),
  }));

  // Filas = SOLO clientes con al menos una proyección esta semana (no todos).
  const filasMap = new Map<number, ClienteFila>();
  for (const s of solicitudes) {
    let fila = filasMap.get(s.cliente_id);
    if (!fila) {
      const editable =
        puedeEditarTodo ||
        (s.cliente.asesor?.usuario_auth_id === userId && userId !== "");
      fila = {
        id: s.cliente_id,
        empresa: s.cliente.empresa,
        proyecto: s.cliente.proyecto ?? "",
        asesorNombre: s.cliente.asesor?.nombre ?? "Sin asesor",
        editable,
        // Cada celda (cliente×día) es una LISTA: un cliente puede tener varias
        // proyecciones el mismo día (distintos concretos/elementos).
        celdas: Object.fromEntries(dias.map((d) => [d.iso, []])),
      };
      filasMap.set(s.cliente_id, fila);
    }
    const iso = ymd(s.fecha_requerida);
    (fila.celdas[iso] ??= []).push({
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
    });
  }
  const filas = [...filasMap.values()];

  // Candidatos para el selector "agregar cliente a esta semana" (siempre editables
  // por el usuario que los ve aquí).
  const candidatos: ClienteOpc[] = candidatosRaw.map((c) => ({
    id: c.id,
    empresa: c.empresa,
    proyecto: c.proyecto ?? "",
    asesorNombre: c.asesor?.nombre ?? "Sin asesor",
  }));

  return (
    <>
      <PageHeader
        titulo="Ventas — Programa Semana"
        descripcion="Proyección PRELIMINAR por cliente y día. No es el pedido formal: el Programador la convierte en pedido."
      />

      <VentasTabs activo="/clientes/semana" roles={roles} />

      <Card className="p-5">
        <GridSemana
          dias={dias}
          filas={filas}
          candidatos={candidatos}
          planteles={plantelesOpc}
          esAdmin={alcance.esAdmin}
          resaltarEditables={!puedeEditarTodo}
          puedeCrearCliente={puedeCrearCliente}
          asesores={asesores.map((a) => ({ value: String(a.id), label: a.nombre }))}
          prevIso={ymd(prev)}
          nextIso={ymd(next)}
          rotuloSemana={`${dias[0].label} – ${dias[6].label}`}
        />
      </Card>
    </>
  );
}
