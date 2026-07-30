"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { puedeAccederRuta } from "@/lib/auth/acceso";
import { NAV, etiquetaNav, type ItemNav } from "./nav";
import { UserMenu } from "./user-menu";
import type { UsuarioShell } from "./sidebar";

function esActivo(pathname: string, item: ItemNav): boolean {
  if (item.href === "/") return pathname === "/";
  const prefijos = [item.href, ...(item.activePrefixes ?? [])];
  return prefijos.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Menú de navegación para móvil/tablet (el sidebar fijo está oculto en < md). */
export function MobileNav({ usuario }: { usuario: UsuarioShell }) {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();
  const items = NAV.filter((item) => puedeAccederRuta(usuario.roles, item.href));

  // Cerrar el drawer al navegar (cambia la ruta).
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setAbierto(true)}
        aria-label="Abrir menú"
        className="rounded-lg p-1.5 text-muted hover:bg-content hover:text-ink"
      >
        <Menu size={22} />
      </button>

      {abierto && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setAbierto(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col bg-sidebar text-sidebar-text shadow-xl">
            <div className="flex items-center justify-between px-5 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo-duracreto.png" alt="DURACRETO" className="h-full w-full object-contain" />
                </div>
                <div className="leading-tight">
                  <div className="font-bold text-white">DURACRETO Logistics</div>
                  <div className="text-[11px] tracking-wider text-slate-400">CONCRETO PREMEZCLADO</div>
                </div>
              </div>
              <button
                onClick={() => setAbierto(false)}
                aria-label="Cerrar menú"
                className="rounded-md p-1 text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
              {items.map((item) => {
                const activo = esActivo(pathname, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setAbierto(false)}
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

            {/* Menú de usuario (Configuración, Cerrar sesión) al pie del drawer */}
            <div className="border-t border-white/5">
              <UserMenu nombre={usuario.nombre} email={usuario.email} roles={usuario.roles} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
