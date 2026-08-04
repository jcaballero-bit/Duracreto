-- Tipo de servicio del pedido (Normal | Servicio de Construccion). Lo elige el
-- asesor en la solicitud y filtra el catalogo de disenos de mezcla en Programacion.
ALTER TABLE "pedidos" ADD COLUMN "tipo_servicio" TEXT;
