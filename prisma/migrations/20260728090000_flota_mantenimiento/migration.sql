-- Catálogos de equipo faltantes (camiones, pickups) + tabla de disponibilidad de
-- flota (mantenimientos / bajas de servicio) para Hito 6.
-- CreateTable
CREATE TABLE "camiones" (
    "id" SERIAL NOT NULL,
    "identificador" TEXT NOT NULL,
    "placa" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'Disponible',
    "plantel_base_id" INTEGER NOT NULL,
    CONSTRAINT "camiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickups" (
    "id" SERIAL NOT NULL,
    "identificador" TEXT NOT NULL,
    "placa" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'Disponible',
    "plantel_base_id" INTEGER NOT NULL,
    CONSTRAINT "pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disponibilidad_flota" (
    "id" SERIAL NOT NULL,
    "unidad_tipo" TEXT NOT NULL,
    "unidad_id" INTEGER NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "tipo_evento" TEXT NOT NULL,
    "motivo" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'Programado',
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "disponibilidad_flota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "camiones_identificador_key" ON "camiones"("identificador");
CREATE INDEX "camiones_plantel_base_id_idx" ON "camiones"("plantel_base_id");
CREATE INDEX "camiones_estado_idx" ON "camiones"("estado");
CREATE UNIQUE INDEX "pickups_identificador_key" ON "pickups"("identificador");
CREATE INDEX "pickups_plantel_base_id_idx" ON "pickups"("plantel_base_id");
CREATE INDEX "pickups_estado_idx" ON "pickups"("estado");
CREATE INDEX "disponibilidad_flota_unidad_tipo_unidad_id_idx" ON "disponibilidad_flota"("unidad_tipo", "unidad_id");
CREATE INDEX "disponibilidad_flota_estado_idx" ON "disponibilidad_flota"("estado");
CREATE INDEX "disponibilidad_flota_fecha_inicio_fecha_fin_idx" ON "disponibilidad_flota"("fecha_inicio", "fecha_fin");

-- AddForeignKey
ALTER TABLE "camiones" ADD CONSTRAINT "camiones_plantel_base_id_fkey" FOREIGN KEY ("plantel_base_id") REFERENCES "planteles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_plantel_base_id_fkey" FOREIGN KEY ("plantel_base_id") REFERENCES "planteles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
