-- AlterTable
ALTER TABLE "mixers" ADD COLUMN     "identificador" TEXT,
ADD COLUMN     "placa" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "mixers_identificador_key" ON "mixers"("identificador");
