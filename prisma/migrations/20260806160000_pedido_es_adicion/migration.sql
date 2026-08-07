-- Marca de ADICION (creado desde Despacho en vivo) vs pedido de Programacion.
-- Aditiva: columna nueva con default false.
ALTER TABLE "pedidos" ADD COLUMN "es_adicion" BOOLEAN NOT NULL DEFAULT false;

-- Backfill heuristico para datos previos (no habia forma de saber el origen): los
-- pedidos creados el MISMO dia calendario que su fecha de suministro eran, en la
-- practica, adiciones de ultimo momento -> se marcan como adicion. Los programados
-- con anticipacion (creado en dia distinto) quedan como parte del programa.
UPDATE "pedidos"
SET "es_adicion" = true
WHERE date("creado_en") = date("hora_solicitada");

-- Coherencia con la nueva regla: una adicion no tiene linea base de programa.
UPDATE "pedidos" SET "volumen_programado" = 0 WHERE "es_adicion" = true;
