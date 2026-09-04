"use server";

// Préstamo de unidades a otro plantel, por día.
//
// Lo gestionan el Programador y el Jefe de Planta (y el Admin / Despachador, que ya
// gestionan flota). El permiso se valida aquí, en el servidor: además del rol, se
// comprueba que la unidad SEA de un plantel del alcance del usuario — un Jefe de
// Planta no puede prestar un mixer de un plantel que no es suyo, ni invocando la
// acción directamente.

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanceActual, exigirGestionFlota } from "@/lib/auth/guard";
import { filtroPlantelPorZona } from "@/lib/auth/acceso";
import { revalidarCatalogos } from "@/lib/catalogos-cache";
import { mantenimientoDeUnidad } from "@/lib/motor/asignacion";
import {
  avisosDePrestamo,
  esTipoPrestable,
  etiquetaTipo,
  participaEnMotor,
  validarPrestamo,
} from "@/lib/flota/prestamos";
import { compromisosDeUnidad } from "@/lib/flota/prestamos-datos";

export interface Res {
  ok: boolean;
  mensaje?: string;
  /** Consecuencias que el usuario debe conocer (no impiden el préstamo). */
  advertencias?: string[];
}

const diaDesdeISO = (iso: string): Date | null => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmt = (d: Date) => d.toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Planteles que el usuario puede ver/usar. `null` = sin límite (Administrador). */
async function plantelesDelUsuario(): Promise<number[] | null> {
  const a = await alcanceActual();
  if (!a) return [];
  if (a.esAdmin) return null;
  const filtro = filtroPlantelPorZona(a);
  const filas = await prisma.planteles.findMany({ where: filtro, select: { id: true } });
  // Sin ningún plantel visible: no puede prestar nada (no "puede prestar todo").
  return filas.map((p) => p.id);
}

/** Plantel base de la unidad, y su estado. `null` si la unidad no existe. */
async function unidadBase(
  tipo: string,
  id: number,
): Promise<{ plantelBaseId: number; estado: string; identificador: string | null } | null> {
  const sel = { plantel_base_id: true, estado: true, identificador: true };
  if (tipo === "Mixer") {
    const u = await prisma.mixers.findUnique({ where: { id }, select: sel });
    return u ? { plantelBaseId: u.plantel_base_id, estado: u.estado, identificador: u.identificador } : null;
  }
  if (tipo === "Bomba") {
    const u = await prisma.bombas.findUnique({ where: { id }, select: sel });
    return u ? { plantelBaseId: u.plantel_base_id, estado: u.estado, identificador: u.identificador } : null;
  }
  if (tipo === "Camion") {
    const u = await prisma.camiones.findUnique({ where: { id }, select: sel });
    return u ? { plantelBaseId: u.plantel_base_id, estado: u.estado, identificador: u.identificador } : null;
  }
  if (tipo === "Pickup") {
    const u = await prisma.pickups.findUnique({ where: { id }, select: sel });
    return u ? { plantelBaseId: u.plantel_base_id, estado: u.estado, identificador: u.identificador } : null;
  }
  return null;
}

/**
 * Consulta previa (solo lectura): qué pasaría al prestar esta unidad ese día. La usa
 * la pantalla para avisar ANTES de confirmar, sin escribir nada.
 */
export async function revisarPrestamoAction(entrada: {
  unidadTipo: string;
  unidadId: number;
  fechaISO: string;
}): Promise<Res> {
  const guard = await exigirGestionFlota();
  if (!guard.ok) return guard;
  if (!esTipoPrestable(entrada.unidadTipo)) return { ok: false, mensaje: "Tipo no válido." };
  const dia = diaDesdeISO(entrada.fechaISO);
  if (!dia) return { ok: false, mensaje: "Fecha no válida." };

  const unidad = await unidadBase(entrada.unidadTipo, entrada.unidadId);
  if (!unidad) return { ok: false, mensaje: "La unidad no existe." };

  const mant = await mantenimientoDeUnidad(entrada.unidadTipo, entrada.unidadId, dia);
  const avisos = avisosDePrestamo({
    enMantenimiento: mant != null,
    rangoMantenimiento: mant ? `${fmt(mant.fecha_inicio)} al ${fmt(mant.fecha_fin)}` : null,
    estadoUnidad: unidad.estado,
    viajesComprometidos: await compromisosDeUnidad(entrada.unidadTipo, entrada.unidadId, dia),
    participaEnMotor: participaEnMotor(entrada.unidadTipo),
  });
  return avisos.bloqueante
    ? { ok: false, mensaje: avisos.bloqueante }
    : { ok: true, advertencias: avisos.advertencias };
}

/** Registra el préstamo de una unidad a otro plantel, para un día. */
export async function prestarUnidadAction(entrada: {
  unidadTipo: string;
  unidadId: number;
  destinoId: number;
  fechaISO: string;
  motivo?: string;
}): Promise<Res> {
  const guard = await exigirGestionFlota();
  if (!guard.ok) return guard;

  const dia = diaDesdeISO(entrada.fechaISO);
  if (!dia) return { ok: false, mensaje: "Fecha no válida." };
  if (!esTipoPrestable(entrada.unidadTipo)) return { ok: false, mensaje: "Tipo no válido." };
  const tipo = entrada.unidadTipo;

  const unidad = await unidadBase(tipo, entrada.unidadId);
  if (!unidad) return { ok: false, mensaje: "La unidad no existe." };

  const error = validarPrestamo({
    unidadTipo: entrada.unidadTipo,
    unidadId: entrada.unidadId,
    origenId: unidad.plantelBaseId,
    destinoId: entrada.destinoId,
  });
  if (error) return { ok: false, mensaje: error };

  // La unidad tiene que ser de un plantel del alcance del usuario: no se presta lo
  // que no es tuyo. El destino, en cambio, puede ser CUALQUIER plantel (el sentido
  // del préstamo es sacar la unidad de tu zona de control).
  const mios = await plantelesDelUsuario();
  if (mios !== null && !mios.includes(unidad.plantelBaseId)) {
    return { ok: false, mensaje: "Esa unidad no es de tus planteles: no puedes prestarla." };
  }
  const destino = await prisma.planteles.findUnique({
    where: { id: entrada.destinoId },
    select: { nombre: true },
  });
  if (!destino) return { ok: false, mensaje: "El plantel destino no existe." };

  // No operativa ese día: no se presta (una unidad de baja no va a trabajar a otra
  // planta). Las demás consecuencias son advertencias, no bloqueos.
  const mant = await mantenimientoDeUnidad(tipo, entrada.unidadId, dia);
  const avisos = avisosDePrestamo({
    enMantenimiento: mant != null,
    rangoMantenimiento: mant ? `${fmt(mant.fecha_inicio)} al ${fmt(mant.fecha_fin)}` : null,
    estadoUnidad: unidad.estado,
    viajesComprometidos: 0, // ya se advirtió en la revisión previa
    participaEnMotor: participaEnMotor(tipo),
  });
  if (avisos.bloqueante) return { ok: false, mensaje: avisos.bloqueante };

  const sesion = await auth();
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";

  try {
    const fila = await prisma.prestamos_unidad.create({
      data: {
        unidad_tipo: tipo,
        unidad_id: entrada.unidadId,
        plantel_origen_id: unidad.plantelBaseId,
        plantel_destino_id: entrada.destinoId,
        fecha: dia,
        motivo: entrada.motivo?.trim() || null,
        creado_por: quien,
      },
    });
    await prisma.bitacora_auditoria.create({
      data: {
        tabla_afectada: "prestamos_unidad",
        registro_id: fila.id,
        usuario: quien,
        campo_modificado: "plantel_destino_id",
        valor_anterior: String(unidad.plantelBaseId),
        valor_nuevo: String(entrada.destinoId),
        motivo:
          `Prestamo de ${etiquetaTipo(tipo)} ` +
          `${unidad.identificador ?? `#${entrada.unidadId}`} a ${destino.nombre} ` +
          `el ${fmt(dia)}`,
      },
    });
  } catch (e) {
    // El índice único (unidad + día) impide prestar la misma unidad dos veces el
    // mismo día, aunque dos personas lo intenten a la vez.
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint") || msg.includes("prestamos_unidad_unidad_tipo")) {
      return { ok: false, mensaje: "Esa unidad ya está prestada ese día." };
    }
    return { ok: false, mensaje: "No se pudo registrar el préstamo." };
  }

  revalidarCatalogos();
  revalidatePath("/flota");
  revalidatePath("/programacion");
  revalidatePath("/despacho");
  return { ok: true };
}

/** Cancela un préstamo: la unidad vuelve a estar disponible en su plantel base. */
export async function devolverUnidadAction(id: number): Promise<Res> {
  const guard = await exigirGestionFlota();
  if (!guard.ok) return guard;

  const fila = await prisma.prestamos_unidad.findUnique({
    where: { id },
    include: { origen: { select: { nombre: true } }, destino: { select: { nombre: true } } },
  });
  if (!fila) return { ok: false, mensaje: "Ese préstamo ya no existe." };

  // Puede devolverla quien la prestó (dueño del origen) o quien la recibió (destino):
  // los dos lados tienen motivos legítimos para deshacerlo.
  const mios = await plantelesDelUsuario();
  if (
    mios !== null &&
    !mios.includes(fila.plantel_origen_id) &&
    !mios.includes(fila.plantel_destino_id)
  ) {
    return { ok: false, mensaje: "Ese préstamo no es de tus planteles." };
  }

  const sesion = await auth();
  const quien = sesion?.user?.name ?? sesion?.user?.email ?? "sistema";
  await prisma.prestamos_unidad.delete({ where: { id } });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "prestamos_unidad",
      registro_id: id,
      usuario: quien,
      campo_modificado: "plantel_destino_id",
      valor_anterior: String(fila.plantel_destino_id),
      valor_nuevo: null,
      motivo:
        `Se cancelo el prestamo de ${etiquetaTipo(fila.unidad_tipo)} #${fila.unidad_id} ` +
        `a ${fila.destino.nombre} del ${fmt(fila.fecha)}: la unidad vuelve a ${fila.origen.nombre}`,
    },
  });

  revalidarCatalogos();
  revalidatePath("/flota");
  revalidatePath("/programacion");
  revalidatePath("/despacho");
  return { ok: true };
}
