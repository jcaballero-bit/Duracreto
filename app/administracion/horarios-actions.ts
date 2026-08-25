"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/guard";
import { TIPOS_DIA, parsearHoraMin, textoMin } from "@/lib/planilla/recargos";
import {
  CLAVE_COSTO_FICHA,
  CLAVE_UMBRAL_EXTRA,
} from "@/lib/extraordinario/metricas";

type Res = { ok: boolean; mensaje?: string };

async function usuario(): Promise<string> {
  const s = await auth();
  return s?.user?.name ?? s?.user?.email ?? "sistema";
}

async function auditar(
  tabla: string,
  registroId: number,
  campo: string,
  antes: string,
  despues: string,
  motivo: string,
) {
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: tabla,
      registro_id: registroId,
      usuario: await usuario(),
      campo_modificado: campo,
      valor_anterior: antes,
      valor_nuevo: despues,
      motivo,
    },
  });
}

/**
 * Horario normal (jornada operativa) de una planta para un tipo de día. Es la
 * referencia con la que se clasifica un despacho como normal o extraordinario — NO son
 * las bandas de recargo de ley, que aplican a las personas y se editan aparte.
 *
 * `activo=false` (o borrar la franja) significa "sin horario normal": todo ese día es
 * extraordinario en esa planta.
 */
export async function guardarHorarioPlantaAction(
  plantaId: number,
  tipoDia: string,
  aperturaHHMM: string,
  cierreHHMM: string,
  activo: boolean,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  if (!(TIPOS_DIA as readonly string[]).includes(tipoDia)) {
    return { ok: false, mensaje: "Tipo de día no válido." };
  }
  const planta = await prisma.plantas.findUnique({
    where: { id: plantaId },
    select: { nombre: true, plantel: { select: { nombre: true } } },
  });
  if (!planta) return { ok: false, mensaje: "Planta no encontrada." };

  const apertura = parsearHoraMin(aperturaHHMM);
  const cierre = parsearHoraMin(cierreHHMM);
  if (apertura == null || cierre == null) {
    return { ok: false, mensaje: "Usa el formato HH:MM (por ejemplo 07:00)." };
  }
  if (cierre <= apertura) {
    return { ok: false, mensaje: "La hora de cierre debe ser posterior a la de apertura." };
  }

  const previo = await prisma.horario_normal_planta.findUnique({
    where: { planta_id_tipo_dia: { planta_id: plantaId, tipo_dia: tipoDia } },
  });
  const fila = await prisma.horario_normal_planta.upsert({
    where: { planta_id_tipo_dia: { planta_id: plantaId, tipo_dia: tipoDia } },
    create: {
      planta_id: plantaId,
      tipo_dia: tipoDia,
      hora_apertura_min: apertura,
      hora_cierre_min: cierre,
      activo,
    },
    update: { hora_apertura_min: apertura, hora_cierre_min: cierre, activo },
  });

  const texto = (a: number, c: number, act: boolean) =>
    act ? `${textoMin(a)} a ${textoMin(c)}` : "sin horario normal";
  await auditar(
    "horario_normal_planta",
    fila.id,
    tipoDia,
    previo ? texto(previo.hora_apertura_min, previo.hora_cierre_min, previo.activo) : "sin horario normal",
    texto(apertura, cierre, activo),
    `Horario normal de ${planta.plantel.nombre} · ${planta.nombre} (${tipoDia})`,
  );

  revalidatePath("/administracion");
  revalidatePath("/extraordinario");
  return { ok: true };
}

/** Costo por m³ que la ficha de costos absorbe de sobretiempo (L 30.78 por defecto). */
export async function guardarCostoFichaAction(valor: string): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const v = Number(valor.trim().replace(/,/g, ""));
  if (!Number.isFinite(v) || v < 0) {
    return { ok: false, mensaje: "El costo no es un número válido." };
  }
  const monto = Math.round(v * 100) / 100;

  const previo = await prisma.configuracion.findUnique({ where: { clave: CLAVE_COSTO_FICHA } });
  await prisma.configuracion.upsert({
    where: { clave: CLAVE_COSTO_FICHA },
    create: { clave: CLAVE_COSTO_FICHA, valor_float: monto },
    update: { valor_float: monto },
  });
  await auditar(
    "configuracion",
    0,
    CLAVE_COSTO_FICHA,
    previo?.valor_float == null ? "sin valor" : previo.valor_float.toFixed(2),
    monto.toFixed(2),
    "Costo por m³ de sobretiempo en la ficha de costos",
  );

  revalidatePath("/administracion");
  revalidatePath("/extraordinario");
  return { ok: true };
}

/** Umbral (%) sobre el cual se resalta una planta o un día por su volumen extra. */
export async function guardarUmbralExtraAction(valor: string): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const v = Number.parseInt(valor.trim(), 10);
  if (!Number.isFinite(v) || v < 0 || v > 100) {
    return { ok: false, mensaje: "El umbral debe ser un porcentaje entre 0 y 100." };
  }

  const previo = await prisma.configuracion.findUnique({ where: { clave: CLAVE_UMBRAL_EXTRA } });
  await prisma.configuracion.upsert({
    where: { clave: CLAVE_UMBRAL_EXTRA },
    create: { clave: CLAVE_UMBRAL_EXTRA, valor_int: v },
    update: { valor_int: v },
  });
  await auditar(
    "configuracion",
    0,
    CLAVE_UMBRAL_EXTRA,
    previo?.valor_int == null ? "sin valor" : String(previo.valor_int),
    String(v),
    "Umbral de volumen extraordinario para resaltar",
  );

  revalidatePath("/administracion");
  revalidatePath("/extraordinario");
  return { ok: true };
}
