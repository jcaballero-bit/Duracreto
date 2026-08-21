-- Revenimiento y temperatura a la SALIDA DE PLANTA, que toma el laboratorista de
-- planta cuando el mixer termina de cargar. Son distintos de los de obra
-- (`revenimiento_obra` / `temperatura_concreto`), que toma el laboratorista del
-- proyecto al llegar: el reporte de calidad imprime los dos pares para poder
-- comparar como salio el concreto contra como llego.
ALTER TABLE "control_calidad_viaje" ADD COLUMN "revenimiento_planta" DOUBLE PRECISION;
ALTER TABLE "control_calidad_viaje" ADD COLUMN "temperatura_planta" DOUBLE PRECISION;
