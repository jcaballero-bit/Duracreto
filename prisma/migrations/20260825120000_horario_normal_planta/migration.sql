-- Control de despachos en horario extraordinario (Parte B).
--
-- IMPORTANTE: esto es DISTINTO de `configuracion_recargos` (Parte A) y no se debe
-- confundir. Aquellas son bandas de LEY LABORAL y aplican a las personas; esta es la
-- JORNADA OPERATIVA de cada planta y solo sirve para clasificar despachos. Coinciden
-- por defecto, pero se configuran por separado y una planta puede tener un horario
-- distinto a otra (p. ej. SANY hasta las 17:00 mientras STALO cierra a las 15:00).
CREATE TABLE "horario_normal_planta" (
    "id" SERIAL NOT NULL,
    "planta_id" INTEGER NOT NULL,
    "tipo_dia" TEXT NOT NULL, -- 'LunVie' | 'Sabado' | 'Domingo'
    "hora_apertura_min" INTEGER NOT NULL, -- minutos desde medianoche
    "hora_cierre_min" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "horario_normal_planta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "horario_normal_planta_planta_id_tipo_dia_key"
    ON "horario_normal_planta"("planta_id", "tipo_dia");
CREATE INDEX "horario_normal_planta_planta_id_idx" ON "horario_normal_planta"("planta_id");
ALTER TABLE "horario_normal_planta" ADD CONSTRAINT "horario_normal_planta_planta_id_fkey"
    FOREIGN KEY ("planta_id") REFERENCES "plantas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Precarga con el horario actual de TODAS las plantas: Lun-Vie 07:00-15:00 y
-- Sabado 07:00-11:00. El DOMINGO no lleva fila a proposito: la ausencia de una franja
-- activa significa "sin horario normal", o sea que todo el domingo es extraordinario.
-- Si algun dia una planta abre normal en domingo, se agrega su fila desde
-- Administracion (no hace falta cambiar codigo).
INSERT INTO "horario_normal_planta" ("planta_id", "tipo_dia", "hora_apertura_min", "hora_cierre_min")
SELECT "id", 'LunVie', 420, 900 FROM "plantas";
INSERT INTO "horario_normal_planta" ("planta_id", "tipo_dia", "hora_apertura_min", "hora_cierre_min")
SELECT "id", 'Sabado', 420, 660 FROM "plantas";

-- ---------------------------------------------------------------------------
-- La tabla clave-valor de configuracion solo guardaba enteros; el costo de la ficha
-- es un decimal (L 30.78 por m3), asi que gana una columna para valores decimales.
ALTER TABLE "configuracion" ADD COLUMN "valor_float" DOUBLE PRECISION;

-- Costo por m3 que la ficha de costos absorbe de sobretiempo, y el umbral (%) sobre el
-- cual se resalta una planta o un dia por su proporcion de volumen extraordinario.
INSERT INTO "configuracion" ("clave", "valor_int", "valor_float")
VALUES ('costo_ficha_por_m3', NULL, 30.78)
ON CONFLICT ("clave") DO NOTHING;
INSERT INTO "configuracion" ("clave", "valor_int", "valor_float")
VALUES ('umbral_volumen_extra_pct', 30, NULL)
ON CONFLICT ("clave") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cobro de sobretiempo hecho a un cliente (captura manual y opcional): sirve para
-- comparar la diferencia NETA cuando el sobretiempo si se le cobro a alguien.
CREATE TABLE "cobros_sobretiempo" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "cliente_id" INTEGER,
    "observaciones" TEXT,
    "creado_por" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cobros_sobretiempo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cobros_sobretiempo_fecha_idx" ON "cobros_sobretiempo"("fecha");
ALTER TABLE "cobros_sobretiempo" ADD CONSTRAINT "cobros_sobretiempo_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
