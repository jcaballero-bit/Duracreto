-- El asesor decide si el cliente está activo (funde una sola vez vs. período largo).
-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true;
