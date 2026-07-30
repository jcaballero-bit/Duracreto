// Utilidades para construir escenarios de prueba y limpiar la BD entre casos.
import { prisma } from "@/lib/prisma";

/** Borra todas las tablas en orden de dependencias. */
export async function limpiarBD() {
  await prisma.metas_asesor.deleteMany(); // ref asesores (RESTRICT) → primero
  await prisma.solicitudes_anticipadas.deleteMany(); // ref clientes (RESTRICT) → primero
  await prisma.viajes.deleteMany();
  await prisma.pedidos.deleteMany();
  await prisma.disponibilidad_flota.deleteMany();
  await prisma.bombas.deleteMany();
  await prisma.mixers.deleteMany();
  await prisma.camiones.deleteMany(); // ref planteles (RESTRICT) → antes de planteles
  await prisma.pickups.deleteMany();
  await prisma.plantas.deleteMany();
  await prisma.clientes.deleteMany();
  await prisma.disenos_mezcla.deleteMany();
  await prisma.planteles.updateMany({ data: { hub_id: null } });
  await prisma.planteles.deleteMany();
}

export interface OpcionesPlantel {
  nombre: string;
  zona: string;
  capacidadPlantaM3h?: number;
  esHub?: boolean; // se apunta a sí mismo
  hubId?: number; // apunta a otro plantel
}

/** Crea un plantel con una planta. Devuelve { plantelId, plantaId }. */
export async function crearPlantel(o: OpcionesPlantel) {
  const p = await prisma.planteles.create({
    data: {
      nombre: o.nombre,
      zona: o.zona,
      capacidad_dosificacion_m3h: o.capacidadPlantaM3h ?? 45,
      hub_id: o.hubId ?? null,
      plantas: {
        create: [
          { nombre: `${o.nombre} P1`, capacidad_m3h: o.capacidadPlantaM3h ?? 45 },
        ],
      },
    },
    include: { plantas: true },
  });
  if (o.esHub) {
    await prisma.planteles.update({
      where: { id: p.id },
      data: { hub_id: p.id },
    });
  }
  return { plantelId: p.id, plantaId: p.plantas[0].id };
}

/** Crea mixers en un plantel según una distribución [capacidad, cantidad][]. */
export async function crearMixers(
  plantelId: number,
  distribucion: Array<[number, number]>,
) {
  const data: {
    marca: string;
    capacidad_m3: number;
    plantel_base_id: number;
    estado: string;
  }[] = [];
  for (const [cap, cant] of distribucion) {
    for (let i = 0; i < cant; i++) {
      data.push({
        marca: "Test",
        capacidad_m3: cap,
        plantel_base_id: plantelId,
        estado: "Disponible",
      });
    }
  }
  if (data.length) await prisma.mixers.createMany({ data });
}

/** Crea un cliente, opcionalmente con tiempos de ruta. Devuelve el id. */
export async function crearCliente(conRuta: boolean, viajeMin = 20, regresoMin = 20) {
  const c = await prisma.clientes.create({
    data: {
      empresa: "Cliente Test",
      proyecto: "Proyecto Test",
      ubicacion: "Test",
      ...(conRuta
        ? {
            tiempo_viaje_referencia_min: viajeMin,
            tiempo_regreso_referencia_min: regresoMin,
          }
        : {}),
    },
  });
  return c.id;
}

/** Crea un diseño de mezcla simple. Devuelve el id. */
export async function crearDiseno() {
  const d = await prisma.disenos_mezcla.create({
    data: { codigo: `D${Date.now()}${Math.floor(Math.random() * 1000)}`, resistencia_psi: 3000, revenimiento: "4 pulg" },
  });
  return d.id;
}
