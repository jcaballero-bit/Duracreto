"use client";

import { useRouter } from "next/navigation";
import { Fragment, useTransition } from "react";
import { confirmarPedidoAsesorAction } from "../actions";
import { Badge } from "../components/ui";

export interface PedidoConfirm {
  id: number;
  plantelNombre: string;
  fecha: string; // fecha y hora de llegada al proyecto
  empresa: string;
  proyecto: string;
  diseno: string; // tipo de concreto
  volumen: number;
  hielo: string; // sacos de hielo (o "—")
  descarga: string; // tipo de descarga (o código de bomba)
  frecuencia: string; // frecuencia entre camiones (o "—")
  transporte: string; // tiempo de transporte (o "—")
  elemento: string;
  confirmado: boolean;
}

const COLSPAN = 11;

export function ListaConfirmaciones({ pedidos }: { pedidos: PedidoConfirm[] }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  const confirmar = (id: number) => {
    startTransition(async () => {
      const res = await confirmarPedidoAsesorAction(id);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo confirmar.");
    });
  };

  if (pedidos.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        No hay pedidos de tus clientes para confirmar en estas fechas.
      </p>
    );
  }

  // Agrupar por plantel conservando el orden ya calculado en el servidor.
  const grupos: { plantel: string; filas: PedidoConfirm[] }[] = [];
  for (const p of pedidos) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.plantel === p.plantelNombre) ultimo.filas.push(p);
    else grupos.push({ plantel: p.plantelNombre, filas: [p] });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Llegada a proyecto</th>
            <th className="px-3 py-2">Cliente / proyecto</th>
            <th className="px-3 py-2">Tipo de concreto</th>
            <th className="px-3 py-2">Vol.</th>
            <th className="px-3 py-2">Hielo (sacos)</th>
            <th className="px-3 py-2">Descarga</th>
            <th className="px-3 py-2">Frecuencia</th>
            <th className="px-3 py-2">Transporte</th>
            <th className="px-3 py-2">Elemento</th>
            <th className="px-3 py-2">Confirmación</th>
            <th className="px-3 py-2">Acción</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <Fragment key={g.plantel}>
              <tr className="bg-content/60">
                <td
                  colSpan={COLSPAN}
                  className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink"
                >
                  {g.plantel}
                </td>
              </tr>
              {g.filas.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="px-3 py-2 whitespace-nowrap capitalize">{p.fecha}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{p.empresa}</div>
                    {p.proyecto && <div className="text-xs text-link">{p.proyecto}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted">{p.diseno}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-medium">
                    {p.volumen.toFixed(1)} m³
                  </td>
                  <td className="px-3 py-2 text-center">{p.hielo}</td>
                  <td className="px-3 py-2">{p.descarga}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.frecuencia}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.transporte}</td>
                  <td className="px-3 py-2">{p.elemento}</td>
                  <td className="px-3 py-2">
                    <Badge tono={p.confirmado ? "ok" : "neutro"}>
                      {p.confirmado ? "Confirmado" : "Pendiente"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {p.confirmado ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <button
                        disabled={pendiente}
                        onClick={() => confirmar(p.id)}
                        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
