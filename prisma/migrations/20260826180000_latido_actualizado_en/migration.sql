-- Marca de "ultima modificacion" para el LATIDO de las pantallas en vivo.
--
-- Las pantallas de Despacho, Programacion y Confirmaciones se refrescaban cada 10-15 s
-- volviendo a correr TODAS sus consultas (61-78 KB por tick), aunque no hubiera cambiado
-- nada: ~14 GB de transferencia al mes con la operacion normal, casi el triple del limite
-- del plan gratuito de Neon (que al agotarse SUSPENDE el compute hasta el mes siguiente).
--
-- Con estas columnas el navegador puede preguntar primero "cambio algo?" con una
-- consulta de agregados (~100 bytes) y recargar la pagina solo cuando la respuesta
-- cambia. Prisma las mantiene solo con @updatedAt; las filas viejas quedan en NULL y el
-- latido usa el conteo y el max(id) para no depender de ellas.
ALTER TABLE "viajes" ADD COLUMN "actualizado_en" TIMESTAMP(3);
ALTER TABLE "pedidos" ADD COLUMN "actualizado_en" TIMESTAMP(3);

-- El latido consulta max(actualizado_en) del dia: el indice evita recorrer la tabla.
CREATE INDEX "viajes_actualizado_en_idx" ON "viajes"("actualizado_en");
CREATE INDEX "pedidos_actualizado_en_idx" ON "pedidos"("actualizado_en");
