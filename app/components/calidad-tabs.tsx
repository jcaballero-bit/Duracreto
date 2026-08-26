import { SeccionTabs } from "./seccion-tabs";

/**
 * Pestañas de la sección "Control de Calidad": la gestión del laboratorio y el reporte
 * imprimible. Las cuatro roles que entran a la sección (Administrador, Jefe de
 * Laboratorio, Gerente de Control de Calidad y Laboratorista) alcanzan ambas rutas.
 *
 * Para el **Laboratorista** la primera pestaña no es "Laboratorio" sino
 * "Proyectos asignados": él no gestiona asignaciones, ahí ve SU agenda del día. Ese
 * matiz vivía en el ítem del menú y se movió aquí al agrupar la sección.
 */
export function CalidadTabs({ activo, roles }: { activo: string; roles: string[] }) {
  const esGestor =
    roles.includes("Administrador") ||
    roles.includes("JefeLaboratorio") ||
    roles.includes("GerenteControlCalidad");
  const etiquetaLab = !esGestor && roles.includes("Laboratorista")
    ? "Proyectos asignados"
    : "Laboratorio";

  return (
    <SeccionTabs
      tabs={[
        { href: "/laboratorio", label: etiquetaLab },
        { href: "/calidad", label: "Reporte de Calidad" },
      ]}
      activo={activo}
      roles={roles}
    />
  );
}
