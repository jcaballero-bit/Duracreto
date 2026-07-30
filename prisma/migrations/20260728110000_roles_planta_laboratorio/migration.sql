-- Roles nuevos (JefePlanta/Dosificador/Laboratorista/JefeLaboratorio) usan estas
-- estructuras: plantel_asignado por usuario + asignación de proyectos a laboratoristas.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "plantel_asignado_id" INTEGER;

-- CreateTable
CREATE TABLE "asignaciones_laboratorista" (
    "id" SERIAL NOT NULL,
    "laboratorista_id" TEXT NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asignaciones_laboratorista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asignaciones_laboratorista_laboratorista_id_idx" ON "asignaciones_laboratorista"("laboratorista_id");
CREATE INDEX "asignaciones_laboratorista_cliente_id_idx" ON "asignaciones_laboratorista"("cliente_id");
CREATE UNIQUE INDEX "asignaciones_laboratorista_laboratorista_id_cliente_id_key" ON "asignaciones_laboratorista"("laboratorista_id", "cliente_id");

-- AddForeignKey
ALTER TABLE "asignaciones_laboratorista" ADD CONSTRAINT "asignaciones_laboratorista_laboratorista_id_fkey" FOREIGN KEY ("laboratorista_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asignaciones_laboratorista" ADD CONSTRAINT "asignaciones_laboratorista_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_plantel_asignado_id_fkey" FOREIGN KEY ("plantel_asignado_id") REFERENCES "planteles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
