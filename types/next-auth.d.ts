import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: string[];
      zona: string | null;
      debeCambiarPassword: boolean;
      plantelAsignadoId: number | null;
      plantaPredeterminadaId: number | null; // planta predeterminada del Dosificador
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    roles?: string[];
    zona?: string | null;
    nombre?: string | null;
    debeCambiar?: boolean;
    plantelAsignado?: number | null;
    plantaPredeterminada?: number | null;
  }
}
