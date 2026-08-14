// Bloqueo horario de edición del PROGRAMA (control del Administrador).
//
// Pasada cierta hora del día, el Jefe de Planta y el Programador dejan de poder MOVER
// la programación (para que el programa del día siguiente no se siga cambiando de
// noche). Es un bloqueo de ESCRITURA: seguir consultando el programa funciona igual.
//
// Lo que NUNCA bloquea: el **Despacho en vivo**. Registrar lo que está pasando en la
// operación (avanzar estados, corregir horas reales, reasignar un mixer que se varó,
// adicionar volumen) no puede detenerse por un corte administrativo — si a las 5:00
// p.m. un despachador no pudiera marcar la llegada de un mixer, sería un error grave.
// Por eso el guard se aplica SOLO a las acciones de programación (ver `app/actions.ts`).
//
// El Administrador nunca queda bloqueado: si lo estuviera, no podría desactivar el
// bloqueo ni corregir nada después del corte.

import { prisma } from "@/lib/prisma";
import type { Alcance } from "@/lib/auth/acceso";

export const CLAVE_BLOQUEO_ACTIVO = "bloqueo_edicion_activo";
export const CLAVE_BLOQUEO_HORA = "bloqueo_edicion_hora_min";
/** Sugerido: 4:00 p.m. (la misma hora en que se congela el DPCR-08). */
export const BLOQUEO_HORA_DEFAULT_MIN = 16 * 60;

/** Roles a los que aplica el bloqueo. El Administrador queda siempre fuera. */
export const ROLES_BLOQUEADOS = ["Jefe de Planta", "Programador"] as const;

export interface ConfigBloqueo {
  activo: boolean;
  /** Hora de corte en minutos desde medianoche. */
  horaCorteMin: number;
}

// ── Regla pura ───────────────────────────────────────────────────────────────

export interface ResultadoBloqueo {
  bloqueado: boolean;
  mensaje?: string;
}

/** "16:00" desde minutos, en formato de 12 h para el aviso al usuario. */
export function textoHoraCorte(minutos: number): string {
  const h24 = Math.floor(minutos / 60);
  const m = String(minutos % 60).padStart(2, "0");
  const suf = h24 < 12 ? "a.m." : "p.m.";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m} ${suf}`;
}

/**
 * ¿Está bloqueada la edición del programa para este usuario en este instante?
 * PURA (sin BD ni sesión) para poder probarla con casos de mesa.
 *
 * Bloquea si: la config está activa, ya pasó la hora de corte, y el usuario tiene un
 * rol afectado (Programador o Jefe de Planta) sin ser Administrador.
 */
export function bloqueaEdicionPrograma(
  cfg: ConfigBloqueo,
  alcance: Pick<Alcance, "esAdmin" | "esProgramador" | "esJefePlanta">,
  ahora: Date,
): ResultadoBloqueo {
  if (!cfg.activo) return { bloqueado: false };
  if (alcance.esAdmin) return { bloqueado: false }; // el Admin nunca se autobloquea
  if (!alcance.esProgramador && !alcance.esJefePlanta) return { bloqueado: false };

  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  if (minutosAhora < cfg.horaCorteMin) return { bloqueado: false };

  return {
    bloqueado: true,
    mensaje:
      `La edición del programa está bloqueada desde las ${textoHoraCorte(cfg.horaCorteMin)}. ` +
      "Contacta al administrador si necesitas hacer un cambio.",
  };
}

// ── Lectura desde BD ─────────────────────────────────────────────────────────

/** Config del bloqueo. Ante cualquier problema devuelve DESACTIVADO: un fallo de
 *  lectura nunca debe dejar al equipo sin poder programar. */
export async function leerConfigBloqueo(): Promise<ConfigBloqueo> {
  try {
    const filas = await prisma.configuracion.findMany({
      where: { clave: { in: [CLAVE_BLOQUEO_ACTIVO, CLAVE_BLOQUEO_HORA] } },
    });
    const valor = (clave: string) => filas.find((f) => f.clave === clave)?.valor_int ?? null;
    const hora = valor(CLAVE_BLOQUEO_HORA);
    return {
      activo: valor(CLAVE_BLOQUEO_ACTIVO) === 1,
      horaCorteMin:
        typeof hora === "number" && hora >= 0 && hora < 24 * 60 ? hora : BLOQUEO_HORA_DEFAULT_MIN,
    };
  } catch {
    return { activo: false, horaCorteMin: BLOQUEO_HORA_DEFAULT_MIN };
  }
}

/** Estado del bloqueo para un usuario AHORA (config de BD + regla pura). */
export async function estadoBloqueoPrograma(
  alcance: Pick<Alcance, "esAdmin" | "esProgramador" | "esJefePlanta">,
  ahora: Date = new Date(),
): Promise<ResultadoBloqueo & { cfg: ConfigBloqueo }> {
  const cfg = await leerConfigBloqueo();
  return { ...bloqueaEdicionPrograma(cfg, alcance, ahora), cfg };
}
