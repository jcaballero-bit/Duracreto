-- Configuracion global clave-valor (editable desde Administracion). Aditivo.
CREATE TABLE "configuracion" (
    "clave" TEXT NOT NULL,
    "valor_int" INTEGER,
    CONSTRAINT "configuracion_pkey" PRIMARY KEY ("clave")
);
