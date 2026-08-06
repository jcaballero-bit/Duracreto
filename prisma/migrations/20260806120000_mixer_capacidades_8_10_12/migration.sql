-- Correccion del estandar de capacidades de mixer: 7->8, 9->10, 11->12 m3.
-- Solo remapea las filas con esos valores exactos; cualquier otra capacidad queda
-- intacta. Las tres asignaciones tocan valores de origen distintos (7,9,11) y
-- destinos distintos (8,10,12), asi que ninguna fila se actualiza dos veces.
-- No es destructiva: solo cambia el numero de capacidad, no borra ni recrea nada.
UPDATE "mixers" SET "capacidad_m3" = 8 WHERE "capacidad_m3" = 7;
UPDATE "mixers" SET "capacidad_m3" = 10 WHERE "capacidad_m3" = 9;
UPDATE "mixers" SET "capacidad_m3" = 12 WHERE "capacidad_m3" = 11;
