import Link from "next/link";
import { puedeAccederRuta } from "@/lib/auth/acceso";

export interface TabSeccion {
  href: string;
  label: string;
}

/**
 * Barra de pestañas de una sección agrupada del menú (Ventas, Control Mano de Obra,
 * Control de Calidad). Cada pestaña se muestra solo si el rol puede entrar a su ruta, y
 * si queda una sola no se dibuja la barra: no hay nada que elegir.
 *
 * Es la misma pieza para todas las secciones, para que agrupar dos pantallas más no
 * signifique copiar el markup otra vez.
 */
export function SeccionTabs({
  tabs,
  activo,
  roles,
}: {
  tabs: TabSeccion[];
  activo: string;
  roles: string[];
}) {
  const visibles = tabs.filter((t) => puedeAccederRuta(roles, t.href));
  if (visibles.length < 2) return null;

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
