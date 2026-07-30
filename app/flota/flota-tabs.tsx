import Link from "next/link";

const TABS: { key: string; label: string }[] = [
  { key: "panel", label: "Panel" },
  { key: "equipo", label: "Equipo" },
  { key: "mantenimiento", label: "Mantenimiento" },
  { key: "historial", label: "Historial" },
];

/** Navegación de secciones de /flota (searchParam `tab`). */
export function FlotaTabs({ activo }: { activo: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {TABS.map((t) => {
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
