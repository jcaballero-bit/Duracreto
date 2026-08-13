// Helpers de formato de presentación (compartidos entre pantallas).

interface DisenoSpec {
  resistencia_psi: number | null;
  etiqueta_resistencia: string | null;
  tamano_agregado?: string | null;
  revenimiento?: string | null;
}

/** Texto de la resistencia: etiqueta explícita ("MR-600") o psi con miles. */
export function textoResistencia(d: DisenoSpec): string {
  if (d.etiqueta_resistencia) return d.etiqueta_resistencia;
  if (d.resistencia_psi != null) return d.resistencia_psi.toLocaleString("en-US");
  return "—";
}

/** Segunda línea del "Tipo de concreto": "4,000 · 3/4"" o "MR-600 · 1-1/2"". */
export function especDiseno(d: DisenoSpec): string {
  const r = textoResistencia(d);
  const agregado = d.tamano_agregado ?? d.revenimiento ?? "";
  return agregado ? `${r} · ${agregado}` : r;
}

/** Texto del control de temperatura por sacos de hielo/m³. */
export function textoHielo(sacos: number | null | undefined): string {
  const n = sacos ?? 0;
  return n <= 0 ? "Sin Control de Temperatura" : `Temp: ${n} sacos/m³`;
}

/**
 * Antigüedad relativa en español a partir de una fecha (o su ISO): "hace 3 días",
 * "hace 2 h", "hace 5 min", "recién". Para mostrar cuánto lleva esperando una
 * proyección/solicitud. `ahora` inyectable para pruebas deterministas.
 */
export function tiempoRelativo(
  fecha: Date | string | null | undefined,
  ahora: Date = new Date(),
): string {
  if (!fecha) return "";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (isNaN(d.getTime())) return "";
  const seg = Math.floor((ahora.getTime() - d.getTime()) / 1000);
  if (seg < 45) return "recién";
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const dias = Math.floor(hrs / 24);
  if (dias < 30) return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
  const anios = Math.floor(meses / 12);
  return `hace ${anios} ${anios === 1 ? "año" : "años"}`;
}

/** Fecha + hora exactas (para tooltips): "12/08/2026 14:35". */
export function fechaHoraCorta(fecha: Date | string | null | undefined): string {
  if (!fecha) return "";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
