-- TEMPORAL/REVERSIBLE: override manual de hora de carga por el Administrador.
-- Aditiva: columna nueva nullable; null = comportamiento automatico (cascada).
-- Con el flag PERMITIR_HORA_CARGA_MANUAL apagado, la columna se ignora.
ALTER TABLE "pedidos" ADD COLUMN "hora_carga_manual" TIMESTAMP(3);
