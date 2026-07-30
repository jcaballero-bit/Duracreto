-- Fuerza el cambio de contraseña en el primer ingreso. Los usuarios YA existentes
-- no se fuerzan (ya venían operando): backfill a false.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "debe_cambiar_password" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: los usuarios que ya existían no deben ser forzados.
UPDATE "User" SET "debe_cambiar_password" = false;
