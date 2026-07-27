-- Proyección semanal de asesores (reemplaza el Excel): tabla de solicitudes
-- anticipadas + campo de frecuencia entre camiones en pedidos (usado por el motor).

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "frecuencia_entre_camiones_min" INTEGER;

-- CreateTable
CREATE TABLE "solicitudes_anticipadas" (
    "id" SERIAL NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "asesor_id" INTEGER,
    "fecha_requerida" TIMESTAMP(3) NOT NULL,
    "volumen_estimado_m3" DOUBLE PRECISION,
    "tipo_concreto_estimado" TEXT,
    "tipo_descarga_estimado" TEXT,
    "frecuencia_entre_camiones_min" INTEGER,
    "observaciones" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'Pendiente',
    "pedido_id" INTEGER,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_anticipadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_anticipadas_pedido_id_key" ON "solicitudes_anticipadas"("pedido_id");

-- CreateIndex
CREATE INDEX "solicitudes_anticipadas_fecha_requerida_estado_idx" ON "solicitudes_anticipadas"("fecha_requerida", "estado");

-- CreateIndex
CREATE INDEX "solicitudes_anticipadas_asesor_id_idx" ON "solicitudes_anticipadas"("asesor_id");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_anticipadas_cliente_id_fecha_requerida_key" ON "solicitudes_anticipadas"("cliente_id", "fecha_requerida");

-- AddForeignKey
ALTER TABLE "solicitudes_anticipadas" ADD CONSTRAINT "solicitudes_anticipadas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_anticipadas" ADD CONSTRAINT "solicitudes_anticipadas_asesor_id_fkey" FOREIGN KEY ("asesor_id") REFERENCES "asesores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_anticipadas" ADD CONSTRAINT "solicitudes_anticipadas_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
