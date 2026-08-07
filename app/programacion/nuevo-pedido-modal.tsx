"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { PedidoForm, type ClienteOpcion, type DisenoOpcion } from "../pedido-form";
import { PrimaryButton } from "../components/ui";

interface Opcion {
  id: number;
  etiqueta: string;
}
interface PlantelOpcion {
  id: number;
  nombre: string;
  zona: string;
  hubId: number | null;
  plantas: Opcion[];
}
interface BombaOpcion {
  id: number;
  etiqueta: string;
  plantelId: number | null;
}

export function NuevoPedidoModal({
  clientes,
  disenos,
  planteles,
  bombas,
  asesores,
  plantelInicial,
  fechaInicial,
  esAdicion = false,
}: {
  clientes: ClienteOpcion[];
  disenos: DisenoOpcion[];
  planteles: PlantelOpcion[];
  bombas: BombaOpcion[];
  asesores: Opcion[];
  plantelInicial?: number;
  fechaInicial?: string;
  // true en "Despacho en vivo": el pedido es una ADICIÓN (fuera del programa/DPCR-08).
  esAdicion?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const router = useRouter();
  const titulo = esAdicion ? "Adicionar pedido" : "Nuevo pedido";

  return (
    <>
      <PrimaryButton conMas onClick={() => setAbierto(true)}>
        {titulo}
      </PrimaryButton>

      {abierto && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
          onClick={() => setAbierto(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-lg font-bold text-ink">{titulo}</h2>
              <button
                onClick={() => setAbierto(false)}
                className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5">
              <PedidoForm
                clientes={clientes}
                disenos={disenos}
                planteles={planteles}
                bombas={bombas}
                asesores={asesores}
                plantelInicial={plantelInicial}
                fechaInicial={fechaInicial}
                esAdicion={esAdicion}
                onExito={() => router.refresh()}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
