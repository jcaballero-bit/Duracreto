import type { Metadata, Viewport } from "next";
import "./globals.css";
import { auth } from "@/auth";
import { Shell } from "./components/shell";
import { RegistrarSW } from "./components/registrar-sw";
import { InstallBanner } from "./components/install-banner";

export const metadata: Metadata = {
  title: "DURACRETO Logistics",
  description: "Sistema de programación y despacho de concreto premezclado",
  manifest: "/manifest.webmanifest",
  // iOS: permite abrir como app a pantalla completa desde la pantalla de inicio.
  appleWebApp: {
    capable: true,
    title: "DURACRETO Logistics",
    statusBarStyle: "default",
  },
  // Favicon (icono de pestaña): el archivo provisto en public/, usado tal cual.
  // apple-touch-icon: icono cuadrado para instalar en iOS.
  icons: {
    icon: "/duracreto_logo_favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e293b",
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
        email: session.user.email ?? "",
        roles: session.user.roles ?? [],
        zona: session.user.zona ?? null,
      }
    : null;

  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full">
        <RegistrarSW />
        {usuario ? (
          <>
            <Shell usuario={usuario}>{children}</Shell>
            <InstallBanner />
          </>
        ) : (
          // Sin sesión (p. ej. /login): sin shell.
          children
        )}
      </body>
    </html>
  );
}
