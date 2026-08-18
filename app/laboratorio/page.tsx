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
import { AsignacionPlantas, type PlantaAsignable } from "./asignacion-plantas";

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
  // Admin, Jefe de Laboratorio y Gerente de Control de Calidad gestionan (editan).
  // El Laboratorista solo VE lo que tiene asignado (solo lectura).
  const esGestor = alcance.esAdmin || alcance.esJefeLaboratorio || alcance.esGerenteControlCalidad;
  const soloLectura = !esGestor;
  // Un JefeLaboratorio está limitado a SU zona (punto 12). Admin y Gerente de Control
  // de Calidad: sin límite (ambas zonas).
  const zonaGestor =
    esGestor && !alcance.esAdmin && !alcance.esGerenteControlCalidad ? alcance.zona : null;

  const sp = await searchParams;
  const fecha = sp.fecha ?? ymd(new Date());
  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  const [laboratoristasRaw, pedidos, plantasRaw, asigsPlanta] = await Promise.all([
    prisma.user.findMany({
      where: {
        activo: true,
        roles: { some: { rol: "Laboratorista" } },
        ...(zonaGestor ? { zona: zonaGestor } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, zona: true },
    }),
    prisma.pedidos.findMany({
      where: {
        hora_solicitada: { gte: ini, lt: fin },
        estado_pedido: "Activo",
        // El Laboratorista solo ve SUS programas asignados.
        ...(soloLectura ? { asignaciones_lab: { some: { laboratorista_id: userId } } } : {}),
        // El JefeLaboratorio solo ve programas de su zona.
        ...(zonaGestor ? { plantel: { zona: zonaGestor } } : {}),
      },
      select: {
        id: true,
        cliente_id: true,
        hora_solicitada: true,
        cliente: { select: { empresa: true, proyecto: true } },
        plantel: { select: { nombre: true, zona: true } },
        asignaciones_lab: { select: { laboratorista_id: true } },
        muestras_ubicacion: true,
        muestras_cantidad: true,
        viajes: { where: { mixer_id: { not: null } }, select: SELECT_VIAJE_VENTANA },
      },
    }),
    // Plantas para el control de calidad de salida (solo las del alcance del gestor).
    esGestor
      ? prisma.plantas.findMany({
          where: zonaGestor ? { plantel: { zona: zonaGestor } } : {},
          orderBy: [{ plantel: { nombre: "asc" } }, { nombre: "asc" }],
          select: { id: true, nombre: true, plantel: { select: { nombre: true, zona: true } } },
        })
      : Promise.resolve([]),
    // Asignaciones de laboratorista de salida de ese día.
    prisma.asignaciones_laboratorista_planta.findMany({
      where: { fecha: { gte: ini, lt: fin } },
      select: {
        planta_id: true,
        laboratorista_id: true,
        observaciones: true,
        planta: { select: { nombre: true, plantel: { select: { nombre: true, zona: true } } } },
      },
    }),
  ]);

  const laboratoristas: LaboratoristaOpc[] = laboratoristasRaw.map((u) => ({
    id: u.id,
    nombre: u.name ?? u.email ?? "Laboratorista",
    zona: u.zona,
  }));

  // Filas de plantas para el control de calidad de salida. Una planta puede tener
  // VARIOS laboratoristas el mismo día; la observación del turno es de la planta/día
  // (se guarda igual en cada fila, así que basta tomar la primera).
  const labsPorPlanta = new Map<number, string[]>();
  const notaPorPlanta = new Map<number, string>();
  for (const a of asigsPlanta) {
    labsPorPlanta.set(a.planta_id, [...(labsPorPlanta.get(a.planta_id) ?? []), a.laboratorista_id]);
    if (a.observaciones && !notaPorPlanta.has(a.planta_id)) {
      notaPorPlanta.set(a.planta_id, a.observaciones);
    }
  }
  const plantasAsignables: PlantaAsignable[] = plantasRaw.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    plantelNombre: p.plantel.nombre,
    zona: p.plantel.zona,
    labIds: labsPorPlanta.get(p.id) ?? [],
    observaciones: notaPorPlanta.get(p.id) ?? "",
  }));

  // Turno de salida de planta del LABORATORISTA que está viendo la pantalla: qué planta
  // le toca hoy y la observación que le dejaron. Él no ve la sección del gestor.
  const misTurnosPlanta = soloLectura
    ? asigsPlanta
        .filter((a) => a.laboratorista_id === userId)
        .map((a) => ({
          planta: `${a.planta.plantel.nombre} · ${a.planta.nombre}`,
          zona: a.planta.plantel.zona,
          observaciones: a.observaciones ?? "",
        }))
    : [];

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
        labIds: p.asignaciones_lab.map((a) => a.laboratorista_id),
        muestrasUbicacion: p.muestras_ubicacion ?? "",
        muestrasCantidad: p.muestras_cantidad,
        ventana,
        ventanaTxt: ventana ? formatearVentana(ventana) : null,
        inicioMs: ventana ? ventana.inicioMs : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.inicioMs - b.inicioMs || a.empresa.localeCompare(b.empresa));

  // Traslapes: POR laboratorista, dos programas de cliente DISTINTO que se cruzan.
  // Un pedido puede tener VARIOS laboratoristas → se indexa cada (pedido, lab).
  const conConflicto = new Set<number>();
  const conflictos: string[] = [];
  const porLab = new Map<string, typeof filas>();
  for (const f of filas) {
    for (const labId of f.labIds) {
      const arr = porLab.get(labId) ?? [];
      arr.push(f);
      porLab.set(labId, arr);
    }
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
    labIds: f.labIds,
    enConflicto: conConflicto.has(f.pedidoId),
    muestrasUbicacion: f.muestrasUbicacion,
    muestrasCantidad: f.muestrasCantidad,
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
      {/* Turno de salida de planta del propio Laboratorista: qué planta le toca hoy y
          la observación que le dejó el Jefe de Laboratorio. Solo lectura. */}
      {soloLectura && misTurnosPlanta.length > 0 && (
        <Card className="mt-5 p-5">
          <h3 className="mb-1 text-sm font-semibold text-ink">
            Control de calidad a la salida de planta
          </h3>
          <p className="mb-3 text-xs text-muted">
            Planta que tienes asignada hoy para el control de salida, con las indicaciones
            del turno.
          </p>
          <ul className="space-y-2">
            {misTurnosPlanta.map((t, i) => (
              <li key={i} className="rounded-lg border border-border bg-surface p-3">
                <div className="font-medium text-ink">{t.planta}</div>
                <div className="text-[11px] text-muted">{t.zona}</div>
                {t.observaciones ? (
                  <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-sm text-sky-900">
                    <span className="font-semibold">Observación: </span>
                    {t.observaciones}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">Sin observaciones para el turno.</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {esGestor && (
        <Card className="mt-5 p-5">
          <AsignacionPlantas
            fecha={fecha}
            plantas={plantasAsignables}
            laboratoristas={laboratoristas}
          />
        </Card>
      )}
    </>
  );
}
