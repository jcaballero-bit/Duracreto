import { auth } from "@/auth";
import { diaDesdeISO, firmaLatido } from "@/lib/latido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Latido de las pantallas en vivo: devuelve una firma corta del rango pedido.
 *
 * El navegador la consulta cada pocos segundos y solo pide el refresco completo de la
 * página cuando la firma cambia. La respuesta pesa ~100 bytes frente a los 61-78 KB que
 * costaba releer la pantalla entera en cada tick.
 *
 * Solo dice "cambió / no cambió" (conteos y marcas de tiempo agregadas), así que no
 * expone datos de negocio; igual exige sesión, porque nada de la aplicación responde a
 * un anónimo.
 */
export async function GET(req: Request) {
  const sesion = await auth();
  if (!sesion?.user) return new Response("No autorizado", { status: 401 });

  const url = new URL(req.url);
  const desde = diaDesdeISO(url.searchParams.get("desde"));
  const hastaParam = diaDesdeISO(url.searchParams.get("hasta"));
  if (!desde) return new Response("Falta el parámetro desde=YYYY-MM-DD", { status: 400 });
  // Por defecto, el día de `desde` (la mayoría de las pantallas son de un solo día).
  const hasta =
    hastaParam ?? new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + 1);

  const v = await firmaLatido({ desde, hasta });

  return new Response(JSON.stringify({ v }), {
    headers: {
      "Content-Type": "application/json",
      // Nunca se cachea: el valor es justamente lo que se está vigilando.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
