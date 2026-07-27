"use client";

import { useRouter } from "next/navigation";
import { Card } from "../components/ui";

export function FiltroFecha({ fecha }: { fecha: string }) {
  const router = useRouter();
  return (
    <Card className="mb-5 flex flex-wrap items-end gap-4 p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Fecha</span>
        <input
          type="date"
          value={fecha}
          onChange={(e) => router.push(`/flota?fecha=${e.target.value}`)}
          className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </label>
      <p className="text-xs text-muted">
        Las dos zonas tienen restricciones de flota independientes; nunca se suman
        en un solo número nacional.
      </p>
    </Card>
  );
}
