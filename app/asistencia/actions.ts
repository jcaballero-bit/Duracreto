"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanceActual } from "@/lib/auth/guard";
import { puedeAccederRuta } from "@/lib/auth/acceso";
import { alcanceAsistencia, puedeEditarPersona } from "@/lib/asistencia/acceso";
import { guardarRegistroAsistencia } from "@/lib/asistencia/registro";

type Res = { ok: boolean; mensaje?: string };

/** Datos que captura la pantalla de Asistencia. NO incluye dinero. */
export interface DatosCaptura {
  entrada?: string; // "HH:MM" o ""
  salida?: string; // "HH:MM" o ""
  tipoAusencia?: string; // "" = trabajó
  observaciones?: string;
}

/**
 * Guarda la asistencia de una persona en un día desde la pantalla de Asistencia.
 *
 * El alcance se valida en el SERVIDOR: un Jefe de Planta solo puede capturar a gente de
 * sus planteles y un Programador solo de su zona, aunque invoquen la acción con el id de
 * otra persona. El costo de la ausencia NO se toca aquí (esta pantalla no maneja dinero):
 * se conserva el que tuviera la fila.
 */
export async function guardarAsistenciaCapturaAction(
  personaId: number,
  fechaISO: string,
  datos: DatosCaptura,
): Promise<Res> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };
  if (!puedeAccederRuta(sesion.user.roles ?? [], "/asistencia")) {
    return { ok: false, mensaje: "No tienes permiso para capturar asistencia." };
  }
  const alcance = await alcanceActual();
  if (!alcance) return { ok: false, mensaje: "Sesión no válida." };

  const persona = await prisma.operadores.findUnique({
    where: { id: personaId },
    select: { plantel_asignado_id: true, activo: true, nombre: true },
  });
  if (!persona) return { ok: false, mensaje: "Persona no encontrada." };

  const zonas = alcance.zonasPermitidas ?? [];
  const plantelesDeZona = zonas.length
    ? (await prisma.planteles.findMany({ where: { zona: { in: zonas } }, select: { id: true } })).map(
        (p) => p.id,
      )
    : [];
  const ambito = alcanceAsistencia(alcance, () => plantelesDeZona);

  if (!puedeEditarPersona(ambito, persona.plantel_asignado_id)) {
    return {
      ok: false,
      mensaje: `No puedes capturar la asistencia de ${persona.nombre}: no está en tu alcance.`,
    };
  }

  const usuario = sesion.user.name ?? sesion.user.email ?? "sistema";
  const r = await guardarRegistroAsistencia(
    personaId,
    fechaISO,
    {
      entrada: datos.entrada,
      salida: datos.salida,
      tipoAusencia: datos.tipoAusencia,
      observaciones: datos.observaciones,
      // `undefined` = no tocar el costo: esta pantalla no muestra ni edita dinero.
      costoAusencia: undefined,
    },
    usuario,
  );
  if (r.ok) {
    revalidatePath("/asistencia");
    revalidatePath("/planilla");
  }
  return r;
}
