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

// ─────────────────────────────────────────────────────────────────────────────────────
// Gráfico de TENDENCIA (a la derecha del calendario)
// ─────────────────────────────────────────────────────────────────────────────────────

export interface AccesoTendencia {
  /** false = el rol no ve el gráfico (no se consulta ni se renderiza). */
  visible: boolean;
  /** Planteles que puede graficar, ya acotados a su alcance. Vacío = ninguno. */
  planteles: { id: number; nombre: string; zona: string }[];
  /** Texto del botón de total, para que no se confunda con el nacional. */
  etiquetaTotal: string;
  /** El rol se limita por zona pero el usuario no tiene zona asignada. */
  faltaZona: boolean;
}

const SIN_TENDENCIA: AccesoTendencia = {
  visible: false,
  planteles: [],
  etiquetaTotal: "",
  faltaZona: false,
};

/**
 * Qué planteles puede GRAFICAR cada rol, y cómo se llama su "total".
 *
 * Sigue el mismo orden de reglas que `accesoCalendario` (gana el rol más amplio) y hay
 * una prueba que comprueba que los dos coinciden: los planteles que este selector ofrece
 * son exactamente los que el filtro del calendario dejaría pasar.
 *
 * Una diferencia deliberada: el **Asesor** NO ve el gráfico. Su alcance es por CLIENTE,
 * no por plantel, así que un eje de planteles le mostraría volumen de clientes que no son
 * suyos — y "Total" sería el total de la empresa. Su calendario sigue mostrando lo suyo,
 * que es la vista que le corresponde.
 *
 * El "total" se nombra según el alcance ("Total nacional" / "Total Zona Norte" / "Total
 * de tus planteles") para que nadie lea un total de zona como si fuera el de la empresa.
 */
export function accesoTendencia(
  alcance: Alcance | null,
  planteles: { id: number; nombre: string; zona: string }[],
): AccesoTendencia {
  if (!alcance) return SIN_TENDENCIA;

  // 1. Acceso completo: todos los planteles y el total nacional.
  if (alcance.esAdmin || alcance.esGerenteComercial || alcance.esGerenteControlCalidad) {
    return {
      visible: true,
      planteles,
      etiquetaTotal: "Total nacional",
      faltaZona: false,
    };
  }

  // 2. Jefe de Planta: SOLO sus planteles asignados, y el total de esos.
  if (alcance.esJefePlanta) {
    const suyos = new Set(alcance.plantelesAsignados);
    const mios = planteles.filter((p) => suyos.has(p.id));
    return {
      visible: true,
      planteles: mios,
      etiquetaTotal: mios.length === 1 ? `Total ${mios[0].nombre}` : "Total de tus planteles",
      faltaZona: false,
    };
  }

  // 3. Roles limitados a SU zona: los planteles de esa zona, y el total de la ZONA.
  if (
    alcance.esProgramador ||
    alcance.esDespachador ||
    alcance.esJefeLaboratorio ||
    alcance.esAlmacen
  ) {
    if (!alcance.zona) {
      return { visible: true, planteles: [], etiquetaTotal: "", faltaZona: true };
    }
    return {
      visible: true,
      planteles: planteles.filter((p) => p.zona === alcance.zona),
      etiquetaTotal: `Total Zona ${alcance.zona}`,
      faltaZona: false,
    };
  }

  // 4. Asesor, Laboratorista, Dosificador y cualquier rol futuro: no lo ven.
  return SIN_TENDENCIA;
}

/**
 * Acota una selección de planteles que llega del NAVEGADOR al alcance real del usuario.
 *
 * Es la validación server-side de la selección: filtrar el desplegable en la pantalla no
 * es una restricción. Devuelve `null` (= total de su alcance) cuando la selección viene
 * vacía o nada de lo pedido está permitido, así el gráfico nunca queda sin datos por un
 * parámetro manipulado.
 */
export function acotarSeleccion(
  pedidos: number[] | null | undefined,
  acceso: AccesoTendencia,
): number[] | null {
  if (!pedidos || pedidos.length === 0) return null;
  const permitidos = new Set(acceso.planteles.map((p) => p.id));
  const ok = [...new Set(pedidos)].filter((id) => permitidos.has(id));
  return ok.length > 0 ? ok.sort((a, b) => a - b) : null;
}
