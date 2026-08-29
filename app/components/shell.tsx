"use client";

// Shell de escritorio: el menú lateral y el área de contenido comparten un estado —
// si el menú se oculta, el contenido tiene que recuperar esos 260 px—, así que ambos
// se montan desde aquí.
//
// El menú arranca DESPLEGADO —el estado por defecto— y se oculta solo cuando el
// usuario lo pide, con el botón del encabezado del propio menú. Mientras navega, la
// preferencia se mantiene (el layout no se vuelve a montar entre rutas); al recargar
// la página vuelve al valor por defecto, desplegado.

import { useState, type ReactNode } from "react";
import { Sidebar, type UsuarioShell } from "./sidebar";
import { Topbar } from "./topbar";
import type { InfoVersion } from "@/lib/version";

export function Shell({
  usuario,
  version,
  children,
}: {
  usuario: UsuarioShell;
  /** Sello de versión del despliegue, para el panel "Acerca de" del menú de usuario. */
  version: InfoVersion;
  children: ReactNode;
}) {
  const [oculto, setOculto] = useState(false);
  const alternar = () => setOculto((prev) => !prev);

  return (
    <>
      {!oculto && <Sidebar usuario={usuario} version={version} onOcultar={alternar} />}
      <div
        className={
          "print-shell-wrap flex min-h-screen flex-col " + (oculto ? "" : "md:pl-[260px]")
        }
      >
        <Topbar usuario={usuario} version={version} menuOculto={oculto} onMostrarMenu={alternar} />
        <main className="print-shell-main flex-1 px-4 py-4 md:px-6 md:py-6">{children}</main>
      </div>
    </>
  );
}
