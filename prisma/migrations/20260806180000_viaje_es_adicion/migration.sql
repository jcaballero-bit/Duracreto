-- Marca de ADICION a nivel de viaje: viajes agregados con "Agregar viaje" en
-- Despacho a un pedido de programa (o los de un pedido es_adicion). No forman parte
-- del Programa DPCR-08 aunque su pedido si lo sea. Aditiva: columna con default.
ALTER TABLE "viajes" ADD COLUMN "es_adicion" BOOLEAN NOT NULL DEFAULT false;

-- Coherencia: todos los viajes de un pedido-adicion quedan marcados como adicion.
UPDATE "viajes" v
SET "es_adicion" = true
FROM "pedidos" p
WHERE v."pedido_id" = p."id" AND p."es_adicion" = true;
