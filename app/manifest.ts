import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA (se sirve en /manifest.webmanifest). Permite "instalar" el
 * sistema como app en el celular/tablet: icono en la pantalla de inicio con el
 * logo DURACRETO y apertura a pantalla completa como acceso directo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DURACRETO Logistics",
    short_name: "DURACRETO",
    description: "Sistema de programación y despacho de concreto premezclado",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1e293b",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
