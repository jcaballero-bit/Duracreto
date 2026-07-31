-- Proyeccion semanal: revenimiento estimado y tipo de servicio (Normal / Servicio
-- de Construccion). Se muestran al Programador al convertir el pedido.
ALTER TABLE "solicitudes_anticipadas" ADD COLUMN "revenimiento" TEXT;
ALTER TABLE "solicitudes_anticipadas" ADD COLUMN "tipo_servicio" TEXT;
