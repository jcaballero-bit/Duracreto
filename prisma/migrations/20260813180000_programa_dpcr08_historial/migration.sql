-- Historial de versiones del Programa DPCR-08 generadas como PDF en el servidor.
-- Cada generacion guarda el SNAPSHOT de los datos, para poder volver a descargar
-- el documento EXACTO despues (documento controlado ISO), aunque la programacion
-- haya cambiado. Migracion ADITIVA: no toca ninguna tabla existente.
CREATE TABLE "programas_dpcr08" (
    "id" SERIAL NOT NULL,
    "fecha_programa" TIMESTAMP(3) NOT NULL,
    "zona" TEXT NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "generado_por" TEXT NOT NULL,
    "ts_generado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,

    CONSTRAINT "programas_dpcr08_pkey" PRIMARY KEY ("id")
);

-- Una sola fila por (dia, zona, version): la version es incremental por dia+zona.
CREATE UNIQUE INDEX "programas_dpcr08_fecha_programa_zona_version_key"
    ON "programas_dpcr08"("fecha_programa", "zona", "version");

CREATE INDEX "programas_dpcr08_fecha_programa_zona_idx"
    ON "programas_dpcr08"("fecha_programa", "zona");

CREATE INDEX "programas_dpcr08_ts_generado_idx"
    ON "programas_dpcr08"("ts_generado");
