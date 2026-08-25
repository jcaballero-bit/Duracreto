import { auth } from "@/auth";
import { alcanceActual } from "@/lib/auth/guard";
import { puedeAccederRuta } from "@/lib/auth/acceso";
import { alcanceDeParams, rangoDeParams } from "@/lib/extraordinario/filtro";
import { calcularExtraordinario } from "@/lib/extraordinario/metricas";
import { nombreArchivoCsv, reporteACsv } from "@/lib/extraordinario/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exportación del reporte de horario extraordinario a CSV.
 *
 * Usa EXACTAMENTE los mismos helpers de filtro y de cálculo que la pantalla, así que
 * el archivo no puede desviarse de lo que se ve, y el enforcement es el mismo por los
 * dos caminos: la ruta valida el rol y el alcance acota los planteles (un Jefe de
 * Planta que escriba a mano el id de otro plantel no obtiene datos ajenos).
 */
export async function GET(req: Request) {
  const sesion = await auth();
  if (!sesion?.user) return new Response("No autorizado", { status: 401 });
  if (!puedeAccederRuta(sesion.user.roles ?? [], "/extraordinario")) {
    return new Response("Sin permiso para este reporte", { status: 403 });
  }
  const alcance = await alcanceActual();
  if (!alcance) return new Response("Sesión no válida", { status: 401 });

  const url = new URL(req.url);
  const sp = {
    desde: url.searchParams.get("desde") ?? undefined,
    hasta: url.searchParams.get("hasta") ?? undefined,
    zona: url.searchParams.get("zona") ?? undefined,
    plantel: url.searchParams.get("plantel") ?? undefined,
  };

  const rango = rangoDeParams(sp);
  const ambito = await alcanceDeParams(alcance, sp);
  const resumen = await calcularExtraordinario({
    desde: rango.desde,
    hasta: rango.hasta,
    plantelIds: ambito.plantelIds,
  });

  const ahora = new Date();
  const csv = reporteACsv(resumen, {
    desde: rango.desdeISO,
    hasta: rango.hastaISO,
    alcance: ambito.etiqueta,
    generadoPor: sesion.user.name ?? sesion.user.email ?? "sistema",
    generadoEn: ahora.toLocaleString("es-HN"),
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivoCsv(rango.desde, new Date(rango.hasta.getTime() - 1))}"`,
      "Cache-Control": "no-store",
    },
  });
}
