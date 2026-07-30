"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Selector de asesor para el mapa de cobertura (searchParam `mapAsesor`). */
export function MapaFiltroAsesor({
  asesores,
  valor,
}: {
  asesores: { id: number; nombre: string }[];
  valor: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const cambiar = (v: string) => {
    const params = new URLSearchParams(sp.toString());
    if (v) params.set("mapAsesor", v);
    else params.delete("mapAsesor");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Asesor:</span>
      <select
        value={valor}
        onChange={(e) => cambiar(e.target.value)}
        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
      >
        <option value="">Todos</option>
        {asesores.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
