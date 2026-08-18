-- Laboratorio: instrucciones de muestreo por pedido, varios laboratoristas por planta
-- y observacion del turno. Migracion ADITIVA salvo el cambio de unicidad, que PASA de
-- (planta, fecha) a (planta, fecha, laboratorista): solo AFLOJA la restriccion, asi
-- que ninguna fila existente la viola.

-- 1) Instrucciones de muestreo del laboratorio, por pedido.
ALTER TABLE "pedidos" ADD COLUMN "muestras_ubicacion" TEXT;
ALTER TABLE "pedidos" ADD COLUMN "muestras_cantidad" INTEGER;

-- 2) Observacion del turno en la planta (la ve el laboratorista asignado).
ALTER TABLE "asignaciones_laboratorista_planta" ADD COLUMN "observaciones" TEXT;

-- 3) Varios laboratoristas por planta y dia.
DROP INDEX "asignaciones_laboratorista_planta_planta_id_fecha_key";

CREATE UNIQUE INDEX "asignaciones_laboratorista_planta_planta_id_fecha_laborator_key"
    ON "asignaciones_laboratorista_planta"("planta_id", "fecha", "laboratorista_id");

CREATE INDEX "asignaciones_laboratorista_planta_planta_id_fecha_idx"
    ON "asignaciones_laboratorista_planta"("planta_id", "fecha");
