// ─────────────────────────────────────────────────────────────────────────────
// Reglas de acceso (PURO, sin BD ni sesión): qué puede ver/hacer cada rol.
// Se prueban en aislamiento y las consumen el guard server-side, las páginas,
// el sidebar y las server actions.
//
// Alcances:
//  · Administrador: todo, ambas zonas.
//  · Programador: programación (hoy en adelante), solo su zona.
//  · Despachador: solo hoy, solo su zona; crea de último momento.
//  · Asesor: solo sus propios clientes, sin límite de zona. Además puede CONSULTAR
//    (solo lectura) el Programa DPCR-08 de ambas zonas.
//  · GerenteComercial: dashboard comercial + CONSULTA (solo lectura, todas las
//    zonas) de Panel principal, Programación, Despacho en vivo, Programa DPCR-08 y
//    la sección Ventas (Clientes, Programa Semana, Confirmaciones). Nunca edita ni
//    opera pedidos.
//  · JefePlanta: Programación + Despacho de SUS planteles (alcance por CONJUNTO de
//    planteles asignados, M2M — puede supervisar varios). Edita. Además CONSULTA
//    (solo lectura) el Programa Semana.
//  · Dosificador: Despacho de SU plantel/planta (edita) + Programa DPCR-08 (ver, SOLO
//    de la zona de su plantel asignado — derivada de planteles.zona).
//  · Laboratorista: Despacho SOLO de los proyectos que le asignaron PARA ESE DÍA;
//    solo puede avanzar Llegada/Descargando/Regresando. + Programa DPCR-08 (ver,
//    SOLO de su zona asignada = User.zona).
//  · JefeLaboratorio: Programación + Despacho de SU ZONA en SOLO LECTURA; su única
//    escritura es asignar Laboratoristas (a proyectos y a plantas de su zona).
//  · GerenteControlCalidad: igual que JefeLaboratorio pero SIN límite de zona (ambas).
//  · Almacen: SOLO lectura de Programa Semana y Programa DPCR-08; nada más.
// ─────────────────────────────────────────────────────────────────────────────
import { ZONAS, type Rol } from "./roles";

export interface Alcance {
  roles: string[];
  zona: string | null;
  plantelAsignadoId: number | null;
  plantaAsignadaId: number | null; // planta específica del Dosificador
  /** Planteles asignados a un Jefe de Planta (M2M). Vacío para los demás roles. */
  plantelesAsignados: number[];
  esAdmin: boolean;
  esProgramador: boolean;
  esDespachador: boolean;
  esAsesor: boolean;
  esGerenteComercial: boolean;
  esJefePlanta: boolean;
  esDosificador: boolean;
  esLaboratorista: boolean;
  esJefeLaboratorio: boolean;
  esGerenteControlCalidad: boolean;
  esAlmacen: boolean;
  /** Zonas cuyas plantas/pedidos puede ver el usuario (por zona). */
  zonasPermitidas: string[];
}

export function calcularAlcance(
  roles: string[],
  zona: string | null,
  plantelAsignadoId: number | null = null,
  plantaAsignadaId: number | null = null,
  plantelesAsignados: number[] = [],
): Alcance {
  const esAdmin = roles.includes("Administrador");
  const esProgramador = roles.includes("Programador");
  const esDespachador = roles.includes("Despachador");
  const esAsesor = roles.includes("Asesor");
  const esGerenteComercial = roles.includes("GerenteComercial");
  const esJefePlanta = roles.includes("JefePlanta");
  const esDosificador = roles.includes("Dosificador");
  const esLaboratorista = roles.includes("Laboratorista");
  const esJefeLaboratorio = roles.includes("JefeLaboratorio");
  const esGerenteControlCalidad = roles.includes("GerenteControlCalidad");
  const esAlmacen = roles.includes("Almacen");

  // Roles sin límite de zona (ven todas o se limitan por otra dimensión: cliente,
  // proyecto asignado, o conjunto de planteles). Programador/Despachador/JefePlanta/
  // JefeLaboratorio van por zona (JefeLaboratorio se restringió por zona en la
  // Tanda 3). GerenteControlCalidad = JefeLab SIN límite de zona.
  const sinLimiteZona =
    esAdmin ||
    esAsesor ||
    esGerenteComercial ||
    esLaboratorista ||
    esGerenteControlCalidad ||
    esAlmacen;
  const zonasPermitidas = sinLimiteZona ? [...ZONAS] : zona ? [zona] : [];

  return {
    roles,
    zona,
    plantelAsignadoId,
    plantaAsignadaId,
    plantelesAsignados,
    esAdmin,
    esProgramador,
    esDespachador,
    esAsesor,
    esGerenteComercial,
    esJefePlanta,
    esDosificador,
    esLaboratorista,
    esJefeLaboratorio,
    esGerenteControlCalidad,
    esAlmacen,
    zonasPermitidas,
  };
}

// ── Acceso a rutas por rol ───────────────────────────────────────────────────
export const ACCESO_RUTAS: Record<string, Rol[]> = {
  "/": [
    "Administrador", "Programador", "Despachador", "Asesor",
    "JefePlanta", "Dosificador", "Laboratorista", "JefeLaboratorio", "GerenteComercial",
    "GerenteControlCalidad", "Almacen",
  ],
  "/programacion": [
    "Administrador", "Programador", "JefePlanta", "JefeLaboratorio",
    "GerenteComercial", "GerenteControlCalidad",
  ],
  "/despacho": [
    "Administrador", "Despachador", "Asesor", "Programador",
    "JefePlanta", "Dosificador", "Laboratorista", "JefeLaboratorio", "GerenteComercial",
    "GerenteControlCalidad",
  ],
  // GerenteComercial: CONSULTA (solo lectura) de toda la sección Ventas.
  // JefePlanta: CONSULTA (solo lectura) del Programa Semana (para ver la carga
  // proyectada que llega a sus planteles). Almacen: SOLO Programa Semana (lectura).
  "/confirmaciones": ["Administrador", "Asesor", "GerenteComercial"],
  "/clientes/semana": [
    "Administrador", "Asesor", "Programador", "GerenteComercial", "JefePlanta", "Almacen",
  ],
  "/clientes": ["Administrador", "Asesor", "GerenteComercial"],
  "/comercial": ["Administrador", "GerenteComercial"],
  // Admin: toda la flota. Programador/Despachador/Dosificador/JefePlanta: SOLO la
  // pestaña Operadores (motoristas) — la página filtra las pestañas por rol.
  "/flota": ["Administrador", "Programador", "Despachador", "Dosificador", "JefePlanta"],
  "/reportes": ["Administrador", "JefePlanta"],
  // Programa DPCR-08: lo pueden VER todos los roles. Si el usuario tiene una zona
  // asignada, se filtra a esa zona; si no, ve ambas (ver `zonasParaPrograma`).
  "/programa": [
    "Administrador", "Programador", "Despachador", "Asesor", "GerenteComercial",
    "JefePlanta", "Dosificador", "Laboratorista", "JefeLaboratorio",
    "GerenteControlCalidad", "Almacen",
  ],
  "/laboratorio": ["Administrador", "JefeLaboratorio", "Laboratorista", "GerenteControlCalidad"],
  // Reporte de control de calidad (captura + PDF). Lo llena el Laboratorista (solo
  // sus proyectos asignados); el JefeLaboratorio (su zona) y el Gerente de Control
  // de Calidad / Admin también.
  "/calidad": ["Administrador", "Laboratorista", "JefeLaboratorio", "GerenteControlCalidad"],
  "/administracion": ["Administrador"],
  "/bitacora": ["Administrador"],
};

/** Roles que pueden entrar a una ruta (match por prefijo para rutas anidadas). */
export function rolesDeRuta(path: string): Rol[] {
  const clave = Object.keys(ACCESO_RUTAS)
    .filter((k) => k !== "/")
    .sort((a, b) => b.length - a.length)
    .find((k) => path === k || path.startsWith(`${k}/`));
  return ACCESO_RUTAS[clave ?? "/"];
}

export function puedeAccederRuta(roles: string[], path: string): boolean {
  const permitidos = rolesDeRuta(path);
  return roles.some((r) => permitidos.includes(r as Rol));
}

// ── Filtros de datos por alcance ─────────────────────────────────────────────
/** Filtro Prisma para `planteles`: por CONJUNTO de planteles (JefePlanta, M2M), por
 *  plantel específico (Dosificador), por zona (Programador/Despachador/JefeLab), o
 *  sin límite (Admin/Asesor/Laboratorista/GerenteComercial/GerenteControlCalidad/
 *  Almacen). */
export function filtroPlantelPorZona(
  alcance: Alcance,
): { zona?: { in: string[] }; id?: number | { in: number[] } } {
  if (alcance.esAdmin) return {};
  // Jefe de Planta: CUALQUIERA de sus planteles asignados (M2M). Tiene prioridad
  // sobre la zona y sobre el Dosificador (si el usuario es ambos).
  if (alcance.esJefePlanta)
    return { id: { in: alcance.plantelesAsignados.length ? alcance.plantelesAsignados : [-1] } };
  // Dosificador: acotado a SU plantel específico.
  if (alcance.esDosificador) return { id: alcance.plantelAsignadoId ?? -1 };
  if (
    alcance.esAsesor ||
    alcance.esLaboratorista ||
    alcance.esGerenteComercial || // consulta comercial: ve todas las zonas
    alcance.esGerenteControlCalidad || // control de calidad global
    alcance.esAlmacen
  )
    return {};
  // Programador, Despachador y JefeLaboratorio: por zona.
  return { zona: { in: alcance.zonasPermitidas } };
}

/** Filtro Prisma para `pedidos` por zona/plantel del alcance. NO cubre Asesor ni
 *  Laboratorista (esos se limitan por cliente/proyecto; usar sus filtros). */
export function filtroPedidoPorZona(
  alcance: Alcance,
): { plantel?: { zona: { in: string[] } }; plantel_id?: number | { in: number[] } } {
  if (alcance.esAdmin) return {};
  // Jefe de Planta: CUALQUIERA de sus planteles asignados (M2M).
  if (alcance.esJefePlanta)
    return { plantel_id: { in: alcance.plantelesAsignados.length ? alcance.plantelesAsignados : [-1] } };
  // Dosificador: acotado a SU plantel específico.
  if (alcance.esDosificador) return { plantel_id: alcance.plantelAsignadoId ?? -1 };
  if (
    alcance.esAsesor ||
    alcance.esLaboratorista ||
    alcance.esGerenteComercial ||
    alcance.esGerenteControlCalidad ||
    alcance.esAlmacen
  )
    return {};
  // Programador, Despachador y JefeLaboratorio: por zona.
  return { plantel: { zona: { in: alcance.zonasPermitidas } } };
}

/** Filtro Prisma para `pedidos` de un asesor (por su usuario de sistema). */
export function filtroPedidoPorAsesor(usuarioAuthId: string) {
  return { cliente: { asesor: { usuario_auth_id: usuarioAuthId } } };
}

/** Filtro Prisma para `pedidos` visibles por un Laboratorista: solo los PROGRAMAS
 *  (pedidos) que le fueron asignados. El día lo acota la consulta de Despacho por
 *  `hora_solicitada`, así que aquí basta con el dueño de la asignación. */
export function filtroPedidoPorLaboratorista(usuarioAuthId: string) {
  return {
    asignacion_lab: { is: { laboratorista_id: usuarioAuthId } },
  };
}

/** Filtro Prisma para `clientes` de un asesor (por su usuario de sistema). */
export function filtroClientePorAsesor(usuarioAuthId: string) {
  return { asesor: { usuario_auth_id: usuarioAuthId } };
}

// ── Reglas de fecha por rol (programar/modificar/operar un pedido) ───────────
/** ¿El rol puede operar un pedido en `fecha` (respecto a `hoy`)? */
export function puedeOperarEnFecha(
  alcance: Alcance,
  fecha: Date,
  hoy: Date,
): boolean {
  if (alcance.esAdmin) return true; // acceso total
  const dia = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const f = dia(fecha);
  const h = dia(hoy);
  // Programador y Jefe de Planta: hoy en adelante (programación futura).
  if ((alcance.esProgramador || alcance.esJefePlanta) && f >= h) return true;
  // Despachador, Dosificador, Laboratorista: solo el día de hoy (despacho).
  if ((alcance.esDespachador || alcance.esDosificador || alcance.esLaboratorista) && f === h)
    return true;
  // Asesor, JefeLaboratorio y GerenteComercial: sin escritura sobre pedidos (consulta).
  return false;
}

/** Estados de viaje que un Laboratorista puede avanzar (solo estos botones). */
export const ESTADOS_LABORATORISTA = ["Llegada", "Descargando", "Regresando"] as const;
