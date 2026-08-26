"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/guard";
import { periodoPorIndice } from "@/lib/planilla/periodos";
import {
  guardarRegistroAsistencia,
  type DatosAsistencia,
} from "@/lib/asistencia/registro";

export type { DatosAsistencia };

type Res = { ok: boolean; mensaje?: string };

const ESTADOS_PERIODO = ["Abierto", "Cerrado", "Pagado"] as const;

async function usuarioSesion(): Promise<string> {
  const s = await auth();
  return s?.user?.name ?? s?.user?.email ?? "sistema";
}

async function auditar(
  registroId: number,
  campo: string,
  antes: string,
  despues: string,
  motivo: string,
  tabla = "asistencia_operativos",
) {
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: tabla,
      registro_id: registroId,
      usuario: await usuarioSesion(),
      campo_modificado: campo,
      valor_anterior: antes,
      valor_nuevo: despues,
      motivo,
    },
  });
}

/** "YYYY-MM-DD" a medianoche local. */
function diaDesdeISO(fechaISO: string): Date | null {
  const m = fechaISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/**
 * Guarda (o borra) la asistencia de una persona en un día. Solo Administrador: esta
 * pantalla muestra salarios y el costo de las ausencias.
 *
 * La regla de negocio (validación, recálculo de horas y bitácora) es compartida con la
 * pantalla de Asistencia: vive una sola vez en `lib/asistencia/registro.ts`.
 */
export async function guardarAsistenciaAction(
  personaId: number,
  fechaISO: string,
  datos: DatosAsistencia,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const r = await guardarRegistroAsistencia(personaId, fechaISO, datos, await usuarioSesion());
  if (r.ok) revalidatePath("/planilla");
  return r;
}

/**
 * Salario mensual de una persona. DATO SENSIBLE: solo Administrador. El diario y el
 * horario se derivan de este valor (ver lib/planilla/salario.ts).
 */
export async function guardarSalarioAction(
  personaId: number,
  salarioMensual: string,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const texto = salarioMensual.trim();
  let valor: number | null = null;
  if (texto !== "") {
    const v = Number(texto.replace(/,/g, ""));
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, mensaje: "El salario no es un número válido." };
    }
    valor = Math.round(v * 100) / 100;
  }

  const previo = await prisma.operadores.findUnique({
    where: { id: personaId },
    select: { nombre: true, salario_mensual: true },
  });
  if (!previo) return { ok: false, mensaje: "Persona no encontrada." };
  if (previo.salario_mensual === valor) return { ok: true };

  await prisma.operadores.update({
    where: { id: personaId },
    data: { salario_mensual: valor },
  });
  await auditar(
    personaId,
    "salario_mensual",
    previo.salario_mensual == null ? "sin salario" : previo.salario_mensual.toFixed(2),
    valor == null ? "sin salario" : valor.toFixed(2),
    `Salario mensual de ${previo.nombre}`,
    "operadores",
  );

  revalidatePath("/planilla");
  return { ok: true };
}

/** Estado del periodo de pago (Abierto / Cerrado / Pagado). Crea la fila si no existe. */
export async function cambiarEstadoPeriodoAction(
  indice: number,
  estado: string,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;
  if (!(ESTADOS_PERIODO as readonly string[]).includes(estado)) {
    return { ok: false, mensaje: "Estado no válido." };
  }

  const calc = periodoPorIndice(indice);
  const previo = await prisma.periodos_pago.findUnique({ where: { fecha_inicio: calc.inicio } });
  const fila = await prisma.periodos_pago.upsert({
    where: { fecha_inicio: calc.inicio },
    create: {
      fecha_inicio: calc.inicio,
      fecha_fin: calc.fin,
      fecha_pago: calc.pago,
      estado,
    },
    update: { estado },
  });
  await auditar(
    fila.id,
    "estado",
    previo?.estado ?? "Abierto",
    estado,
    "Estado del periodo de pago",
    "periodos_pago",
  );

  revalidatePath("/planilla");
  return { ok: true };
}

/**
 * Ajuste manual de un periodo (cuando una catorcena específica varía). El inicio es la
 * llave del periodo, así que solo se ajustan el cierre y la fecha de pago.
 */
export async function ajustarPeriodoAction(
  indice: number,
  finISO: string,
  pagoISO: string,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const calc = periodoPorIndice(indice);
  const fin = diaDesdeISO(finISO);
  const pago = diaDesdeISO(pagoISO);
  if (!fin || !pago) return { ok: false, mensaje: "Fecha no válida." };
  if (fin.getTime() < calc.inicio.getTime()) {
    return { ok: false, mensaje: "El cierre no puede ser antes del inicio del periodo." };
  }
  if (pago.getTime() < fin.getTime()) {
    return { ok: false, mensaje: "La fecha de pago no puede ser antes del cierre." };
  }

  const previo = await prisma.periodos_pago.findUnique({ where: { fecha_inicio: calc.inicio } });
  const fila = await prisma.periodos_pago.upsert({
    where: { fecha_inicio: calc.inicio },
    create: { fecha_inicio: calc.inicio, fecha_fin: fin, fecha_pago: pago, estado: "Abierto" },
    update: { fecha_fin: fin, fecha_pago: pago },
  });
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await auditar(
    fila.id,
    "fechas",
    previo ? `${f(previo.fecha_fin)} / paga ${f(previo.fecha_pago)}` : `${f(calc.fin)} / paga ${f(calc.pago)}`,
    `${f(fin)} / paga ${f(pago)}`,
    "Ajuste manual del periodo de pago",
    "periodos_pago",
  );

  revalidatePath("/planilla");
  return { ok: true };
}
