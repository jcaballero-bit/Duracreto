import { SeccionTabs } from "./seccion-tabs";

// Pestañas de la sección Ventas. Cada una se muestra solo si el rol puede acceder
// (Programador solo ve "Programa Semana"; Asesor/Admin ven las tres).
const TABS = [
  { href: "/clientes", label: "Clientes" },
  { href: "/clientes/semana", label: "Programa Semana" },
  { href: "/confirmaciones", label: "Mis confirmaciones" },
];

export function VentasTabs({ activo, roles }: { activo: string; roles: string[] }) {
  return <SeccionTabs tabs={TABS} activo={activo} roles={roles} />;
}
