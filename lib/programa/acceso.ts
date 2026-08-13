// Reglas de ACCESO al Programa DPCR-08 (zona + filtro por rol), compartidas por la
// pantalla (`/programa`) y por la generación del PDF en el servidor
// (`/programa/pdf`). Vive aquí, y no en la página, para que ambos caminos apliquen
// EXACTAMENTE el mismo enforcement server-side: quien no puede ver una zona en
// pantalla tampoco puede descargar su PDF llamando la ruta a mano.

import { prisma } from "@/lib/prisma";
import {
  type Alcance,
  filtroPedidoPorAsesor,
  filtroPedidoPorLaboratorista,
} from "@/lib/auth/acceso";
import { ZONAS } from "@/lib/auth/roles";

/**
 * Zonas cuyo Programa DPCR-08 puede ver/generar el usuario.
 * Regla: TODOS los roles pueden verlo. Si el usuario tiene una zona ASIGNADA, se
 * filtra a esa zona; si NO tiene ninguna asignada, ve ambas. La zona asignada se
 * resuelve según el rol:
 *  · Admin / Gerencia Comercial / Gerente de Control de Calidad / Almacén: ambas.
 *  · AsesorRestringido: ambas zonas, pero limitado a SUS clientes (ver filtroPorRol).
 *  · Asesor: `asesores.zona_asignada` (fresca de BD).
 *  · Dosificador / Jefe de Planta: la zona de su(s) plantel(es) asignado(s).
 *  · Programador / Despachador / Laboratorista / Jefe de Laboratorio: `User.zona`.
 */
export async function zonasParaPrograma(
  alcance: Alcance,
  userId: string | null,
): Promise<string[]> {
  // Roles globales (sin límite de zona): siempre ambas zonas.
  if (
    alcance.esAdmin ||
    alcance.esGerenteComercial ||
    alcance.esGerenteControlCalidad ||
    alcance.esAlmacen
  ) {
    return [...ZONAS];
  }

  // AsesorRestringido: el DPCR-08 se limita a SUS clientes (filtroPorRol), no por
  // zona. Devolvemos ambas para que ninguna zona oculte un pedido suyo; el filtro
  // por cliente es el límite real.
  if (alcance.esAsesorRestringido) return [...ZONAS];

  // Reunir la(s) zona(s) asignada(s) del usuario desde todas las fuentes posibles.
  const zonas = new Set<string>();
  if (alcance.esAsesor && userId) {
    const yo = await prisma.asesores.findFirst({
      where: { usuario_auth_id: userId },
      select: { zona_asignada: true },
    });
    if (yo?.zona_asignada) zonas.add(yo.zona_asignada);
  }
  if (alcance.zona) zonas.add(alcance.zona); // User.zona (Programador/Despachador/…)
  if (alcance.plantelAsignadoId != null) {
    const pl = await prisma.planteles.findUnique({
      where: { id: alcance.plantelAsignadoId },
      select: { zona: true },
    });
    if (pl) zonas.add(pl.zona); // Dosificador
  }
  if (alcance.plantelesAsignados.length > 0) {
    const suyos = await prisma.planteles.findMany({
      where: { id: { in: alcance.plantelesAsignados } },
      select: { zona: true },
    });
    for (const p of suyos) zonas.add(p.zona); // Jefe de Planta (M2M)
  }

  // Con zona asignada → se FILTRA a esa(s); sin ninguna → ve AMBAS.
  return zonas.size > 0 ? [...zonas] : [...ZONAS];
}

/**
 * Filtro extra de `pedidos` según el rol (además de la zona):
 *  · Laboratorista → SOLO los programas que le fueron asignados ese día.
 *  · AsesorRestringido → SOLO los pedidos de SUS propios clientes.
 *  · Los demás roles → sin filtro de cliente (el programa completo de la zona).
 */
export function filtroPorRol(
  alcance: Alcance,
  userId: string | null,
): {
  filtro: Record<string, unknown>;
  soloLabAsignado: boolean;
  soloAsesorPropio: boolean;
} {
  const soloLabAsignado = alcance.esLaboratorista && !alcance.esAdmin && userId != null;
  const soloAsesorPropio =
    alcance.esAsesorRestringido && !alcance.esAdmin && userId != null;
  const filtro: Record<string, unknown> = soloLabAsignado
    ? filtroPedidoPorLaboratorista(userId!)
    : soloAsesorPropio
      ? filtroPedidoPorAsesor(userId!)
      : {};
  return { filtro, soloLabAsignado, soloAsesorPropio };
}
