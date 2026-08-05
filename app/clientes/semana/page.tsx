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
  // GerenteComercial y JefePlanta: solo CONSULTA (sin editar celdas ni agregar
  // clientes) — ven la carga proyectada en modo solo lectura.
  const esSupervisor = alcance.esGerenteComercial || alcance.esJefePlanta;

  // Restricción por zona (enforcement server-side, no solo UI):
  //  · Asesor CON zona (punto 5): solo filas de asesores de SU MISMA zona.
  //  · Programador: solo el Programa Semana de SU zona (User.zona).
  //  · Jefe de Planta: solo la zona de su plantel asignado.
  //  · Admin / GerenteComercial: ven todas las zonas.
  const esSoloAsesor = alcance.esAsesor && !alcance.esAdmin && !alcance.esProgramador;
  let zonaAsesor: string | null = null;
  if (esSoloAsesor) {
    const yo = await prisma.asesores.findFirst({
      where: { usuario_auth_id: userId },
      select: { zona_asignada: true },
    });
    zonaAsesor = yo?.zona_asignada ?? null;
  }
  // Zona OPERATIVA (Programador por User.zona; Jefe de Planta por la zona de su
  // plantel). Acota lo que ve y edita. Admin/Gerente: sin límite.
  let zonaOperativa: string | null = null;
  if (!alcance.esAdmin && !alcance.esGerenteComercial) {
    if (alcance.esProgramador && alcance.zona) {
      zonaOperativa = alcance.zona;
    } else if (alcance.esJefePlanta && alcance.plantelAsignadoId != null) {
      const pl = await prisma.planteles.findUnique({
        where: { id: alcance.plantelAsignadoId },
        select: { zona: true },
      });
      zonaOperativa = pl?.zona ?? null;
    }
  }
  // Zona a la que se acota la vista (para el filtro/selector de plantas).
  const zonaVista = zonaOperativa ?? (esSoloAsesor ? zonaAsesor : null);
  // Filtro de proyecciones. Para Programador/Jefe de Planta, una proyección es "de
  // su zona" si la atiende una planta de esa zona O si su asesor pertenece a ella.
  const whereZonaSolicitud = zonaOperativa
    ? {
        OR: [
          { plantel: { zona: zonaOperativa } },
          { cliente: { asesor: { zona_asignada: zonaOperativa } } },
        ],
      }
    : esSoloAsesor && zonaAsesor
      ? { cliente: { asesor: { zona_asignada: zonaAsesor } } }
      : {};

  // Candidatos para "agregar cliente a esta semana": el Asesor solo los suyos; un
  // Programador/Jefe de Planta acotado por zona, solo los de su zona (o sin zona de
  // asesor); Admin/Gerente, todos.
  const whereCandidatos = puedeEditarTodo
    ? zonaOperativa
      ? {
          activo: true,
          OR: [
            { asesor: { zona_asignada: zonaOperativa } },
            { asesor: { zona_asignada: null } },
            { asesor: null },
          ],
        }
      : { activo: true }
    : { activo: true, ...filtroClientePorAsesor(userId) };

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
    // Proyecciones de la semana. Asesor con zona y Jefe de Planta ven solo las de su
    // zona; el resto (Admin/Programador/Gerente, o asesor sin zona) ve todas.
    prisma.solicitudes_anticipadas.findMany({
      where: { fecha_requerida: rango, ...whereZonaSolicitud },
      include: {
        cliente: {
          include: { asesor: { select: { nombre: true, usuario_auth_id: true } } },
        },
      },
    }),
    // Asesor con zona y Jefe de Planta solo ven/usan los planteles de SU zona
    // (filtro y selector de planta de la celda); el resto ve todos.
    prisma.planteles.findMany({
      where: zonaVista ? { zona: zonaVista } : {},
      orderBy: { nombre: "asc" },
    }),
    // Candidatos para "agregar a la semana": solo clientes ACTIVOS, acotados por rol
    // y zona (ver whereCandidatos). Los inactivos no se ofrecen para programar.
    prisma.clientes.findMany({
      where: whereCandidatos,
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
          resaltarEditables={alcance.esAsesor}
          soloLectura={esSupervisor}
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
