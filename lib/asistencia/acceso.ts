/**
 * Alcance de la pantalla de Asistencia.
 *
 * Regla acordada: el Administrador ve todo; el **Jefe de Planta** solo sus planteles
 * asignados; el **Programador** su zona. Vive aparte de `filtroPlantelPorZona` porque
 * esta pantalla se abre a un conjunto propio de roles y conviene que la regla sea
 * explícita y probable por sí sola.
 *
 * Se usa en los DOS caminos: para armar la lista de la pantalla y para validar en el
 * servidor a quién se puede editar (si no, un Jefe de Planta podría guardar la
 * asistencia de alguien de otro plantel invocando la acción directamente).
 */
import type { Alcance } from "@/lib/auth/acceso";

export interface AlcanceAsistencia {
  /** Ve a TODO el personal, incluido el que no tiene plantel asignado. */
  todos: boolean;
  /** Planteles visibles (vacío + todos=false significa que no ve nada). */
  plantelIds: number[];
  /** Zonas visibles, cuando el alcance es por zona (Programador). */
  zonas: string[];
  /** Puede escribir en la pantalla (todos los roles con acceso capturan). */
  puedeEditar: boolean;
  /** Texto del alcance, para el encabezado. */
  etiqueta: string;
}

/**
 * Resuelve el alcance a partir del rol. `plantelesDeZona` traduce las zonas del
 * Programador a planteles concretos (lo trae la pantalla desde la base).
 */
export function alcanceAsistencia(
  alcance: Alcance,
  plantelesDeZona: (zonas: string[]) => number[],
): AlcanceAsistencia {
  if (alcance.esAdmin) {
    return { todos: true, plantelIds: [], zonas: [], puedeEditar: true, etiqueta: "Todos los planteles" };
  }

  // Jefe de Planta: SOLO sus planteles asignados (M2M). Sin planteles no ve nada, en
  // vez de verlo todo.
  if (alcance.esJefePlanta) {
    return {
      todos: false,
      plantelIds: alcance.plantelesAsignados.length ? alcance.plantelesAsignados : [-1],
      zonas: [],
      puedeEditar: true,
      etiqueta: "Mis planteles",
    };
  }

  // Programador: su zona.
  if (alcance.esProgramador) {
    const zonas = alcance.zonasPermitidas ?? [];
    const ids = plantelesDeZona(zonas);
    return {
      todos: false,
      plantelIds: ids.length ? ids : [-1],
      zonas,
      puedeEditar: true,
      etiqueta: zonas.length === 1 ? `Zona ${zonas[0]}` : "Mis zonas",
    };
  }

  // Cualquier otro rol que llegara aquí no ve nada (el guard de ruta ya lo impide).
  return { todos: false, plantelIds: [-1], zonas: [], puedeEditar: false, etiqueta: "Sin alcance" };
}

/** Filtro Prisma para `operadores` según el alcance. */
export function filtroPersonalPorAlcance(
  a: AlcanceAsistencia,
): { plantel_asignado_id?: { in: number[] } } {
  if (a.todos) return {};
  return { plantel_asignado_id: { in: a.plantelIds } };
}

/** ¿Se puede capturar la asistencia de una persona de este plantel? */
export function puedeEditarPersona(
  a: AlcanceAsistencia,
  plantelDeLaPersona: number | null,
): boolean {
  if (!a.puedeEditar) return false;
  if (a.todos) return true;
  if (plantelDeLaPersona == null) return false; // sin plantel solo lo ve el Administrador
  return a.plantelIds.includes(plantelDeLaPersona);
}
