import { SeccionTabs } from "./seccion-tabs";

// Pestañas de la sección "Control Mano de Obra". Cada una se muestra solo si el rol
// puede entrar: Asistencia la ven Admin, Jefe de Planta y Programador; Horario
// extraordinario, Admin y Jefe de Planta; Planilla es exclusiva del Administrador
// (contiene salarios).
const TABS = [
  { href: "/asistencia", label: "Asistencia" },
  { href: "/extraordinario", label: "Horario extraordinario" },
  { href: "/planilla", label: "Planilla" },
];

export function PersonalTabs({ activo, roles }: { activo: string; roles: string[] }) {
  return <SeccionTabs tabs={TABS} activo={activo} roles={roles} />;
}
