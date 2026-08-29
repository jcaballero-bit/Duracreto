// Sello de version del despliegue, para "Acerca de DURACRETO Logistics".
//
// Los valores crudos los incrusta `next.config.ts` al compilar (commit, rama, fecha del
// build). Aquí solo se les da forma. Es un módulo PURO: recibe el entorno como argumento
// para poder probarlo sin depender de con qué se compiló.
//
// Por qué la version es de CALENDARIO (`2026.08.28`) y no un `1.4.2` a mano: el sistema se
// despliega con cada cambio y nadie va a acordarse de subir un numero. La fecha del build
// mas el commit corto identifican EXACTAMENTE que codigo esta corriendo, se actualizan
// solos, y "el build del 28 de agosto" se entiende sin tener que consultar una tabla de
// versiones. El numero semantico de `package.json` se muestra aparte, para cuando se
// quiera marcar un hito.

export interface InfoVersion {
  /** Version visible, de calendario: "2026.08.28". */
  version: string;
  /** Commit corto, que hace unica cada compilacion: "a1b2c3d". */
  build: string;
  /** Commit completo, por si hay que buscarlo en el repositorio. */
  commit: string;
  rama: string;
  /** Fecha y hora del build, ya formateada para mostrar. */
  compiladoEn: string;
  /** ISO del build, para el atributo `dateTime`. */
  compiladoIso: string;
  /** Version semantica de package.json ("0.1.0"). */
  versionPaquete: string;
  /** "Producción" o "Desarrollo". */
  entorno: string;
}

const DESCONOCIDO = "desconocido";

/** Formatea la fecha del build en español, con hora. */
function fechaLarga(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DESCONOCIDO;
  return d.toLocaleString("es-HN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Version de calendario a partir de la fecha del build. */
function versionCalendario(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DESCONOCIDO;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/**
 * Valores crudos del build.
 *
 * Se leen como expresiones LITERALES `process.env.X`, no recorriendo `process.env` como
 * objeto: la clave `env` de `next.config.ts` funciona sustituyendo ese texto exacto en el
 * bundle al compilar. Pasar `process.env` entero y hacer `env.APP_COMMIT` deja la
 * sustitución sin efecto y todo sale "desconocido" — pasó, y solo se ve en la pantalla.
 */
const CRUDO: Record<string, string | undefined> = {
  APP_BUILD_ISO: process.env.APP_BUILD_ISO,
  APP_COMMIT: process.env.APP_COMMIT,
  APP_RAMA: process.env.APP_RAMA,
  APP_VERSION_PAQUETE: process.env.APP_VERSION_PAQUETE,
};

/**
 * Arma la información de versión. El entorno se recibe aparte porque en las pruebas
 * interesa comprobar las dos ramas sin tocar `NODE_ENV`.
 */
export function infoVersion(
  env: Record<string, string | undefined> = CRUDO,
  entornoProduccion = process.env.NODE_ENV === "production",
): InfoVersion {
  const iso = env.APP_BUILD_ISO ?? "";
  const commit = (env.APP_COMMIT ?? "").trim();
  return {
    version: versionCalendario(iso),
    build: commit ? commit.slice(0, 7) : DESCONOCIDO,
    commit: commit || DESCONOCIDO,
    rama: (env.APP_RAMA ?? "").trim() || DESCONOCIDO,
    compiladoEn: fechaLarga(iso),
    compiladoIso: iso,
    versionPaquete: (env.APP_VERSION_PAQUETE ?? "").trim() || DESCONOCIDO,
    entorno: entornoProduccion ? "Producción" : "Desarrollo",
  };
}

/** Quién construyó y mantiene el sistema. */
export const DESARROLLADOR = "Ing. Arturo Caballero";

/** Una línea de qué es esto, para el encabezado del panel. */
export const DESCRIPCION_SISTEMA =
  "Sistema de programación y despacho de concreto premezclado. Uso interno de DURACRETO.";
