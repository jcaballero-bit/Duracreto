"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Selector de mes para el registro de adiciones/cancelaciones del asesor.
 * Fija el searchParam `regMes` (vacío = todos los meses) conservando el resto.
 */
export function SelectorMesRegistro({
  opciones,
  valor,
}: {
  opciones: { value: string; label: string }[];
  valor: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const cambiar = (v: string) => {
    const params = new URLSearchParams(sp.toString());
    if (v) params.set("regMes", v);
    else params.delete("regMes");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <select
      value={valor}
      onChange={(e) => cambiar(e.target.value)}
      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
    >
      <option value="">Todos los meses</option>
      {opciones.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
