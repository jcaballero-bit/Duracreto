-- Observaciones del pedido y del plantel.
--
-- 1) El campo libre del pedido pasa a llamarse `observaciones`. Es un RENAME, no un
--    drop: el texto que ya estuviera cargado se conserva.
ALTER TABLE "pedidos" RENAME COLUMN "ubicacion_detalle" TO "observaciones";

-- 2) Nota operativa del PLANTEL para un dia (p. ej. "Enviar 5 mixers a Choloma").
CREATE TABLE "observaciones_plantel" (
    "id" SERIAL NOT NULL,
    "plantel_id" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "texto" TEXT NOT NULL,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observaciones_plantel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "observaciones_plantel_plantel_id_fecha_key"
    ON "observaciones_plantel"("plantel_id", "fecha");

CREATE INDEX "observaciones_plantel_fecha_idx" ON "observaciones_plantel"("fecha");

ALTER TABLE "observaciones_plantel"
    ADD CONSTRAINT "observaciones_plantel_plantel_id_fkey"
    FOREIGN KEY ("plantel_id") REFERENCES "planteles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
