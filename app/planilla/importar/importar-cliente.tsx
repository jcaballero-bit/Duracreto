"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Link2,
  Loader2,
  UserX,
} from "lucide-react";
import type { PreviaImportacion, ReporteImportacion } from "@/lib/biometrico/importar";
import {
  ignorarCodigoAction,
  importarArchivoAction,
  mapearDepartamentoAction,
  previsualizarArchivoAction,
  vincularCodigoAction,
} from "../importacion-actions";

export interface PersonaOpcion {
  id: number;
  nombre: string;
  puesto: string;
  codigo: string | null;
}

const selCls =
  "rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent";

/**
 * Flujo de importación: subir → previsualizar → resolver vinculaciones → confirmar →
 * reporte. El archivo se conserva en el navegador y se reenvía en cada paso, así no hay
 * que guardarlo en el servidor entre pasos.
 */
export function ImportarBiometrico({
  personas,
  planteles,
}: {
  personas: PersonaOpcion[];
  planteles: { id: number; nombre: string }[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaImportacion | null>(null);
  const [reporte, setReporte] = useState<ReporteImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sobrescribir, setSobrescribir] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const analizar = (f: File | null) => {
    const usar = f ?? archivo;
    if (!usar) return;
    setError(null);
    setReporte(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("archivo", usar);
      const r = await previsualizarArchivoAction(fd);
      if (!r.ok) {
        setError(r.mensaje);
        setPrevia(null);
      } else {
        setPrevia(r.previa);
      }
    });
  };

  const importar = () => {
    if (!archivo) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("archivo", archivo);
      const r = await importarArchivoAction(fd, sobrescribir);
      if (!r.ok) setError(r.mensaje);
      else {
        setReporte(r.reporte);
        setPrevia(null);
        router.refresh();
      }
    });
  };

  const conAccion = (fn: () => Promise<{ ok: boolean; mensaje?: string }>) => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.mensaje ?? "No se pudo guardar.");
        return;
      }
      // Se vuelve a analizar para que la previsualización refleje el vínculo nuevo.
      if (archivo) {
        const fd = new FormData();
        fd.set("archivo", archivo);
        const p = await previsualizarArchivoAction(fd);
        if (p.ok) setPrevia(p.previa);
      }
      router.refresh();
    });
  };

  return (
    <div>
      {/* ── Paso 1: el archivo ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.XLS"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setArchivo(f);
            setPrevia(null);
            setReporte(null);
            setError(null);
            if (f) analizar(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pendiente}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          <FileUp size={16} /> {archivo ? "Elegir otro archivo" : "Elegir el archivo del reloj"}
        </button>
        {archivo && (
          <span className="text-sm text-muted">
            {archivo.name} · {(archivo.size / 1024).toFixed(0)} KB
          </span>
        )}
        {pendiente && (
          <span className="inline-flex items-center gap-1 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Procesando…
          </span>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* ── Reporte final ──────────────────────────────────────────────────── */}
      {reporte && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <CheckCircle2 size={16} /> Importación terminada
          </h3>
          <ul className="space-y-0.5 text-sm text-emerald-900">
            <li>Registros creados: <strong>{reporte.creados}</strong></li>
            <li>Registros actualizados: <strong>{reporte.actualizados}</strong></li>
            <li>Sin cambio (ya decían lo mismo): {reporte.sinCambio}</li>
            {reporte.conflictosOmitidos > 0 && (
              <li className="text-amber-800">
                Omitidos por estar corregidos a mano: <strong>{reporte.conflictosOmitidos}</strong>{" "}
                (vuelve a importar marcando la casilla de sobrescribir si quieres reemplazarlos)
              </li>
            )}
            {reporte.omitidosSinVinculo > 0 && (
              <li className="text-amber-800">
                Omitidos por código sin vincular: <strong>{reporte.omitidosSinVinculo}</strong>
              </li>
            )}
            {reporte.omitidosIgnorados > 0 && (
              <li>Omitidos por código marcado como ajeno: {reporte.omitidosIgnorados}</li>
            )}
            {reporte.fallidos.length > 0 && (
              <li className="text-red-800">
                Fallidos: <strong>{reporte.fallidos.length}</strong>
                <ul className="ml-4 list-disc">
                  {reporte.fallidos.slice(0, 10).map((f) => (
                    <li key={f.fila}>
                      fila {f.fila} (código {f.codigo}): {f.motivo}
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ── Paso 2: previsualización ───────────────────────────────────────── */}
      {previa && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">Lo que trae el archivo</h3>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Dato
              titulo="Rango de fechas"
              valor={
                previa.desdeISO && previa.hastaISO
                  ? previa.desdeISO === previa.hastaISO
                    ? previa.desdeISO
                    : `${previa.desdeISO} al ${previa.hastaISO}`
                  : "—"
              }
              pie={`${previa.fechas.length} ${previa.fechas.length === 1 ? "día" : "días"} · detectado de los datos`}
            />
            <Dato titulo="Filas de datos" valor={String(previa.filasDatos)} />
            <Dato titulo="Personas distintas" valor={String(previa.personasDistintas)} />
            <Dato titulo="Registros con marcas" valor={String(previa.registrosConMarcas)} />
            <Dato
              titulo="Ausencias"
              valor={String(previa.ausencias)}
              pie="entran pendientes de clasificar"
            />
            <Dato
              titulo="Cruces de medianoche"
              valor={String(previa.crucesMedianoche)}
              pie="la salida cae al día siguiente"
            />
          </div>

          {previa.encabezadosInesperados.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Los encabezados no calzan con el formato conocido</strong> — revisa que sea el
              reporte de asistencia del reloj antes de importar:
              <ul className="ml-4 mt-1 list-disc">
                {previa.encabezadosInesperados.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Vinculación de códigos */}
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Link2 size={15} /> Vinculación de personas
          </h3>
          <p className="mb-2 text-xs text-muted">
            {previa.sinVincular === 0
              ? "Todos los códigos del archivo están resueltos."
              : `${previa.sinVincular} código(s) sin vincular. Sus filas NO se importan hasta que se resuelvan: elige a quién corresponde cada uno, o márcalo como ajeno al personal operativo para que no vuelva a preguntar.`}
          </p>
          <div className="mb-4 max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-content">
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-2 py-2">Código</th>
                  <th className="px-2 py-2">Nombre en el reloj</th>
                  <th className="px-2 py-2">Departamento</th>
                  <th className="px-2 py-2 text-right">Filas</th>
                  <th className="px-2 py-2">Persona del sistema</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {[...previa.vinculos]
                  .sort((a, b) => {
                    // Primero lo que falta resolver.
                    const rank = (v: typeof a) => (v.personaId != null ? 2 : v.ignorado ? 1 : 0);
                    return rank(a) - rank(b) || a.codigo.localeCompare(b.codigo);
                  })
                  .map((v) => (
                    <tr
                      key={v.codigo}
                      className={
                        "border-b border-border/60 " +
                        (v.personaId == null && !v.ignorado ? "bg-amber-50" : "")
                      }
                    >
                      <td className="px-2 py-1.5 tabular-nums text-ink">{v.codigo}</td>
                      <td className="px-2 py-1.5 text-ink">{v.nombreReloj || "—"}</td>
                      <td className="px-2 py-1.5 text-xs text-muted">
                        {v.departamentos.join(" · ") || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {v.registros}
                      </td>
                      <td className="px-2 py-1.5">
                        {v.ignorado ? (
                          <span className="text-xs text-muted">
                            No pertenece al personal operativo
                          </span>
                        ) : (
                          <select
                            value={v.personaId ?? ""}
                            disabled={pendiente}
                            onChange={(e) =>
                              conAccion(() =>
                                vincularCodigoAction(
                                  v.codigo,
                                  e.target.value === "" ? null : Number(e.target.value),
                                ),
                              )
                            }
                            className={selCls + " w-full max-w-[280px]"}
                          >
                            <option value="">— Sin vincular —</option>
                            {personas.map((p) => (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={p.codigo != null && p.codigo !== v.codigo}
                              >
                                {p.nombre} ({p.puesto})
                                {p.codigo != null && p.codigo !== v.codigo
                                  ? ` — ya tiene el código ${p.codigo}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          disabled={pendiente}
                          title={
                            v.ignorado
                              ? "Volver a considerar este código"
                              : "No pertenece al personal operativo"
                          }
                          onClick={() =>
                            conAccion(() =>
                              ignorarCodigoAction(v.codigo, v.nombreReloj, !v.ignorado),
                            )
                          }
                          className={
                            "rounded p-1 " +
                            (v.ignorado
                              ? "text-accent hover:bg-content"
                              : "text-muted hover:bg-content hover:text-red-600")
                          }
                        >
                          <UserX size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Departamentos */}
          <h3 className="mb-1 text-sm font-semibold text-ink">Departamentos del reloj</h3>
          <p className="mb-2 text-xs text-muted">
            Los nombres del reloj no coinciden con los planteles del sistema. Un departamento sin
            correspondencia <strong>no impide la importación</strong>: la fila entra igual y queda
            señalada aquí.
          </p>
          <div className="mb-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border bg-content text-left text-xs font-medium text-muted">
                  <th className="px-2 py-2">Departamento del reloj</th>
                  <th className="px-2 py-2 text-right">Filas</th>
                  <th className="px-2 py-2">Plantel del sistema</th>
                </tr>
              </thead>
              <tbody>
                {previa.departamentos.map((d) => (
                  <tr
                    key={d.departamento}
                    className={
                      "border-b border-border/60 " + (d.plantelId == null ? "bg-amber-50" : "")
                    }
                  >
                    <td className="px-2 py-1.5 text-ink">{d.departamento}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">{d.registros}</td>
                    <td className="px-2 py-1.5">
                      <select
                        value={d.plantelId ?? ""}
                        disabled={pendiente}
                        onChange={(e) =>
                          conAccion(() =>
                            mapearDepartamentoAction(
                              d.departamento,
                              e.target.value === "" ? null : Number(e.target.value),
                            ),
                          )
                        }
                        className={selCls}
                      >
                        <option value="">— Sin correspondencia —</option>
                        {planteles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Filas con problemas */}
          {previa.problemas.length > 0 && (
            <>
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <AlertTriangle size={15} className="text-amber-600" /> Filas con problemas (
                {previa.problemas.length})
              </h3>
              <p className="mb-2 text-xs text-muted">
                Las filas con una sola marca se importan con lo que exista, para corregirlas a
                mano; las que no tienen código o fecha válida no se pueden importar.
              </p>
              <div className="mb-4 max-h-60 overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="sticky top-0 bg-content">
                    <tr className="border-b border-border text-left text-xs font-medium text-muted">
                      <th className="px-2 py-2">Fila</th>
                      <th className="px-2 py-2">Código</th>
                      <th className="px-2 py-2">Nombre</th>
                      <th className="px-2 py-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.problemas.map((p, i) => (
                      <tr key={`${p.fila}-${i}`} className="border-b border-border/60">
                        <td className="px-2 py-1.5 tabular-nums text-ink">{p.fila}</td>
                        <td className="px-2 py-1.5 tabular-nums text-muted">{p.codigo || "—"}</td>
                        <td className="px-2 py-1.5 text-muted">{p.nombre || "—"}</td>
                        <td className="px-2 py-1.5 text-xs text-ink">{p.detalle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Conflictos con correcciones manuales */}
          {previa.conflictos.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <AlertTriangle size={15} /> {previa.conflictos.length} registro(s) ya corregidos a
                mano
              </h3>
              <p className="mb-2 text-xs text-amber-900">
                El archivo dice algo distinto de lo que alguien capturó o corrigió a mano. Por
                defecto <strong>no se tocan</strong>. Si marcas la casilla, la importación los
                reemplaza y la bitácora lo registra como sobrescritura.
              </p>
              <div className="max-h-48 overflow-auto rounded-lg border border-amber-200 bg-surface">
                <table className="w-full min-w-[520px] text-xs">
                  <thead className="sticky top-0 bg-content">
                    <tr className="border-b border-border text-left font-medium text-muted">
                      <th className="px-2 py-1.5">Fecha</th>
                      <th className="px-2 py-1.5">Persona</th>
                      <th className="px-2 py-1.5">Capturado a mano</th>
                      <th className="px-2 py-1.5">Traería el reloj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.conflictos.map((c, i) => (
                      <tr key={`${c.fechaISO}-${c.codigo}-${i}`} className="border-b border-border/60">
                        <td className="px-2 py-1 tabular-nums text-ink">{c.fechaISO}</td>
                        <td className="px-2 py-1 text-ink">{c.persona}</td>
                        <td className="px-2 py-1 tabular-nums text-ink">{c.actual}</td>
                        <td className="px-2 py-1 tabular-nums text-amber-800">{c.nuevo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs font-medium text-amber-900">
                <input
                  type="checkbox"
                  checked={sobrescribir}
                  onChange={(e) => setSobrescribir(e.target.checked)}
                  className="accent-accent"
                />
                Sí, reemplazar también los registros corregidos a mano
              </label>
            </div>
          )}

          {/* Confirmar */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={importar}
              disabled={pendiente || previa.importables === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Importar {previa.importables} registro(s)
            </button>
            {previa.sinVincular > 0 && (
              <span className="text-xs text-amber-700">
                Quedan {previa.sinVincular} código(s) sin vincular: sus filas no se importarán.
              </span>
            )}
            {previa.importables === 0 && (
              <span className="text-xs text-muted">
                No hay nada que importar todavía: vincula al menos un código.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Dato({ titulo, valor, pie }: { titulo: string; valor: string; pie?: string }) {
  return (
    <div className="rounded-lg border border-border bg-content/40 px-3 py-2">
      <div className="text-xs text-muted">{titulo}</div>
      <div className="text-base font-semibold tabular-nums text-ink">{valor}</div>
      {pie && <div className="text-[11px] text-muted">{pie}</div>}
    </div>
  );
}
