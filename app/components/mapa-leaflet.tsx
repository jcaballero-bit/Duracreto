"use client";

import { useEffect, useMemo, useRef } from "react";

// Leaflet se auto-aloja en /public/vendor/leaflet (sin npm ni CDN en runtime) y
// se carga bajo demanda solo en el navegador (necesita `window`).

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    L?: any;
  }
}

let promesaLeaflet: Promise<any> | null = null;

/** Carga Leaflet (CSS + JS auto-alojados) una sola vez y devuelve `window.L`. */
function cargarLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("sin window"));
  if (window.L) return Promise.resolve(window.L);
  if (promesaLeaflet) return promesaLeaflet;
  promesaLeaflet = new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/vendor/leaflet/leaflet.css";
      link.setAttribute("data-leaflet", "");
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "/vendor/leaflet/leaflet.js";
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("No se pudo cargar Leaflet"));
    document.body.appendChild(script);
  });
  return promesaLeaflet;
}

export interface PuntoMapa {
  id: string | number;
  lat: number;
  lng: number;
  color: string;
  popupHtml: string;
  // "circulo" (por defecto) = cliente; "cuadro" = plantel (marcador cuadrado).
  forma?: "circulo" | "cuadro";
}

/**
 * Mapa Leaflet + OpenStreetMap reutilizable. Dibuja un marcador circular por
 * punto (coloreado) con su popup. Ajusta el encuadre a los puntos.
 */
export function MapaLeaflet({
  puntos,
  centroLat = 15.2,
  centroLng = -87.9,
  zoom = 7,
  alto = "500px",
}: {
  puntos: PuntoMapa[];
  centroLat?: number;
  centroLng?: number;
  zoom?: number;
  alto?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Firma estable del contenido: evita reconstruir el mapa en re-renders iguales.
  const firma = useMemo(() => JSON.stringify(puntos), [puntos]);

  useEffect(() => {
    let map: any;
    let cancelado = false;
    cargarLeaflet()
      .then((L) => {
        if (cancelado || !ref.current) return;
        map = L.map(ref.current, { scrollWheelZoom: true }).setView(
          [centroLat, centroLng],
          zoom,
        );
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        const coords: [number, number][] = [];
        for (const p of puntos) {
          let marcador;
          if (p.forma === "cuadro") {
            // Plantel: marcador cuadrado (se distingue de los círculos de cliente).
            const icon = L.divIcon({
              className: "",
              html:
                `<div style="width:16px;height:16px;background:${p.color};` +
                `border:2px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            });
            marcador = L.marker([p.lat, p.lng], { icon }).addTo(map);
          } else {
            marcador = L.circleMarker([p.lat, p.lng], {
              radius: 9,
              color: "#ffffff",
              weight: 2,
              fillColor: p.color,
              fillOpacity: 0.9,
            }).addTo(map);
          }
          marcador.bindPopup(p.popupHtml);
          coords.push([p.lat, p.lng]);
        }
        if (coords.length > 0) {
          map.fitBounds(coords, { padding: [40, 40], maxZoom: 14 });
        }
      })
      .catch(() => {
        /* si Leaflet no carga, el contenedor queda vacío (no rompe la página) */
      });

    return () => {
      cancelado = true;
      if (map) map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, centroLat, centroLng, zoom]);

  return (
    <div
      ref={ref}
      style={{ height: alto }}
      className="z-0 w-full overflow-hidden rounded-lg border border-border"
    />
  );
}
