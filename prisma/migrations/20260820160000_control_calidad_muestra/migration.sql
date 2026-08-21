-- De QUE viaje se tomo la muestra, y donde. El laboratorista de PLANTA marca su
-- casilla y el de OBRA la suya (son independientes: un mismo viaje puede tener
-- muestra en los dos lados). El reporte de calidad lo imprime por viaje y resume
-- abajo si el muestreo fue en planta, en obra o en ambos.
ALTER TABLE "control_calidad_viaje" ADD COLUMN "muestra_planta" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "control_calidad_viaje" ADD COLUMN "muestra_obra" BOOLEAN NOT NULL DEFAULT false;
