"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, GripVertical, Sparkles, Wand2 } from "lucide-react";
import { organizarDiaAction, reordenarPedidoAction } from "../actions";

export type EstadoCliente = "ok" | "warn" | "danger";

export interface PlantaMedidor {
  nombre: string;
  ocupacionPct: number; // 0..100+ (se topa visualmente a 100)
}
export interface ClienteCard {
  pedidoId: number;
  orden: number; // orden_dia (1..N)
  empresa: string;
  proyecto: string;
  plantaNombre: string;
  estado: EstadoCliente;
  frase: string; // estado en lenguaje simple
  horaTxt: string; // llegada aproximada (contexto, no dato principal)
}
export interface PlantelSimple {
  plantelId: number;
  nombre: string;
  zona: string;
  plantas: PlantaMedidor[];
  clientes: ClienteCard[];
  sugerencia: string | null; // frase en lenguaje llano o null
}

/** Color y frase del medidor de capacidad según el % de ocupación. */
function nivelMedidor(pct: number): { color: string; texto: string } {
  if (pct < 60) return { color: "bg-emerald-500", texto: "Hay bastante espacio" };
  if (pct <= 85) return { color: "bg-amber-500", texto: "Espacio moderado" };
  return { color: "bg-red-500", texto: "Casi lleno" };
}

const ICONO: Record<EstadoCliente, React.ReactNode> = {
  ok: <CheckCircle2 size={18} className="text-emerald-600" />,
  warn: <Clock size={18} className="text-amber-600" />,
  danger: <AlertTriangle size={18} className="text-red-600" />,
};

/**
 * Vista SIMPLE de Programación (por defecto): medidores de capacidad por planta,
 * botón "Organizar mi día", tarjeta de sugerencia y tarjetas de cliente con estado
 * en lenguaje llano y reordenamiento por arrastre. Sin términos técnicos.
 */
export function VistaSimple({
  planteles,
  fecha,
  puedeOrganizar,
  puedeReordenar,
}: {
  planteles: PlantelSimple[];
  fecha: string;
  puedeOrganizar: boolean;
  puedeReordenar: boolean;
}) {
  const router = useRouter();
  const [organizando, startOrganizar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [descartadas, setDescartadas] = useState<Set<number>>(new Set());

  const organizarTodo = () => {
    setAviso(null);
    startOrganizar(async () => {
      let ok = 0;
      let err: string | null = null;
      for (const p of planteles) {
        const res = await organizarDiaAction(p.plantelId, fecha);
        if (res.ok) ok += 1;
        else err = res.mensaje ?? "No se pudo organizar.";
      }
      if (err && ok === 0) setAviso(err);
      else setAviso(`Listo: organicé el día en ${ok} plantel(es). Los horarios quedaron acomodados.`);
      router.refresh();
    });
  };

  if (planteles.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
        No hay clientes programados para este día.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {puedeOrganizar && (
        <div className="flex flex-col items-start gap-2">
          <button
            onClick={organizarTodo}
            disabled={organizando}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-accent-hover disabled:opacity-50"
          >
            <Wand2 size={20} /> {organizando ? "Organizando…" : "Organizar mi día"}
          </button>
          <p className="text-xs text-muted">
            Acomoda automáticamente las entregas del día: primero los clientes grandes o
            de hora fija, y rellena los espacios con los pedidos chicos.
          </p>
          {aviso && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>
          )}
        </div>
      )}

      {planteles.map((p) => (
        <div key={p.plantelId} className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3">
            <span className="text-lg font-semibold text-ink">{p.nombre}</span>{" "}
            <span className="text-sm text-muted">({p.zona})</span>
          </div>

          {/* Medidores de capacidad por planta */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {p.plantas.map((pl) => {
              const pct = Math.min(100, Math.round(pl.ocupacionPct));
              const nivel = nivelMedidor(pl.ocupacionPct);
              return (
                <div key={pl.nombre} className="rounded-lg border border-border bg-content/40 p-3">
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-ink">{pl.nombre}</span>
                    <span className="text-muted">{pct}% ocupada</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                    <div className={`h-full rounded-full ${nivel.color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{nivel.texto}</p>
                </div>
              );
            })}
          </div>

          {/* Tarjeta de sugerencia (lenguaje llano) */}
          {p.sugerencia && !descartadas.has(p.plantelId) && (
            <div className="mb-4 rounded-lg border border-sky-300 bg-sky-50 p-3">
              <div className="flex items-start gap-2">
                <Sparkles size={18} className="mt-0.5 shrink-0 text-sky-600" />
                <div className="flex-1">
                  <p className="text-sm text-sky-900">{p.sugerencia}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => setDescartadas((s) => new Set(s).add(p.plantelId))}
                      className="rounded-md border border-sky-300 bg-white px-3 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100"
                    >
                      No, gracias
                    </button>
                    <button
                      onClick={() => {
                        document
                          .getElementById("pendientes-por-programar")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700"
                    >
                      Sí, agrégalo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tarjetas de cliente (con arrastre para reordenar) */}
          <ListaClientes
            clientes={p.clientes}
            puedeReordenar={puedeReordenar}
            onReordenado={(msg) => {
              setAviso(msg);
              router.refresh();
            }}
          />
        </div>
      ))}
    </div>
  );
}

function ListaClientes({
  clientes,
  puedeReordenar,
  onReordenado,
}: {
  clientes: ClienteCard[];
  puedeReordenar: boolean;
  onReordenado: (msg: string) => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [arrastra, setArrastra] = useState<number | null>(null); // pedidoId en arrastre

  if (clientes.length === 0) {
    return <p className="text-sm text-muted">Sin clientes en este plantel.</p>;
  }

  const soltarSobre = (destino: ClienteCard) => {
    const origen = arrastra;
    setArrastra(null);
    if (origen == null || origen === destino.pedidoId) return;
    startTransition(async () => {
      const res = await reordenarPedidoAction(origen, destino.orden);
      if (res.ok) onReordenado("Reacomodé el orden y recalculé los horarios del día.");
      else alert(res.mensaje ?? "No se pudo reordenar.");
    });
  };

  return (
    <ul className="space-y-2">
      {clientes.map((c) => (
        <li
          key={c.pedidoId}
          draggable={puedeReordenar && !pendiente}
          onDragStart={() => setArrastra(c.pedidoId)}
          onDragOver={(e) => {
            if (puedeReordenar) e.preventDefault();
          }}
          onDrop={() => soltarSobre(c)}
          className={`flex items-center gap-3 rounded-lg border border-border bg-surface p-3 ${
            puedeReordenar ? "cursor-grab active:cursor-grabbing" : ""
          } ${arrastra === c.pedidoId ? "opacity-50" : ""}`}
        >
          {puedeReordenar && <GripVertical size={16} className="shrink-0 text-muted" />}
          <span className="shrink-0">{ICONO[c.estado]}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">
              {c.empresa}
              {c.proyecto ? <span className="font-normal text-muted"> · {c.proyecto}</span> : ""}
            </div>
            <div className="text-xs text-muted">{c.frase}</div>
          </div>
          <div className="shrink-0 text-right text-xs text-muted">
            <div>{c.plantaNombre}</div>
            <div>llega ~{c.horaTxt}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
