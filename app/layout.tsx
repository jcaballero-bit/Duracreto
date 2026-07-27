import type { Metadata } from "next";
import "./globals.css";
import { auth } from "@/auth";
import { Sidebar } from "./components/sidebar";
import { Topbar } from "./components/topbar";

export const metadata: Metadata = {
  title: "DPCR-08 · Despacho de Concreto",
  description: "Sistema de programación y despacho de concreto premezclado",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const usuario = session?.user
    ? {
        nombre: session.user.name ?? session.user.email ?? "Usuario",
        roles: session.user.roles ?? [],
        zona: session.user.zona ?? null,
      }
    : null;

  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full">
        {usuario ? (
          <>
            <Sidebar roles={usuario.roles} />
            <div className="flex min-h-screen flex-col md:pl-[260px]">
              <Topbar usuario={usuario} />
              <main className="flex-1 px-6 py-6">{children}</main>
            </div>
          </>
        ) : (
          // Sin sesión (p. ej. /login): sin shell.
          children
        )}
      </body>
    </html>
  );
}
