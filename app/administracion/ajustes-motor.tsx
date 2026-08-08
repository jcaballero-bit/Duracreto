"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { guardarMargenHuecoAction } from "./actions";

/** Editor del margen mínimo de hueco (min) del motor de 2 pasadas. */
export function AjustesMotor({ margenHueco }: { margenHueco: number }) {
  const router = useRouter();
  const [valor, setValor] = useState(String(margenHueco));
  const [pendiente, startTransition] = useTransition();

  const guardar = () => {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0) {
      alert("El margen debe ser un número entero de minutos (0 o más).");
      return;
    }
    startTransition(async () => {
      const res = await guardarMargenHuecoAction(n);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo guardar.");
    });
  };

  return (
    <div className="max-w-sm">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Margen mínimo de hueco (minutos)</span>
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            step="1"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={guardar}
            disabled={pendiente}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <Save size={16} /> {pendiente ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </label>
    </div>
  );
}
