// Se ejecuta en cada worker ANTES de importar los módulos de prueba, de modo que
// lib/prisma construya su cliente apuntando a la BD de PRUEBA de Postgres.
process.env.DATABASE_URL =
  "postgresql://duracreto:duracreto@localhost:5433/duracreto_test?schema=public";
(process.env as Record<string, string>).NODE_ENV = "test";
