-- Planta predeterminada del Dosificador + reasignaciones por día (Jefe de Planta /
-- Programador). Aditivo/no destructivo: el RENAME preserva los datos existentes
-- (la que antes era "planta_asignada" pasa a ser la "predeterminada").

-- 1) Renombrar la columna del Dosificador: planta_asignada_id -> planta_predeterminada_id.
--    (El FK sigue funcionando; solo cambia el nombre de la columna.)
ALTER TABLE "User" RENAME COLUMN "planta_asignada_id" TO "planta_predeterminada_id";

-- 2) Reasignaciones temporales de planta por día. Única por (dosificador, fecha):
--    una nueva reemplaza la anterior de ese día (upsert en la acción).
CREATE TABLE "reasignaciones_dosificador_planta" (
    "id" SERIAL NOT NULL,
    "dosificador_id" TEXT NOT NULL,
    "planta_id" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reasignaciones_dosificador_planta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reasignaciones_dosificador_planta_dosificador_id_fecha_key" ON "reasignaciones_dosificador_planta"("dosificador_id", "fecha");
CREATE INDEX "reasignaciones_dosificador_planta_fecha_idx" ON "reasignaciones_dosificador_planta"("fecha");
ALTER TABLE "reasignaciones_dosificador_planta" ADD CONSTRAINT "reasignaciones_dosificador_planta_dosificador_id_fkey" FOREIGN KEY ("dosificador_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reasignaciones_dosificador_planta" ADD CONSTRAINT "reasignaciones_dosificador_planta_planta_id_fkey" FOREIGN KEY ("planta_id") REFERENCES "plantas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
