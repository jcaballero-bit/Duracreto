"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { puedeAccederRuta } from "@/lib/auth/acceso";
import { NAV } from "./nav";

/** ¿La ruta actual corresponde a este ítem de navegación? */
function esActivo(pathname: string, href: string, activePrefixes?: string[]): boolean {
  if (href === "/") return pathname === "/";
  const prefijos = [href, ...(activePrefixes ?? [])];
  return prefijos.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function Sidebar({ roles }: { roles: string[] }) {
  const pathname = usePathname();
  // Solo se muestran los ítems a los que el rol tiene acceso.
  const items = NAV.filter((item) => puedeAccederRuta(roles, item.href));

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[260px] flex-col bg-sidebar text-sidebar-text md:flex">
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
        <div className="leading-tight">
          <div className="font-bold text-white">DURACRETO Logistics</div>
          <div className="text-[11px] tracking-wider text-slate-400">
            CONCRETO PREMEZCLADO
          </div>
        </div>
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
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 text-[11px] text-slate-500">DPCR-08 · v0.1</div>
    </aside>
  );
}
