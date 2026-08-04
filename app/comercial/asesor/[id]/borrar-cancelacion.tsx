"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { eliminarCancelacionAction } from "../../actions";

/**
 * Botón (solo Admin) para eliminar una cancelación hecha por error, de modo que
 * deje de contar contra el desempeño del asesor. Pide confirmación (es irreversible).
 */
export function BorrarCancelacion({ pedidoId, cliente }: { pedidoId: number; cliente: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  const borrar = () => {
    if (
      !confirm(
        `¿Eliminar esta cancelación de "${cliente}"? Dejará de afectar el desempeño del asesor y se quitará del historial. No se puede deshacer.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await eliminarCancelacionAction(pedidoId);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo eliminar la cancelación.");
    });
  };

  return (
    <button
      type="button"
      onClick={borrar}
      disabled={pendiente}
      title="Eliminar cancelación hecha por error"
      aria-label="Eliminar cancelación"
      className="rounded p-1 text-danger hover:bg-red-50 disabled:opacity-50"
    >
      <Trash2 size={14} />
    </button>
  );
}
