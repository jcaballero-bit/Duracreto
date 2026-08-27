import { auth } from "@/auth";
import { diaDesdeISO, firmaLatido } from "@/lib/latido";
import { alcanceActual } from "@/lib/auth/guard";
import { filtroPlantelPorZona, plantelesDelFiltro } from "@/lib/auth/acceso";
import { plantelesCatalogo } from "@/lib/catalogos-cache";

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

  // Alcance: la firma vigila SOLO los planteles que este usuario ve, y si además tiene
  // un plantel elegido en la pantalla, solo ese. Sin esto, a un Despachador del Norte le
  // recargaba la pantalla completa cada vez que cambiaba algo en Centro Sur.
  //
  // El alcance se calcula en el SERVIDOR a partir de la sesión: el parámetro de la URL
  // solo puede ACOTAR (se intersecta), nunca ampliar.
  const alcance = await alcanceActual();
  if (!alcance) return new Response("No autorizado", { status: 401 });
  const permitidos = plantelesDelFiltro(filtroPlantelPorZona(alcance), await plantelesCatalogo());
  const pedido = Number(url.searchParams.get("plantel"));
  let plantelIds: number[] | null = permitidos;
  if (Number.isInteger(pedido) && pedido > 0) {
    plantelIds = permitidos === null || permitidos.includes(pedido) ? [pedido] : permitidos;
  }

  const v = await firmaLatido({ desde, hasta, plantelIds });

  return new Response(JSON.stringify({ v }), {
    headers: {
      "Content-Type": "application/json",
      // Nunca se cachea: el valor es justamente lo que se está vigilando.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
