// Prepara la BD de PRUEBA (Postgres `duracreto_test`) antes de correr la suite:
// asegura el servidor embebido arriba, recrea la BD desde cero y aplica las
// migraciones. Se ejecuta una sola vez por corrida de vitest.
import { execSync } from "node:child_process";
import pg from "pg";
import { iniciarPg, PG_PASSWORD, PG_PORT, PG_USER, urlDe } from "../../scripts/pg";

const TEST_DB = "duracreto_test";
const TEST_DB_URL = urlDe(TEST_DB);

export default async function setup() {
  await iniciarPg(); // Postgres embebido arriba (idempotente)

  // Recrear la BD de prueba desde cero (conectando a la BD de mantenimiento).
  const admin = new pg.Client({
    host: "127.0.0.1",
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: "postgres",
  });
  await admin.connect();
  // Cortar conexiones abiertas a la BD de prueba antes de recrearla.
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [TEST_DB],
  );
  await admin.query(`drop database if exists "${TEST_DB}"`);
  await admin.query(`create database "${TEST_DB}"`);
  await admin.end();

  // Aplicar el esquema a la BD de prueba.
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });
}
