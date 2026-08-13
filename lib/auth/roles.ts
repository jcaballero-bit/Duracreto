// Roles y zonas del sistema (Fase 3). Un usuario puede tener varios roles.
export const ROLES = [
  "Administrador",
  "Programador",
  "Despachador",
  "Asesor",
  // Igual que Asesor pero MAS restringido: NO ve informacion de ningun otro asesor en
  // ninguna pantalla (Programa Semana y DPCR-08 se limitan a sus propios clientes).
  "AsesorRestringido",
  "GerenteComercial",
  "JefePlanta",
  "Dosificador",
  "Laboratorista",
  "JefeLaboratorio",
  // Gerente de Control de Calidad: mismos permisos que JefeLaboratorio pero SIN
  // limite de zona (ve/asigna en ambas zonas). Superior jerarquico del JefeLab.
  "GerenteControlCalidad",
  // Almacen: solo lectura de Programa Semana y del Programa DPCR-08. Nada mas.
  "Almacen",
] as const;
export type Rol = (typeof ROLES)[number];

export const ZONAS = ["Norte", "Centro Sur"] as const;
export type Zona = (typeof ZONAS)[number];

/** ¿El conjunto de roles incluye alguno de los requeridos? */
export function tieneAlgunRol(roles: string[] | undefined, requeridos: Rol[]): boolean {
  if (!roles) return false;
  return requeridos.some((r) => roles.includes(r));
}

export function esAdministrador(roles: string[] | undefined): boolean {
  return tieneAlgunRol(roles, ["Administrador"]);
}
