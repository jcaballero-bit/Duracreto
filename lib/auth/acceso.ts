// ─────────────────────────────────────────────────────────────────────────────
// Reglas de acceso (PURO, sin BD ni sesión): qué puede ver/hacer cada rol.
// Se prueban en aislamiento y las consumen el guard server-side, las páginas,
// el sidebar y las server actions.
//
// Alcances:
//  · Administrador: todo, ambas zonas.
//  · Programador: programación (hoy en adelante), solo su zona.
//  · Despachador: solo hoy, solo su zona; crea de último momento.
//  · Asesor: solo sus propios clientes, sin límite de zona.
//  · GerenteComercial: dashboard comercial (solo consulta).
//  · JefePlanta: Programación + Despacho de SU plantel (alcance por plantel, más
//    fino que por zona). Edita.
//  · Dosificador: Despacho de SU plantel (edita) + Programa DPCR-08 (ver, SOLO de
//    la zona de su plantel asignado — derivada de planteles.zona).
//  · Laboratorista: Despacho SOLO de los proyectos que le asignaron PARA ESE DÍA;
//    solo puede avanzar Llegada/Descargando/Regresando. + Programa DPCR-08 (ver,
//    SOLO de su zona asignada = User.zona).
//  · JefeLaboratorio: Programación + Despacho completos en SOLO LECTURA; su única
//    escritura es asignar proyectos a Laboratoristas.
// ─────────────────────────────────────────────────────────────────────────────
import { ZONAS, type Rol } from "./roles";

export interface Alcance {
  roles: string[];
  zona: string | null;
  plantelAsignadoId: number | null;
  esAdmin: boolean;
  esProgramador: boolean;
  esDespachador: boolean;
  esAsesor: boolean;
  esGerenteComercial: boolean;
  esJefePlanta: boolean;
  esDosificador: boolean;
  esLaboratorista: boolean;
  esJefeLaboratorio: boolean;
  /** Zonas cuyas plantas/pedidos puede ver el usuario (por zona). */
  zonasPermitidas: string[];
}

export function calcularAlcance(
  roles: string[],
  zona: string | null,
  plantelAsignadoId: number | null = null,
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

  // Roles sin límite de zona (ven todas o se limitan por otra dimensión: cliente,
  // proyecto asignado, o plantel específico). Programador/Despachador van por zona.
  const sinLimiteZona =
    esAdmin || esAsesor || esGerenteComercial || esLaboratorista || esJefeLaboratorio;
  const zonasPermitidas = sinLimiteZona ? [...ZONAS] : zona ? [zona] : [];

  return {
    roles,
    zona,
    plantelAsignadoId,
    esAdmin,
    esProgramador,
    esDespachador,
    esAsesor,
    esGerenteComercial,
    esJefePlanta,
    esDosificador,
    esLaboratorista,
    esJefeLaboratorio,
    zonasPermitidas,
  };
}

// ── Acceso a rutas por rol ───────────────────────────────────────────────────
export const ACCESO_RUTAS: Record<string, Rol[]> = {
  "/": [
    "Administrador", "Programador", "Despachador", "Asesor",
    "JefePlanta", "Dosificador", "Laboratorista", "JefeLaboratorio",
  ],
  "/programacion": ["Administrador", "Programador", "JefePlanta", "JefeLaboratorio"],
  "/despacho": [
    "Administrador", "Despachador", "Asesor",
    "JefePlanta", "Dosificador", "Laboratorista", "JefeLaboratorio",
  ],
  "/confirmaciones": ["Administrador", "Asesor"],
  "/clientes/semana": ["Administrador", "Asesor", "Programador"],
  "/clientes": ["Administrador", "Asesor"],
  "/comercial": ["Administrador", "GerenteComercial"],
  "/flota": ["Administrador"],
  "/reportes": ["Administrador", "JefePlanta"],
  "/programa": ["Administrador", "Programador", "Despachador", "Dosificador", "Laboratorista"],
  "/laboratorio": ["Administrador", "JefeLaboratorio", "Laboratorista"],
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
/** Filtro Prisma para `planteles`: por plantel asignado (JefePlanta/Dosificador),
 *  por zona (Programador/Despachador), o sin límite (Admin/Asesor/Lab/JefeLab). */
export function filtroPlantelPorZona(
  alcance: Alcance,
): { zona?: { in: string[] }; id?: number } {
  if (alcance.esJefePlanta || alcance.esDosificador)
    return { id: alcance.plantelAsignadoId ?? -1 };
  if (
    alcance.esAdmin ||
    alcance.esAsesor ||
    alcance.esLaboratorista ||
    alcance.esJefeLaboratorio
  )
    return {};
  return { zona: { in: alcance.zonasPermitidas } };
}

/** Filtro Prisma para `pedidos` por zona/plantel del alcance. NO cubre Asesor ni
 *  Laboratorista (esos se limitan por cliente/proyecto; usar sus filtros). */
export function filtroPedidoPorZona(
  alcance: Alcance,
): { plantel?: { zona: { in: string[] } }; plantel_id?: number } {
  if (alcance.esJefePlanta || alcance.esDosificador)
    return { plantel_id: alcance.plantelAsignadoId ?? -1 };
  if (
    alcance.esAdmin ||
    alcance.esAsesor ||
    alcance.esLaboratorista ||
    alcance.esJefeLaboratorio
  )
    return {};
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
  // Asesor y JefeLaboratorio: sin permiso de escritura sobre pedidos.
  return false;
}

/** Estados de viaje que un Laboratorista puede avanzar (solo estos botones). */
export const ESTADOS_LABORATORISTA = ["Llegada", "Descargando", "Regresando"] as const;
