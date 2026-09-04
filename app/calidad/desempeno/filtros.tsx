"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

const ctrl =
  "mt-0.5 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";

/**
 * Rango de fechas del periodo evaluado. Va en la URL para que el indicador se pueda
 * compartir por enlace (una evaluación se comenta, y conviene que las dos personas
 * estén viendo el mismo periodo).
 */
export function FiltrosDesempeno({ desde, hasta }: { desde: string; hasta: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendiente, startTransition] = useTransition();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);

  const navegar = (cambios: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v === "") p.delete(k);
      else p.set(k, v);
    }
    startTransition(() => router.push(`/calidad/desempeno?${p.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-muted">
        Desde
        <input
          type="date"
          value={d}
          onChange={(e) => setD(e.target.value)}
          onBlur={() => d !== desde && navegar({ desde: d })}
          className={ctrl}
        />
      </label>
      <label className="text-xs text-muted">
        Hasta
        <input
          type="date"
          value={h}
          onChange={(e) => setH(e.target.value)}
          onBlur={() => h !== hasta && navegar({ hasta: h })}
          className={ctrl}
        />
      </label>
      {pendiente && <span className="pb-2 text-xs text-muted">Actualizando…</span>}
    </div>
  );
}
