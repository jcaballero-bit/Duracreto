import { MapPin, Navigation } from "lucide-react";
import { enlaceComoLlegar, enlaceVista } from "@/lib/geo/maps-link";

export interface UbicacionCliente {
  googleMapsUrl?: string | null;
  latitud?: number | null;
  longitud?: number | null;
}

/**
 * Botones de ubicación de la obra para Programación/Despacho/detalle:
 *  · "Ver en Google Maps" — abre el enlace exacto que compartió el asesor
 *    (`google_maps_url`); si no hay, reconstruye una vista desde lat/long.
 *  · "Cómo llegar" — navegación directa al destino (solo si hay coordenadas).
 * Si no hay ni enlace ni coordenadas, muestra "Ubicación no definida".
 */
export function BotonesMapa({
  ubicacion,
  compacto = false,
}: {
  ubicacion: UbicacionCliente;
  compacto?: boolean;
}) {
  const { googleMapsUrl, latitud, longitud } = ubicacion;
  const tieneCoords = latitud != null && longitud != null;
  const urlVista = googleMapsUrl || (tieneCoords ? enlaceVista(latitud!, longitud!) : null);

  if (!urlVista) {
    return <span className="text-xs text-muted">Ubicación no definida</span>;
  }

  const base =
    "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <a
        href={urlVista}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} text-link hover:bg-content`}
        title="Abrir la ubicación en Google Maps"
      >
        <MapPin size={13} />
        {compacto ? "Mapa" : "Ver en Google Maps"}
      </a>
      {tieneCoords && (
        <a
          href={enlaceComoLlegar(latitud!, longitud!)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} text-link hover:bg-content`}
          title="Trazar ruta hacia la obra desde tu ubicación actual"
        >
          <Navigation size={13} />
          Cómo llegar
        </a>
      )}
    </div>
  );
}
