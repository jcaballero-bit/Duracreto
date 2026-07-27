"use client";

import { useRouter } from "next/navigation";
import { Card } from "../components/ui";

export interface OpcionFiltro {
  value: string;
  label: string;
}

export function FiltrosBitacora({
  tabla,
  usuario,
  desde,
  hasta,
  tablas,
  usuarios,
}: {
  tabla: string;
  usuario: string;
  desde: string;
  hasta: string;
  tablas: OpcionFiltro[];
  usuarios: string[];
}) {
  const router = useRouter();

  const navegar = (cambios: Record<string, string>) => {
    const actual = { tabla, usuario, desde, hasta, ...cambios };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(actual)) {
      if (v && v !== "todos") params.set(k, v);
    }
    // Cualquier cambio de filtro vuelve a la primera página.
    router.push(params.toString() ? `/bitacora?${params.toString()}` : "/bitacora");
  };

  const inputCls =
    "rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

  return (
    <Card className="mb-5 flex flex-wrap items-end gap-4 p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Tabla</span>
        <select
          value={tabla}
          onChange={(e) => navegar({ tabla: e.target.value })}
          className={inputCls}
        >
          <option value="todos">Todas</option>
          {tablas.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Usuario</span>
        <select
          value={usuario}
          onChange={(e) => navegar({ usuario: e.target.value })}
          className={inputCls}
        >
          <option value="todos">Todos</option>
          {usuarios.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Desde</span>
        <input
          type="date"
          value={desde}
          onChange={(e) => navegar({ desde: e.target.value })}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Hasta</span>
        <input
          type="date"
          value={hasta}
          onChange={(e) => navegar({ hasta: e.target.value })}
          className={inputCls}
        />
      </label>

      {(tabla !== "todos" || usuario !== "todos" || desde || hasta) && (
        <button
          onClick={() => router.push("/bitacora")}
          className="rounded-lg border border-border px-3 py-2 text-sm text-ink hover:bg-content"
        >
          Limpiar filtros
        </button>
      )}
    </Card>
  );
}
