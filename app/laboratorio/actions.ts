"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanceActual } from "@/lib/auth/guard";
import type { Alcance } from "@/lib/auth/acceso";
import {
  ventanaDePedido,
  seTraslapan,
  formatearVentana,
  type ViajeVentana,
} from "@/lib/laboratorio/ventana";

/** Gestionan las asignaciones de laboratorio: Admin, Jefe de Laboratorio y Gerente
 *  de Control de Calidad. Devuelve también el alcance (para el límite por zona). */
async function autorizar(): Promise<
  { ok: true; quien: string; alcance: Alcance } | { ok: false; mensaje: string }
> {
  const alcance = await alcanceActual();
  if (!alcance) return { ok: false, mensaje: "Sesión no válida." };
  if (!alcance.esAdmin && !alcance.esJefeLaboratorio && !alcance.esGerenteControlCalidad) {
    return {
      ok: false,
      mensaje: "Solo el Jefe de Laboratorio (o Control de Calidad / Admin) puede asignar.",
    };
  }
  const sesion = await auth();
  return { ok: true, quien: sesion?.user?.name ?? sesion?.user?.email ?? "sistema", alcance };
}

/** Zona a la que está limitado el gestor (JefeLaboratorio → su zona; Admin y Gerente
 *  de Control de Calidad → sin límite = null). */
function zonaLimiteGestor(alcance: Alcance): string | null {
  if (alcance.esAdmin || alcance.esGerenteControlCalidad) return null;
  return alcance.zona;
}

// Campos de viaje que necesita el cálculo de ventana.
const SELECT_VIAJE_VENTANA = {
  mixer_id: true,
  hora_llegada_proyecto: true,
  ts_llegada_real: true,
  hora_regreso_planta: true,
  ts_regreso_real: true,
  hora_fin_descarga: true,
  ts_fin_descarga_real: true,
} as const;

/**
 * Fija la lista de Laboratoristas de UN programa (pedido). `laboratoristaIds` = el
 * conjunto COMPLETO de laboratoristas que quedan asignados (uno, varios o ninguno —
 * lista vacía = "Ninguno"). Para CADA laboratorista de la lista valida, POR PERSONA,
 * que el horario del programa no se cruce con otro programa YA asignado a ESE
 * laboratorista ese día (de un cliente distinto): si se cruza, RECHAZA indicando quién
 * y con cuál. No permite duplicar el mismo laboratorista en el mismo programa.
 */
export async function guardarLaboratoristasAction(
  pedidoId: number,
  laboratoristaIds: string[],
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await autorizar();
  if (!g.ok) return g;

  // Límite por zona (punto 12): un JefeLaboratorio solo gestiona programas de SU zona.
  const zonaLimit = zonaLimiteGestor(g.alcance);
  if (zonaLimit) {
    const pz = await prisma.pedidos.findUnique({
      where: { id: pedidoId },
      select: { plantel: { select: { zona: true } } },
    });
    if (pz && pz.plantel.zona !== zonaLimit) {
      return { ok: false, mensaje: "Ese programa es de otra zona; no puedes gestionarlo." };
    }
  }

  // Deduplicar (no asignar dos veces al mismo laboratorista) y descartar vacíos.
  const ids = [...new Set(laboratoristaIds.filter((x) => x))];

  const pedido = await prisma.pedidos.findUnique({
    where: { id: pedidoId },
    select: {
      cliente_id: true,
      hora_solicitada: true,
      viajes: { where: { mixer_id: { not: null } }, select: SELECT_VIAJE_VENTANA },
    },
  });
  if (!pedido) return { ok: false, mensaje: "Programa no encontrado." };

  if (ids.length > 0) {
    // Todos deben ser Laboratoristas activos.
    const validos = await prisma.user.findMany({
      where: { id: { in: ids }, activo: true, roles: { some: { rol: "Laboratorista" } } },
      select: { id: true, name: true, email: true },
    });
    if (validos.length !== ids.length) {
      return { ok: false, mensaje: "Alguno de los seleccionados no es un Laboratorista activo." };
    }
    const nombreDe = (id: string) => {
      const u = validos.find((v) => v.id === id);
      return u?.name ?? u?.email ?? "Laboratorista";
    };

    const ventanaNueva = ventanaDePedido(pedido.viajes as ViajeVentana[], pedido.hora_solicitada);
    if (ventanaNueva) {
      const dia = pedido.hora_solicitada;
      const ini = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate());
      const fin = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1);
      // Validación de traslape POR PERSONA: para cada laboratorista de la lista, sus
      // OTROS programas del día (cliente distinto) no deben cruzarse con este.
      for (const labId of ids) {
        const otros = await prisma.pedidos.findMany({
          where: {
            id: { not: pedidoId },
            cliente_id: { not: pedido.cliente_id },
            hora_solicitada: { gte: ini, lt: fin },
            estado_pedido: "Activo",
            asignaciones_lab: { some: { laboratorista_id: labId } },
          },
          select: {
            hora_solicitada: true,
            cliente: { select: { empresa: true } },
            viajes: { where: { mixer_id: { not: null } }, select: SELECT_VIAJE_VENTANA },
          },
        });
        for (const o of otros) {
          const vo = ventanaDePedido(o.viajes as ViajeVentana[], o.hora_solicitada);
          if (vo && seTraslapan(ventanaNueva, vo)) {
            return {
              ok: false,
              mensaje:
                `${nombreDe(labId)} ya tiene "${o.cliente.empresa}" (${formatearVentana(vo)}), que se cruza con ` +
                `este programa (${formatearVentana(ventanaNueva)}). Un laboratorista no puede estar en dos proyectos a la vez.`,
            };
          }
        }
      }
    }
  }

  // Reemplazar el conjunto de laboratoristas del pedido (borra y vuelve a crear).
  await prisma.asignaciones_laboratorista.deleteMany({ where: { pedido_id: pedidoId } });
  if (ids.length > 0) {
    await prisma.asignaciones_laboratorista.createMany({
      data: ids.map((labId) => ({ pedido_id: pedidoId, laboratorista_id: labId, creado_por: g.quien })),
    });
  }
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "asignaciones_laboratorista",
      registro_id: pedidoId,
      usuario: g.quien,
      campo_modificado: "laboratorista",
      valor_anterior: null,
      valor_nuevo: ids.length > 0 ? `pedido=${pedidoId} laboratoristas=${ids.join(",")}` : null,
      motivo: ids.length > 0 ? "Asignación de laboratorista(s) a un programa" : "Programa sin laboratorista (Ninguno)",
    },
  });

  revalidatePath("/laboratorio");
  revalidatePath("/despacho");
  return { ok: true };
}

/**
 * Asigna (o cambia) el Laboratorista que controla la calidad a la SALIDA de una
 * PLANTA en un DÍA. Distinta de la asignación por proyecto: NO valida traslapes (es
 * "quién está en esta planta ahora") y una nueva asignación REEMPLAZA la de esa
 * planta/fecha. `laboratoristaId` vacío = quitar. Reglas:
 *  · Solo la gestiona el Jefe de Laboratorio / Gerente de Control de Calidad / Admin.
 *  · Un JefeLaboratorio solo puede asignar plantas de SU zona.
 *  · La planta debe ser de la zona del laboratorista (control de calidad por zona).
 */
export async function asignarLaboratoristaPlantaAction(
  plantaId: number,
  fechaISO: string, // "YYYY-MM-DD"
  laboratoristaId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const g = await autorizar();
  if (!g.ok) return g;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!m) return { ok: false, mensaje: "Fecha inválida." };
  const fecha = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);

  const planta = await prisma.plantas.findUnique({
    where: { id: plantaId },
    select: { nombre: true, plantel: { select: { zona: true, nombre: true } } },
  });
  if (!planta) return { ok: false, mensaje: "Planta no encontrada." };

  // Límite por zona del gestor (JefeLaboratorio → solo plantas de su zona).
  const zonaLimit = zonaLimiteGestor(g.alcance);
  if (zonaLimit && planta.plantel.zona !== zonaLimit) {
    return { ok: false, mensaje: "Solo puedes asignar plantas de tu zona." };
  }

  // Quitar la asignación de esa planta/fecha.
  if (!laboratoristaId) {
    await prisma.asignaciones_laboratorista_planta.deleteMany({
      where: { planta_id: plantaId, fecha },
    });
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "asignaciones_laboratorista_planta",
        registro_id: plantaId,
        usuario: g.quien,
        campo_modificado: "laboratorista",
        valor_anterior: null,
        valor_nuevo: null,
        motivo: `Planta ${planta.nombre} sin laboratorista (${fechaISO})`,
      },
    });
    revalidatePath("/laboratorio");
    return { ok: true };
  }

  const lab = await prisma.user.findUnique({
    where: { id: laboratoristaId },
    select: { activo: true, zona: true, roles: { where: { rol: "Laboratorista" }, select: { id: true } } },
  });
  if (!lab || !lab.activo || lab.roles.length === 0) {
    return { ok: false, mensaje: "El usuario seleccionado no es un Laboratorista activo." };
  }
  // La planta debe ser de la zona del laboratorista (si tiene zona asignada).
  if (lab.zona && lab.zona !== planta.plantel.zona) {
    return { ok: false, mensaje: "Ese laboratorista es de otra zona; no puede cubrir esta planta." };
  }

  await prisma.asignaciones_laboratorista_planta.upsert({
    where: { planta_id_fecha: { planta_id: plantaId, fecha } },
    update: { laboratorista_id: laboratoristaId, creado_por: g.quien },
    create: { planta_id: plantaId, fecha, laboratorista_id: laboratoristaId, creado_por: g.quien },
  });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "asignaciones_laboratorista_planta",
      registro_id: plantaId,
      usuario: g.quien,
      campo_modificado: "laboratorista",
      valor_anterior: null,
      valor_nuevo: `planta=${plantaId} laboratorista=${laboratoristaId} (${fechaISO})`,
      motivo: `Laboratorista de salida en planta ${planta.nombre}`,
    },
  });

  revalidatePath("/laboratorio");
  return { ok: true };
}
