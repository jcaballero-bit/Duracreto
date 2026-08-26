-- Base de la pantalla de Asistencia.
--
-- `operadores.activo`: dar de baja a una persona sin borrar su historial. Es distinto
-- de `estado` ("Disponible" / "No disponible"), que es la disponibilidad del dia a dia
-- de un motorista para el motor de asignacion; `activo` es la relacion laboral.
ALTER TABLE "operadores" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "operadores_activo_idx" ON "operadores"("activo");

-- Quien y cuando hizo la ultima correccion de una fila de asistencia (el alta ya la
-- registraban `creado_por` / `creado_en`).
ALTER TABLE "asistencia_operativos" ADD COLUMN "actualizado_por" TEXT;
ALTER TABLE "asistencia_operativos" ADD COLUMN "actualizado_en" TIMESTAMP(3);

-- El origen del dato pasa a llamarse "Biometrico" (antes "Importado"), que es como lo
-- nombra el resto del sistema y la pantalla de Asistencia.
UPDATE "asistencia_operativos" SET "origen" = 'Biometrico' WHERE "origen" = 'Importado';
