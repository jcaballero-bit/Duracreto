"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/guard";
import { calcularHorasTurno } from "@/lib/planilla/horas";
import { leerBandas } from "@/lib/planilla/consulta";
import { costoSugeridoAusencia, esTipoAusencia } from "@/lib/planilla/ausencias";
import { periodoPorIndice } from "@/lib/planilla/periodos";

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
 * "HH:MM" sobre un día dado. Si la salida queda igual o antes de la entrada se
 * entiende que el turno cruzó la medianoche y la salida pasa al día siguiente
 * (así el turno nocturno se captura con dos horas, sin pedir una segunda fecha).
 */
function horaEn(dia: Date, texto: string): Date | null {
  const m = texto.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), h, min, 0, 0);
}

export interface DatosAsistencia {
  entrada?: string; // "HH:MM" o ""
  salida?: string; // "HH:MM" o ""
  tipoAusencia?: string; // "" = trabajó
  costoAusencia?: string; // "" = usar el sugerido
  observaciones?: string;
}

/**
 * Guarda (o borra) la asistencia de una persona en un día y recalcula sus horas por
 * nivel de recargo. Solo Administrador: la pantalla de planilla contiene salarios.
 */
export async function guardarAsistenciaAction(
  personaId: number,
  fechaISO: string,
  datos: DatosAsistencia,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const dia = diaDesdeISO(fechaISO);
  if (!dia) return { ok: false, mensaje: "Fecha no válida." };

  const persona = await prisma.operadores.findUnique({
    where: { id: personaId },
    select: { nombre: true, salario_mensual: true },
  });
  if (!persona) return { ok: false, mensaje: "Persona no encontrada." };

  const previo = await prisma.asistencia_operativos.findUnique({
    where: { persona_id_fecha: { persona_id: personaId, fecha: dia } },
  });

  const tipoAusencia = (datos.tipoAusencia ?? "").trim();
  const hayAusencia = tipoAusencia !== "";
  if (hayAusencia && !esTipoAusencia(tipoAusencia)) {
    return { ok: false, mensaje: "Tipo de ausencia no válido." };
  }

  // Una ausencia no lleva horas; un turno capturado limpia la ausencia.
  let entrada: Date | null = null;
  let salida: Date | null = null;
  if (!hayAusencia) {
    entrada = horaEn(dia, datos.entrada ?? "");
    salida = horaEn(dia, datos.salida ?? "");
    if ((datos.entrada ?? "").trim() !== "" && !entrada) {
      return { ok: false, mensaje: "Hora de entrada no válida (usa HH:MM)." };
    }
    if ((datos.salida ?? "").trim() !== "" && !salida) {
      return { ok: false, mensaje: "Hora de salida no válida (usa HH:MM)." };
    }
    // Turno nocturno: la salida cae en el día siguiente.
    if (entrada && salida && salida.getTime() <= entrada.getTime()) {
      salida = new Date(salida.getTime() + 86_400_000);
    }
  }

  const observaciones = (datos.observaciones ?? "").trim();

  // Nada que guardar: si existía la fila se borra (celda vaciada).
  if (!hayAusencia && !entrada && !salida && observaciones === "") {
    if (previo) {
      await prisma.asistencia_operativos.delete({ where: { id: previo.id } });
      await auditar(
        previo.id,
        "asistencia",
        `${persona.nombre} ${fechaISO}`,
        "borrada",
        "Asistencia borrada desde Planilla",
      );
      revalidatePath("/planilla");
    }
    return { ok: true };
  }

  const horas = calcularHorasTurno(entrada, salida, await leerBandas());

  // Costo de la ausencia: el capturado, o el sugerido por tipo si viene vacío.
  let costoAusencia: number | null = null;
  if (hayAusencia) {
    const texto = (datos.costoAusencia ?? "").trim();
    if (texto === "") {
      costoAusencia = costoSugeridoAusencia(
        tipoAusencia as Parameters<typeof costoSugeridoAusencia>[0],
        persona.salario_mensual,
      );
    } else {
      const v = Number(texto.replace(",", "."));
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, mensaje: "El costo de la ausencia no es un número válido." };
      }
      costoAusencia = Math.round(v * 100) / 100;
    }
  }

  const data = {
    hora_entrada: entrada,
    hora_salida: salida,
    horas_normales: horas.horas_normales,
    horas_extra_25: horas.horas_extra_25,
    horas_extra_50: horas.horas_extra_50,
    horas_extra_75: horas.horas_extra_75,
    horas_extra_100: horas.horas_extra_100,
    tipo_ausencia: hayAusencia ? tipoAusencia : null,
    costo_ausencia: costoAusencia,
    observaciones: observaciones === "" ? null : observaciones,
  };

  const fila = await prisma.asistencia_operativos.upsert({
    where: { persona_id_fecha: { persona_id: personaId, fecha: dia } },
    create: { persona_id: personaId, fecha: dia, creado_por: await usuarioSesion(), ...data },
    update: data,
  });

  const resumen = (
    e: Date | null,
    s: Date | null,
    aus: string | null,
    costo: number | null,
  ) => {
    if (aus) return `${aus} (L ${(costo ?? 0).toFixed(2)})`;
    const t = (f: Date | null) =>
      f ? `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}` : "--:--";
    return `${t(e)} a ${t(s)}`;
  };
  await auditar(
    fila.id,
    "asistencia",
    previo
      ? resumen(previo.hora_entrada, previo.hora_salida, previo.tipo_ausencia, previo.costo_ausencia)
      : "sin registro",
    resumen(entrada, salida, hayAusencia ? tipoAusencia : null, costoAusencia),
    `Asistencia de ${persona.nombre} el ${fechaISO}`,
  );

  revalidatePath("/planilla");
  return { ok: true };
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
