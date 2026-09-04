import { SeccionTabs } from "./seccion-tabs";

/**
 * Pestañas de la sección "Control de Calidad": la gestión del laboratorio, el reporte
 * imprimible y la evaluación del equipo. Las dos primeras las alcanzan los cuatro roles
 * de la sección; la tercera solo sus gestores (Gerente de Control de Calidad, Jefe de
 * Laboratorio y Administrador), y `SeccionTabs` la oculta a quien no entra.
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
        { href: "/calidad/desempeno", label: "Desempeño de laboratoristas" },
      ]}
      activo={activo}
      roles={roles}
    />
  );
}
