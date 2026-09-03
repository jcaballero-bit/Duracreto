// Configuración única de navegación. Sidebar y Topbar la comparten para
// mantener títulos, rutas e íconos en un solo lugar.
import {
  BarChart3,
  Building2,
  CalendarClock,
  Contact,
  Shuffle,
  FileText,
  FlaskConical,
  LayoutGrid,
  ScrollText,
  Settings,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface ItemNav {
  href: string;
  label: string;
  icon: LucideIcon;
  // Prefijos extra para marcar el ítem activo (además de `href`). Permite que
  // "Ventas" quede activo en /clientes, /clientes/semana y /confirmaciones.
  activePrefixes?: string[];
}

export const NAV: ItemNav[] = [
  { href: "/", label: "Panel principal", icon: LayoutGrid },
  { href: "/programacion", label: "Programación", icon: CalendarClock },
  { href: "/despacho", label: "Despacho en vivo", icon: Truck },
  // Ventas agrupa Clientes + Programa Semana + Mis confirmaciones (tabs dentro de
  // la pantalla). Apunta al grid (accesible a Admin/Asesor/Programador); cada tab
  // se muestra a quien pueda entrar a su ruta.
  {
    href: "/clientes/semana",
    label: "Ventas",
    icon: Contact,
    activePrefixes: ["/clientes", "/confirmaciones"],
  },
  { href: "/comercial", label: "Gerencia Comercial", icon: TrendingUp },
  // Seccion agrupada (mismo patron que Ventas / Control Mano de Obra): el href
  // apunta al reporte que alcanzan los CUATRO roles, y las pestanas de dentro se
  // filtran por rol, asi que a nadie se le ofrece una pantalla a la que no entra.
  {
    href: "/reportes/descargas",
    label: "Reportes",
    icon: BarChart3,
    activePrefixes: ["/reportes"],
  },
  { href: "/reasignaciones", label: "Reasignar Dosificador", icon: Shuffle },
  { href: "/flota", label: "Flota", icon: Building2 },
  // Control de Calidad agrupa Laboratorio + Reporte de Calidad (tabs dentro de la
  // pantalla). Las cuatro roles de la seccion alcanzan ambas rutas.
  {
    href: "/laboratorio",
    label: "Control de Calidad",
    icon: FlaskConical,
    activePrefixes: ["/calidad"],
  },
  { href: "/programa", label: "Programa DPCR-08", icon: FileText },
  {
    href: "/asistencia",
    label: "Control Mano de Obra",
    icon: Users,
    activePrefixes: ["/planilla", "/extraordinario"],
  },
  { href: "/administracion", label: "Administración", icon: Settings },
  { href: "/bitacora", label: "Bitácora", icon: ScrollText },
];

/** Prefijos que activan un ítem (su href + los activePrefixes). */
function prefijosDe(item: ItemNav): string[] {
  return [item.href, ...(item.activePrefixes ?? [])];
}

/** Etiqueta del ítem del menú (hoy siempre la del grupo). */
export function etiquetaNav(item: ItemNav, _roles: string[]): string {
  // Se conserva la firma con los roles porque el titulo de seccion puede volver a
  // depender de ellos; hoy ninguna etiqueta cambia por rol (la del Laboratorista se
  // movio a la pestana de Control de Calidad, ver calidad-tabs.tsx).
  void _roles;
  return item.label;
}

/** Título de sección para una ruta (coincide con el label del NAV, sensible al rol). */
export function tituloDeRuta(pathname: string, roles: string[] = []): string {
  const candidatos = NAV.filter((n) => n.href !== "/")
    .flatMap((n) => prefijosDe(n).map((prefijo) => ({ n, prefijo })))
    .sort((a, b) => b.prefijo.length - a.prefijo.length);
  const match = candidatos.find(
    ({ prefijo }) => pathname === prefijo || pathname.startsWith(`${prefijo}/`),
  );
  return match ? etiquetaNav(match.n, roles) : "Panel principal";
}
