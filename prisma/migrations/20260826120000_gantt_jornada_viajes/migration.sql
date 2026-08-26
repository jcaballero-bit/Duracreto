-- Gantt de jornada vs. viajes: lo que hace falta para poder atribuir el trabajo a cada
-- puesto.

-- 1) OPERADOR DE LA BOMBA. Sin este dato no se puede medir al Operador_Bomba (no se
-- sabe que bomba opera cada uno). Es el equivalente de `mixers.operador_asignado_id`:
-- el operador HABITUAL de esa bomba. Si a futuro resulta que la bomba cambia de
-- operador segun el dia, se agrega una tabla de asignacion por fecha encima (como
-- `reasignaciones_dosificador_planta` hace con el dosificador) y este campo queda como
-- el predeterminado.
ALTER TABLE "bombas" ADD COLUMN "operador_asignado_id" INTEGER;
CREATE INDEX "bombas_operador_asignado_id_idx" ON "bombas"("operador_asignado_id");
ALTER TABLE "bombas" ADD CONSTRAINT "bombas_operador_asignado_id_fkey"
    FOREIGN KEY ("operador_asignado_id") REFERENCES "operadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) VINCULO entre la ficha de personal y el usuario del sistema (mismo patron que
-- `asesores.usuario_auth_id`). Hace falta para el Dosificador: su planta del dia vive
-- en el USUARIO (`User.planta_predeterminada_id` + `reasignaciones_dosificador_planta`),
-- no en la ficha de personal. Sin vinculo, el Gantt cae a la planta unica del plantel
-- cuando no hay ambiguedad, y si el plantel tiene 2 plantas lo dice en vez de adivinar.
ALTER TABLE "operadores" ADD COLUMN "usuario_id" TEXT;
CREATE UNIQUE INDEX "operadores_usuario_id_key" ON "operadores"("usuario_id");
ALTER TABLE "operadores" ADD CONSTRAINT "operadores_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) UMBRALES DE TIEMPO SIN VIAJE, POR PUESTO. Los porcentajes NO son comparables entre
-- puestos: un motorista ocupa ~90 min por ciclo completo y un dosificador ~15-20 min por
-- carga, asi que con el mismo ritmo de trabajo el dosificador marca un ocio mucho mayor.
-- Por eso cada puesto tiene su propia escala, editable desde Administracion.
--   minutos_hueco = a partir de cuantos minutos se DIBUJA el hueco (el calculo del
--                   total ocioso incluye todos, tambien los cortos).
--   verde_pct / amarillo_pct = cortes del semaforo (por encima del amarillo, rojo).
CREATE TABLE "umbrales_ocio_puesto" (
    "id" SERIAL NOT NULL,
    "puesto" TEXT NOT NULL,
    "minutos_hueco" INTEGER NOT NULL DEFAULT 45,
    "verde_pct" INTEGER NOT NULL DEFAULT 20,
    "amarillo_pct" INTEGER NOT NULL DEFAULT 40,
    CONSTRAINT "umbrales_ocio_puesto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "umbrales_ocio_puesto_puesto_key" ON "umbrales_ocio_puesto"("puesto");

INSERT INTO "umbrales_ocio_puesto" ("puesto", "minutos_hueco", "verde_pct", "amarillo_pct") VALUES
    ('Motorista_Mixer',  45, 20, 40),
    ('Motorista_Camion', 45, 20, 40),
    -- El dosificador solo esta ocupado mientras carga: su ocio normal es mucho mayor.
    ('Dosificador',      60, 50, 70),
    ('Operador_Bomba',   60, 40, 60);
