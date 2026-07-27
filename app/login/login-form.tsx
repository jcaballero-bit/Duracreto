"use client";

import { useActionState } from "react";
import { Boxes } from "lucide-react";
import { iniciarSesionAction, entrarConGoogleAction } from "./actions";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

export function LoginForm({ googleHabilitado }: { googleHabilitado: boolean }) {
  const [error, formAction, pendiente] = useActionState(
    iniciarSesionAction,
    undefined,
  );

  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
          <Boxes size={22} />
        </div>
        <div className="leading-tight">
          <div className="font-bold text-ink">Despacho</div>
          <div className="text-[11px] tracking-wider text-muted">
            CONCRETO PREMEZCLADO
          </div>
        </div>
      </div>

      <h1 className="mb-1 text-lg font-bold text-ink">Iniciar sesión</h1>
      <p className="mb-4 text-sm text-muted">Ingresa con tu correo y contraseña.</p>

      <form action={formAction} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Correo</span>
          <input type="email" name="email" required className={inputCls} autoComplete="email" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Contraseña</span>
          <input
            type="password"
            name="password"
            required
            className={inputCls}
            autoComplete="current-password"
          />
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={pendiente}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {pendiente ? "Entrando…" : "Entrar"}
        </button>
      </form>

      {googleHabilitado && (
        <form action={entrarConGoogleAction} className="mt-3">
          <button
            type="submit"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-content"
          >
            Entrar con Google
          </button>
        </form>
      )}

      <p className="mt-4 rounded-lg bg-content px-3 py-2 text-xs text-muted">
        Demo: <strong className="text-ink">jcaballero@duracreto.com</strong> / admin123
      </p>
    </div>
  );
}
