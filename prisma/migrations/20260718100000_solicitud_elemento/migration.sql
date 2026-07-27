-- Elemento estructural estimado en la proyección semanal (se precarga al
-- convertir la solicitud en pedido).

-- AlterTable
ALTER TABLE "solicitudes_anticipadas" ADD COLUMN     "elemento" TEXT;
