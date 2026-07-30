"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { cambiarMiPasswordAction } from "./actions";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

export function CambiarPasswordForm({ forzado }: { forzado: boolean }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const enviar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setExito(false);
    const fd = new FormData(e.currentTarget);
    const actual = String(fd.get("actual") ?? "");
    const nueva = String(fd.get("nueva") ?? "");
    const confirmar = String(fd.get("confirmar") ?? "");

    startTransition(async () => {
      const res = await cambiarMiPasswordAction(actual, nueva, confirmar);
      // Si venía forzado, el server cierra la sesión y redirige a /login (no
      // regresa un resultado normal). Si regresa ok sin forzado, mostramos éxito.
      if (res.ok) {
        setExito(true);
        router.refresh();
      } else {
        setError(res.mensaje ?? "No se pudo cambiar la contraseña.");
      }
    });
  };

  return (
    <form onSubmit={enviar} className="max-w-md space-y-4">
      {forzado && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Por seguridad, debes <strong>cambiar tu contraseña</strong> antes de continuar
          (es tu primer ingreso). Al guardarla, se cerrará la sesión y entrarás de nuevo
          con la nueva.
        </div>
      )}

      {exito && !forzado && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✅ Contraseña actualizada correctamente.
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Contraseña actual</span>
        <input type="password" name="actual" required className={inputCls} autoComplete="current-password" />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Nueva contraseña (mín. 6)</span>
        <input type="password" name="nueva" required minLength={6} className={inputCls} autoComplete="new-password" />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Confirmar nueva contraseña</span>
        <input type="password" name="confirmar" required minLength={6} className={inputCls} autoComplete="new-password" />
      </label>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        <KeyRound size={16} />
        {pendiente ? "Guardando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
