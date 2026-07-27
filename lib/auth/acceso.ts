// ─────────────────────────────────────────────────────────────────────────────
// Reglas de acceso (PURO, sin BD ni sesión): qué puede ver/hacer cada rol.
// Se prueban en aislamiento y las consumen el guard server-side, las páginas,
// el sidebar y las server actions.
//
// Reglas del negocio (CLAUDE.md):
//  · Administrador: todo, ambas zonas.
//  · Programador: programación futura (hoy en adelante), solo su zona.
//  · Despachador: solo el día de hoy, solo su zona; puede crear de último momento.
//  · Asesor: solo sus propios clientes, sin límite de zona (enforcement de
//    cliente pendiente hasta que exista la tabla asesores — ver CLAUDE.md).
// ─────────────────────────────────────────────────────────────────────────────
import { ZONAS, type Rol } from "./roles";

export interface Alcance {
  roles: string[];
  zona: string | null;
  esAdmin: boolean;
  esProgramador: boolean;
  esDespachador: boolean;
  esAsesor: boolean;
  esGerenteComercial: boolean;
  /** Zonas cuyas plantas/pedidos puede ver el usuario. */
  zonasPermitidas: string[];
}

export function calcularAlcance(roles: string[], zona: string | null): Alcance {
  const esAdmin = roles.includes("Administrador");
  const esProgramador = roles.includes("Programador");
  const esDespachador = roles.includes("Despachador");
  const esAsesor = roles.includes("Asesor");
  const esGerenteComercial = roles.includes("GerenteComercial");

  // Admin y Asesor no tienen límite de zona (el Asesor se limita por cliente).
  // Programador/Despachador ven solo su zona asignada.
  const zonasPermitidas =
    esAdmin || esAsesor ? [...ZONAS] : zona ? [zona] : [];

  return {
    roles,
    zona,
    esAdmin,
    esProgramador,
    esDespachador,
    esAsesor,
    esGerenteComercial,
    zonasPermitidas,
  };
}

// ── Acceso a rutas por rol ───────────────────────────────────────────────────
export const ACCESO_RUTAS: Record<string, Rol[]> = {
  "/": ["Administrador", "Programador", "Despachador", "Asesor"],
  "/programacion": ["Administrador", "Programador"],
  "/despacho": ["Administrador", "Despachador", "Asesor"],
  "/confirmaciones": ["Administrador", "Asesor"],
  "/clientes/semana": ["Administrador", "Asesor", "Programador"],
  "/clientes": ["Administrador", "Asesor"],
  "/comercial": ["Administrador", "GerenteComercial"],
  "/flota": ["Administrador"],
  "/programa": ["Administrador", "Programador", "Despachador"],
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

// ── Filtro de datos por zona ─────────────────────────────────────────────────
/** Filtro Prisma para `planteles` según el alcance (vacío = sin límite). */
export function filtroPlantelPorZona(alcance: Alcance): { zona?: { in: string[] } } {
  if (alcance.esAdmin || alcance.esAsesor) return {}; // sin límite de zona
  return { zona: { in: alcance.zonasPermitidas } };
}

/** Filtro Prisma para `pedidos` (por la zona de su plantel). */
export function filtroPedidoPorZona(
  alcance: Alcance,
): { plantel?: { zona: { in: string[] } } } {
  if (alcance.esAdmin || alcance.esAsesor) return {};
  return { plantel: { zona: { in: alcance.zonasPermitidas } } };
}

/** Filtro Prisma para `pedidos` de un asesor (por su usuario de sistema). */
export function filtroPedidoPorAsesor(usuarioAuthId: string) {
  return { cliente: { asesor: { usuario_auth_id: usuarioAuthId } } };
}

/** Filtro Prisma para `clientes` de un asesor (por su usuario de sistema). */
export function filtroClientePorAsesor(usuarioAuthId: string) {
  return { asesor: { usuario_auth_id: usuarioAuthId } };
}

// ── Reglas de fecha por rol (programar/modificar un pedido) ──────────────────
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
  if (alcance.esProgramador && f >= h) return true; // futuro (hoy en adelante)
  if (alcance.esDespachador && f === h) return true; // solo hoy
  return false;
}
