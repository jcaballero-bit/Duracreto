// Aplica las migraciones pendientes en el despliegue, con REINTENTOS.
//
// Por qué existe: `prisma migrate deploy` toma un advisory lock de Postgres antes de
// migrar y se rinde a los 10 s (P1002). Eso falla el build en dos situaciones que no
// son un error real del proyecto:
//  · **Dos despliegues a la vez** (p. ej. dos commits pusheados seguidos): el primero
//    tiene el lock y el segundo lo espera. Reintentar es exactamente lo correcto —
//    cuando el primero termina, el segundo ve "No pending migrations".
//  · **Neon arrancando en frío** o latencia del endpoint `-pooler`: la primera
//    conexión tarda más que el tiempo de espera del lock.
//
// El lock NO se desactiva (`PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`) a propósito: es la
// única protección contra dos migraciones simultáneas escribiendo `_prisma_migrations`.
// Se prefiere esperar.
//
// Solo se reintenta ante fallos TRANSITORIOS (lock ocupado / no se pudo conectar). Un
// error real de migración (SQL inválido, migración fallida, deriva de esquema) falla
// de inmediato: el build DEBE romperse si una migración está mal.

import { spawnSync } from "node:child_process";

const INTENTOS = 5;
const ESPERA_BASE_MS = 6000;

/** Patrones de fallo que vale la pena reintentar (no son culpa del código). */
const TRANSITORIOS = [
  "P1002", // el servidor respondió pero se agotó el tiempo (incluye el advisory lock)
  "P1001", // no se pudo alcanzar el servidor (Neon despertando)
  "advisory lock",
  "Timed out fetching a new connection",
  "Can't reach database server",
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function intentar() {
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(salida);
  return { ok: r.status === 0, salida };
}

for (let intento = 1; intento <= INTENTOS; intento++) {
  const { ok, salida } = intentar();
  if (ok) {
    if (intento > 1) console.log(`\n[migrate] listo en el intento ${intento}.`);
    process.exit(0);
  }

  const transitorio = TRANSITORIOS.some((p) => salida.includes(p));
  if (!transitorio) {
    console.error("\n[migrate] error NO transitorio: se detiene el build.");
    process.exit(1);
  }
  if (intento === INTENTOS) {
    console.error(`\n[migrate] sigue sin poder migrar tras ${INTENTOS} intentos.`);
    process.exit(1);
  }

  // Espera creciente: da tiempo a que el otro despliegue suelte el lock.
  const espera = ESPERA_BASE_MS * intento;
  console.log(
    `\n[migrate] fallo transitorio (lock ocupado o base despertando). ` +
      `Reintento ${intento + 1}/${INTENTOS} en ${espera / 1000}s…`,
  );
  await esperar(espera);
}
