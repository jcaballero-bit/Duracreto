-- CreateTable
CREATE TABLE "metas_asesor" (
    "id" SERIAL NOT NULL,
    "asesor_id" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "meta_m3" DOUBLE PRECISION NOT NULL,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metas_asesor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metas_asesor_anio_mes_idx" ON "metas_asesor"("anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "metas_asesor_asesor_id_anio_mes_key" ON "metas_asesor"("asesor_id", "anio", "mes");

-- AddForeignKey
ALTER TABLE "metas_asesor" ADD CONSTRAINT "metas_asesor_asesor_id_fkey" FOREIGN KEY ("asesor_id") REFERENCES "asesores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

