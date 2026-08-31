-- PRODUCCION HISTORICA: volumen despachado de periodos anteriores al uso del sistema.
--
-- Tabla APARTE a proposito. El calendario y el grafico se siguen alimentando de los
-- viajes en estado Completado exactamente como antes; esta tabla solo se consulta al
-- graficar y se combina con la del sistema, que siempre tiene precedencia. Ningun
-- proceso automatico escribe aqui: solo la carga manual o la importacion de
-- Administracion.
--
-- Nota: este proyecto NO usa el trigger tg_audit_row. La auditoria va por
-- bitacora_auditoria desde las server actions, como en el resto del sistema.
CREATE TABLE "produccion_historica" (
    "id" SERIAL NOT NULL,
    -- Dia, o primer dia del mes cuando la granularidad es Mensual.
    "fecha" TIMESTAMP(3) NOT NULL,
    "plantel_id" INTEGER NOT NULL,
    "volumen_m3" DOUBLE PRECISION NOT NULL,
    -- 'Diaria' | 'Mensual'
    "granularidad" TEXT NOT NULL,
    "observaciones" TEXT,
    "cargado_por" TEXT NOT NULL,
    "cargado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "produccion_historica_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "produccion_historica_fecha_plantel_id_granularidad_key"
    ON "produccion_historica"("fecha", "plantel_id", "granularidad");
CREATE INDEX "produccion_historica_fecha_idx" ON "produccion_historica"("fecha");

ALTER TABLE "produccion_historica"
    ADD CONSTRAINT "produccion_historica_plantel_id_fkey"
    FOREIGN KEY ("plantel_id") REFERENCES "planteles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Como se llama cada plantel en los archivos historicos ("SPS", "S. Marta"...). Se
-- recuerda para que la siguiente importacion no vuelva a preguntar.
CREATE TABLE "alias_plantel_historico" (
    "id" SERIAL NOT NULL,
    -- Alias NORMALIZADO (sin acentos ni mayusculas).
    "alias" TEXT NOT NULL,
    "plantel_id" INTEGER NOT NULL,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alias_plantel_historico_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "alias_plantel_historico_alias_key" ON "alias_plantel_historico"("alias");

ALTER TABLE "alias_plantel_historico"
    ADD CONSTRAINT "alias_plantel_historico_plantel_id_fkey"
    FOREIGN KEY ("plantel_id") REFERENCES "planteles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Se siembra con el nombre real de cada plantel, normalizado: asi un archivo que ya trae
-- "Santa Marta" o "CHOLOMA" se resuelve sin que nadie tenga que mapear nada.
INSERT INTO "alias_plantel_historico" ("alias", "plantel_id", "creado_por")
SELECT lower(btrim(nombre)), id, 'sistema' FROM "planteles"
ON CONFLICT ("alias") DO NOTHING;
