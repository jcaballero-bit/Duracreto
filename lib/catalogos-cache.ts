/**
 * Catálogos en caché: las listas que las pantallas necesitan para sus desplegables
 * (clientes, diseños de mezcla, bombas, asesores, planteles) cambian una vez por semana,
 * pero se releían de la base en CADA render de Programación — unos 20 KB por refresco.
 *
 * Con la caché se leen una vez y se sirven de memoria hasta que algo las modifica.
 *
 * INVALIDACIÓN: cada acción que toca uno de estos catálogos llama a
 * `revalidarCatalogos()`. Es lo que hace que un cliente recién creado aparezca de
 * inmediato en el desplegable de Nuevo pedido (que es el flujo real: el asesor da de alta
 * al cliente y lo programa enseguida). El `revalidate` de 60 s es solo una red de
 * seguridad por si algún camino de escritura futuro se olvida de invalidar.
 */
import { unstable_cache, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";

export const TAG_CATALOGOS = "catalogos";

/**
 * Invalida la caché de catálogos. La llaman las acciones que los modifican.
 *
 * Se usa `updateTag` y no `revalidateTag` porque en Next 16 es el que da semántica de
 * "lee lo que acabas de escribir" dentro de una server action: al crear un cliente, el
 * desplegable de Nuevo pedido ya lo trae en el mismo viaje, sin esperar el revalidate.
 */
export function revalidarCatalogos(): void {
  // Envuelto a propósito: si algún día se llamara desde un contexto donde `updateTag`
  // no está permitido, una escritura de catálogo NO debe fallar por no poder invalidar
  // la caché. En ese caso el `revalidate` de 60 s se encarga.
  try {
    updateTag(TAG_CATALOGOS);
  } catch {
    /* la red de seguridad es el revalidate de 60 s */
  }
}

const opciones = { tags: [TAG_CATALOGOS], revalidate: 60 };

/** Clientes activos para los desplegables (los inactivos no se programan). */
export const clientesActivos = unstable_cache(
  async () =>
    prisma.clientes.findMany({
      where: { activo: true },
      orderBy: { empresa: "asc" },
      select: {
        id: true,
        empresa: true,
        proyecto: true,
        asesor_id: true,
        tiempo_viaje_referencia_min: true,
        google_maps_url: true,
        latitud: true,
        longitud: true,
      },
    }),
  ["catalogo-clientes-activos"],
  opciones,
);

/** Diseños de mezcla. */
export const disenosCatalogo = unstable_cache(
  async () =>
    prisma.disenos_mezcla.findMany({
      orderBy: { codigo: "asc" },
      select: {
        id: true,
        codigo: true,
        resistencia_psi: true,
        etiqueta_resistencia: true,
        tamano_agregado: true,
        revenimiento: true,
      },
    }),
  ["catalogo-disenos"],
  opciones,
);

/** Bombas disponibles (para elegir la del pedido). */
export const bombasDisponibles = unstable_cache(
  async () =>
    prisma.bombas.findMany({
      where: { estado: "Disponible" },
      orderBy: { identificador: "asc" },
      select: { id: true, identificador: true, plantel_base_id: true },
    }),
  ["catalogo-bombas-disponibles"],
  opciones,
);

/** Asesores (para asignar el del pedido). */
export const asesoresCatalogo = unstable_cache(
  async () =>
    prisma.asesores.findMany({
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true },
    }),
  ["catalogo-asesores"],
  opciones,
);

/**
 * Mixers con su estado, para el selector y el panel del modo manual. Se cachean con el
 * estado incluido porque un cambio de estado (mantenimiento, fuera de servicio) también
 * invalida la caché desde Flota.
 */
export const mixersCatalogo = unstable_cache(
  async () =>
    prisma.mixers.findMany({
      orderBy: { identificador: "asc" },
      select: {
        id: true,
        identificador: true,
        capacidad_m3: true,
        plantel_base_id: true,
        estado: true,
      },
    }),
  ["catalogo-mixers"],
  opciones,
);
