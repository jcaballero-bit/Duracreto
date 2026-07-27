-- Orden de atención del pedido dentro de su plantel+fecha (base de la cola para
-- la cascada de horarios). Se asigna MAX+1 al crear y es reordenable.

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "orden_dia" INTEGER;
