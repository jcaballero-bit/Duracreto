"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Download, Upload, X } from "lucide-react";
import {
  importarCatalogo,
  type Catalogo,
  type ResultadoImport,
} from "./catalogos-actions";
import { COLUMNAS_ESPERADAS } from "./columnas";
import { generarPlantilla, parseCSV } from "@/lib/csv";

export function ImportarCsv({
  catalogo,
  singular,
}: {
  catalogo: Catalogo;
  singular: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<Record<string, string>[]>([]);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const [pendiente, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const columnas = COLUMNAS_ESPERADAS[catalogo];

  const descargarPlantilla = () => {
    const blob = new Blob([generarPlantilla(columnas)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plantilla_${catalogo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const alSeleccionar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNombreArchivo(file.name);
    setResultado(null);
    setFilas(parseCSV(await file.text()));
  };

  const importar = () => {
    startTransition(async () => {
      const res = await importarCatalogo(catalogo, filas);
      setResultado(res);
      if (res.creados > 0) router.refresh();
    });
  };

  const cerrar = () => {
    setAbierto(false);
    setFilas([]);
    setNombreArchivo("");
    setResultado(null);
  };

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-content"
      >
        <Upload size={16} /> Importar CSV
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
          onClick={cerrar}
        >
          <div
            className="w-full max-w-2xl rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-lg font-bold text-ink">
                Importar {singular} desde CSV
              </h2>
              <button onClick={cerrar} className="rounded-md p-1 text-muted hover:bg-content hover:text-ink" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <p className="text-sm text-muted">
                Descarga la plantilla, complétala y súbela. Los encabezados se
                detectan automáticamente (mayúsculas, tildes y espacios se
                normalizan). Las relaciones se referencian por nombre.
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={descargarPlantilla}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-content"
                >
                  <Download size={16} /> Descargar plantilla
                </button>
                <button
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-content"
                >
                  <Upload size={16} /> Seleccionar archivo
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={alSeleccionar}
                />
                {nombreArchivo && (
                  <span className="self-center text-xs text-muted">{nombreArchivo}</span>
                )}
              </div>

              <div className="rounded-lg bg-content px-3 py-2 text-xs">
                <span className="text-muted">Columnas esperadas:</span>{" "}
                <span className="font-mono text-ink">{columnas.join(", ")}</span>
              </div>

              {filas.length > 0 && !resultado && (
                <div>
                  <div className="mb-1 text-sm font-medium text-ink">
                    {filas.length} registro(s) detectado(s) — previsualización:
                  </div>
                  <div className="max-h-48 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-content text-left text-muted">
                          {columnas.map((c) => (
                            <th key={c} className="px-2 py-1">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filas.slice(0, 8).map((f, i) => (
                          <tr key={i} className="border-t border-border/60">
                            {columnas.map((c) => (
                              <td key={c} className="px-2 py-1 text-ink">
                                {f[c] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filas.length > 8 && (
                    <div className="mt-1 text-xs text-muted">…y {filas.length - 8} más.</div>
                  )}
                </div>
              )}

              {resultado && (
                <div className="rounded-lg border border-border p-3 text-sm">
                  <div className="font-medium text-ink">
                    Importación: {resultado.creados} creado(s),{" "}
                    {resultado.errores.length} con error.
                  </div>
                  {resultado.errores.length > 0 && (
                    <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs text-danger">
                      {resultado.errores.map((e, i) => (
                        <li key={i}>fila {e.fila}: {e.motivo}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <button onClick={cerrar} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content">
                Cerrar
              </button>
              <button
                onClick={importar}
                disabled={filas.length === 0 || pendiente || resultado !== null}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {pendiente ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
