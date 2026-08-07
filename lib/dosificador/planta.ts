// Resolución de la planta EFECTIVA de un Dosificador en una fecha:
//   1) si existe una reasignación en `reasignaciones_dosificador_planta` para
//      (dosificador, fecha) → esa planta;
//   2) si no, su `planta_predeterminada_id`.
// De la planta efectiva se derivan su plantel y su zona. El Dosificador NO elige:
// la reasignación la crea el Jefe de Planta / Programador. Módulo puro-de-BD para
// poder probarlo en aislamiento; lo usa el guard al construir el Alcance.
import { prisma } from "@/lib/prisma";

export interface PlantaEfectiva {
  plantaId: number | null;
  plantelId: number | null;
  zona: string | null;
}

export async function resolverPlantaDosificador(
  dosificadorId: string,
  plantaPredeterminadaId: number | null,
  fecha: Date,
): Promise<PlantaEfectiva> {
  const dia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const manana = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 1);
  const reasig = await prisma.reasignaciones_dosificador_planta.findFirst({
    where: { dosificador_id: dosificadorId, fecha: { gte: dia, lt: manana } },
    select: { planta_id: true },
  });
  const plantaId = reasig?.planta_id ?? plantaPredeterminadaId ?? null;
  if (plantaId == null) return { plantaId: null, plantelId: null, zona: null };
  const planta = await prisma.plantas.findUnique({
    where: { id: plantaId },
    select: { plantel_id: true, plantel: { select: { zona: true } } },
  });
  return {
    plantaId,
    plantelId: planta?.plantel_id ?? null,
    zona: planta?.plantel.zona ?? null,
  };
}
