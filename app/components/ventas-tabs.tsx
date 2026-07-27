import Link from "next/link";
import { puedeAccederRuta } from "@/lib/auth/acceso";

// Tabs de la sección Ventas. Cada una se muestra solo si el rol puede acceder
// (Programador solo ve "Programa Semana"; Asesor/Admin ven las tres).
const TABS = [
  { href: "/clientes", label: "Clientes" },
  { href: "/clientes/semana", label: "Programa Semana" },
  { href: "/confirmaciones", label: "Mis confirmaciones" },
];

export function VentasTabs({ activo, roles }: { activo: string; roles: string[] }) {
  const visibles = TABS.filter((t) => puedeAccederRuta(roles, t.href));
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border text-sm">
      {visibles.map((t) =>
        t.href === activo ? (
          <span
            key={t.href}
            className="border-b-2 border-accent px-3 py-2 font-medium text-accent"
          >
            {t.label}
          </span>
        ) : (
          <Link key={t.href} href={t.href} className="px-3 py-2 text-muted hover:text-ink">
            {t.label}
          </Link>
        ),
      )}
    </div>
  );
}
