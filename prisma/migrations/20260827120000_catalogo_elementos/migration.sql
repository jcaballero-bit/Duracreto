-- Catalogo de ELEMENTOS de obra: las sugerencias del desplegable de "Elemento".
--
-- NO convierte `pedidos.elemento` ni `solicitudes_anticipadas.elemento` en llaves
-- foraneas: siguen siendo texto libre. El catalogo solo alimenta el desplegable, y el
-- buscador del desplegable permite escribir uno que no este en la lista.
CREATE TABLE "elementos" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "elementos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "elementos_nombre_key" ON "elementos"("nombre");

-- Se siembra con los elementos que YA se usan, para que la lista no nazca vacia: se
-- toman los distintos de pedidos y de las proyecciones del Programa Semana, recortados
-- y sin los vacios.
--
-- Normalizacion: mayuscula SOLO en la inicial. En la base convive "LOSA ENTREPISO" con
-- "Losa entrepiso", y el indice unico rechazaria los duplicados; con esto ambos caen en
-- "Losa entrepiso". Se descarto `initcap` porque capitaliza cada palabra y en espanol
-- deja "Muro De Contencion" en vez de "Muro de contencion".
INSERT INTO "elementos" ("nombre")
SELECT DISTINCT upper(left(btrim(e), 1)) || lower(substr(btrim(e), 2))
  FROM (
    SELECT elemento AS e FROM "pedidos" WHERE elemento IS NOT NULL AND btrim(elemento) <> ''
    UNION ALL
    SELECT elemento AS e FROM "solicitudes_anticipadas" WHERE elemento IS NOT NULL AND btrim(elemento) <> ''
  ) AS usados
ON CONFLICT ("nombre") DO NOTHING;
