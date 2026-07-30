import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requerirAcceso } from "@/lib/auth/guard";
import {
  ventanaDePedido,
  seTraslapan,
  formatearVentana,
  type ViajeVentana,
} from "@/lib/laboratorio/ventana";
import { Card, PageHeader } from "../components/ui";
import { GestionAsignaciones, type LaboratoristaOpc, type ProgramaDia } from "./gestion";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const SELECT_VIAJE_VENTANA = {
  mixer_id: true,
  hora_llegada_proyecto: true,
  ts_llegada_real: true,
  hora_regreso_planta: true,
  ts_regreso_real: true,
  hora_fin_descarga: true,
  ts_fin_descarga_real: true,
} as const;

/** Asignación de un Laboratorista a cada PROGRAMA del día (Jefe de Lab + Admin). */
export default async function LaboratorioPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const alcance = await requerirAcceso("/laboratorio");
  const sesion = await auth();
  const userId = sesion?.user?.id ?? "";
  // Admin y Jefe de Laboratorio gestionan (editan). El Laboratorista solo VE lo
  // que tiene asignado (solo lectura), filtrado a sus propios programas.
  const esGestor = alcance.esAdmin || alcance.esJefeLaboratorio;
  const soloLectura = !esGestor;

  const sp = await searchParams;
  const fecha = sp.fecha ?? ymd(new Date());
  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  const [laboratoristasRaw, pedidos] = await Promise.all([
    prisma.user.findMany({
      where: { activo: true, roles: { some: { rol: "Laboratorista" } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, zona: true },
    }),
    prisma.pedidos.findMany({
      where: {
        hora_solicitada: { gte: ini, lt: fin },
        estado_pedido: "Activo",
        // El Laboratorista solo ve SUS programas asignados.
        ...(soloLectura ? { asignacion_lab: { is: { laboratorista_id: userId } } } : {}),
      },
      select: {
        id: true,
        cliente_id: true,
        hora_solicitada: true,
        cliente: { select: { empresa: true, proyecto: true } },
        plantel: { select: { nombre: true, zona: true } },
        asignacion_lab: { select: { laboratorista_id: true } },
        viajes: { where: { mixer_id: { not: null } }, select: SELECT_VIAJE_VENTANA },
      },
    }),
  ]);

  const laboratoristas: LaboratoristaOpc[] = laboratoristasRaw.map((u) => ({
    id: u.id,
    nombre: u.name ?? u.email ?? "Laboratorista",
    zona: u.zona,
  }));

  // Una fila por programa (pedido) con su ventana; orden = hora programada (llegada).
  const filas = pedidos
    .map((p) => {
      const ventana = ventanaDePedido(p.viajes as ViajeVentana[], p.hora_solicitada);
      return {
        pedidoId: p.id,
        clienteId: p.cliente_id,
        empresa: p.cliente.empresa,
        proyecto: p.cliente.proyecto ?? "",
        plantel: p.plantel.nombre,
        zona: p.plantel.zona,
        labId: p.asignacion_lab?.laboratorista_id ?? "",
        ventana,
        ventanaTxt: ventana ? formatearVentana(ventana) : null,
        inicioMs: ventana ? ventana.inicioMs : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.inicioMs - b.inicioMs || a.empresa.localeCompare(b.empresa));

  // Traslapes: por laboratorista, dos programas de cliente DISTINTO que se cruzan.
  const conConflicto = new Set<number>();
  const conflictos: string[] = [];
  const porLab = new Map<string, typeof filas>();
  for (const f of filas) {
    if (!f.labId) continue;
    const arr = porLab.get(f.labId) ?? [];
    arr.push(f);
    porLab.set(f.labId, arr);
  }
  for (const [labId, arr] of porLab) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const A = arr[i];
        const B = arr[j];
        if (A.clienteId === B.clienteId) continue; // mismo proyecto: no cuenta
        if (A.ventana && B.ventana && seTraslapan(A.ventana, B.ventana)) {
          conConflicto.add(A.pedidoId);
          conConflicto.add(B.pedidoId);
          const nom = laboratoristas.find((l) => l.id === labId)?.nombre ?? "Laboratorista";
          conflictos.push(
            `${nom}: "${A.empresa}" (${A.ventanaTxt}) se cruza con "${B.empresa}" (${B.ventanaTxt}).`,
          );
        }
      }
    }
  }

  const programas: ProgramaDia[] = filas.map((f) => ({
    pedidoId: f.pedidoId,
    empresa: f.empresa,
    proyecto: f.proyecto,
    plantel: f.plantel,
    zona: f.zona,
    ventanaTxt: f.ventanaTxt,
    labId: f.labId,
    enConflicto: conConflicto.has(f.pedidoId),
  }));

  return (
    <>
      <PageHeader
        titulo={soloLectura ? "Proyectos asignados" : "Laboratorio"}
        descripcion={
          soloLectura
            ? "Estos son los proyectos que tienes asignados para el día. El horario se calcula de los viajes."
            : "Asigna a cada programa del día quién será el Laboratorista que lo visitará (o Ninguno). El horario se calcula de los viajes; un mismo Laboratorista no puede tener dos proyectos que se crucen."
        }
      />
      <Card className="p-5">
        <GestionAsignaciones
          fecha={fecha}
          laboratoristas={laboratoristas}
          programas={programas}
          conflictos={conflictos}
          soloLectura={soloLectura}
        />
      </Card>
    </>
  );
}
