"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/guard";

type Res = { ok: boolean; mensaje?: string };

async function usuario(): Promise<string> {
  const s = await auth();
  return s?.user?.name ?? s?.user?.email ?? "sistema";
}

/** "YYYY-MM-DD" a medianoche local. */
function diaDesdeISO(fechaISO: string): Date | null {
  const m = fechaISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/**
 * Registra un cobro de sobretiempo hecho a un cliente. Es captura MANUAL y opcional:
 * sirve para ver la diferencia neta cuando el sobretiempo sí se le cobró a alguien.
 *
 * Solo Administrador: es un dato comercial que entra al análisis de margen (el Jefe de
 * Planta ve el reporte, pero no captura cobros).
 */
export async function registrarCobroAction(
  fechaISO: string,
  monto: string,
  clienteId: number | null,
  observaciones: string,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const fecha = diaDesdeISO(fechaISO);
  if (!fecha) return { ok: false, mensaje: "Fecha no válida." };

  const v = Number(monto.trim().replace(/,/g, ""));
  if (!Number.isFinite(v) || v <= 0) {
    return { ok: false, mensaje: "El monto debe ser un número mayor que cero." };
  }

  const fila = await prisma.cobros_sobretiempo.create({
    data: {
      fecha,
      monto: Math.round(v * 100) / 100,
      cliente_id: clienteId ?? null,
      observaciones: observaciones.trim() === "" ? null : observaciones.trim(),
      creado_por: await usuario(),
    },
  });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "cobros_sobretiempo",
      registro_id: fila.id,
      usuario: await usuario(),
      campo_modificado: "monto",
      valor_anterior: "sin registro",
      valor_nuevo: fila.monto.toFixed(2),
      motivo: `Cobro de sobretiempo a cliente (${fechaISO})`,
    },
  });

  revalidatePath("/extraordinario");
  return { ok: true };
}

/** Borra un cobro registrado (solo Administrador), dejando el rastro en bitácora. */
export async function eliminarCobroAction(id: number): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const previo = await prisma.cobros_sobretiempo.findUnique({ where: { id } });
  if (!previo) return { ok: false, mensaje: "El cobro ya no existe." };

  await prisma.cobros_sobretiempo.delete({ where: { id } });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "cobros_sobretiempo",
      registro_id: id,
      usuario: await usuario(),
      campo_modificado: "monto",
      valor_anterior: previo.monto.toFixed(2),
      valor_nuevo: "borrado",
      motivo: "Cobro de sobretiempo eliminado",
    },
  });

  revalidatePath("/extraordinario");
  return { ok: true };
}
