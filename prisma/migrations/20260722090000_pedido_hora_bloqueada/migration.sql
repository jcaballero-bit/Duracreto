-- Hora de llegada fija (excepción manual): la cascada respeta hora_solicitada
-- como llegada exacta y no reprograma ese pedido junto al resto.

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "hora_bloqueada" BOOLEAN NOT NULL DEFAULT false;
