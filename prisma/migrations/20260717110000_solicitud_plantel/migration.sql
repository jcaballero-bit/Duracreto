-- Clasificación por planta en las proyecciones semanales: qué planta atenderá
-- cada celda (puede variar por día para un mismo cliente).

-- AlterTable
ALTER TABLE "solicitudes_anticipadas" ADD COLUMN     "plantel_id" INTEGER;

-- AddForeignKey
ALTER TABLE "solicitudes_anticipadas" ADD CONSTRAINT "solicitudes_anticipadas_plantel_id_fkey" FOREIGN KEY ("plantel_id") REFERENCES "planteles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
