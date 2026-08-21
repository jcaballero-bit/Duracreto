-- Un pedido puede necesitar VARIAS bombas (obras grandes: dos o mas equipos de
-- bombeo colocando al mismo tiempo). Antes solo cabia una (`pedidos.bomba_id`).
--
-- FUENTE UNICA del dato = esta tabla. `pedidos.bomba_id` queda OBSOLETA: se copia su
-- valor aqui y se pone en NULL para no tener dos versiones del mismo dato (la columna
-- no se borra en esta migracion para no hacer DDL destructivo).
CREATE TABLE "pedidos_bombas" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "bomba_id" INTEGER NOT NULL,
    CONSTRAINT "pedidos_bombas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pedidos_bombas_pedido_id_bomba_id_key" ON "pedidos_bombas"("pedido_id", "bomba_id");
CREATE INDEX "pedidos_bombas_pedido_id_idx" ON "pedidos_bombas"("pedido_id");
CREATE INDEX "pedidos_bombas_bomba_id_idx" ON "pedidos_bombas"("bomba_id");

ALTER TABLE "pedidos_bombas" ADD CONSTRAINT "pedidos_bombas_pedido_id_fkey"
    FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pedidos_bombas" ADD CONSTRAINT "pedidos_bombas_bomba_id_fkey"
    FOREIGN KEY ("bomba_id") REFERENCES "bombas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Traspasar la bomba que ya tenia cada pedido y dejar la columna vieja vacia.
INSERT INTO "pedidos_bombas" ("pedido_id", "bomba_id")
SELECT "id", "bomba_id" FROM "pedidos" WHERE "bomba_id" IS NOT NULL;

UPDATE "pedidos" SET "bomba_id" = NULL WHERE "bomba_id" IS NOT NULL;
