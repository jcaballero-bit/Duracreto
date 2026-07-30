// ─────────────────────────────────────────────────────────────────────────────
// Ventana horaria que ocupa un Laboratorista en un proyecto (cliente) un día.
// PURO (sin BD): se deriva de los viajes de ese cliente ese día. Regla de negocio:
// el Laboratorista debe estar presente DESDE antes de la llegada del primer mixer
// HASTA que el último mixer se retira del proyecto.
//
// Se usa para validar que un mismo Laboratorista no quede con dos proyectos cuyos
// horarios se traslapan el mismo día (ver app/laboratorio/actions.ts).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Margen (minutos) que el Laboratorista debe llegar ANTES del primer mixer.
 * Configurable: súbelo si se quiere más antelación en obra.
 */
export const MARGEN_LLEGADA_LABORATORISTA_MIN = 15;

/** Campos de un viaje necesarios para calcular la ventana (subconjunto de `viajes`). */
export interface ViajeVentana {
  mixer_id: number | null;
  // Llegada al proyecto: real si ya pasó, si no la programada.
  hora_llegada_proyecto: Date | null;
  ts_llegada_real: Date | null;
  // Salida del proyecto (el mixer se retira). Prioridad: regreso real -> regreso
  // programado -> fin de descarga real -> fin de descarga programado. `hora_regreso_planta`
  // es el límite documentado (cota superior segura); el fin de descarga es el
  // respaldo cuando el regreso no está modelado.
  hora_regreso_planta: Date | null;
  ts_regreso_real: Date | null;
  hora_fin_descarga: Date | null;
  ts_fin_descarga_real: Date | null;
}

export interface Ventana {
  inicioMs: number; // llegada del primer mixer − margen
  finMs: number; // salida del último mixer del proyecto
}

/** Llegada efectiva de un viaje (real si existe, si no la programada). */
function llegadaDe(v: ViajeVentana): Date | null {
  return v.ts_llegada_real ?? v.hora_llegada_proyecto;
}

/** Momento en que el viaje se retira del proyecto (ver prioridad arriba). */
function salidaDe(v: ViajeVentana): Date | null {
  return (
    v.ts_regreso_real ?? v.hora_regreso_planta ?? v.ts_fin_descarga_real ?? v.hora_fin_descarga
  );
}

/**
 * Ventana [inicio − margen, fin] que ocupa el Laboratorista para un proyecto un día.
 * Devuelve null si los viajes no tienen horario suficiente para determinarla (no
 * hay mixer asignado, o falta llegada o salida) — en ese caso no hay traslape que
 * validar todavía.
 */
export function ventanaOcupada(
  viajes: ViajeVentana[],
  margenMin: number = MARGEN_LLEGADA_LABORATORISTA_MIN,
): Ventana | null {
  let inicio = Number.POSITIVE_INFINITY;
  let fin = Number.NEGATIVE_INFINITY;
  for (const v of viajes) {
    if (v.mixer_id == null) continue; // viaje sin mixer: aún sin horario real
    const llegada = llegadaDe(v);
    const salida = salidaDe(v);
    if (llegada) inicio = Math.min(inicio, llegada.getTime());
    if (salida) fin = Math.max(fin, salida.getTime());
  }
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
  return { inicioMs: inicio - margenMin * 60_000, finMs: fin };
}

/**
 * Ventana de UN pedido (programa). Igual que `ventanaOcupada`, pero descarta los
 * viajes cuya llegada cae FUERA del día del pedido (`diaRef` = su hora_solicitada).
 * Protege contra artefactos del motor que agendan un viaje en otro día y crearían
 * una ventana gigante y falsos traslapes.
 */
export function ventanaDePedido(
  viajes: ViajeVentana[],
  diaRef: Date,
  margenMin: number = MARGEN_LLEGADA_LABORATORISTA_MIN,
): Ventana | null {
  const ini = new Date(diaRef.getFullYear(), diaRef.getMonth(), diaRef.getDate()).getTime();
  const fin = new Date(diaRef.getFullYear(), diaRef.getMonth(), diaRef.getDate() + 1).getTime();
  const delDia = viajes.filter((v) => {
    const ll = v.ts_llegada_real ?? v.hora_llegada_proyecto;
    if (!ll) return false;
    const t = ll.getTime();
    return t >= ini && t < fin;
  });
  return ventanaOcupada(delDia, margenMin);
}

/** ¿Se traslapan dos ventanas? Tocarse en el borde (fin == inicio) NO es traslape. */
export function seTraslapan(a: Ventana, b: Ventana): boolean {
  return a.inicioMs < b.finMs && b.inicioMs < a.finMs;
}

/** Formatea una ventana como "8:00 a.m. a 10:30 a.m." para mensajes al usuario. */
export function formatearVentana(v: Ventana): string {
  return `${hhmm(new Date(v.inicioMs))} a ${hhmm(new Date(v.finMs))}`;
}

function hhmm(d: Date): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suf = h < 12 ? "a.m." : "p.m.";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suf}`;
}
