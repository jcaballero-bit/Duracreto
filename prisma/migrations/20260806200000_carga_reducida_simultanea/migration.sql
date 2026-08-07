-- Tanda 1: carga reducida (pendiente/acceso dificil) + carga simultanea en 2 plantas.

-- Flags por pedido (aditivos, default false).
ALTER TABLE "pedidos" ADD COLUMN "carga_simultanea" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pedidos" ADD COLUMN "carga_reducida" BOOLEAN NOT NULL DEFAULT false;

-- Config editable de capacidades reducidas (NO hardcodeada).
CREATE TABLE "capacidades_reducidas" (
  "id" SERIAL NOT NULL,
  "capacidad_nominal_m3" INTEGER NOT NULL,
  "capacidad_efectiva_m3" INTEGER NOT NULL,
  CONSTRAINT "capacidades_reducidas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "capacidades_reducidas_capacidad_nominal_m3_key"
  ON "capacidades_reducidas"("capacidad_nominal_m3");

-- Precarga con los valores ya conocidos (editable desde Administracion).
INSERT INTO "capacidades_reducidas" ("capacidad_nominal_m3", "capacidad_efectiva_m3")
VALUES (8, 6), (10, 8), (12, 10);
