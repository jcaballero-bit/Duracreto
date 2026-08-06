-- Normaliza capacidad_asignada_m3 de los viajes PENDIENTES a la CARGA SEGURA de su
-- mixer (capacidad_fisica - 1 m3, el margen actual), para que empaten con el nuevo
-- emparejamiento del motor (que planifica con carga segura, no con la fisica).
-- Sin esto, un viaje pendiente cuya capacidad_asignada quedo en la fisica (8/10/12)
-- no empataria al recalcular y caeria en "Sin cubrir".
-- Solo toca viajes con mixer y NO finalizados; los completados/cancelados son
-- historicos y el motor no los reasigna, asi que se dejan intactos.
UPDATE "viajes" v
SET "capacidad_asignada_m3" = GREATEST(1, m."capacidad_m3" - 1)
FROM "mixers" m
WHERE v."mixer_id" = m."id"
  AND v."capacidad_asignada_m3" > 0
  AND v."estado" NOT IN ('Completado', 'Cancelado');
