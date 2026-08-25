-- Corrige la hora del periodo ancla insertado en la migracion anterior.
--
-- El sistema guarda los "dias" como MEDIANOCHE LOCAL (el runtime fija
-- TZ=America/Tegucigalpa en instrumentation.ts), que en la columna TIMESTAMP queda
-- como 06:00 UTC. El INSERT de la migracion anterior escribio 00:00, asi que la
-- busqueda por fecha_inicio (que la app arma con medianoche local) no encontraba la
-- fila y el periodo ancla aparecia como si no existiera.
--
-- Honduras no usa horario de verano, asi que el desfase es siempre de 6 horas.
UPDATE "periodos_pago"
SET "fecha_inicio" = "fecha_inicio" + interval '6 hours',
    "fecha_fin"    = "fecha_fin"    + interval '6 hours',
    "fecha_pago"   = "fecha_pago"   + interval '6 hours'
WHERE "fecha_inicio" = '2026-07-06 00:00:00';
