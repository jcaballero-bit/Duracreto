-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "asesor_id" INTEGER;

-- AlterTable
ALTER TABLE "plantas" ADD COLUMN     "tiempo_alistamiento_min" INTEGER NOT NULL DEFAULT 5;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_asesor_id_fkey" FOREIGN KEY ("asesor_id") REFERENCES "asesores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
