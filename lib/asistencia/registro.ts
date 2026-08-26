/**
 * Guardado de un registro de asistencia (persona + día).
 *
 * ÚNICA implementación del guardado: la usan la pantalla de Asistencia (Jefe de Planta,
 * Programador y Administrador, sin ver costos) y la de Planilla (solo Administrador, con
 * el costo de la ausencia). Cada pantalla pone su propio guard de acceso; la regla de
 * negocio —qué se guarda, cómo se recalculan las horas y qué queda en la bitácora— vive
 * aquí una sola vez.
 *
 * Las horas SIEMPRE se recalculan con `calcularHorasTurno` desde las marcas, así que no
 * pueden quedar desalineadas con las bandas de recargo configuradas.
 */
import { prisma } from "@/lib/prisma";
import { calcularHorasTurno } from "@/lib/planilla/horas";
import { leerBandas } from "@/lib/planilla/consulta";
import { costoSugeridoAusencia, esTipoAusencia, type TipoAusencia } from "@/lib/planilla/ausencias";

export interface DatosAsistencia {
  entrada?: string; // "HH:MM" o "" (vacío = sin marca)
  salida?: string; // "HH:MM" o ""
  tipoAusencia?: string; // "" = trabajó
  /**
   * Costo de la ausencia. `""` = usar el sugerido por tipo. `undefined` = NO tocarlo
   * (lo que hace la pantalla de Asistencia, que no muestra dinero: conserva el valor
   * que tuviera la fila y solo sugiere uno al crearla).
   */
  costoAusencia?: string;
  observaciones?: string;
}

export type ResultadoAsistencia = { ok: boolean; mensaje?: string };

/** "YYYY-MM-DD" a medianoche local. */
export function diaDesdeISO(fechaISO: string): Date | null {
  const m = fechaISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/**
 * "HH:MM" sobre un día dado. La salida anterior o igual a la entrada significa que el
 * turno cruzó la medianoche, y de eso se encarga `guardarRegistroAsistencia`.
 */
export function horaEn(dia: Date, texto: string): Date | null {
  const m = texto.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), h, min, 0, 0);
}

const hhmm = (f: Date | null) =>
  f ? `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}` : "--:--";

/** Texto corto del turno o la ausencia, para la bitácora. */
function resumen(entrada: Date | null, salida: Date | null, tipoAusencia: string | null): string {
  if (tipoAusencia) return `ausencia: ${tipoAusencia}`;
  if (!entrada && !salida) return "sin marcas";
  return `${hhmm(entrada)} a ${hhmm(salida)}`;
}

/**
 * Guarda (o borra) la asistencia de una persona en un día y recalcula sus horas por
 * nivel de recargo. Vaciar todo BORRA la fila: no deja un registro en cero, que no es lo
 * mismo que "no se capturó".
 */
export async function guardarRegistroAsistencia(
  personaId: number,
  fechaISO: string,
  datos: DatosAsistencia,
  usuario: string,
): Promise<ResultadoAsistencia> {
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
    // Turno nocturno: la salida cae en el día siguiente. Sin esto el cálculo daría
    // horas negativas.
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
        `${persona.nombre} ${fechaISO}`,
        "borrada",
        "Asistencia borrada",
        usuario,
      );
    }
    return { ok: true };
  }

  const horas = calcularHorasTurno(entrada, salida, await leerBandas());

  // Costo de la ausencia: el capturado, el sugerido por tipo, o el que ya tenía la fila
  // si quien guarda no maneja dinero (pantalla de Asistencia).
  let costoAusencia: number | null = null;
  if (hayAusencia) {
    if (datos.costoAusencia === undefined) {
      costoAusencia =
        previo && previo.tipo_ausencia === tipoAusencia
          ? previo.costo_ausencia
          : costoSugeridoAusencia(tipoAusencia as TipoAusencia, persona.salario_mensual);
    } else if (datos.costoAusencia.trim() === "") {
      costoAusencia = costoSugeridoAusencia(
        tipoAusencia as TipoAusencia,
        persona.salario_mensual,
      );
    } else {
      const v = Number(datos.costoAusencia.trim().replace(",", "."));
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, mensaje: "El costo de la ausencia no es un número válido." };
      }
      costoAusencia = Math.round(v * 100) / 100;
    }
  }

  const camposComunes = {
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
    // Capturado o corregido a mano: esto es lo que protege la fila de que una
    // importación posterior la reemplace en silencio.
    origen: "Manual",
  };

  const fila = await prisma.asistencia_operativos.upsert({
    where: { persona_id_fecha: { persona_id: personaId, fecha: dia } },
    create: { persona_id: personaId, fecha: dia, creado_por: usuario, ...camposComunes },
    update: { ...camposComunes, actualizado_por: usuario, actualizado_en: new Date() },
  });

  await auditar(
    fila.id,
    previo
      ? resumen(previo.hora_entrada, previo.hora_salida, previo.tipo_ausencia)
      : "sin registro",
    resumen(entrada, salida, hayAusencia ? tipoAusencia : null),
    `Asistencia de ${persona.nombre} el ${fechaISO}`,
    usuario,
  );

  return { ok: true };
}

async function auditar(
  registroId: number,
  antes: string,
  despues: string,
  motivo: string,
  usuario: string,
) {
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "asistencia_operativos",
      registro_id: registroId,
      usuario,
      campo_modificado: "asistencia",
      valor_anterior: antes,
      valor_nuevo: despues,
      motivo,
    },
  });
}
