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
import { PUESTOS_MOTORISTA_MIXER } from "@/lib/planilla/puestos";

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

/**
 * Motoristas de mixer disponibles, para el desplegable de motorista en Despacho.
 *
 * `operadores` guarda a TODO el personal operativo (dosificadores, operadores de
 * cargadora…), así que aquí se limita a los puestos que pueden manejar un mixer.
 * Los que YA van en un viaje de hoy no salen de aquí: se derivan de los viajes que la
 * pantalla ya cargó, así no hace falta una consulta aparte dependiente del día (que
 * además no se podría cachear).
 */
export const motoristasDisponibles = unstable_cache(
  async () =>
    prisma.operadores.findMany({
      where: { estado: "Disponible", puesto: { in: [...PUESTOS_MOTORISTA_MIXER] } },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true },
    }),
  ["catalogo-motoristas-disponibles"],
  opciones,
);

/**
 * Planteles con sus plantas. Cambian una o dos veces al año, y casi todas las pantallas
 * los necesitan; el alcance por rol se aplica DESPUÉS, en memoria, con
 * `plantelesDelFiltro`.
 */
export const plantelesCatalogo = unstable_cache(
  async () =>
    prisma.planteles.findMany({
      orderBy: { nombre: "asc" },
      select: {
        id: true,
        nombre: true,
        zona: true,
        hub_id: true,
        plantas: {
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true, capacidad_m3h: true },
        },
      },
    }),
  ["catalogo-planteles"],
  opciones,
);

/**
 * Elementos de obra ACTIVOS, para el desplegable con buscador del campo "Elemento".
 * Es un catálogo de sugerencias: el campo sigue aceptando texto libre, así que un
 * elemento que no esté aquí no bloquea nada.
 */
export const elementosCatalogo = unstable_cache(
  async () =>
    prisma.elementos.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { nombre: true },
    }),
  ["catalogo-elementos"],
  opciones,
);
