// Service worker mínimo para la PWA de DURACRETO Logistics.
// NO cachea (es un acceso directo en línea al sistema): solo existe para cumplir
// el criterio de instalabilidad y dejar que el navegador ofrezca "Instalar app".
// El handler de fetch es pass-through (no intercepta), así siempre se ve la versión
// más reciente servida por el servidor.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Sin respondWith: el navegador maneja la petición normalmente (red).
});
