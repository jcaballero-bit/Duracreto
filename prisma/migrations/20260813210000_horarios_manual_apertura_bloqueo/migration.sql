-- Ajuste de horarios del modo manual + apertura de planta por dia. Migracion
-- ADITIVA: solo agrega una columna con default y una tabla nueva; no toca datos.

-- 1) Hora FIJA por viaje: el reajuste de la cola de un cliente por frecuencia
--    salta estos viajes (y avisa). Distinto de `pedidos.hora_bloqueada`, que es la
--    regla equivalente a nivel de pedido para el motor automatico.
ALTER TABLE "viajes" ADD COLUMN "hora_fija" BOOLEAN NOT NULL DEFAULT false;

-- 2) Apertura de planta para un DIA concreto (excepcion puntual). Sin fila para el
--    dia rige la apertura por defecto (clave `hora_apertura_min` en `configuracion`).
CREATE TABLE "aperturas_planta" (
    "id" SERIAL NOT NULL,
    "planta_id" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "hora_apertura_min" INTEGER NOT NULL,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aperturas_planta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "aperturas_planta_planta_id_fecha_key"
    ON "aperturas_planta"("planta_id", "fecha");

CREATE INDEX "aperturas_planta_fecha_idx" ON "aperturas_planta"("fecha");

ALTER TABLE "aperturas_planta"
    ADD CONSTRAINT "aperturas_planta_planta_id_fkey"
    FOREIGN KEY ("planta_id") REFERENCES "plantas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
