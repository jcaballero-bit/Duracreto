/**
 * Qué entra al Reporte de Control de Calidad.
 *
 * REGLA: solo los viajes **despachados de planta**. El reporte documenta concreto que
 * salió y se ensayó; un viaje cancelado (o que todavía no ha salido) no tiene nada que
 * documentar. Y si un cliente canceló TODO su suministro, no aparece en el reporte ni en
 * el selector de clientes.
 *
 * Ojo con la asimetría, que es deliberada: el viaje cancelado SÍ permanece en
 * Programación y en el Programa DPCR-08, porque esos son el programa publicado y no se
 * reescriben porque un viaje se caiga. Es solo aquí donde se excluye.
 *
 * El fragmento vive en un módulo aparte para que la pantalla y las pruebas usen
 * literalmente el mismo criterio.
 */
import { ESTADOS_DESPACHADO } from "@/lib/motor/config";

/** Filtro Prisma de un viaje que salió de planta (y que además tiene mixer). */
export const WHERE_VIAJE_DESPACHADO: {
  mixer_id: { not: null };
  estado: { in: string[] };
} = {
  mixer_id: { not: null },
  estado: { in: [...ESTADOS_DESPACHADO] },
};

/** Filtro Prisma de un pedido con al menos un viaje despachado. */
export const WHERE_PEDIDO_CON_DESPACHO = {
  viajes: { some: WHERE_VIAJE_DESPACHADO },
};
