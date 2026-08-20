"use client";

import { usePathname } from "next/navigation";
import { PanelLeftOpen } from "lucide-react";
import { tituloDeRuta } from "./nav";
import { MobileNav } from "./mobile-nav";

export interface UsuarioSesion {
  nombre: string;
  email: string;
  roles: string[];
  zona: string | null;
}

export function Topbar({
  usuario,
  menuOculto = false,
  onMostrarMenu,
}: {
  usuario: UsuarioSesion;
  /** true = el menú lateral está oculto: aparece el botón para traerlo de vuelta. */
  menuOculto?: boolean;
  onMostrarMenu?: () => void;
}) {
  const pathname = usePathname();
  const seccion = tituloDeRuta(pathname, usuario.roles);

  return (
    <header className="print-hide sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:px-6">
      <div className="flex items-center gap-2">
        <MobileNav usuario={usuario} />
        {/* Solo en escritorio: en celular el menú vive en el drawer del hamburguesa. */}
        {menuOculto && onMostrarMenu && (
          <button
            onClick={onMostrarMenu}
            title="Mostrar el menú"
            aria-label="Mostrar el menú"
            className="hidden rounded-lg border border-border p-1.5 text-muted transition-colors hover:text-ink md:inline-flex"
          >
            <PanelLeftOpen size={18} />
          </button>
        )}
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">{seccion}</div>
          <div className="text-xs text-muted">
            {usuario.nombre}
            {usuario.zona && <span> · Zona {usuario.zona}</span>}
          </div>
        </div>
      </div>

      {/* Roles (informativo). El cierre de sesión vive en el menú de usuario del
          sidebar / drawer, no aquí. */}
      <div className="hidden items-center gap-2 sm:flex">
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
      </div>
    </header>
  );
}
