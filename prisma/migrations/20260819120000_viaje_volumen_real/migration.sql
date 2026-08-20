-- Volumen REAL cargado en un viaje, separado del volumen PROGRAMADO.
--
-- Regla del sistema: Despacho en vivo nunca escribe sobre la programacion. Las horas
-- ya seguian esa regla (hora_* programadas vs ts_*_real); el volumen no: al editarlo
-- en Despacho se sobreescribia volumen_asignado_m3, que es el dato del programa, y el
-- Programa DPCR-08 cambiaba solo (filas y totales) cuando se despachaba menos de lo
-- programado. Con esta columna el programa queda intacto y la realidad se registra
-- aparte. NULL = se cargo lo programado.
ALTER TABLE "viajes" ADD COLUMN "volumen_real_m3" DOUBLE PRECISION;

-- Restaurar el volumen PROGRAMADO de los viajes cuyo volumen ya fue editado desde
-- Despacho: la bitacora guarda el valor anterior de cada cambio, y el mas ANTIGUO por
-- viaje es el que se publico en el programa. Lo real (lo que hay hoy en la columna)
-- se mueve a volumen_real_m3.
WITH primer_cambio AS (
  SELECT DISTINCT ON (b."registro_id")
         b."registro_id" AS viaje_id,
         b."valor_anterior" AS programado
  FROM "bitacora_auditoria" b
  WHERE b."tabla_afectada" = 'viajes'
    AND b."campo_modificado" = 'volumen_asignado_m3'
    AND b."valor_anterior" ~ '^[0-9]+(\.[0-9]+)?$'
  ORDER BY b."registro_id", b."fecha_hora" ASC, b."id" ASC
)
UPDATE "viajes" v
SET "volumen_real_m3" = v."volumen_asignado_m3",
    "volumen_asignado_m3" = pc.programado::DOUBLE PRECISION
FROM primer_cambio pc
WHERE v."id" = pc.viaje_id
  AND v."volumen_asignado_m3" <> pc.programado::DOUBLE PRECISION;
