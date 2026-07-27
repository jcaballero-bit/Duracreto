-- CreateTable
CREATE TABLE "planteles" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "zona" TEXT NOT NULL,
    "capacidad_dosificacion_m3h" INTEGER NOT NULL,
    "hub_id" INTEGER,

    CONSTRAINT "planteles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantas" (
    "id" SERIAL NOT NULL,
    "plantel_id" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "capacidad_m3h" INTEGER NOT NULL,

    CONSTRAINT "plantas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operadores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'Disponible',

    CONSTRAINT "operadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mixers" (
    "id" SERIAL NOT NULL,
    "marca" TEXT NOT NULL,
    "capacidad_m3" INTEGER NOT NULL,
    "plantel_base_id" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'Disponible',
    "operador_asignado_id" INTEGER,

    CONSTRAINT "mixers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bombas" (
    "id" SERIAL NOT NULL,
    "identificador" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'Disponible',
    "plantel_base_id" INTEGER NOT NULL,

    CONSTRAINT "bombas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" SERIAL NOT NULL,
    "empresa" TEXT NOT NULL,
    "proyecto" TEXT NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "contacto" TEXT,
    "telefono" TEXT,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disenos_mezcla" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "resistencia_psi" INTEGER,
    "etiqueta_resistencia" TEXT,
    "tamano_agregado" TEXT,
    "revenimiento" TEXT NOT NULL,
    "sacos_hielo_por_m3" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aditivo_especial" TEXT,

    CONSTRAINT "disenos_mezcla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rutas_estandar" (
    "id" SERIAL NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "tiempo_viaje_referencia_min" INTEGER NOT NULL,
    "tiempo_regreso_referencia_min" INTEGER NOT NULL,

    CONSTRAINT "rutas_estandar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" SERIAL NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "diseno_id" INTEGER NOT NULL,
    "volumen_total_m3" DOUBLE PRECISION NOT NULL,
    "hora_solicitada" TIMESTAMP(3) NOT NULL,
    "plantel_id" INTEGER NOT NULL,
    "planta_id" INTEGER NOT NULL,
    "bomba_id" INTEGER,
    "tipo_descarga" TEXT NOT NULL,
    "elemento" TEXT,
    "ubicacion_detalle" TEXT,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viajes" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "mixer_id" INTEGER,
    "capacidad_asignada_m3" INTEGER NOT NULL,
    "volumen_asignado_m3" DOUBLE PRECISION NOT NULL,
    "operador_id" INTEGER,
    "hora_solicitada" TIMESTAMP(3) NOT NULL,
    "hora_inicio_carga" TIMESTAMP(3),
    "hora_fin_carga" TIMESTAMP(3),
    "hora_salida_planta" TIMESTAMP(3),
    "hora_llegada_proyecto" TIMESTAMP(3),
    "hora_inicio_descarga" TIMESTAMP(3),
    "hora_fin_descarga" TIMESTAMP(3),
    "hora_regreso_planta" TIMESTAMP(3),
    "ts_inicio_carga_real" TIMESTAMP(3),
    "ts_fin_carga_real" TIMESTAMP(3),
    "ts_salida_real" TIMESTAMP(3),
    "ts_llegada_real" TIMESTAMP(3),
    "ts_inicio_descarga_real" TIMESTAMP(3),
    "ts_fin_descarga_real" TIMESTAMP(3),
    "ts_regreso_real" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'Programado',
    "ajustado_manualmente" BOOLEAN NOT NULL DEFAULT false,
    "motivo_asignacion" TEXT,
    "ruta_por_defecto" BOOLEAN NOT NULL DEFAULT false,
    "estado_confirmacion" TEXT,
    "fecha_hora_confirmacion" TIMESTAMP(3),
    "usuario_confirmo" TEXT,

    CONSTRAINT "viajes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitacora_auditoria" (
    "id" SERIAL NOT NULL,
    "tabla_afectada" TEXT NOT NULL,
    "registro_id" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "fecha_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campo_modificado" TEXT NOT NULL,
    "valor_anterior" TEXT,
    "valor_nuevo" TEXT,
    "motivo" TEXT,

    CONSTRAINT "bitacora_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planteles_nombre_key" ON "planteles"("nombre");

-- CreateIndex
CREATE INDEX "planteles_zona_idx" ON "planteles"("zona");

-- CreateIndex
CREATE INDEX "plantas_plantel_id_idx" ON "plantas"("plantel_id");

-- CreateIndex
CREATE INDEX "operadores_estado_idx" ON "operadores"("estado");

-- CreateIndex
CREATE INDEX "mixers_plantel_base_id_idx" ON "mixers"("plantel_base_id");

-- CreateIndex
CREATE INDEX "mixers_estado_idx" ON "mixers"("estado");

-- CreateIndex
CREATE INDEX "mixers_capacidad_m3_idx" ON "mixers"("capacidad_m3");

-- CreateIndex
CREATE UNIQUE INDEX "bombas_identificador_key" ON "bombas"("identificador");

-- CreateIndex
CREATE INDEX "bombas_plantel_base_id_idx" ON "bombas"("plantel_base_id");

-- CreateIndex
CREATE INDEX "bombas_estado_idx" ON "bombas"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "disenos_mezcla_codigo_key" ON "disenos_mezcla"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "rutas_estandar_cliente_id_key" ON "rutas_estandar"("cliente_id");

-- CreateIndex
CREATE INDEX "pedidos_plantel_id_idx" ON "pedidos"("plantel_id");

-- CreateIndex
CREATE INDEX "pedidos_planta_id_idx" ON "pedidos"("planta_id");

-- CreateIndex
CREATE INDEX "pedidos_hora_solicitada_idx" ON "pedidos"("hora_solicitada");

-- CreateIndex
CREATE INDEX "viajes_pedido_id_idx" ON "viajes"("pedido_id");

-- CreateIndex
CREATE INDEX "viajes_mixer_id_idx" ON "viajes"("mixer_id");

-- CreateIndex
CREATE INDEX "viajes_estado_idx" ON "viajes"("estado");

-- CreateIndex
CREATE INDEX "bitacora_auditoria_tabla_afectada_registro_id_idx" ON "bitacora_auditoria"("tabla_afectada", "registro_id");

-- AddForeignKey
ALTER TABLE "planteles" ADD CONSTRAINT "planteles_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "planteles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantas" ADD CONSTRAINT "plantas_plantel_id_fkey" FOREIGN KEY ("plantel_id") REFERENCES "planteles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mixers" ADD CONSTRAINT "mixers_operador_asignado_id_fkey" FOREIGN KEY ("operador_asignado_id") REFERENCES "operadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mixers" ADD CONSTRAINT "mixers_plantel_base_id_fkey" FOREIGN KEY ("plantel_base_id") REFERENCES "planteles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bombas" ADD CONSTRAINT "bombas_plantel_base_id_fkey" FOREIGN KEY ("plantel_base_id") REFERENCES "planteles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas_estandar" ADD CONSTRAINT "rutas_estandar_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_diseno_id_fkey" FOREIGN KEY ("diseno_id") REFERENCES "disenos_mezcla"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_plantel_id_fkey" FOREIGN KEY ("plantel_id") REFERENCES "planteles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_planta_id_fkey" FOREIGN KEY ("planta_id") REFERENCES "plantas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_bomba_id_fkey" FOREIGN KEY ("bomba_id") REFERENCES "bombas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_mixer_id_fkey" FOREIGN KEY ("mixer_id") REFERENCES "mixers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
