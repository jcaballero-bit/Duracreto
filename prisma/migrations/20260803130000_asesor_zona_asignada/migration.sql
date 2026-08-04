-- Zona principal del asesor (Norte | Centro Sur). En Programa Semana un asesor con
-- zona ve solo las filas de asesores de su misma zona; sin zona (null) ve todas.
ALTER TABLE "asesores" ADD COLUMN "zona_asignada" TEXT;
