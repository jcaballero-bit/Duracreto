"use client";

import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { tituloDeRuta } from "./nav";
import { MobileNav } from "./mobile-nav";
import { cerrarSesionAction } from "../auth-actions";

export interface UsuarioSesion {
  nombre: string;
  roles: string[];
  zona: string | null;
}

export function Topbar({ usuario }: { usuario: UsuarioSesion }) {
  const pathname = usePathname();
  const seccion = tituloDeRuta(pathname);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:px-6">
      <div className="flex items-center gap-2">
        <MobileNav roles={usuario.roles} />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">{seccion}</div>
          <div className="text-xs text-muted">
            {usuario.nombre}
            {usuario.zona && <span> · Zona {usuario.zona}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {usuario.roles.length > 0 ? (
          usuario.roles.map((rol) => (
            <span
              key={rol}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
            >
              {rol}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
            Sin rol
          </span>
        )}

        <form action={cerrarSesionAction}>
          <button
            type="submit"
            title="Cerrar sesión"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-content hover:text-ink"
          >
            <LogOut size={15} />
            Salir
          </button>
        </form>
      </div>
    </header>
  );
}
