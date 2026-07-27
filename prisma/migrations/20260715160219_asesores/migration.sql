-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "asesor_id" INTEGER;

-- CreateTable
CREATE TABLE "asesores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT,
    "usuario_auth_id" TEXT,

    CONSTRAINT "asesores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asesores_usuario_auth_id_key" ON "asesores"("usuario_auth_id");

-- CreateIndex
CREATE INDEX "clientes_asesor_id_idx" ON "clientes"("asesor_id");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_asesor_id_fkey" FOREIGN KEY ("asesor_id") REFERENCES "asesores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asesores" ADD CONSTRAINT "asesores_usuario_auth_id_fkey" FOREIGN KEY ("usuario_auth_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
