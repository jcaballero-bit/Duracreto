"use client";

import { useRouter } from "next/navigation";
import { Card } from "../components/ui";

const ZONAS = ["Norte", "Centro Sur"];

export function FiltrosComercial({
  periodo,
  zona,
}: {
  periodo: string; // "YYYY-MM"
  zona: string; // "todas" | "Norte" | "Centro Sur"
}) {
  const router = useRouter();

  const navegar = (nuevoPeriodo: string, nuevaZona: string) => {
    const params = new URLSearchParams();
    params.set("periodo", nuevoPeriodo);
    if (nuevaZona !== "todas") params.set("zona", nuevaZona);
    router.push(`/comercial?${params.toString()}`);
  };

  const inputCls =
    "rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

  return (
    <Card className="mb-5 flex flex-wrap items-end gap-4 p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Mes</span>
        <input
          type="month"
          value={periodo}
          onChange={(e) => navegar(e.target.value, zona)}
          className={inputCls}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Zona</span>
        <select
          value={zona}
          onChange={(e) => navegar(periodo, e.target.value)}
          className={inputCls}
        >
          <option value="todas">Todas</option>
          {ZONAS.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
    </Card>
  );
}
