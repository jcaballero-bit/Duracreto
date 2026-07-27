// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL local embebido para desarrollo (reemplaza al SQLite de Fase 1/2).
//
// Usa el binario real de Postgres que trae `embedded-postgres` (sin Docker ni
// instalación de sistema). El clúster se crea una sola vez con initdb; el
// arranque se hace con `pg_ctl start` DESACOPLADO, así el servidor persiste como
// proceso en segundo plano entre `dev`/`seed`/`test` hasta `db:down` o reinicio.
//
// Uso:  tsx scripts/pg.ts up|down
// Los npm scripts `predev`/`predb:seed`/`predb:reset` lo levantan automáticamente.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

export const PG_PORT = 5433;
export const PG_USER = "duracreto";
export const PG_PASSWORD = "duracreto";
export const DATA_DIR = path.resolve(process.cwd(), ".pgdata");
export const LOG_FILE = path.resolve(process.cwd(), "logfile");
export const DBS = ["duracreto", "duracreto_test"];

export function urlDe(db: string): string {
  return `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${db}?schema=public`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ¿Hay algo escuchando ya en el puerto de Postgres? */
function puertoResponde(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const cerrar = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(800);
    socket.once("connect", () => cerrar(true));
    socket.once("timeout", () => cerrar(false));
    socket.once("error", () => cerrar(false));
  });
}

/** Ruta al binario pg_ctl del paquete platform-específico de embedded-postgres. */
function pgCtl(): string {
  const key = `${process.platform}-${process.arch}`;
  const paquete: Record<string, string> = {
    "win32-x64": "windows-x64",
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "darwin-x64": "darwin-x64",
    "darwin-arm64": "darwin-arm64",
  };
  const dir = path.resolve(
    process.cwd(),
    "node_modules/@embedded-postgres",
    paquete[key],
    "native/bin",
  );
  return path.join(dir, process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
}

/** Crea las bases de datos del proyecto si no existen. */
async function asegurarDbs(): Promise<void> {
  const cliente = new pg.Client({
    host: "127.0.0.1",
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: "postgres",
  });
  await cliente.connect();
  for (const db of DBS) {
    const res = await cliente.query("select 1 from pg_database where datname = $1", [db]);
    if (res.rowCount === 0) await cliente.query(`create database "${db}"`);
  }
  await cliente.end();
}

/** Arranca Postgres (idempotente, desacoplado) y asegura las BD del proyecto. */
export async function iniciarPg(): Promise<void> {
  // initdb una sola vez (crea el clúster con el superusuario y su contraseña).
  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    await new EmbeddedPostgres({
      databaseDir: DATA_DIR,
      user: PG_USER,
      password: PG_PASSWORD,
      port: PG_PORT,
      persistent: true,
    }).initialise();
  }

  if (!(await puertoResponde(PG_PORT))) {
    const r = spawnSync(
      pgCtl(),
      ["start", "-D", DATA_DIR, "-l", LOG_FILE, "-o", `-p ${PG_PORT}`, "-w"],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error("pg_ctl start falló");
    for (let i = 0; i < 20 && !(await puertoResponde(PG_PORT)); i++) await sleep(300);
  }

  await asegurarDbs();
}

/** Detiene el servidor Postgres. */
export async function detenerPg(): Promise<void> {
  if (!(await puertoResponde(PG_PORT))) return;
  spawnSync(pgCtl(), ["stop", "-D", DATA_DIR, "-m", "fast", "-w"], {
    stdio: "inherit",
  });
}

// CLI
const accion = process.argv[2];
if (accion === "up") {
  iniciarPg()
    .then(() => {
      console.log(`Postgres listo en :${PG_PORT} (BD: ${DBS.join(", ")}).`);
      process.exit(0);
    })
    .catch((e) => {
      console.error("Error al iniciar Postgres:", e?.message ?? e);
      process.exit(1);
    });
} else if (accion === "down") {
  detenerPg()
    .then(() => {
      console.log("Postgres detenido.");
      process.exit(0);
    })
    .catch((e) => {
      console.error("Error al detener Postgres:", e?.message ?? e);
      process.exit(1);
    });
}
