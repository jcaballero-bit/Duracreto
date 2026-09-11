"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronUp, Info, LogOut, Settings } from "lucide-react";
import { cerrarSesionAction } from "../auth-actions";
import { InstallApp } from "./install-app";
import { AcercaDe } from "./acerca-de";
import type { InfoVersion } from "@/lib/version";

/**
 * Cierra la sesión y sale del sistema con una RECARGA COMPLETA del navegador.
 *
 * No se usa el redirect del router de Next a propósito. Una computadora de planta la
 * comparten varios turnos, así que al cerrar sesión no puede quedar nada de la persona
 * anterior, y una navegación del lado del cliente conserva el documento y la memoria de
 * la pestaña. `location.replace` en cambio:
 *
 *  · pide /login al servidor como documento nuevo, así que el proceso arranca limpio;
 *  · **REEMPLAZA** la entrada del historial en vez de agregar una, de modo que el botón
 *    Atrás ya no puede volver a la pantalla donde estaba la sesión anterior (que es la
 *    otra forma de "cerré sesión pero sigo viendo el sistema").
 */
async function cerrarSesion() {
  await cerrarSesionAction();
  window.location.replace("/login");
}

function iniciales(nombre: string): string {
  return (
    nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "U"
  );
}

/**
 * Menú de usuario al pie del sidebar (y del drawer móvil): avatar + nombre + rol,
 * y al hacer clic despliega correo, "Configuración" y "Cerrar sesión".
 */
export function UserMenu({
  nombre,
  email,
  roles,
  version,
}: {
  nombre: string;
  email: string;
  roles: string[];
  /** Sello de versión del despliegue, para el panel "Acerca de". */
  version: InfoVersion;
}) {
  const [abierto, setAbierto] = useState(false);
  const [acercaDe, setAcercaDe] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Cerrar al navegar.
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!abierto) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [abierto]);

  const rolTexto = roles.length > 0 ? roles.join(" · ") : "Sin rol";

  return (
    <div className="relative px-3 pb-4 pt-2" ref={ref}>
      {acercaDe && <AcercaDe info={version} onCerrar={() => setAcercaDe(false)} />}
      {abierto && (
        <div className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-xl bg-white text-slate-800 shadow-xl ring-1 ring-black/5">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">{nombre}</div>
            <div className="truncate text-xs text-slate-500">{email}</div>
          </div>
          <Link
            href="/configuracion"
            onClick={() => setAbierto(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Settings size={16} /> Configuración
          </Link>
          <InstallApp onAccion={() => setAbierto(false)} />
          <button
            onClick={() => {
              setAbierto(false);
              setAcercaDe(true);
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <Info size={16} /> Acerca de DURACRETO Logistics
          </button>
          <form action={cerrarSesion} className="border-t border-slate-100">
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <LogOut size={16} /> Cerrar sesión
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-active/60"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
          {iniciales(nombre)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium text-white">{nombre}</span>
          <span className="block truncate text-xs text-slate-400">{rolTexto}</span>
        </span>
        <ChevronUp
          size={16}
          className={`shrink-0 text-slate-400 transition-transform ${abierto ? "" : "rotate-180"}`}
        />
      </button>
    </div>
  );
}
