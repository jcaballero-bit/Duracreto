-- Registro del método de captura de la ubicación del cliente: GPS tomado en sitio
-- (con precisión) vs. enlace de Google Maps vs. manual, y cuándo se capturó.
-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "ubicacion_capturada_en" TIMESTAMP(3),
ADD COLUMN     "ubicacion_origen" TEXT,
ADD COLUMN     "ubicacion_precision_m" DOUBLE PRECISION;
