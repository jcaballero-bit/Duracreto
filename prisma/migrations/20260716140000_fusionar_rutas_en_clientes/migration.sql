-- Fusiona rutas_estandar dentro de clientes: una sola fuente de datos por
-- cliente/proyecto. Se agregan lat/long y los tiempos de referencia; se
-- traspasan los datos existentes de rutas_estandar ANTES de eliminar la tabla.

-- AlterTable: nuevas columnas en clientes
ALTER TABLE "clientes" ADD COLUMN     "latitud" DOUBLE PRECISION,
ADD COLUMN     "longitud" DOUBLE PRECISION,
ADD COLUMN     "tiempo_regreso_referencia_min" INTEGER,
ADD COLUMN     "tiempo_viaje_referencia_min" INTEGER;

-- Traspaso de datos: mover los tiempos de rutas_estandar al cliente dueño.
UPDATE "clientes" c
SET "tiempo_viaje_referencia_min"   = r."tiempo_viaje_referencia_min",
    "tiempo_regreso_referencia_min" = r."tiempo_regreso_referencia_min"
FROM "rutas_estandar" r
WHERE r."cliente_id" = c."id";

-- DropForeignKey
ALTER TABLE "rutas_estandar" DROP CONSTRAINT "rutas_estandar_cliente_id_fkey";

-- DropTable
DROP TABLE "rutas_estandar";
