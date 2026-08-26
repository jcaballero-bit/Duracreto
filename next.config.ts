import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @react-pdf/renderer se usa SOLO en el servidor (genera el PDF del Programa
  // DPCR-08) y trae dependencias nativas de Node (fontkit, zlib). Se deja fuera del
  // bundler para que Next no intente empaquetarlo.
  serverExternalPackages: ["@react-pdf/renderer"],
  // El encabezado ISO del PDF lleva el logo real: hay que incluir el archivo en el
  // bundle de la función de servidor (si no, en producción no existe `public/`).
  outputFileTracingIncludes: {
    "/programa/pdf": ["./public/logo-duracreto.png"],
  },
  experimental: {
    // El archivo del reloj biometrico se sube a una server action. El de prueba pesa
    // 366 KB (9 dias), asi que una catorcena completa puede acercarse al limite de 1 MB
    // que Next aplica por defecto al cuerpo de una server action.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
