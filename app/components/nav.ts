// Configuración única de navegación. Sidebar y Topbar la comparten para
// mantener títulos, rutas e íconos en un solo lugar.
import {
  Building2,
  CalendarClock,
  Contact,
  FileText,
  LayoutGrid,
  ScrollText,
  Settings,
  TrendingUp,
  Truck,
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
  { href: "/flota", label: "Flota", icon: Building2 },
  { href: "/programa", label: "Programa DPCR-08", icon: FileText },
  { href: "/administracion", label: "Administración", icon: Settings },
  { href: "/bitacora", label: "Bitácora", icon: ScrollText },
];

/** Prefijos que activan un ítem (su href + los activePrefixes). */
function prefijosDe(item: ItemNav): string[] {
  return [item.href, ...(item.activePrefixes ?? [])];
}

/** Título de sección para una ruta (coincide con el label del NAV). */
export function tituloDeRuta(pathname: string): string {
  const candidatos = NAV.filter((n) => n.href !== "/")
    .flatMap((n) => prefijosDe(n).map((prefijo) => ({ n, prefijo })))
    .sort((a, b) => b.prefijo.length - a.prefijo.length);
  const match = candidatos.find(
    ({ prefijo }) => pathname === prefijo || pathname.startsWith(`${prefijo}/`),
  );
  return match ? match.n.label : "Panel principal";
}
