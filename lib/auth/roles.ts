// Roles y zonas del sistema (Fase 3). Un usuario puede tener varios roles.
export const ROLES = [
  "Administrador",
  "Programador",
  "Despachador",
  "Asesor",
  "GerenteComercial",
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
