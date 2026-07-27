-- Permitir VARIAS proyecciones del mismo cliente el mismo día (p. ej. 4000 para
-- muros y 5000 para losa): se quita el unique (cliente_id, fecha_requerida) y se
-- deja como índice simple.

-- DropIndex
DROP INDEX "solicitudes_anticipadas_cliente_id_fecha_requerida_key";

-- CreateIndex
CREATE INDEX "solicitudes_anticipadas_cliente_id_fecha_requerida_idx" ON "solicitudes_anticipadas"("cliente_id", "fecha_requerida");
