// Color FIJO y determinista por cliente (mismo color entre sesiones y recargas).
// Se usa en el Gantt del modo manual para distinguir de un vistazo los clientes
// intercalados en una misma planta. Se deriva del cliente_id con un hash simple
// que mapea a una paleta de tonos con buen contraste entre sí.
const PALETA = [
  "#2563eb", // azul
  "#dc2626", // rojo
  "#16a34a", // verde
  "#d97706", // ámbar
  "#7c3aed", // violeta
  "#0891b2", // cian
  "#db2777", // rosa
  "#4d7c0f", // oliva
  "#ea580c", // naranja
  "#4f46e5", // índigo
  "#0d9488", // teal
  "#be123c", // carmesí
];

const GRIS = "#64748b";

/** Color hex determinista para un cliente (gris si no hay id). */
export function colorPorCliente(id: number | null | undefined): string {
  if (id == null) return GRIS;
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}
