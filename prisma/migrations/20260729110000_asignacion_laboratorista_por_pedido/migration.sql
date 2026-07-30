-- Cambia asignaciones_laboratorista de por-(cliente,fecha) a por-PEDIDO.
-- Las filas viejas ya no aplican con la nueva semantica: se eliminan.
DELETE FROM "asignaciones_laboratorista";

-- Quita indices y columnas de la version por-cliente/fecha.
DROP INDEX IF EXISTS "asignaciones_laboratorista_laboratorista_id_cliente_id_fecha_key";
DROP INDEX IF EXISTS "asignaciones_laboratorista_laboratorista_id_fecha_idx";
DROP INDEX IF EXISTS "asignaciones_laboratorista_cliente_id_fecha_idx";
ALTER TABLE "asignaciones_laboratorista" DROP CONSTRAINT IF EXISTS "asignaciones_laboratorista_cliente_id_fkey";
ALTER TABLE "asignaciones_laboratorista" DROP COLUMN "cliente_id";
ALTER TABLE "asignaciones_laboratorista" DROP COLUMN "fecha";

-- Nueva columna pedido_id (unica) + FK a pedidos.
ALTER TABLE "asignaciones_laboratorista" ADD COLUMN "pedido_id" INTEGER NOT NULL;
CREATE UNIQUE INDEX "asignaciones_laboratorista_pedido_id_key" ON "asignaciones_laboratorista"("pedido_id");
CREATE INDEX "asignaciones_laboratorista_laboratorista_id_idx" ON "asignaciones_laboratorista"("laboratorista_id");
ALTER TABLE "asignaciones_laboratorista" ADD CONSTRAINT "asignaciones_laboratorista_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
