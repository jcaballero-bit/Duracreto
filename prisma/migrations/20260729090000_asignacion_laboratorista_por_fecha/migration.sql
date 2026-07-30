-- Cambia asignaciones_laboratorista de "indefinida" (activo boolean) a "por fecha".
-- Las filas viejas (indefinidas) ya no aplican con la nueva semantica: se eliminan.
DELETE FROM "asignaciones_laboratorista";

-- Quita el índice único viejo (laboratorista, cliente) y los índices simples.
DROP INDEX IF EXISTS "asignaciones_laboratorista_laboratorista_id_cliente_id_key";
DROP INDEX IF EXISTS "asignaciones_laboratorista_laboratorista_id_idx";
DROP INDEX IF EXISTS "asignaciones_laboratorista_cliente_id_idx";

-- Quita `activo`, agrega `fecha` (día específico).
ALTER TABLE "asignaciones_laboratorista" DROP COLUMN "activo";
ALTER TABLE "asignaciones_laboratorista" ADD COLUMN "fecha" TIMESTAMP(3) NOT NULL;

-- Nuevos índices: único por (laboratorista, cliente, fecha) + búsquedas por día.
CREATE UNIQUE INDEX "asignaciones_laboratorista_laboratorista_id_cliente_id_fecha_key" ON "asignaciones_laboratorista"("laboratorista_id", "cliente_id", "fecha");
CREATE INDEX "asignaciones_laboratorista_laboratorista_id_fecha_idx" ON "asignaciones_laboratorista"("laboratorista_id", "fecha");
CREATE INDEX "asignaciones_laboratorista_cliente_id_fecha_idx" ON "asignaciones_laboratorista"("cliente_id", "fecha");
