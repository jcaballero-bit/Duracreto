import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// ── Sello de VERSION del despliegue ─────────────────────────────────────────────
// Se calcula UNA vez, aqui, al compilar: el commit y la fecha del build identifican
// exactamente que codigo esta corriendo, y se actualizan solos con cada cambio sin que
// nadie tenga que acordarse de subir un numero a mano.
//
// En Netlify el repositorio esta clonado y ademas expone `COMMIT_REF` y `BRANCH`; en
// local se leen de git. Todo va en try/catch: un despliegue NO puede fallar porque no
// se pudo leer el commit — en el peor caso la pantalla dice "desconocido".
function gitCorto(cmd: string, porDefecto = ""): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return porDefecto;
  }
}

const commit = process.env.COMMIT_REF ?? gitCorto("git rev-parse HEAD");
const rama = process.env.BRANCH ?? gitCorto("git rev-parse --abbrev-ref HEAD");
const versionPaquete = (() => {
  try {
    return JSON.parse(readFileSync("./package.json", "utf8")).version as string;
  } catch {
    return "";
  }
})();


const nextConfig: NextConfig = {
  // @react-pdf/renderer se usa SOLO en el servidor (genera el PDF del Programa
  // DPCR-08) y trae dependencias nativas de Node (fontkit, zlib). Se deja fuera del
  // bundler para que Next no intente empaquetarlo.
  serverExternalPackages: ["@react-pdf/renderer"],
  // El encabezado ISO del PDF lleva el logo real: hay que incluir el archivo en el
  // bundle de la función de servidor (si no, en producción no existe `public/`).
  outputFileTracingIncludes: {
    "/programa/pdf": ["./public/logo-duracreto.png"],
  },
  // Estos valores quedan INCRUSTADOS en el build (no se leen en cada arranque): son el
  // sello de la version que se muestra en "Acerca de DURACRETO Logistics".
  env: {
    APP_COMMIT: commit,
    APP_RAMA: rama,
    APP_VERSION_PAQUETE: versionPaquete,
    APP_BUILD_ISO: new Date().toISOString(),
  },
  experimental: {
    // El archivo del reloj biometrico se sube a una server action. El de prueba pesa
    // 366 KB (9 dias), asi que una catorcena completa puede acercarse al limite de 1 MB
    // que Next aplica por defecto al cuerpo de una server action.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
