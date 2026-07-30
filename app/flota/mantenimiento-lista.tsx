"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarEstadoMantenimientoAction } from "./actions";

export interface ItemMantenimiento {
  id: number;
  unidad: string;
  tipoUnidad: string;
  evento: string; // etiqueta legible
  rango: string; // "dd/mm → dd/mm"
  motivo: string;
  estado: string; // Programado | En_curso | Completado | Cancelado
}

const tonoEstado: Record<string, string> = {
  Programado: "bg-blue-100 text-blue-700",
  En_curso: "bg-amber-100 text-amber-700",
  Completado: "bg-emerald-100 text-emerald-700",
  Cancelado: "bg-slate-100 text-slate-500",
};

export function MantenimientoLista({ items }: { items: ItemMantenimiento[] }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  const cambiar = (id: number, estado: string) => {
    startTransition(async () => {
      const res = await cambiarEstadoMantenimientoAction(id, estado);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo actualizar.");
    });
  };

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">Sin mantenimientos registrados.</p>;
  }

  const btn = "rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Unidad</th>
            <th className="px-3 py-2">Evento</th>
            <th className="px-3 py-2">Rango</th>
            <th className="px-3 py-2">Motivo</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} className="border-b border-border/60 align-top">
              <td className="px-3 py-2">
                <div className="font-medium text-ink">{m.unidad}</div>
                <div className="text-xs text-muted">{m.tipoUnidad}</div>
              </td>
              <td className="px-3 py-2 text-ink">{m.evento}</td>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{m.rango}</td>
              <td className="px-3 py-2 text-muted">{m.motivo || "—"}</td>
              <td className="px-3 py-2">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tonoEstado[m.estado] ?? ""}`}>
                  {m.estado.replace("_", " ")}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {m.estado === "Programado" && (
                    <button onClick={() => cambiar(m.id, "En_curso")} disabled={pendiente} className={`${btn} bg-amber-100 text-amber-700 hover:bg-amber-200`}>
                      Iniciar
                    </button>
                  )}
                  {(m.estado === "Programado" || m.estado === "En_curso") && (
                    <>
                      <button onClick={() => cambiar(m.id, "Completado")} disabled={pendiente} className={`${btn} bg-emerald-100 text-emerald-700 hover:bg-emerald-200`}>
                        Completar
                      </button>
                      <button onClick={() => cambiar(m.id, "Cancelado")} disabled={pendiente} className={`${btn} bg-red-50 text-red-700 hover:bg-red-100`}>
                        Cancelar
                      </button>
                    </>
                  )}
                  {(m.estado === "Completado" || m.estado === "Cancelado") && (
                    <span className="text-xs text-muted">—</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
