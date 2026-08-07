import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { filtroPlantelPorZona } from "@/lib/auth/acceso";
import { compararPlanteles } from "@/lib/planteles-orden";
import { Card, PageHeader } from "../components/ui";
import { GestionReasignaciones, type DosificadorOpc, type PlantaOpc, type ReasignacionVista } from "./gestion";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Reasignación de planta de los Dosificadores por día (Jefe de Planta / Programador
 *  / Admin). El Dosificador NO elige: solo ve el resultado en Despacho en vivo. */
export default async function ReasignacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const alcance = await requerirAcceso("/reasignaciones");
  const sp = await searchParams;
  const fecha = sp.fecha ?? ymd(new Date());
  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  // Plantas dentro del alcance del gestor (Admin = todas).
  const scopePlantel = filtroPlantelPorZona(alcance);
  const [plantasRaw, dosificadoresRaw, reasigRaw] = await Promise.all([
    prisma.plantas.findMany({
      where: { plantel: scopePlantel },
      select: { id: true, nombre: true, plantel: { select: { nombre: true } } },
    }),
    prisma.user.findMany({
      where: { activo: true, roles: { some: { rol: "Dosificador" } } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        planta_predeterminada: { select: { nombre: true, plantel: { select: { nombre: true } } } },
      },
    }),
    prisma.reasignaciones_dosificador_planta.findMany({
      where: {
        fecha: { gte: ini, lt: fin },
        ...(alcance.esAdmin ? {} : { planta: { plantel: scopePlantel } }),
      },
      select: {
        id: true,
        dosificador: { select: { name: true, email: true } },
        planta: { select: { nombre: true, plantel: { select: { nombre: true } } } },
      },
    }),
  ]);

  const plantas: PlantaOpc[] = plantasRaw
    .slice()
    .sort(
      (a, b) =>
        compararPlanteles(a.plantel.nombre, b.plantel.nombre) || a.nombre.localeCompare(b.nombre),
    )
    .map((p) => ({ id: p.id, label: `${p.plantel.nombre} · ${p.nombre}` }));

  const dosificadores: DosificadorOpc[] = dosificadoresRaw.map((u) => ({
    id: u.id,
    nombre: u.name ?? u.email ?? "Dosificador",
    predeterminada: u.planta_predeterminada
      ? `${u.planta_predeterminada.plantel.nombre} · ${u.planta_predeterminada.nombre}`
      : "Sin planta predeterminada",
  }));

  const reasignaciones: ReasignacionVista[] = reasigRaw.map((r) => ({
    id: r.id,
    dosificador: r.dosificador.name ?? r.dosificador.email ?? "Dosificador",
    planta: `${r.planta.plantel.nombre} · ${r.planta.nombre}`,
  }));

  return (
    <>
      <PageHeader
        titulo="Reasignación de Dosificadores"
        descripcion="Reasigna temporalmente a un Dosificador a otra planta un día específico. El Dosificador no elige nada: verá reflejada la planta que le asignes en Despacho en vivo (o su planta predeterminada si no hay reasignación ese día)."
      />
      <Card className="p-5">
        <GestionReasignaciones
          fecha={fecha}
          dosificadores={dosificadores}
          plantas={plantas}
          reasignaciones={reasignaciones}
        />
      </Card>
    </>
  );
}
