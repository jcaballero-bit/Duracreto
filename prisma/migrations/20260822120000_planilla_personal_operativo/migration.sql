-- Modulo de planilla del personal operativo (Parte A).
--
-- DECISION: la tabla `operadores` NO se renombra a `personal_operativo`. Su nombre lo
-- referencian mixers.operador_asignado_id, viajes.operador_id, el framework generico de
-- catalogos (Catalogo, columnas.ts, import-resolver.ts), la pantalla de Flota y el motor
-- (que pre-llena el motorista del viaje desde el mixer). Renombrarla toca ~10 archivos y
-- las plantillas CSV sin ganar nada operativo. En su lugar la tabla se GENERALIZA: gana
-- `puesto` (ahora guarda dosificadores, operadores de cargadora, etc.) y su etiqueta en
-- pantalla pasa a "Personal operativo".
ALTER TABLE "operadores" ADD COLUMN "puesto" TEXT NOT NULL DEFAULT 'Motorista_Mixer';
-- Dato SENSIBLE: solo el Administrador lo ve (pantalla /planilla). Base elegida =
-- MENSUAL, que es como se pacta el sueldo. El diario y el horario se DERIVAN:
--   salario_diario = salario_mensual / 30
--   salario_hora   = salario_diario / 8 = salario_mensual / 240
ALTER TABLE "operadores" ADD COLUMN "salario_mensual" DOUBLE PRECISION;
CREATE INDEX "operadores_puesto_idx" ON "operadores"("puesto");

-- ---------------------------------------------------------------------------
-- Bandas de recargo por tipo de dia. Editables desde Administracion: NUNCA fijas
-- en el codigo. Las horas se guardan como MINUTOS desde medianoche (misma
-- convencion que hora_apertura_min y bloqueo_edicion_hora_min), asi 24:00 = 1440
-- es representable.
CREATE TABLE "configuracion_recargos" (
    "id" SERIAL NOT NULL,
    "tipo_dia" TEXT NOT NULL,
    "hora_desde_min" INTEGER NOT NULL,
    "hora_hasta_min" INTEGER NOT NULL,
    "porcentaje_recargo" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "configuracion_recargos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "configuracion_recargos_tipo_dia_hora_desde_min_key"
    ON "configuracion_recargos"("tipo_dia", "hora_desde_min");
CREATE INDEX "configuracion_recargos_tipo_dia_idx" ON "configuracion_recargos"("tipo_dia");

INSERT INTO "configuracion_recargos" ("tipo_dia", "hora_desde_min", "hora_hasta_min", "porcentaje_recargo") VALUES
    ('LunVie',    0,  300,  75),
    ('LunVie',  300,  420,  25),
    ('LunVie',  420,  900,   0),
    ('LunVie',  900, 1140,  25),
    ('LunVie', 1140, 1320,  50),
    ('LunVie', 1320, 1440,  75),
    ('Sabado',    0,  300,  75),
    ('Sabado',  300,  420,  25),
    ('Sabado',  420,  660,   0),
    ('Sabado',  660, 1140,  25),
    ('Sabado', 1140, 1320,  50),
    ('Sabado', 1320, 1440,  75),
    ('Domingo',   0, 1440, 100);

-- ---------------------------------------------------------------------------
-- Asistencia diaria. Una fila por persona y dia (unica): asi la pantalla de
-- planilla puede hacer upsert por celda. Las horas por nivel de recargo se
-- CALCULAN con calcularHorasTurno y se guardan resueltas para no recalcular en
-- cada lectura; se recalculan cuando se edita la hora de entrada o salida.
CREATE TABLE "asistencia_operativos" (
    "id" SERIAL NOT NULL,
    "persona_id" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "hora_entrada" TIMESTAMP(3),
    "hora_salida" TIMESTAMP(3),
    "horas_normales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horas_extra_25" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horas_extra_50" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horas_extra_75" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horas_extra_100" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tipo_ausencia" TEXT,
    "costo_ausencia" DOUBLE PRECISION,
    "observaciones" TEXT,
    "creado_por" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asistencia_operativos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "asistencia_operativos_persona_id_fecha_key"
    ON "asistencia_operativos"("persona_id", "fecha");
CREATE INDEX "asistencia_operativos_fecha_idx" ON "asistencia_operativos"("fecha");
ALTER TABLE "asistencia_operativos" ADD CONSTRAINT "asistencia_operativos_persona_id_fkey"
    FOREIGN KEY ("persona_id") REFERENCES "operadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Periodos de pago catorcenales con 6 dias de rezago entre el cierre y el pago.
-- Periodo ancla: 06-jul-2026 a 19-jul-2026, se paga el 25-jul-2026. Los
-- siguientes se generan sumando 14 dias (fecha_pago = fecha_fin + 6 dias); el
-- Administrador puede ajustar uno especifico a mano.
CREATE TABLE "periodos_pago" (
    "id" SERIAL NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "fecha_pago" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'Abierto',
    CONSTRAINT "periodos_pago_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "periodos_pago_fecha_inicio_key" ON "periodos_pago"("fecha_inicio");

INSERT INTO "periodos_pago" ("fecha_inicio", "fecha_fin", "fecha_pago", "estado") VALUES
    ('2026-07-06 00:00:00', '2026-07-19 00:00:00', '2026-07-25 00:00:00', 'Abierto');
