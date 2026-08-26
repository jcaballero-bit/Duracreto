-- Una bomba puede tener VARIOS operadores: cambian por turno dentro del mismo dia
-- (decision del usuario, ago-2026).
--
-- El turno NO se captura aparte: a cada operador le corresponden las descargas de su
-- bomba que caen dentro de SU jornada de asistencia, que ya se registra. Asi el reparto
-- por turno sale del dato que se ingresa igual, sin digitacion diaria nueva; lo unico
-- que se captura aqui es QUIENES operan la bomba, que cambia rara vez.
--
-- FUENTE UNICA del dato = esta tabla. `bombas.operador_asignado_id` queda OBSOLETA: se
-- copia su valor aqui y se pone en NULL (no se borra la columna para no hacer DDL
-- destructivo), igual que se hizo con `pedidos.bomba_id` al pasar a `pedidos_bombas`.
CREATE TABLE "bombas_operadores" (
    "id" SERIAL NOT NULL,
    "bomba_id" INTEGER NOT NULL,
    "operador_id" INTEGER NOT NULL,
    CONSTRAINT "bombas_operadores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bombas_operadores_bomba_id_operador_id_key"
    ON "bombas_operadores"("bomba_id", "operador_id");
CREATE INDEX "bombas_operadores_bomba_id_idx" ON "bombas_operadores"("bomba_id");
CREATE INDEX "bombas_operadores_operador_id_idx" ON "bombas_operadores"("operador_id");
ALTER TABLE "bombas_operadores" ADD CONSTRAINT "bombas_operadores_bomba_id_fkey"
    FOREIGN KEY ("bomba_id") REFERENCES "bombas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bombas_operadores" ADD CONSTRAINT "bombas_operadores_operador_id_fkey"
    FOREIGN KEY ("operador_id") REFERENCES "operadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "bombas_operadores" ("bomba_id", "operador_id")
SELECT "id", "operador_asignado_id" FROM "bombas" WHERE "operador_asignado_id" IS NOT NULL;

UPDATE "bombas" SET "operador_asignado_id" = NULL WHERE "operador_asignado_id" IS NOT NULL;
