import { auth } from "@/auth";
import { alcanceActual } from "@/lib/auth/guard";
import { puedeAccederRuta } from "@/lib/auth/acceso";
import { alcanceDeParams, rangoDeParams } from "@/lib/reportes/filtro";
import { calcularDescargas } from "@/lib/reportes/descargas-datos";
import { descargasACsv, nombreArchivoDescargas } from "@/lib/reportes/descargas-csv";
import { leerUmbralesDescarga } from "@/lib/reportes/umbrales";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exportación del reporte de tiempos de descarga y esperas a CSV.
 *
 * Usa EXACTAMENTE los mismos helpers de filtro y de cálculo que la pantalla, así que
 * el archivo no puede desviarse de lo que se ve, y el enforcement es el mismo por los
 * dos caminos: se valida el rol y el alcance acota los planteles (un Jefe de Planta
 * que escriba a mano el id de otro plantel no obtiene datos ajenos).
 */
export async function GET(req: Request) {
  const sesion = await auth();
  if (!sesion?.user) return new Response("No autorizado", { status: 401 });
  if (!puedeAccederRuta(sesion.user.roles ?? [], "/reportes/descargas")) {
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
  const clienteParam = Number(url.searchParams.get("cliente"));
  const clienteId = Number.isInteger(clienteParam) && clienteParam > 0 ? clienteParam : null;

  const rango = rangoDeParams(sp);
  const ambito = await alcanceDeParams(alcance, sp);
  const umbrales = await leerUmbralesDescarga();

  const reporte = await calcularDescargas({
    desde: rango.desde,
    hasta: rango.hasta,
    plantelIds: ambito.plantelIds,
    clienteId,
    umbrales,
  });

  // Nombre del cliente para el encabezado del archivo. Se lee solo si hay filtro y se
  // valida que el cliente esté dentro del alcance (si no, no aparece en `clientes`).
  let cliente = "Todos los clientes";
  if (clienteId != null) {
    const enAlcance = reporte.clientes.find((c) => c.id === clienteId);
    if (enAlcance) cliente = enAlcance.etiqueta;
    else {
      const c = await prisma.clientes.findUnique({
        where: { id: clienteId },
        select: { empresa: true },
      });
      cliente = c ? c.empresa : "Todos los clientes";
    }
  }

  const csv = descargasACsv(reporte, umbrales, {
    desde: rango.desdeISO,
    hasta: rango.hastaISO,
    alcance: ambito.etiqueta,
    cliente,
    generadoPor: sesion.user.name ?? sesion.user.email ?? "sistema",
    generadoEn: new Date().toLocaleString("es-HN"),
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivoDescargas(
        rango.desde,
        new Date(rango.hasta.getTime() - 1),
      )}"`,
      "Cache-Control": "no-store",
    },
  });
}
