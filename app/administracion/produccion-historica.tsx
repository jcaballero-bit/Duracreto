"use client";

// Administración › Producción histórica.
//
// Carga el volumen despachado de periodos ANTERIORES al uso del sistema (el Excel que se
// llevaba antes). Solo el Administrador: es un dato que altera los reportes históricos de
// toda la empresa.
//
// Lo que nunca hay que perder de vista al leer esta pantalla: el sistema SIEMPRE gana. Si
// un periodo ya tiene viajes completados, la fila histórica se puede guardar —queda
// archivada— pero no se grafica, porque sumarlas duplicaría el volumen.

import { useMemo, useRef, useState, useTransition } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { Card, PrimaryButton } from "../components/ui";
import { GRANULARIDADES_HISTORICAS } from "@/lib/produccion/historica";
import {
  eliminarHistoricaAction,
  eliminarLoteHistoricaAction,
  guardarHistoricaAction,
  importarHistoricaAction,
  previsualizarHistoricaAction,
  verificarChoqueAction,
  vincularAliasAction,
  type FilaPrevia,
  type Previsualizacion,
} from "./historica-actions";

export interface PlantelOpc {
  id: number;
  nombre: string;
  /** Sus plantas dosificadoras, para poder cargar el detalle en vez del total. */
  plantas: { id: number; nombre: string }[];
}

export interface FilaCargada {
  id: number;
  fechaTxt: string;
  plantel: string;
  /** Planta dosificadora, o `null` si la carga es del plantel completo. */
  planta: string | null;
  volumen: number;
  granularidad: string;
  observaciones: string | null;
  cargadoPor: string;
}

// La columna `planta` es OPCIONAL: sin ella cada fila es el total del plantel. Va en la
// plantilla para que se vea que existe, con la celda del ejemplo en blanco.
const COLUMNAS = ["fecha", "plantel", "planta", "volumen_m3"];

export function ProduccionHistorica({
  planteles,
  filas,
  filtrosAnio,
  anioActivo,
}: {
  planteles: PlantelOpc[];
  filas: FilaCargada[];
  /**
   * Filtros de año con su URL ya armada. Llegan como DATOS y no como una función que
   * construya el enlace: un componente servidor no puede pasarle funciones a uno cliente.
   */
  filtrosAnio: { etiqueta: string; valor: number | null; href: string }[];
  anioActivo: number | null;
}) {
  const [pendiente, iniciar] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-ink">Producción histórica</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Volumen despachado de periodos <strong>anteriores</strong> al uso del sistema. Se
          guarda aparte y solo se combina al graficar:{" "}
          <strong>si un periodo ya tiene viajes registrados, manda el sistema</strong> y el
          dato histórico queda archivado sin graficarse. Las dos fuentes nunca se suman.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-muted">
          Una carga <strong>Diaria</strong> alimenta el calendario y el gráfico. Una{" "}
          <strong>Mensual</strong> alimenta solo el gráfico en Mes y Año: un total del mes no
          se puede repartir entre días sin inventar el reparto.
        </p>
      </Card>

      {msg && (
        <Card className="border-accent/30 p-4">
          <p className="text-sm text-ink">{msg}</p>
        </Card>
      )}

      <Importar planteles={planteles} onMensaje={setMsg} />
      <Manual planteles={planteles} onMensaje={setMsg} />

      {/* ── Lo ya cargado ─────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-ink">Cargas registradas</h3>
          <div className="flex flex-wrap items-center gap-1">
            {filtrosAnio.map((f) => (
              <a
                key={f.etiqueta}
                href={f.href}
                className={`rounded-full border px-2.5 py-0.5 text-xs tabular-nums ${
                  anioActivo === f.valor
                    ? "border-transparent bg-accent text-white"
                    : "border-border text-muted hover:text-ink"
                }`}
              >
                {f.etiqueta}
              </a>
            ))}
            {/* Borrado EN LOTE de lo que muestra el filtro. Una importacion equivocada
                deja decenas de filas y borrarlas una por una no es razonable. La
                confirmacion dice EXACTAMENTE que alcance se va a borrar. */}
            {filas.length > 0 && (
              <button
                disabled={pendiente}
                onClick={() => {
                  const alcance =
                    anioActivo === null
                      ? "TODAS las cargas históricas, de todos los años"
                      : `todas las cargas del año ${anioActivo}`;
                  if (
                    !confirm(
                      `Se van a eliminar ${alcance}.\n\n` +
                        "Esto borra únicamente la producción histórica cargada a mano: " +
                        "no toca ningún viaje ni dato registrado por el sistema." +
                        "\n\n¿Continuar?",
                    )
                  ) {
                    return;
                  }
                  iniciar(async () => {
                    const r = await eliminarLoteHistoricaAction({ anio: anioActivo });
                    if (r.ok) {
                      setMsg(`Se eliminaron ${r.borradas} cargas (${r.volumen} m³).`);
                      location.reload();
                    } else setMsg(r.mensaje ?? "No se pudo eliminar.");
                  });
                }}
                className="ml-2 flex items-center gap-1.5 rounded-lg border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/5 disabled:opacity-40"
              >
                <Trash2 size={13} />
                {anioActivo === null ? "Eliminar todas" : `Eliminar las de ${anioActivo}`}
              </button>
            )}
          </div>
        </div>

        {filas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Todavía no hay producción histórica cargada. Mientras esta tabla esté vacía, el
            calendario y el gráfico se comportan exactamente como siempre.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-2 py-2">Periodo</th>
                  <th className="px-2 py-2">Plantel</th>
                  <th className="px-2 py-2">Planta</th>
                  <th className="px-2 py-2 text-right">Volumen (m³)</th>
                  <th className="px-2 py-2">Granularidad</th>
                  <th className="px-2 py-2">Observaciones</th>
                  <th className="px-2 py-2">Cargado por</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="border-b border-border/60">
                    <td className="px-2 py-2 tabular-nums text-ink">{f.fechaTxt}</td>
                    <td className="px-2 py-2 text-ink">{f.plantel}</td>
                    <td className="px-2 py-2 text-muted">
                      {f.planta ?? <span className="italic">todo el plantel</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">
                      {f.volumen.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-muted">{f.granularidad}</td>
                    <td className="px-2 py-2 text-xs text-muted">{f.observaciones ?? "—"}</td>
                    <td className="px-2 py-2 text-xs text-muted">{f.cargadoPor}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        disabled={pendiente}
                        onClick={() => {
                          if (!confirm(`¿Eliminar la carga de ${f.planta ?? f.plantel} (${f.fechaTxt})?`))
                            return;
                          iniciar(async () => {
                            const r = await eliminarHistoricaAction(f.id);
                            setMsg(r.ok ? "Carga eliminada." : (r.mensaje ?? "No se pudo eliminar."));
                            if (r.ok) location.reload();
                          });
                        }}
                        title="Eliminar esta carga"
                        className="rounded p-1 text-muted hover:bg-content hover:text-danger disabled:opacity-40"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Importación desde archivo ─────────────────────────────────────────────────
function Importar({
  planteles,
  onMensaje,
}: {
  planteles: PlantelOpc[];
  onMensaje: (m: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [encabezados, setEncabezados] = useState<string[]>([]);
  // `planta` en "" = el archivo no trae detalle por planta y cada fila es del plantel.
  const [mapeo, setMapeo] = useState({
    fecha: "fecha",
    plantel: "plantel",
    volumen: "volumen_m3",
    planta: "",
  });
  const [granularidad, setGranularidad] = useState("Diaria");
  const [observaciones, setObservaciones] = useState("");
  const [previa, setPrevia] = useState<Previsualizacion | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [filasArchivo, setFilasArchivo] = useState(0);
  const [pendiente, iniciar] = useTransition();
  const archivo = useRef<HTMLInputElement>(null);

  const leer = async (f: File) => {
    const t = await f.text();
    setTexto(t);
    setPrevia(null);
    setNombreArchivo(f.name);
    setFilasArchivo(t.split("\n").filter((l) => l.trim() !== "").length - 1);
    // Encabezados del archivo, para que el mapeo se pueda elegir aunque los nombres no
    // sean los esperados: los archivos históricos vienen de hojas con formatos distintos.
    const limpio = t.replace(/^﻿/, "").replace(/^sep=.\r?\n/i, "");
    const primera = limpio.split(/\r?\n/)[0] ?? "";
    const delim = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
    const cols = primera.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
    setEncabezados(cols);
    // Se intenta adivinar por nombre; si no, el usuario los elige.
    const buscar = (...claves: string[]) =>
      cols.find((c) => claves.some((k) => c.toLowerCase().includes(k))) ?? cols[0] ?? "";
    // La columna de planta solo se propone si el archivo trae una que se llame asi:
    // adivinarla de mas convertiria un archivo por plantel en uno por planta.
    const columnaPlanta =
      cols.find((c) => /^\s*planta\s*$/i.test(c) || /planta dosif/i.test(c)) ?? "";
    setMapeo({
      fecha: buscar("fecha", "dia", "mes", "periodo"),
      // "planta" tambien esta aqui porque muchos archivos viejos le dicen asi al plantel;
      // si hay una columna llamada exactamente "planta" se usa como planta, no como plantel.
      plantel: buscar("plantel", "planta", "sucursal", "sps"),
      volumen: buscar("volumen", "m3", "metros", "cantidad"),
      planta: columnaPlanta,
    });
  };

  const plantilla = () => {
    const contenido =
      `﻿sep=;\r\n${COLUMNAS.join(";")}\r\n` +
      // Sin planta: la fila es el total del plantel.
      "01/07/2025;Santa Marta;;1250.5\r\n" +
      // Con planta: el detalle. Las dos formas no se mezclan en la misma fecha.
      "02/07/2025;Santa Marta;STALO;700\r\n" +
      "02/07/2025;Santa Marta;SANY;550.5\r\n";
    const url = URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-produccion-historica.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const sinVincular = previa?.resumen?.plantelesSinVincular ?? [];
  const plantasRaras = previa?.resumen?.plantasSinReconocer ?? [];

  return (
    <Card className="p-5">
      <h3 className="mb-1 text-base font-semibold text-ink">Importar desde archivo</h3>
      <p className="mb-3 text-xs text-muted">
        Archivo <strong>CSV</strong> con las columnas fecha, plantel y volumen, y{" "}
        <strong>opcionalmente</strong> planta si el archivo trae el detalle por planta
        dosificadora. Un{" "}
        <code>.xlsx</code> no se lee directamente: guárdalo como CSV desde Excel (la
        plantilla de abajo se abre en columnas en cualquier configuración).
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Archivo CSV</span>
          {/* El `<input type="file">` nativo se pierde entre los controles estilados (se
              ve como un "Seleccionar archivo" gris y nadie lo encuentra). Se oculta y se
              dispara desde un botón de verdad. */}
          <input
            ref={archivo}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void leer(f);
            }}
          />
          <button
            type="button"
            onClick={() => archivo.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent/5 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10"
          >
            <Upload size={15} /> {nombreArchivo ? "Cambiar archivo" : "Elegir archivo…"}
          </button>
        </div>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Granularidad</span>
          <select
            value={granularidad}
            onChange={(e) => {
              setGranularidad(e.target.value);
              setPrevia(null);
            }}
            className="rounded border border-border bg-surface px-2 py-1 text-sm"
          >
            {GRANULARIDADES_HISTORICAS.map((g) => (
              <option key={g.valor} value={g.valor}>
                {g.etiqueta}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-[14rem] flex-1 text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">
            Observaciones (queda en cada fila)
          </span>
          <input
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Ej. cargado del Excel de producción 2025"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>

        <button
          onClick={plantilla}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-ink"
        >
          <Download size={15} /> Descargar plantilla
        </button>
      </div>

      <p className="mt-2 text-xs text-muted">
        {GRANULARIDADES_HISTORICAS.find((g) => g.valor === granularidad)?.ayuda}
      </p>

      {nombreArchivo && (
        <p className="mt-2 text-xs text-ink">
          Archivo cargado: <strong className="font-semibold">{nombreArchivo}</strong>
          {filasArchivo > 0 && <span className="text-muted"> · {filasArchivo} filas</span>}
        </p>
      )}

      {encabezados.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted">
            Columnas del archivo (elige cuál corresponde a cada campo)
          </p>
          <div className="flex flex-wrap gap-3">
            {(["fecha", "plantel", "volumen", "planta"] as const).map((campo) => (
              <label key={campo} className="text-sm">
                <span className="mb-1 block text-xs text-muted capitalize">
                  {campo}
                  {campo === "planta" && (
                    <span className="normal-case"> (opcional)</span>
                  )}
                </span>
                <select
                  value={mapeo[campo]}
                  onChange={(e) => {
                    setMapeo({ ...mapeo, [campo]: e.target.value });
                    setPrevia(null);
                  }}
                  className="rounded border border-border bg-surface px-2 py-1 text-sm"
                >
                  {/* Sin columna de planta, cada fila del archivo es el TOTAL del
                      plantel. Es el caso normal de los archivos viejos. */}
                  {campo === "planta" && <option value="">— sin detalle por planta —</option>}
                  {encabezados.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {mapeo.planta && (
            <p className="mt-2 text-xs text-warn">
              El archivo se va a cargar con detalle POR PLANTA. Para una misma fecha no se
              puede tener el total del plantel y el de sus plantas: sería contar el mismo
              volumen dos veces.
            </p>
          )}

        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PrimaryButton
          onClick={() =>
            iniciar(async () => {
              const r = await previsualizarHistoricaAction(texto, granularidad, mapeo);
              setPrevia(r);
              if (!r.ok) onMensaje(r.mensaje ?? "No se pudo leer el archivo.");
            })
          }
          disabled={pendiente || !texto}
        >
          Previsualizar
        </PrimaryButton>
        {!texto && (
          <span className="text-xs text-muted">Primero elige un archivo CSV.</span>
        )}
      </div>

      {/* Planteles del archivo que el sistema no reconoce: se vinculan y se recuerdan. */}
      {sinVincular.length > 0 && (
        <div className="mt-4 rounded-lg border border-warn/40 bg-warn/5 p-3">
          <p className="mb-2 text-sm font-medium text-ink">
            Estos nombres del archivo no corresponden a ningún plantel
          </p>
          <p className="mb-2 text-xs text-muted">
            Vincúlalos y el sistema los recordará para las próximas importaciones. Las filas
            de un nombre sin vincular no se importan.
          </p>
          {sinVincular.map((alias) => (
            <div key={alias} className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="min-w-[8rem] text-sm font-medium text-ink">{alias}</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (!id) return;
                  iniciar(async () => {
                    const r = await vincularAliasAction(alias, id);
                    if (r.ok) {
                      const p = await previsualizarHistoricaAction(texto, granularidad, mapeo);
                      setPrevia(p);
                    } else onMensaje(r.mensaje ?? "No se pudo vincular.");
                  });
                }}
                className="rounded border border-border bg-surface px-2 py-1 text-sm"
              >
                <option value="">Elegir plantel…</option>
                {planteles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Las plantas NO tienen tabla de alias como los planteles: son pocas y con codigo
          propio (STALO, SANY), asi que se corrige el archivo o se da de alta la planta. */}
      {plantasRaras.length > 0 && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger/5 p-3">
          <p className="mb-1 text-sm font-medium text-ink">
            Estos nombres de planta no existen en el plantel indicado
          </p>
          <p className="text-xs text-muted">
            {plantasRaras.join(" · ")}. Corrige el nombre en el archivo (debe coincidir con el
            de la planta en Administración › Plantas) o deja esa columna sin asignar para
            cargar el total del plantel. Esas filas no se importan.
          </p>
        </div>
      )}

      {previa?.ok && previa.resumen && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-sm text-ink">
            <strong>{previa.resumen.crear}</strong> se crearían ·{" "}
            <strong>{previa.resumen.actualizar}</strong> actualizarían un dato ya cargado ·{" "}
            <strong>{previa.resumen.choca}</strong> chocan con datos del sistema ·{" "}
            <strong>{previa.resumen.error}</strong> con problemas
            {previa.resumen.vacias > 0 && (
              <>
                {" · "}
                <strong>{previa.resumen.vacias}</strong> sin volumen (no se cargan: una celda
                en blanco no es un 0)
              </>
            )}
          </p>
          <TablaPrevia filas={previa.filas ?? []} />
          <div className="mt-3">
            <PrimaryButton
              disabled={pendiente || previa.resumen.crear + previa.resumen.actualizar + previa.resumen.choca === 0}
              onClick={() =>
                iniciar(async () => {
                  const r = await importarHistoricaAction(texto, granularidad, mapeo, observaciones);
                  if (r.ok) {
                    onMensaje(
                      `Importación lista: ${r.creadas} creadas, ${r.actualizadas} actualizadas, ${r.omitidas} omitidas.`,
                    );
                    location.reload();
                  } else onMensaje(r.mensaje ?? "No se pudo importar.");
                })
              }
            >
              Confirmar importación
            </PrimaryButton>
          </div>
        </div>
      )}
    </Card>
  );
}

function TablaPrevia({ filas }: { filas: FilaPrevia[] }) {
  const muestra = useMemo(() => filas.slice(0, 40), [filas]);
  const tono: Record<string, string> = {
    crear: "text-ok",
    actualizar: "text-accent",
    choca: "text-warn",
    vacia: "text-muted",
    error: "text-danger",
  };
  return (
    <div className="max-h-72 overflow-auto rounded border border-border">
      <table className="w-full min-w-[620px] text-xs">
        <thead className="sticky top-0 bg-content">
          <tr className="text-left text-muted">
            <th className="px-2 py-1.5">Línea</th>
            <th className="px-2 py-1.5">Fecha</th>
            <th className="px-2 py-1.5">Plantel</th>
            <th className="px-2 py-1.5">Planta</th>
            <th className="px-2 py-1.5 text-right">m³</th>
            <th className="px-2 py-1.5">Qué pasaría</th>
          </tr>
        </thead>
        <tbody>
          {muestra.map((f) => (
            <tr key={f.linea} className="border-t border-border/60">
              <td className="px-2 py-1 tabular-nums text-muted">{f.linea}</td>
              <td className="px-2 py-1 tabular-nums text-ink">{f.fechaIso}</td>
              <td className="px-2 py-1 text-ink">{f.plantelTexto}</td>
              <td className="px-2 py-1 text-muted">{f.plantaTexto ?? "—"}</td>
              <td className="px-2 py-1 text-right tabular-nums text-ink">
                {f.volumen?.toFixed(2) ?? "—"}
              </td>
              <td className={`px-2 py-1 ${tono[f.accion] ?? ""}`}>
                {f.accion}
                {f.motivo && <span className="text-muted"> — {f.motivo}</span>}
              </td>
            </tr>
          ))}
          {filas.length > muestra.length && (
            <tr>
              <td colSpan={6} className="px-2 py-1.5 text-center text-muted">
                … y {filas.length - muestra.length} filas más
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Captura manual ────────────────────────────────────────────────────────────
function Manual({
  planteles,
  onMensaje,
}: {
  planteles: PlantelOpc[];
  onMensaje: (m: string) => void;
}) {
  const [fecha, setFecha] = useState("");
  const [plantelId, setPlantelId] = useState(String(planteles[0]?.id ?? ""));
  // "" = el volumen es del PLANTEL completo. Elegir una planta carga solo su detalle.
  const [plantaId, setPlantaId] = useState("");
  const [volumen, setVolumen] = useState("");
  const [granularidad, setGranularidad] = useState("Diaria");
  const [observaciones, setObservaciones] = useState("");
  const [pendiente, iniciar] = useTransition();

  // Derivado, no un estado aparte: así no hace falta un efecto que lo sincronice cuando
  // cambia el plantel (el patrón `setState` dentro de `useEffect` que este repo evita).
  const plantasDelPlantel = planteles.find((p) => String(p.id) === plantelId)?.plantas ?? [];

  const guardar = () =>
    iniciar(async () => {
      const entrada = {
        fechaIso: fecha,
        plantelId: Number(plantelId),
        plantaId: plantaId ? Number(plantaId) : null,
        volumen: Number(volumen.replace(",", ".")),
        granularidad,
        observaciones,
      };
      // Se AVISA antes de guardar si el sistema ya tiene datos de ese periodo: la fila
      // quedaría archivada sin graficarse, y el usuario decide.
      const chequeo = await verificarChoqueAction(entrada);
      if (chequeo.ok && chequeo.choca) {
        const seguir = confirm(
          "El sistema ya tiene viajes completados de ese periodo y plantel.\n\n" +
            "Si guardas este dato, quedará archivado pero NO se va a graficar: el sistema " +
            "tiene precedencia y sumar las dos fuentes duplicaría el volumen.\n\n" +
            "¿Guardarlo igual?",
        );
        if (!seguir) return;
      }
      const r = await guardarHistoricaAction(entrada);
      if (r.ok) {
        onMensaje("Carga guardada.");
        setVolumen("");
        location.reload();
      } else onMensaje(r.mensaje ?? "No se pudo guardar.");
    });

  return (
    <Card className="p-5">
      <h3 className="mb-1 text-base font-semibold text-ink">Captura manual</h3>
      <p className="mb-3 text-xs text-muted">
        Para corregir o agregar un valor puntual sin rearmar un archivo. Con granularidad
        Mensual, la fecha se ancla al día 1 del mes. El volumen puede ser el{" "}
        <strong>total del plantel</strong> o el de una <strong>planta</strong>; en una misma
        fecha no se pueden cargar los dos (sería contar el mismo volumen dos veces).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Plantel</span>
          <select
            value={plantelId}
            onChange={(e) => {
              setPlantelId(e.target.value);
              // Las plantas son de UN plantel: al cambiar de plantel la elección anterior
              // ya no aplica (el servidor lo rechaza, pero no hay que ofrecerlo siquiera).
              setPlantaId("");
            }}
            className="rounded border border-border bg-surface px-2 py-1 text-sm"
          >
            {planteles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        {plantasDelPlantel.length > 0 && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Planta</span>
            <select
              value={plantaId}
              onChange={(e) => setPlantaId(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-sm"
            >
              <option value="">Todo el plantel</option>
              {plantasDelPlantel.map((pa) => (
                <option key={pa.id} value={pa.id}>
                  {pa.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Volumen (m³)</span>
          <input
            value={volumen}
            onChange={(e) => setVolumen(e.target.value)}
            inputMode="decimal"
            className="w-28 rounded border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Granularidad</span>
          <select
            value={granularidad}
            onChange={(e) => setGranularidad(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-sm"
          >
            {GRANULARIDADES_HISTORICAS.map((g) => (
              <option key={g.valor} value={g.valor}>
                {g.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[12rem] flex-1 text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Observaciones</span>
          <input
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <PrimaryButton onClick={guardar} disabled={pendiente || !fecha || !volumen || !plantelId}>
          Guardar
        </PrimaryButton>
      </div>
    </Card>
  );
}
