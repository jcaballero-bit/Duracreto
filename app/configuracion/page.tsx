import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card } from "../components/ui";
import { CambiarPasswordForm } from "./cambiar-password-form";

export const dynamic = "force-dynamic";

// Configuración de la cuenta. Accesible a CUALQUIER usuario autenticado (todos los
// roles), incluido cuando el sistema lo forzó por primer ingreso.
export default async function ConfiguracionPage() {
  const sesion = await auth();
  if (!sesion?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: sesion.user.id },
    select: { name: true, email: true, debe_cambiar_password: true },
  });
  const forzado = user?.debe_cambiar_password ?? false;

  return (
    <>
      <PageHeader
        titulo="Configuración"
        descripcion="Tu cuenta y seguridad."
      />

      <Card className="p-5">
        <div className="mb-4">
          <div className="text-sm font-semibold text-ink">{user?.name ?? "Usuario"}</div>
          <div className="text-xs text-muted">{user?.email}</div>
        </div>

        <h2 className="mb-3 text-base font-semibold text-ink">Cambiar contraseña</h2>
        <CambiarPasswordForm forzado={forzado} />
      </Card>
    </>
  );
}
