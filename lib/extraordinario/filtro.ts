/**
 * Resolución del filtro del reporte (rango de fechas + zona/plantel) y del alcance por
 * rol. Lo comparten la pantalla y la ruta de exportación a CSV, para que el enforcement
 * y los números sean IDÉNTICOS por los dos caminos (el mismo patrón que
 * `lib/programa/acceso.ts` usa para el DPCR-08).
 */
import { prisma } from "@/lib/prisma";
import type { Alcance } from "@/lib/auth/acceso";
import { filtroPlantelPorZona } from "@/lib/auth/acceso";

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function diaDesdeISO(texto: string | undefined): Date | null {
  const m = (texto ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

export interface RangoReporte {
  /** Inclusive, medianoche local. */
  desde: Date;
  /** EXCLUSIVO (el día siguiente al último día del rango). */
  hasta: Date;
  desdeISO: string;
  /** Último día INCLUIDO, como lo ve el usuario en el selector. */
  hastaISO: string;
}

/**
 * Rango del reporte. Por defecto, del primer día del mes en curso a hoy — el periodo
 * que se suele revisar. Si el usuario invierte las fechas, se ordenan.
 */
export function rangoDeParams(
  sp: { desde?: string; hasta?: string },
  hoy = new Date(),
): RangoReporte {
  const hoyDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  let desde = diaDesdeISO(sp.desde) ?? new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  let ultimo = diaDesdeISO(sp.hasta) ?? hoyDia;
  if (ultimo.getTime() < desde.getTime()) [desde, ultimo] = [ultimo, desde];
  const hasta = new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate() + 1);
  return { desde, hasta, desdeISO: iso(desde), hastaISO: iso(ultimo) };
}

export interface AlcanceReporte {
  /** Planteles que el usuario puede ver (Admin: todos; Jefe de Planta: los suyos). */
  planteles: { id: number; nombre: string; zona: string }[];
  /** Planteles que entran al cálculo, ya aplicados los filtros de zona y plantel. */
  plantelIds: number[];
  zonas: string[];
  zona: string;
  plantel: string;
  /** Texto del alcance, para el encabezado y el CSV. */
  etiqueta: string;
}

/**
 * Planteles visibles y filtrados. El filtro de la URL NUNCA amplía el alcance: se
 * intersecta con los planteles que el rol puede ver (un Jefe de Planta que escriba a
 * mano el id de otro plantel no obtiene datos ajenos).
 */
export async function alcanceDeParams(
  alcance: Alcance,
  sp: { zona?: string; plantel?: string },
): Promise<AlcanceReporte> {
  const visibles = await prisma.planteles.findMany({
    where: filtroPlantelPorZona(alcance),
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, zona: true },
  });

  const zonas = [...new Set(visibles.map((p) => p.zona))].sort();
  const zona = sp.zona && zonas.includes(sp.zona) ? sp.zona : "";

  let elegidos = zona === "" ? visibles : visibles.filter((p) => p.zona === zona);
  const plantelId = Number(sp.plantel);
  const plantelValido =
    Number.isInteger(plantelId) && elegidos.some((p) => p.id === plantelId) ? plantelId : null;
  if (plantelValido != null) elegidos = elegidos.filter((p) => p.id === plantelValido);

  const etiqueta =
    plantelValido != null
      ? `Plantel ${elegidos[0]?.nombre ?? plantelValido}`
      : zona !== ""
        ? `Zona ${zona}`
        : visibles.length === 1
          ? `Plantel ${visibles[0].nombre}`
          : "Todos los planteles";

  return {
    planteles: visibles,
    // Siempre explícito (nunca "vacío = todos"): así el cálculo no puede filtrarse a
    // planteles fuera del alcance del rol. Si el usuario no tiene ningún plantel
    // visible (un Jefe de Planta sin planteles asignados), se usa un id imposible para
    // que NO vea datos en vez de verlos todos.
    plantelIds: elegidos.length > 0 ? elegidos.map((p) => p.id) : [-1],
    zonas,
    zona,
    plantel: plantelValido != null ? String(plantelValido) : "",
    etiqueta,
  };
}
