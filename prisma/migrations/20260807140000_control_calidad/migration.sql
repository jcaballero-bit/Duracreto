-- Tanda 4: Control de calidad. Dos tablas que guardan SOLO lo nuevo (lo demas se
-- lee de viajes/pedidos, no se recaptura). Aditivo: no toca datos existentes.

-- Por VIAJE: revenimiento en obra + temperatura del concreto (los captura el
-- Laboratorista). Una fila por viaje (viaje_id unico).
CREATE TABLE "control_calidad_viaje" (
    "id" SERIAL NOT NULL,
    "viaje_id" INTEGER NOT NULL,
    "revenimiento_obra" DOUBLE PRECISION,
    "temperatura_concreto" DOUBLE PRECISION,
    "laboratorista_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_calidad_viaje_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "control_calidad_viaje_viaje_id_key" ON "control_calidad_viaje"("viaje_id");
ALTER TABLE "control_calidad_viaje" ADD CONSTRAINT "control_calidad_viaje_viaje_id_fkey" FOREIGN KEY ("viaje_id") REFERENCES "viajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "control_calidad_viaje" ADD CONSTRAINT "control_calidad_viaje_laboratorista_id_fkey" FOREIGN KEY ("laboratorista_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- General: una vez por pedido (cliente/dia). Preguntas al finalizar el servicio.
CREATE TABLE "control_calidad_general" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "laboratorista_id" TEXT,
    "observaciones" TEXT,
    "humedecio_area" BOOLEAN NOT NULL DEFAULT false,
    "vibro_concreto" BOOLEAN NOT NULL DEFAULT false,
    "m3_programados" DOUBLE PRECISION,
    "m3_colocados" DOUBLE PRECISION,
    "aplico_aditivo" BOOLEAN NOT NULL DEFAULT false,
    "aditivo_unidades" TEXT,
    "uso_curador" BOOLEAN NOT NULL DEFAULT false,
    "existe_reclamo" BOOLEAN NOT NULL DEFAULT false,
    "detalle_reclamo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_calidad_general_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "control_calidad_general_pedido_id_key" ON "control_calidad_general"("pedido_id");
ALTER TABLE "control_calidad_general" ADD CONSTRAINT "control_calidad_general_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "control_calidad_general" ADD CONSTRAINT "control_calidad_general_laboratorista_id_fkey" FOREIGN KEY ("laboratorista_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
