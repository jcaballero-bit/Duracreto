"use client";

import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Card } from "../components/ui";

export interface ClienteOpc {
  id: number;
  nombre: string;
}

/** Filtros del reporte de calidad (cliente + fecha) + botón de impresión a PDF. */
export function CalidadFiltros({
  clientes,
  clienteSel,
  fecha,
  puedeImprimir,
}: {
  clientes: ClienteOpc[];
  clienteSel: string; // "" = ninguno
  fecha: string;
  puedeImprimir: boolean;
}) {
  const router = useRouter();

  const navegar = (nuevoCliente: string, nuevaFecha: string) => {
    const params = new URLSearchParams();
    params.set("fecha", nuevaFecha);
    if (nuevoCliente) params.set("cliente", nuevoCliente);
    router.push(`/calidad?${params.toString()}`);
  };

  return (
    <Card className="no-print mb-5 flex flex-wrap items-end gap-4 p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Fecha</span>
        <input
          type="date"
          value={fecha}
          onChange={(e) => navegar(clienteSel, e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Cliente</span>
        <select
          value={clienteSel}
          onChange={(e) => navegar(e.target.value, fecha)}
          className="min-w-[220px] rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="">— Elige un cliente —</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => window.print()}
        disabled={!puedeImprimir}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        <Printer size={16} /> Descargar PDF
      </button>
    </Card>
  );
}
