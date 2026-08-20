// Quién ve el calendario de producción del Panel Principal, y con qué alcance.
//
// La regla la fijó el usuario y NO coincide con `filtroPedidoPorZona` para todos los
// roles (p. ej. Almacén no tiene límite de zona en el resto del sistema, pero aquí sí),
// así que vive en su propia función pura y probada en vez de repartirse por la página:
//
//   · Administrador, Gerente Comercial y Gerente de Control de Calidad → TODO.
//   · Jefe de Planta                → solo los planteles que tiene asignados.
//   · Programador, Despachador,
//     Jefe de Laboratorio, Almacén  → solo su zona asignada.
//   · Asesor (y AsesorRestringido)  → solo el volumen despachado a SUS clientes.
//   · Laboratorista y Dosificador   → NO lo ven.
//
// Cuando el calendario no es visible, la página ni siquiera consulta la producción:
// el dato no se envía al navegador, no se oculta con CSS.

import type { Alcance } from "@/lib/auth/acceso";
import { filtroPedidoPorAsesor } from "@/lib/auth/acceso";
import { ZONAS } from "@/lib/auth/roles";

export interface AccesoCalendario {
  /** false = el rol no ve el calendario (no se consulta ni se renderiza). */
  visible: boolean;
  /** `where` extra para `pedidos` según el alcance del usuario. */
  filtro: Record<string, unknown>;
  /** Zonas ofrecidas en el selector. Vacío = sin selector (el alcance ya la fija). */
  zonas: string[];
  /** Texto del alcance para el encabezado ("Zona Norte", "Tus clientes"…). */
  etiqueta: string | null;
  /** true = el rol se limita por zona pero el usuario no tiene zona asignada. */
  faltaZona: boolean;
}

const OCULTO: AccesoCalendario = {
  visible: false,
  filtro: {},
  zonas: [],
  etiqueta: null,
  faltaZona: false,
};

/**
 * Resuelve el acceso al calendario. `userId` solo se usa para el Asesor (sus clientes);
 * si falta, el Asesor no ve nada (mejor no mostrar que mostrar de más).
 *
 * El orden de las reglas importa: un usuario puede tener VARIOS roles y gana el más
 * amplio. Un Laboratorista que además sea Programador ve su zona; un Laboratorista
 * "puro" no ve el calendario.
 */
export function accesoCalendario(
  alcance: Alcance | null,
  userId: string | null | undefined,
): AccesoCalendario {
  if (!alcance) return OCULTO;

  // 1. Acceso completo (ambas zonas, con selector).
  if (alcance.esAdmin || alcance.esGerenteComercial || alcance.esGerenteControlCalidad) {
    return { visible: true, filtro: {}, zonas: [...ZONAS], etiqueta: null, faltaZona: false };
  }

  // 2. Jefe de Planta: SOLO sus planteles asignados (sin selector de zona; su zona se
  //    deriva de esos planteles). Sin planteles asignados no ve nada (`[-1]`).
  if (alcance.esJefePlanta) {
    const ids = alcance.plantelesAsignados.length ? alcance.plantelesAsignados : [-1];
    return {
      visible: true,
      filtro: { plantel_id: { in: ids } },
      zonas: [],
      etiqueta: ids.length === 1 && ids[0] !== -1 ? "Tu plantel" : "Tus planteles",
      faltaZona: false,
    };
  }

  // 3. Roles limitados a SU zona. Se usa `alcance.zona` (la del usuario), no
  //    `zonasPermitidas`: Almacén no tiene límite de zona en el resto del sistema y
  //    aquí sí debe tenerlo.
  if (
    alcance.esProgramador ||
    alcance.esDespachador ||
    alcance.esJefeLaboratorio ||
    alcance.esAlmacen
  ) {
    if (!alcance.zona) {
      return { visible: true, filtro: { plantel_id: -1 }, zonas: [], etiqueta: null, faltaZona: true };
    }
    return {
      visible: true,
      filtro: { plantel: { zona: alcance.zona } },
      zonas: [],
      etiqueta: `Zona ${alcance.zona}`,
      faltaZona: false,
    };
  }

  // 4. Asesor: el volumen despachado a SUS clientes (sin límite de zona: el cliente
  //    es el límite).
  if (alcance.esAsesor) {
    if (!userId) return OCULTO;
    return {
      visible: true,
      filtro: filtroPedidoPorAsesor(userId),
      zonas: [],
      etiqueta: "Tus clientes",
      faltaZona: false,
    };
  }

  // 5. Laboratorista, Dosificador y cualquier rol futuro: no lo ven.
  return OCULTO;
}
