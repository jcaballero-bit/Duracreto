// Historial de versiones del Programa DPCR-08 generadas como PDF. Sirve para la
// trazabilidad del documento controlado: quién lo generó, cuándo, y volver a
// descargar EXACTAMENTE ese documento (se re-renderiza desde su snapshot).
import Link from "next/link";
import { ArrowLeft, FileDown } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { zonasParaPrograma } from "@/lib/programa/acceso";
import { ymd } from "@/lib/programa/snapshot";
import { Card, PageHeader } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function HistorialProgramaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; zona?: string }>;
}) {
  const alcance = await requerirAcceso("/programa");
  const sesion = await auth();
  const sp = await searchParams;

  // Mismo enforcement que la pantalla y la ruta del PDF: solo las zonas del usuario.
  const zonasPermitidas = await zonasParaPrograma(alcance, sesion?.user?.id ?? null);
  const zonaFiltro = sp.zona && zonasPermitidas.includes(sp.zona) ? sp.zona : null;
  const fechaFiltro = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : null;

  const versiones = await prisma.programas_dpcr08.findMany({
    where: {
      zona: zonaFiltro ?? { in: zonasPermitidas },
      ...(fechaFiltro
        ? {
            fecha_programa: {
              gte: new Date(`${fechaFiltro}T00:00:00`),
              lt: new Date(new Date(`${fechaFiltro}T00:00:00`).getTime() + 86400000),
            },
          }
        : {}),
    },
    orderBy: [{ fecha_programa: "desc" }, { zona: "asc" }, { version: "desc" }],
    take: 200,
    select: {
      id: true,
      fecha_programa: true,
      zona: true,
      version: true,
      generado_por: true,
      ts_generado: true,
    },
  });

  const fmt = (d: Date) =>
    d.toLocaleString("es-HN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const volverA = `/programa?${new URLSearchParams({
    ...(fechaFiltro ? { fecha: fechaFiltro } : {}),
    ...(zonaFiltro ? { zona: zonaFiltro } : {}),
  }).toString()}`;

  return (
    <>
      <PageHeader
        titulo="Programa DPCR-08 — Versiones generadas"
        descripcion="Cada vez que se genera el PDF queda archivada una versión con los datos congelados de ese momento. Descargarla devuelve el documento idéntico, aunque la programación haya cambiado."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={volverA}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink hover:bg-content"
        >
          <ArrowLeft size={16} /> Volver al Programa
        </Link>
        {(fechaFiltro || zonaFiltro) && (
          <>
            <span className="text-sm text-muted">
              Filtrado por {fechaFiltro ?? "todas las fechas"}
              {zonaFiltro ? ` · Zona ${zonaFiltro}` : ""}
            </span>
            <Link href="/programa/historial" className="text-sm text-link underline">
              ver todas
            </Link>
          </>
        )}
      </div>

      <Card className="p-5">
        {versiones.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
            Aún no se ha generado ningún PDF
            {fechaFiltro || zonaFiltro ? " con este filtro" : ""}. Usa{" "}
            <strong>Generar PDF</strong> en el Programa.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Día del programa</th>
                  <th className="px-3 py-2">Zona</th>
                  <th className="px-3 py-2">Versión</th>
                  <th className="px-3 py-2">Generado por</th>
                  <th className="px-3 py-2">Fecha de generación</th>
                  <th className="px-3 py-2">Descargar</th>
                </tr>
              </thead>
              <tbody>
                {versiones.map((v) => (
                  <tr key={v.id} className="border-b border-border/60">
                    <td className="px-3 py-2 font-medium text-ink">{ymd(v.fecha_programa)}</td>
                    <td className="px-3 py-2 text-muted">{v.zona}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                        v{v.version}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{v.generado_por}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{fmt(v.ts_generado)}</td>
                    <td className="px-3 py-2">
                      {/* GET con la versión: re-renderiza desde el snapshot archivado. */}
                      <a
                        href={`/programa/pdf?version=${v.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-content"
                      >
                        <FileDown size={14} /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
