-- Reparto de carga entre plantas por pedido. En planteles con 2 plantas, true =
-- los viajes se reparten entre ambas (carga simultanea); false = todos en la
-- planta elegida. Aditiva: columna nueva con default; no toca datos existentes.
ALTER TABLE "pedidos" ADD COLUMN "usar_ambas_plantas" BOOLEAN NOT NULL DEFAULT false;
