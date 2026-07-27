-- Cancelación con motivo (marcar, no borrar) + snapshot de volumen programado
-- para medir adiciones del día. Indicadores comerciales por asesor.
-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "cancelado_por" TEXT,
ADD COLUMN     "detalle_cancelacion" TEXT,
ADD COLUMN     "estado_pedido" TEXT NOT NULL DEFAULT 'Activo',
ADD COLUMN     "fecha_cancelacion" TIMESTAMP(3),
ADD COLUMN     "motivo_cancelacion" TEXT,
ADD COLUMN     "volumen_programado" DOUBLE PRECISION;

-- Backfill: el volumen programado original = el volumen actual de los pedidos ya existentes.
UPDATE "pedidos" SET "volumen_programado" = "volumen_total_m3" WHERE "volumen_programado" IS NULL;
