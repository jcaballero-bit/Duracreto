// Cliente mínimo de OpenRouteService (cálculo de tiempo de manejo por carretera).
// Env-gated: si no hay `ORS_API_KEY` en el entorno, o la API falla / no hay
// cobertura, devuelve null — el que llama debe caer a captura MANUAL (nunca a un
// valor por defecto silencioso). NO agrega dependencias (usa fetch nativo).
//
// Para habilitarlo en producción: setear ORS_API_KEY (cuenta gratuita en
// openrouteservice.org). Sin la clave, el cálculo automático simplemente no ocurre
// y el formulario pide el tiempo manualmente.

const ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

/**
 * Minutos de manejo entre dos coordenadas (ida), o null si no se pudo calcular
 * (sin clave, error de red, sin ruta). Nunca lanza.
 */
export async function duracionRutaMin(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<number | null> {
  const key = process.env.ORS_API_KEY;
  if (!key) return null;
  if (![fromLat, fromLng, toLat, toLng].every((n) => Number.isFinite(n))) return null;
  try {
    const res = await fetch(ORS_URL, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      // ORS usa [lng, lat].
      body: JSON.stringify({ coordinates: [[fromLng, fromLat], [toLng, toLat]] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const dur = (data as { routes?: { summary?: { duration?: number } }[] })?.routes?.[0]
      ?.summary?.duration;
    if (typeof dur !== "number" || !Number.isFinite(dur)) return null;
    return Math.max(1, Math.round(dur / 60)); // segundos → minutos
  } catch {
    return null;
  }
}

/** Distancia haversine en km (para elegir el plantel más cercano como origen). */
export function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
