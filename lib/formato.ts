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
