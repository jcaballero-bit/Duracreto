"use client";

import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Card } from "../components/ui";

export function ProgramaControles({
  fecha,
  zona,
  zonas,
}: {
  fecha: string;
  zona: string;
  zonas: string[];
}) {
  const router = useRouter();

  const navegar = (nuevaFecha: string, nuevaZona: string) => {
    const params = new URLSearchParams();
    params.set("fecha", nuevaFecha);
    params.set("zona", nuevaZona);
    router.push(`/programa?${params.toString()}`);
  };

  const inputCls =
    "rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

  return (
    <Card className="no-print mb-5 flex flex-wrap items-end justify-between gap-4 p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => navegar(e.target.value, zona)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">Zona</span>
          <select
            value={zona}
            onChange={(e) => navegar(fecha, e.target.value)}
            className={inputCls}
          >
            {zonas.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
      >
        <Printer size={16} /> Imprimir / Guardar PDF
      </button>
    </Card>
  );
}
