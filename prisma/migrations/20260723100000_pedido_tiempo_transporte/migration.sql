-- Tiempo de transporte (ida) por pedido, precargado del cliente y editable por el
-- Programador. Null = usa el tiempo del cliente. El regreso se asume igual a la ida.
-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "tiempo_transporte_min" INTEGER;
