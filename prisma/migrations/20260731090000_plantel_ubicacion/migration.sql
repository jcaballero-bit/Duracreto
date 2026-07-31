-- Ubicacion geografica de cada plantel (para el mapa de cobertura comercial).
ALTER TABLE "planteles" ADD COLUMN "latitud" DOUBLE PRECISION;
ALTER TABLE "planteles" ADD COLUMN "longitud" DOUBLE PRECISION;
