-- Planta dosificadora por VIAJE (no solo por pedido): en planteles con 2 plantas un
-- pedido puede repartir sus viajes entre ambas. Backfill = la planta del pedido.
ALTER TABLE "viajes" ADD COLUMN "planta_id" INTEGER;
UPDATE "viajes" v SET "planta_id" = p."planta_id" FROM "pedidos" p WHERE v."pedido_id" = p."id";
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_planta_id_fkey"
  FOREIGN KEY ("planta_id") REFERENCES "plantas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "viajes_planta_id_idx" ON "viajes"("planta_id");

-- Planta especifica del Dosificador (mas fino que el plantel).
ALTER TABLE "User" ADD COLUMN "planta_asignada_id" INTEGER;
ALTER TABLE "User" ADD CONSTRAINT "User_planta_asignada_id_fkey"
  FOREIGN KEY ("planta_asignada_id") REFERENCES "plantas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
