-- Hielo por m³ estimado en la proyección semanal del asesor (se precarga al
-- convertir la solicitud en pedido).

-- AlterTable
ALTER TABLE "solicitudes_anticipadas" ADD COLUMN     "sacos_hielo_por_m3" INTEGER;
