// Se ejecuta una vez al arrancar el servidor (antes de atender requests).
// Fija la zona horaria del proceso a Honduras si no viene ya del entorno, para
// que TODO el cálculo de fechas/horas del motor y las vistas use UTC-6 sin
// depender de la zona del servidor de despliegue.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.TZ) {
    process.env.TZ = "America/Tegucigalpa";
  }
}
