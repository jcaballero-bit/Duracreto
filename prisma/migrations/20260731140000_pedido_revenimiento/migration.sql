-- Revenimiento (rango de asentamiento) por pedido, editable por Programador/Jefe de
-- Planta. Se muestra en Programacion, Despacho en vivo y Programa DPCR-08.
ALTER TABLE "pedidos" ADD COLUMN "revenimiento" TEXT;
