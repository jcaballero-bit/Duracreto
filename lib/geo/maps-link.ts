// Utilidades PURAS para leer/armar enlaces de Google Maps.
//
// El asesor pega un enlace de Google Maps (dejando caer un pin en la obra y
// tocando "Compartir"). De ahí extraemos latitud/longitud SIN llamar a ninguna
// API externa: los enlaces largos ya traen las coordenadas en el texto de la URL.
// Los enlaces cortos (maps.app.goo.gl / goo.gl/maps) NO las traen visibles y hay
// que resolver la redirección primero (eso vive en una server action que usa
// estas mismas funciones sobre la URL larga resultante).
//
// NOTA DE ROBUSTEZ: Google puede cambiar el formato de sus enlaces. Si un patrón
// deja de reconocer una URL, `extraerCoordsDeUrl` devuelve null y el flujo de
// arriba permite guardar el cliente igual (ubicación en blanco) + mostrar aviso.

export interface Coords {
  lat: number;
  lng: number;
}

// Patrones en orden de PRIORIDAD (del más preciso al más laxo). Cada entrada dice
// qué grupo capturado es la latitud y cuál la longitud (algunos formatos internos
// de Google ponen la longitud PRIMERO).
//  1. `!3d<lat>!4d<lng>` — coordenadas exactas del lugar/pin (data param).
//  2. `?q=`/`query=`/`ll=`/`destination=`/`center=`/`daddr=` = pares lat,lng.
//  3. `@<lat>,<lng>` — centro del mapa (puede diferir un poco del pin).
//  4. `!2d<lng>!3d<lat>` — formato embebido en HTML/protobuf (¡lng primero!).
//  5. Un par `lat,lng` como segmento de ruta (`/14.08,-87.20`).
const NUM = "(-?\\d+(?:\\.\\d+)?)";
interface Patron {
  re: RegExp;
  lat: number; // índice del grupo con la latitud
  lng: number; // índice del grupo con la longitud
}
const PATRONES: Patron[] = [
  { re: new RegExp(`!3d${NUM}!4d${NUM}`), lat: 1, lng: 2 },
  {
    re: new RegExp(`[?&](?:q|query|ll|destination|center|daddr)=${NUM},${NUM}`, "i"),
    lat: 1,
    lng: 2,
  },
  { re: new RegExp(`@${NUM},${NUM}`), lat: 1, lng: 2 },
  { re: new RegExp(`!2d${NUM}!3d${NUM}`), lat: 2, lng: 1 },
  { re: new RegExp(`/${NUM},${NUM}`), lat: 1, lng: 2 },
];

/** ¿Las coordenadas son geográficamente plausibles (y no el (0,0) nulo)? */
function esValida(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Normaliza los marcadores que Google codifica en el texto (HTML o URL): `%21`→`!`
 * y `%2C`→`,`. NO hace un decodeURIComponent completo (que fallaría con `%` sueltos
 * en HTML grandes); solo reemplaza esos dos tokens, que son los que separan las
 * coordenadas.
 */
function normalizar(texto: string): string {
  return texto.replace(/%21/gi, "!").replace(/%2C/gi, ",");
}

/**
 * Extrae lat/lng del texto de una URL de Google Maps —o del cuerpo HTML de la
 * página resuelta—. Devuelve null si ningún patrón coincide o las coordenadas no
 * son válidas.
 */
export function extraerCoordsDeUrl(url: string | null | undefined): Coords | null {
  if (!url) return null;
  const texto = normalizar(url);
  for (const p of PATRONES) {
    const m = texto.match(p.re);
    if (m) {
      const lat = Number.parseFloat(m[p.lat]);
      const lng = Number.parseFloat(m[p.lng]);
      if (esValida(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/** ¿Es un enlace CORTO de Google Maps (necesita resolver la redirección)? */
export function esEnlaceCorto(url: string | null | undefined): boolean {
  if (!url) return false;
  return /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url);
}

/** Enlace de VISTA (solo muestra el punto) a partir de coordenadas. */
export function enlaceVista(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Enlace de NAVEGACIÓN ("Cómo llegar") hacia el destino, desde la ubicación actual. */
export function enlaceComoLlegar(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
