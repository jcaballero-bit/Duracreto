-- La produccion historica se puede cargar por PLANTEL o por PLANTA dosificadora.
--
-- `planta_id` NULL = la fila es del plantel completo (como todo lo cargado hasta ahora).
-- Los archivos viejos a veces traen el detalle por planta (STALO / SANY) y a veces solo el
-- total del plantel; se admiten los dos, pero NO mezclados en el mismo periodo: el total
-- del plantel mas el de sus plantas seria contar el mismo volumen dos veces.
ALTER TABLE "produccion_historica" ADD COLUMN "planta_id" INTEGER;

ALTER TABLE "produccion_historica"
    ADD CONSTRAINT "produccion_historica_planta_id_fkey"
    FOREIGN KEY ("planta_id") REFERENCES "plantas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "produccion_historica_planta_id_idx" ON "produccion_historica"("planta_id");

-- El indice unico anterior no contemplaba la planta.
DROP INDEX IF EXISTS "produccion_historica_fecha_plantel_id_granularidad_key";

-- Unicidad con DOS indices PARCIALES. Uno normal sobre (fecha, plantel, planta,
-- granularidad) NO serviria: Postgres considera distintos dos NULL, asi que dejaria
-- duplicar las filas de plantel (las que tienen planta_id NULL).
CREATE UNIQUE INDEX "produccion_historica_plantel_key"
    ON "produccion_historica"("fecha", "plantel_id", "granularidad")
    WHERE "planta_id" IS NULL;

CREATE UNIQUE INDEX "produccion_historica_planta_key"
    ON "produccion_historica"("fecha", "plantel_id", "planta_id", "granularidad")
    WHERE "planta_id" IS NOT NULL;
