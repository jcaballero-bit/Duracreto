-- Tanda 3: Jefe de Planta con varios planteles (M2M) + asignacion de Laboratorista
-- a la salida de una PLANTA (control de calidad de salida, por dia). Aditivo:
-- no borra ni altera datos existentes. Los roles nuevos (GerenteControlCalidad,
-- Almacen) viven solo en codigo (lib/auth/roles.ts), sin cambio de esquema.

-- Planteles del Jefe de Planta (muchos a muchos).
CREATE TABLE "jefes_planta_planteles" (
    "id" SERIAL NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "plantel_id" INTEGER NOT NULL,
    CONSTRAINT "jefes_planta_planteles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "jefes_planta_planteles_usuario_id_plantel_id_key" ON "jefes_planta_planteles"("usuario_id", "plantel_id");
CREATE INDEX "jefes_planta_planteles_usuario_id_idx" ON "jefes_planta_planteles"("usuario_id");
ALTER TABLE "jefes_planta_planteles" ADD CONSTRAINT "jefes_planta_planteles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jefes_planta_planteles" ADD CONSTRAINT "jefes_planta_planteles_plantel_id_fkey" FOREIGN KEY ("plantel_id") REFERENCES "planteles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Asignacion de Laboratorista a la salida de una PLANTA (por dia). Unica por
-- (planta, fecha): una nueva asignacion reemplaza la anterior de esa planta/dia.
CREATE TABLE "asignaciones_laboratorista_planta" (
    "id" SERIAL NOT NULL,
    "laboratorista_id" TEXT NOT NULL,
    "planta_id" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asignaciones_laboratorista_planta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "asignaciones_laboratorista_planta_planta_id_fecha_key" ON "asignaciones_laboratorista_planta"("planta_id", "fecha");
CREATE INDEX "asignaciones_laboratorista_planta_laboratorista_id_idx" ON "asignaciones_laboratorista_planta"("laboratorista_id");
ALTER TABLE "asignaciones_laboratorista_planta" ADD CONSTRAINT "asignaciones_laboratorista_planta_laboratorista_id_fkey" FOREIGN KEY ("laboratorista_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asignaciones_laboratorista_planta" ADD CONSTRAINT "asignaciones_laboratorista_planta_planta_id_fkey" FOREIGN KEY ("planta_id") REFERENCES "plantas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
