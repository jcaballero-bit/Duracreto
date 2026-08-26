-- Importacion del archivo del reloj biometrico.
--
-- Llave de vinculacion: el CODIGO del reloj (ej. 2000002), no el nombre - los nombres
-- vienen con mayusculas inconsistentes ("RONY RIOS" vs "Basilio Sanchez") y no son
-- confiables. Es unico: dos personas no pueden compartir el mismo codigo.
ALTER TABLE "operadores" ADD COLUMN "codigo_biometrico" TEXT;
CREATE UNIQUE INDEX "operadores_codigo_biometrico_key" ON "operadores"("codigo_biometrico");

-- Origen de cada fila de asistencia: "Manual" (digitada o corregida a mano) o
-- "Importado" (vino del reloj). Sirve para la proteccion contra sobreescritura: una
-- fila Manual no se reemplaza en silencio con lo que traiga el archivo.
ALTER TABLE "asistencia_operativos" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'Manual';
-- Trazabilidad: la fila COMPLETA que traia el reloj (incluidos sus propios calculos,
-- que NO se usan). Solo se llena en las filas importadas.
ALTER TABLE "asistencia_operativos" ADD COLUMN "datos_reloj" JSONB;
ALTER TABLE "asistencia_operativos" ADD COLUMN "departamento_reloj" TEXT;
CREATE INDEX "asistencia_operativos_origen_idx" ON "asistencia_operativos"("origen");

-- ---------------------------------------------------------------------------
-- Codigos del reloj que NO pertenecen al personal operativo (vigilancia,
-- administrativos, etc.). Se marcan una vez y no se vuelven a preguntar.
CREATE TABLE "codigos_biometricos_ignorados" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre_reloj" TEXT,
    "creado_por" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codigos_biometricos_ignorados_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "codigos_biometricos_ignorados_codigo_key"
    ON "codigos_biometricos_ignorados"("codigo");

-- ---------------------------------------------------------------------------
-- Correspondencia entre el "Departamento" del reloj (Produccion SPS, TALLER SPS,
-- CALIDAD SPS, PREFABRICADOS, JUTOSA...) y el plantel del sistema. Editable: los
-- nombres del reloj NO coinciden con los planteles, y no se debe depender de que lo
-- hagan. Un departamento sin correspondencia NO descarta la fila: se importa y se
-- senala para revision.
CREATE TABLE "mapeo_departamento_biometrico" (
    "id" SERIAL NOT NULL,
    "departamento" TEXT NOT NULL,
    "plantel_id" INTEGER,
    "creado_por" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mapeo_departamento_biometrico_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mapeo_departamento_biometrico_departamento_key"
    ON "mapeo_departamento_biometrico"("departamento");
ALTER TABLE "mapeo_departamento_biometrico" ADD CONSTRAINT "mapeo_departamento_biometrico_plantel_id_fkey"
    FOREIGN KEY ("plantel_id") REFERENCES "planteles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
