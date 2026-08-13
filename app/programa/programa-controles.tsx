"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileDown, History, Loader2 } from "lucide-react";
import { Card } from "../components/ui";

export function ProgramaControles({
  fecha,
  zona,
  zonas,
}: {
  fecha: string;
  zona: string;
  zonas: string[];
}) {
  const router = useRouter();
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navegar = (nuevaFecha: string, nuevaZona: string) => {
    const params = new URLSearchParams();
    params.set("fecha", nuevaFecha);
    params.set("zona", nuevaZona);
    router.push(`/programa?${params.toString()}`);
  };

  /**
   * Genera el PDF EN EL SERVIDOR y lo descarga. Ya no se usa la impresión del
   * navegador: el servidor devuelve el documento exacto (y archiva la versión).
   */
  const generarPdf = async () => {
    setGenerando(true);
    setError(null);
    try {
      const res = await fetch("/programa/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, zona }),
      });
      if (!res.ok) {
        const detalle = await res.json().catch(() => ({}));
        setError(detalle.mensaje ?? "No se pudo generar el PDF.");
        return;
      }
      // Nombre de archivo que manda el servidor (incluye la versión).
      const disp = res.headers.get("Content-Disposition") ?? "";
      const nombre =
        /filename="([^"]+)"/.exec(disp)?.[1] ?? `DPCR-08_${fecha}_${zona}.pdf`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // La versión nueva debe verse en el historial.
      router.refresh();
    } catch {
      setError("No se pudo generar el PDF. Intenta de nuevo.");
    } finally {
      setGenerando(false);
    }
  };

  const inputCls =
    "rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

  return (
    <Card className="mb-5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">Fecha</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => navegar(e.target.value, zona)}
              className={inputCls}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">Zona</span>
            <select
              value={zona}
              onChange={(e) => navegar(fecha, e.target.value)}
              className={inputCls}
            >
              {zonas.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/programa/historial?fecha=${fecha}&zona=${encodeURIComponent(zona)}`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink hover:bg-content"
          >
            <History size={16} /> Versiones generadas
          </Link>
          <button
            onClick={generarPdf}
            disabled={generando}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {generando ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
            {generando ? "Generando…" : "Generar PDF"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        El PDF se genera en el servidor con paginación exacta y queda archivado como
        versión, para poder volver a descargar el mismo documento después. Lo que ves
        abajo es la vista previa en pantalla.
      </p>
    </Card>
  );
}
