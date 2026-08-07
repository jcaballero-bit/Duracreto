-- Tanda 2: historial de cambios rapidos de estado de una unidad (mixer/bomba/
-- camion/pickup), con fecha/hora, para consultar el estado dia a dia. Aditiva.
CREATE TABLE "historial_estado_unidad" (
  "id" SERIAL NOT NULL,
  "unidad_tipo" TEXT NOT NULL,
  "unidad_id" INTEGER NOT NULL,
  "estado_anterior" TEXT,
  "estado_nuevo" TEXT NOT NULL,
  "fecha_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuario" TEXT,
  CONSTRAINT "historial_estado_unidad_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "historial_estado_unidad_unidad_tipo_unidad_id_idx"
  ON "historial_estado_unidad"("unidad_tipo", "unidad_id");
CREATE INDEX "historial_estado_unidad_fecha_hora_idx"
  ON "historial_estado_unidad"("fecha_hora");
