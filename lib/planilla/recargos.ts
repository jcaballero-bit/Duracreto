/**
 * Tipo de día y bandas de recargo. Las bandas NO viven aquí: vienen de la tabla
 * `configuracion_recargos` (editable desde Administración). Este módulo solo define
 * la forma del dato y cómo se clasifica una fecha.
 */
export const TIPOS_DIA = ["LunVie", "Sabado", "Domingo"] as const;
export type TipoDia = (typeof TIPOS_DIA)[number];

export const ETIQUETA_TIPO_DIA: Record<TipoDia, string> = {
  LunVie: "Lunes a viernes",
  Sabado: "Sábado",
  Domingo: "Domingo",
};

/** Una franja horaria con su recargo. `hastaMin` es exclusivo; 24:00 = 1440. */
export interface BandaRecargo {
  tipoDia: TipoDia;
  desdeMin: number;
  hastaMin: number;
  porcentaje: number;
}

/**
 * Tipo de día de una fecha, según el día de la semana en hora local (el runtime
 * corre en America/Tegucigalpa, ver instrumentation.ts).
 */
export function tipoDiaDe(fecha: Date): TipoDia {
  const d = fecha.getDay();
  if (d === 0) return "Domingo";
  if (d === 6) return "Sabado";
  return "LunVie";
}

/** Minutos desde medianoche → "HH:MM" (1440 → "24:00"). */
export function textoMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" → minutos desde medianoche. Devuelve null si no se entiende. */
export function parsearHoraMin(texto: string): number | null {
  const m = texto.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || h * 60 + min > 1440) return null;
  return h * 60 + min;
}
