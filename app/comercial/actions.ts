"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";

type Res = { ok: boolean; mensaje?: string };

/** Solo Gerente Comercial o Administrador gestionan metas. */
async function exigirComercial(): Promise<
  { ok: true; quien: string } | { ok: false; mensaje: string }
> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };
  const alcance = calcularAlcance(sesion.user.roles ?? [], sesion.user.zona ?? null);
  if (!alcance.esAdmin && !alcance.esGerenteComercial) {
    return { ok: false, mensaje: "Solo el Gerente Comercial o el Administrador pueden hacer esto." };
  }
  return { ok: true, quien: sesion.user.name ?? sesion.user.email ?? "gerente" };
}

/**
 * Crea o actualiza la meta de m³ de un asesor para un mes. Si el valor es 0 o
 * vacío, borra la meta (queda "sin meta"). Registra en bitácora.
 */
export async function guardarMetaAction(
  asesorId: number,
  anio: number,
  mes: number,
  metaM3: number | null,
): Promise<Res> {
  const ctx = await exigirComercial();
  if (!ctx.ok) return ctx;
  if (!asesorId || !anio || mes < 1 || mes > 12) {
    return { ok: false, mensaje: "Datos inválidos." };
  }

  try {
    const existente = await prisma.metas_asesor.findUnique({
      where: { asesor_id_anio_mes: { asesor_id: asesorId, anio, mes } },
    });

    if (metaM3 == null || !(metaM3 > 0)) {
      // Borrar la meta (vuelve a "sin meta definida").
      if (existente) {
        await prisma.metas_asesor.delete({ where: { id: existente.id } });
        await auditar(existente.id, ctx.quien, String(existente.meta_m3), null, asesorId, anio, mes);
      }
      revalidatePath("/comercial");
      return { ok: true };
    }

    if (existente) {
      await prisma.metas_asesor.update({
        where: { id: existente.id },
        data: { meta_m3: metaM3, creado_por: ctx.quien },
      });
      await auditar(existente.id, ctx.quien, String(existente.meta_m3), String(metaM3), asesorId, anio, mes);
    } else {
      const creada = await prisma.metas_asesor.create({
        data: { asesor_id: asesorId, anio, mes, meta_m3: metaM3, creado_por: ctx.quien },
      });
      await auditar(creada.id, ctx.quien, null, String(metaM3), asesorId, anio, mes);
    }
    revalidatePath("/comercial");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado." };
  }
}

async function auditar(
  registroId: number,
  quien: string,
  anterior: string | null,
  nuevo: string | null,
  asesorId: number,
  anio: number,
  mes: number,
) {
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "metas_asesor",
      registro_id: registroId,
      usuario: quien,
      campo_modificado: "meta_m3",
      valor_anterior: anterior,
      valor_nuevo: nuevo,
      motivo: `Meta asesor #${asesorId} ${mes}/${anio}`,
    },
  });
}
