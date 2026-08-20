"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose } from "lucide-react";
import { puedeAccederRuta } from "@/lib/auth/acceso";
import { NAV, etiquetaNav } from "./nav";
import { UserMenu } from "./user-menu";

export interface UsuarioShell {
  nombre: string;
  email: string;
  roles: string[];
  zona: string | null;
}

/** ¿La ruta actual corresponde a este ítem de navegación? */
function esActivo(pathname: string, href: string, activePrefixes?: string[]): boolean {
  if (href === "/") return pathname === "/";
  const prefijos = [href, ...(activePrefixes ?? [])];
  return prefijos.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function Sidebar({
  usuario,
  onOcultar,
}: {
  usuario: UsuarioShell;
  /** Oculta el menú (lo pasa el shell, que también ajusta el ancho del contenido). */
  onOcultar?: () => void;
}) {
  const pathname = usePathname();
  // Solo se muestran los ítems a los que el rol tiene acceso.
  const items = NAV.filter((item) => puedeAccederRuta(usuario.roles, item.href));

  return (
    <aside className="print-hide fixed inset-y-0 left-0 z-20 hidden w-[260px] flex-col bg-sidebar text-sidebar-text md:flex">
      {/* Logo DURACRETO + nombre del sistema */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-duracreto.png"
            alt="DURACRETO"
            className="h-full w-full object-contain"
          />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="font-bold text-white">DURACRETO Logistics</div>
          <div className="text-[11px] tracking-wider text-slate-400">
            CONCRETO PREMEZCLADO
          </div>
        </div>
        {onOcultar && (
          <button
            onClick={onOcultar}
            title="Ocultar el menú"
            aria-label="Ocultar el menú"
            className="ml-auto shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-sidebar-active hover:text-white"
          >
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map((item) => {
          const activo = esActivo(pathname, item.href, item.activePrefixes);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                activo
                  ? "bg-sidebar-active font-medium text-white"
                  : "text-sidebar-text hover:bg-sidebar-active/60 hover:text-white"
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span>{etiquetaNav(item, usuario.roles)}</span>
            </Link>
          );
        })}
      </nav>

      {/* Menú de usuario (correo, Configuración, Cerrar sesión) */}
      <div className="border-t border-white/5">
        <UserMenu nombre={usuario.nombre} email={usuario.email} roles={usuario.roles} />
      </div>
    </aside>
  );
}
