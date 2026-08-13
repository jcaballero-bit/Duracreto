-- Prompt B: varios laboratoristas por pedido + antiguedad de solicitud + plantel del operador.

-- F2: permitir UNO O MAS laboratoristas por pedido (antes pedido_id era UNIQUE = uno solo).
-- Se quita el unique de pedido_id y se agrega un unique compuesto (pedido_id, laboratorista_id)
-- para no duplicar el mismo laboratorista en el mismo pedido.
DROP INDEX "asignaciones_laboratorista_pedido_id_key";
CREATE UNIQUE INDEX "asignaciones_laboratorista_pedido_id_laboratorista_id_key" ON "asignaciones_laboratorista"("pedido_id", "laboratorista_id");
CREATE INDEX "asignaciones_laboratorista_pedido_id_idx" ON "asignaciones_laboratorista"("pedido_id");

-- F4: fecha/hora de la ultima modificacion de una solicitud anticipada, separada de creado_en
-- (para conservar el dato original de cuando se solicito = antiguedad).
ALTER TABLE "solicitudes_anticipadas" ADD COLUMN "actualizado_en" TIMESTAMP(3);

-- F5: plantel donde el operador trabaja normalmente (FK opcional a planteles). El MIXER
-- habitual sigue viviendo en mixers.operador_asignado_id (fuente unica), no aqui.
ALTER TABLE "operadores" ADD COLUMN "plantel_asignado_id" INTEGER;
ALTER TABLE "operadores" ADD CONSTRAINT "operadores_plantel_asignado_id_fkey" FOREIGN KEY ("plantel_asignado_id") REFERENCES "planteles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "operadores_plantel_asignado_id_idx" ON "operadores"("plantel_asignado_id");
