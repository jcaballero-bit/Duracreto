-- Prestamo EXPLICITO de una unidad a otro plantel, por dia.
--
-- Distinto del prestamo implicito por hub (`planteles.hub_id`), que comparte la flota
-- del hub con todos los dependientes de la zona: aqui una persona decide que unidad
-- concreta va a que plantel y en que dia, y ese dia la unidad queda FIJADA alli (deja
-- de estar disponible en su plantel base y en el resto de la zona).
CREATE TABLE "prestamos_unidad" (
    "id"                 SERIAL       NOT NULL,
    "unidad_tipo"        TEXT         NOT NULL,
    "unidad_id"          INTEGER      NOT NULL,
    "plantel_origen_id"  INTEGER      NOT NULL,
    "plantel_destino_id" INTEGER      NOT NULL,
    "fecha"              TIMESTAMP(3) NOT NULL,
    "motivo"             TEXT,
    "creado_por"         TEXT         NOT NULL,
    "creado_en"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prestamos_unidad_pkey" PRIMARY KEY ("id")
);

-- Una unidad no puede estar prestada a dos planteles el mismo dia.
CREATE UNIQUE INDEX "prestamos_unidad_unidad_tipo_unidad_id_fecha_key"
    ON "prestamos_unidad"("unidad_tipo", "unidad_id", "fecha");
CREATE INDEX "prestamos_unidad_fecha_idx" ON "prestamos_unidad"("fecha");
CREATE INDEX "prestamos_unidad_plantel_destino_id_fecha_idx"
    ON "prestamos_unidad"("plantel_destino_id", "fecha");
CREATE INDEX "prestamos_unidad_plantel_origen_id_fecha_idx"
    ON "prestamos_unidad"("plantel_origen_id", "fecha");

ALTER TABLE "prestamos_unidad"
    ADD CONSTRAINT "prestamos_unidad_plantel_origen_id_fkey"
    FOREIGN KEY ("plantel_origen_id") REFERENCES "planteles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prestamos_unidad"
    ADD CONSTRAINT "prestamos_unidad_plantel_destino_id_fkey"
    FOREIGN KEY ("plantel_destino_id") REFERENCES "planteles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
