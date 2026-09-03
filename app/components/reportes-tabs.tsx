import { SeccionTabs } from "./seccion-tabs";

/**
 * Pestañas de la sección **Reportes**. Cada una se muestra solo si el rol puede entrar
 * a su ruta (lo filtra `SeccionTabs`), así que un Programador ve únicamente Tiempos de
 * descarga y no se le ofrece Indicadores, que es de Admin y Jefe de Planta.
 */
export function ReportesTabs({ activo, roles }: { activo: string; roles: string[] }) {
  return (
    <SeccionTabs
      activo={activo}
      roles={roles}
      tabs={[
        { href: "/reportes/descargas", label: "Tiempos de descarga y esperas" },
        { href: "/reportes", label: "Indicadores de planta" },
      ]}
    />
  );
}
