import Link from "next/link";

export interface TabFlota {
  key: string;
  label: string;
}

/** Navegación de secciones de /flota (searchParam `tab`). Las pestañas visibles
 *  dependen del rol (se calculan en la página). */
export function FlotaTabs({ tabs, activo }: { tabs: TabFlota[]; activo: string }) {
  if (tabs.length <= 1) return null; // un solo acceso: no hace falta la barra
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => {
        const on = t.key === activo;
        return (
          <Link
            key={t.key}
            href={`/flota?tab=${t.key}`}
            className={
              "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors " +
              (on ? "border-b-2 border-accent text-accent" : "text-muted hover:text-ink")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
