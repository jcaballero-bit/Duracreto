import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { Card, PageHeader } from "../components/ui";
import { FiltrosBitacora, type OpcionFiltro } from "./filtros";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;

// Nombre legible de cada tabla auditada.
const TABLA_LABEL: Record<string, string> = {
  viajes: "Viajes (despacho)",
  pedidos: "Pedidos",
  clientes: "Clientes",
  solicitudes_anticipadas: "Programa Semana",
};
const etiquetaTabla = (t: string) => TABLA_LABEL[t] ?? t;

function fmtFechaHora(d: Date): string {
  return d.toLocaleString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "YYYY-MM-DD" → Date local a medianoche (o null si no es válida). */
function fechaLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export default async function BitacoraPage({
  searchParams,
}: {
  searchParams: Promise<{
    tabla?: string;
    usuario?: string;
    desde?: string;
    hasta?: string;
    pagina?: string;
  }>;
}) {
  await requerirAcceso("/bitacora");
  const sp = await searchParams;
  const tabla = sp.tabla ?? "todos";
  const usuario = sp.usuario ?? "todos";
  const desde = sp.desde ?? "";
  const hasta = sp.hasta ?? "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  // Rango de fechas (hasta es inclusivo → hasta el final del día).
  const dDesde = fechaLocal(desde);
  const dHasta = fechaLocal(hasta);
  const finHasta = dHasta ? new Date(dHasta.getTime() + 24 * 60 * 60 * 1000) : null;

  const where: Prisma.bitacora_auditoriaWhereInput = {
    ...(tabla !== "todos" ? { tabla_afectada: tabla } : {}),
    ...(usuario !== "todos" ? { usuario } : {}),
    ...(dDesde || finHasta
      ? {
          fecha_hora: {
            ...(dDesde ? { gte: dDesde } : {}),
            ...(finHasta ? { lt: finHasta } : {}),
          },
        }
      : {}),
  };

  const [total, registros, tablasRaw, usuariosRaw] = await Promise.all([
    prisma.bitacora_auditoria.count({ where }),
    prisma.bitacora_auditoria.findMany({
      where,
      orderBy: { fecha_hora: "desc" },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    prisma.bitacora_auditoria.groupBy({ by: ["tabla_afectada"] }),
    prisma.bitacora_auditoria.groupBy({ by: ["usuario"] }),
  ]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const tablas: OpcionFiltro[] = tablasRaw
    .map((t) => ({ value: t.tabla_afectada, label: etiquetaTabla(t.tabla_afectada) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const usuarios = usuariosRaw.map((u) => u.usuario).sort((a, b) => a.localeCompare(b));

  // Preserva los filtros al paginar.
  const urlPagina = (n: number) => {
    const params = new URLSearchParams();
    if (tabla !== "todos") params.set("tabla", tabla);
    if (usuario !== "todos") params.set("usuario", usuario);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    params.set("pagina", String(n));
    return `/bitacora?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        titulo="Bitácora de auditoría"
        descripcion="Registro de todos los cambios del sistema: quién, cuándo, qué campo y el motivo."
      />

      <FiltrosBitacora
        tabla={tabla}
        usuario={usuario}
        desde={desde}
        hasta={hasta}
        tablas={tablas}
        usuarios={usuarios}
      />

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between text-sm text-muted">
          <span>
            <span className="font-semibold text-ink">{total}</span> registro(s)
          </span>
          <span>
            Página {pagina} de {totalPaginas}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 whitespace-nowrap">Fecha / hora</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Tabla</th>
                <th className="px-3 py-2">Registro</th>
                <th className="px-3 py-2">Campo</th>
                <th className="px-3 py-2">Cambio</th>
                <th className="px-3 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {registros.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted">
                    No hay registros para estos filtros.
                  </td>
                </tr>
              ) : (
                registros.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-muted">
                      {fmtFechaHora(r.fecha_hora)}
                    </td>
                    <td className="px-3 py-2 text-ink">{r.usuario}</td>
                    <td className="px-3 py-2 text-ink">{etiquetaTabla(r.tabla_afectada)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">#{r.registro_id}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-ink">
                      {r.campo_modificado}
                    </td>
                    <td className="px-3 py-2">
                      {r.valor_anterior != null || r.valor_nuevo != null ? (
                        <span className="text-xs">
                          <span className="text-danger line-through">
                            {r.valor_anterior ?? "—"}
                          </span>{" "}
                          <span className="text-muted">→</span>{" "}
                          <span className="font-medium text-ok">{r.valor_nuevo ?? "—"}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{r.motivo ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPaginas > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {pagina > 1 ? (
              <Link
                href={urlPagina(pagina - 1)}
                className="rounded-lg border border-border px-3 py-1.5 text-ink hover:bg-content"
              >
                ← Anterior
              </Link>
            ) : (
              <span className="rounded-lg border border-border px-3 py-1.5 text-muted/40">
                ← Anterior
              </span>
            )}
            <span className="px-2 text-muted">
              {pagina} / {totalPaginas}
            </span>
            {pagina < totalPaginas ? (
              <Link
                href={urlPagina(pagina + 1)}
                className="rounded-lg border border-border px-3 py-1.5 text-ink hover:bg-content"
              >
                Siguiente →
              </Link>
            ) : (
              <span className="rounded-lg border border-border px-3 py-1.5 text-muted/40">
                Siguiente →
              </span>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
