"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  analizarFrecuenciaAction,
  crearPedidoAction,
  modificarPedidoAction,
  sugerirHoraSolicitadaAction,
  type EstadoFormulario,
} from "./actions";
import { Badge, PrimaryButton } from "./components/ui";
import { BotonesMapa } from "./components/maps-buttons";
import { REVENIMIENTOS, TIPOS_SERVICIO, disenoAplicaTipoServicio } from "@/lib/revenimiento";

interface Opcion {
  id: number;
  etiqueta: string;
}
/** Diseño de mezcla con su código, para filtrar por tipo de servicio. */
export interface DisenoOpcion extends Opcion {
  codigo: string;
}
/** Cliente con su asesor comercial dueño (para precargar el asesor del pedido),
 * su tiempo de transporte de referencia (para precargarlo en el pedido) y su
 * ubicación (para que el Programador la vea antes de programar). */
export interface ClienteOpcion extends Opcion {
  asesorId: number | null;
  transporteMin: number | null;
  googleMapsUrl: string | null;
  latitud: number | null;
  longitud: number | null;
}
interface PlantelOpcion {
  id: number;
  nombre: string;
  zona: string;
  hubId: number | null; // hub de zona (para ofrecer bombas en préstamo)
  plantas: Opcion[];
}
interface BombaOpcion {
  id: number;
  etiqueta: string;
  plantelId: number | null;
}

/** Valores iniciales para modo edición (prellenan el formulario). */
export interface ValoresPedido {
  cliente_id: number;
  diseno_id: number;
  plantel_id: number;
  planta_id: number;
  volumen_total_m3: number;
  hora_local: string; // "YYYY-MM-DDTHH:mm" para el input datetime-local
  tipo_descarga: string;
  revenimiento: string | null;
  tipo_servicio: string | null;
  sacos_hielo_por_m3: number;
  bomba_id: number | null;
  asesor_id: number | null;
  hora_bloqueada: boolean;
  usar_ambas_plantas: boolean;
  carga_simultanea: boolean;
  carga_reducida: boolean;
  frecuencia_entre_camiones_min: number | null;
  tiempo_transporte_min: number | null;
  elemento: string | null;
  observaciones: string | null;
}

/** Pre-llenado para modo CREACIÓN (p. ej. al convertir una solicitud anticipada). */
export interface PresetPedido {
  cliente_id?: number;
  diseno_id?: number; // diseño sugerido (el Programador confirma o cambia)
  plantel_id?: number | null; // planta sugerida por el asesor (editable)
  volumen_total_m3?: number;
  sacos_hielo_por_m3?: number | null;
  elemento?: string | null;
  tipo_descarga?: string;
  frecuencia_entre_camiones_min?: number | null;
  hora_local?: string; // "YYYY-MM-DDTHH:mm"
  solicitud_id?: number; // vincula el pedido a la solicitud al guardar
  // Datos que el asesor escribió en el Programa Semana (solo lectura, informativos
  // para que el Programador elija el diseño correcto). No se guardan en el pedido.
  tipoConcretoAsesor?: string;
  revenimientoAsesor?: string;
  tipoServicioAsesor?: string;
}

const estadoInicial: EstadoFormulario = { ok: false };

export function PedidoForm({
  clientes,
  disenos,
  planteles,
  bombas,
  asesores,
  plantelInicial,
  fechaInicial,
  pedidoId,
  valores,
  preset,
  esAdicion = false,
  esAdmin = false,
  aislado = false,
  onExito,
}: {
  clientes: ClienteOpcion[];
  disenos: DisenoOpcion[];
  planteles: PlantelOpcion[];
  bombas: BombaOpcion[];
  asesores: Opcion[];
  plantelInicial?: number;
  fechaInicial?: string; // "YYYY-MM-DD" (fecha del filtro). El campo sigue editable.
  pedidoId?: number; // si viene, el formulario está en modo EDICIÓN
  valores?: ValoresPedido; // valores iniciales para edición
  preset?: PresetPedido; // pre-llenado en creación (convertir solicitud)
  // true = el pedido se crea desde Despacho en vivo como ADICIÓN (fuera del
  // programa/DPCR-08). Cambia la etiqueta del botón y marca el pedido.
  esAdicion?: boolean;
  // Solo el Admin puede ingresar volúmenes que NO sean múltiplos de 0.5 m³ (step
  // libre); los demás roles quedan con paso 0.5. Se refuerza en el servidor.
  esAdmin?: boolean;
  // true = la edición viene del Modo Manual: el motor re-agenda SOLO este pedido y no
  // le mueve el horario a ningún otro cliente (los choques se avisan, no se corrigen).
  aislado?: boolean;
  onExito?: () => void;
}) {
  const esEdicion = pedidoId != null;
  // En edición se enlaza el pedidoId a la server action de modificar.
  const accion = useMemo(
    () =>
      esEdicion
        ? modificarPedidoAction.bind(null, pedidoId!)
        : crearPedidoAction,
    [esEdicion, pedidoId],
  );

  const [estado, formAction, pendiente] = useActionState(accion, estadoInicial);

  // Agregar un cliente ya NO reprograma a los que estaban, así que no hay
  // confirmación de impacto que pedir: si el pedido nuevo se encima con otro, el
  // servidor lo guarda igual y devuelve el choque en `resultado.avisosChoque`.
  const formRef = useRef<HTMLFormElement>(null);

  // Cliente y asesor son controlados: al elegir cliente se PRECARGA su asesor
  // dueño, pero el usuario puede cambiarlo (no es de solo lectura).
  const clienteInicial =
    valores?.cliente_id ?? preset?.cliente_id ?? clientes[0]?.id ?? 0;
  const [clienteId, setClienteId] = useState<number>(clienteInicial);
  const [asesorId, setAsesorId] = useState<string>(
    valores?.asesor_id != null
      ? String(valores.asesor_id)
      : clientes.find((c) => c.id === clienteInicial)?.asesorId != null
        ? String(clientes.find((c) => c.id === clienteInicial)!.asesorId)
        : "",
  );
  // Tiempo de transporte (min): se PRECARGA del cliente (su tiempo de referencia)
  // pero el Programador puede ajustarlo por pedido. En edición manda el override
  // ya guardado; si no hay, cae al del cliente.
  const [transporte, setTransporte] = useState<string>(() => {
    const inicial =
      valores?.tiempo_transporte_min ??
      clientes.find((c) => c.id === clienteInicial)?.transporteMin ??
      null;
    return inicial != null ? String(inicial) : "";
  });

  // Cliente seleccionado (para mostrar su ubicación antes de programar).
  const clienteSel = clientes.find((c) => c.id === clienteId);

  const [plantelId, setPlantelId] = useState<number>(
    valores?.plantel_id ?? preset?.plantel_id ?? plantelInicial ?? planteles[0]?.id ?? 0,
  );
  const [tipoDescarga, setTipoDescarga] = useState(
    valores?.tipo_descarga ?? preset?.tipo_descarga ?? "Canal directo",
  );
  const [bombaId, setBombaId] = useState(
    valores?.bomba_id != null ? String(valores.bomba_id) : "",
  );
  const bombaHabilitada = tipoDescarga !== "Canal directo"; // cualquier bomba

  const plantasDelPlantel = useMemo(
    () => planteles.find((p) => p.id === plantelId)?.plantas ?? [],
    [planteles, plantelId],
  );

  // Planta, volumen y hora son controlados: la hora se AUTOCOMPLETA con la próxima
  // disponible de la planta ese día (sugerencia editable), no se hereda el estimado.
  const [plantaId, setPlantaId] = useState<number>(
    valores?.planta_id ??
      planteles.find((p) => p.id === plantelId)?.plantas[0]?.id ??
      0,
  );
  const [volumen, setVolumen] = useState<string>(
    String(valores?.volumen_total_m3 ?? preset?.volumen_total_m3 ?? 10),
  );
  const [horaLocal, setHoraLocal] = useState<string>(
    valores?.hora_local ??
      preset?.hora_local ??
      (fechaInicial ? `${fechaInicial}T07:00` : ""),
  );
  // Hora de llegada FIJA (excepción): no autocompletar ni reprogramar.
  const [bloqueada, setBloqueada] = useState<boolean>(valores?.hora_bloqueada ?? false);
  // Cargar en ambas plantas (solo aplica a planteles de 2 plantas).
  const [usarAmbas, setUsarAmbas] = useState<boolean>(valores?.usar_ambas_plantas ?? false);
  // Carga SIMULTÁNEA: sub-opción de "ambas plantas" (forzar arranque a la vez).
  const [simultanea, setSimultanea] = useState<boolean>(valores?.carga_simultanea ?? false);
  // Carga REDUCIDA: acceso difícil / pendiente (usa capacidad efectiva).
  const [reducida, setReducida] = useState<boolean>(valores?.carga_reducida ?? false);
  // Frecuencia entre camiones (min): controlada para poder analizar si es alcanzable
  // con la flota real antes de confirmar (advertencia NO bloqueante).
  const [frecuencia, setFrecuencia] = useState<string>(() => {
    const inicial =
      valores?.frecuencia_entre_camiones_min ??
      preset?.frecuencia_entre_camiones_min ??
      null;
    return inicial != null ? String(inicial) : "";
  });
  const [analisisFreq, setAnalisisFreq] = useState<
    Awaited<ReturnType<typeof analizarFrecuenciaAction>> | null
  >(null);
  const fechaBase = horaLocal.slice(0, 10);

  // Tipo de servicio (Normal / Servicio de Construcción): lo precarga la solicitud
  // del asesor y FILTRA el catálogo de diseños de mezcla. Editable por el Programador.
  const [tipoServicio, setTipoServicio] = useState<string>(
    valores?.tipo_servicio ?? preset?.tipoServicioAsesor ?? "",
  );
  const disenosFiltrados = useMemo(
    () => disenos.filter((d) => disenoAplicaTipoServicio(d.codigo, tipoServicio)),
    [disenos, tipoServicio],
  );
  // Diseño controlado: si el filtro por tipo de servicio deja fuera el actual, se
  // reajusta al primero permitido (o 0 si no hay ninguno que cumpla el filtro).
  const [disenoId, setDisenoId] = useState<number>(
    valores?.diseno_id ?? preset?.diseno_id ?? disenos[0]?.id ?? 0,
  );
  useEffect(() => {
    if (!disenosFiltrados.some((d) => d.id === disenoId)) {
      setDisenoId(disenosFiltrados[0]?.id ?? 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoServicio]);

  // Bombas ordenadas por prioridad de hub: propias del plantel (o compartidas)
  // primero, luego las del HUB (préstamo), luego las de otro plantel (refuerzo
  // excepcional). Se etiquetan para que el préstamo/refuerzo sea una elección
  // consciente. Así un plantel dependiente sin bomba propia igual puede elegir una.
  const hubIdSel = planteles.find((p) => p.id === plantelId)?.hubId ?? null;
  const bombasDisponibles = useMemo(() => {
    const clasif = (b: BombaOpcion) => {
      if (b.plantelId === plantelId || b.plantelId === null) return { rank: 0, sufijo: "" };
      if (hubIdSel != null && hubIdSel !== plantelId && b.plantelId === hubIdSel)
        return { rank: 1, sufijo: " (préstamo del hub)" };
      return { rank: 2, sufijo: " (refuerzo — otro plantel)" };
    };
    return bombas
      .map((b) => ({ b, c: clasif(b) }))
      .sort((x, y) => x.c.rank - y.c.rank || x.b.id - y.b.id)
      .map(({ b, c }) => ({ ...b, etiqueta: b.etiqueta + c.sufijo }));
  }, [bombas, plantelId, hubIdSel]);

  // Al cambiar de plantel, si la planta actual ya no pertenece, tomar la primera.
  useEffect(() => {
    if (!plantasDelPlantel.some((pl) => pl.id === plantaId)) {
      setPlantaId(plantasDelPlantel[0]?.id ?? 0);
    }
    // "Ambas plantas" (y su simultaneidad) solo aplica con 2+ plantas; en 1 se apaga.
    if (plantasDelPlantel.length < 2) {
      if (usarAmbas) setUsarAmbas(false);
      if (simultanea) setSimultanea(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantelId]);

  // Autocompletar la hora de LLEGADA con la próxima disponible de la planta ese
  // día (solo al crear/convertir; en edición se respeta la hora existente).
  useEffect(() => {
    if (esEdicion || bloqueada || !plantaId || !fechaBase) return;
    let cancelado = false;
    (async () => {
      const res = await sugerirHoraSolicitadaAction(
        plantaId,
        fechaBase,
        Number(volumen) || 0,
        clienteId || undefined,
      );
      if (!cancelado && res.ok && res.horaLocal) setHoraLocal(res.horaLocal);
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantaId, fechaBase, esEdicion, volumen, clienteId, bloqueada]);

  // Analizar si la frecuencia entre camiones es alcanzable con la flota REAL del
  // día (advertencia NO bloqueante). Solo cuando hay volumen + planta + frecuencia.
  // Se hace con un pequeño retraso (debounce) para no llamar en cada tecla.
  useEffect(() => {
    const freqNum = Number(frecuencia);
    const volNum = Number(volumen);
    if (!plantelId || !plantaId || !(volNum > 0) || !(freqNum > 0)) {
      setAnalisisFreq(null);
      return;
    }
    let cancelado = false;
    const t = setTimeout(async () => {
      const res = await analizarFrecuenciaAction({
        plantelId,
        plantaId,
        volumenTotal: volNum,
        frecuenciaMin: freqNum,
        tipoDescarga,
        transporteMin: transporte !== "" ? Number(transporte) : null,
        clienteId: clienteId || null,
        usarAmbasPlantas: usarAmbas,
        cargaReducida: reducida,
        fechaISO: fechaBase || undefined,
      });
      if (!cancelado) setAnalisisFreq(res.ok ? res : null);
    }, 450);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    frecuencia,
    volumen,
    plantelId,
    plantaId,
    tipoDescarga,
    transporte,
    clienteId,
    usarAmbas,
    reducida,
    fechaBase,
  ]);

  // Al programar con éxito, avisar al contenedor (refrescar la tabla).
  useEffect(() => {
    if (estado.ok && estado.resultado) onExito?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {preset?.solicitud_id != null && (
          <input type="hidden" name="solicitud_id" value={preset.solicitud_id} />
        )}
        {esAdicion && <input type="hidden" name="es_adicion" value="1" />}
        {/* Edición desde el Modo Manual: re-agendar solo este pedido. */}
        {aislado && <input type="hidden" name="aislado" value="1" />}
        <Campo label="Cliente">
          <select
            name="cliente_id"
            className={inputCls}
            value={clienteId}
            onChange={(e) => {
              const nuevo = Number(e.target.value);
              setClienteId(nuevo);
              const cli = clientes.find((c) => c.id === nuevo);
              // Precargar el asesor dueño del cliente (editable después).
              const a = cli?.asesorId ?? null;
              setAsesorId(a != null ? String(a) : "");
              // Precargar el tiempo de transporte de referencia del cliente.
              setTransporte(cli?.transporteMin != null ? String(cli.transporteMin) : "");
            }}
            required
          >
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </Campo>

        <Campo label="Asesor">
          <select
            name="asesor_id"
            className={inputCls}
            value={asesorId}
            onChange={(e) => setAsesorId(e.target.value)}
          >
            <option value="">Sin asesor</option>
            {asesores.map((a) => (
              <option key={a.id} value={a.id}>
                {a.etiqueta}
              </option>
            ))}
          </select>
        </Campo>

        {/* Ubicación del proyecto del cliente elegido (para verla antes de programar). */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-content/40 px-3 py-2 text-sm sm:col-span-2">
          <span className="font-medium text-ink">Ubicación del proyecto:</span>
          <BotonesMapa
            ubicacion={{
              googleMapsUrl: clienteSel?.googleMapsUrl,
              latitud: clienteSel?.latitud,
              longitud: clienteSel?.longitud,
            }}
          />
        </div>

        {/* Lo que el asesor escribió en el Programa Semana (solo lectura): guía para
            elegir el diseño y confirmar el revenimiento. Solo aparece al convertir. */}
        {(preset?.tipoConcretoAsesor || preset?.revenimientoAsesor || preset?.tipoServicioAsesor) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm sm:col-span-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
              Lo que indicó el asesor (referencia)
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-amber-900">
              <span>
                Concreto: <strong>{preset.tipoConcretoAsesor || "—"}</strong>
              </span>
              <span>
                Revenimiento: <strong>{preset.revenimientoAsesor || "—"}</strong>
              </span>
              <span>
                Tipo de servicio: <strong>{preset.tipoServicioAsesor || "—"}</strong>
              </span>
            </div>
          </div>
        )}

        <Campo label="Tipo de servicio">
          <select
            name="tipo_servicio"
            className={inputCls}
            value={tipoServicio}
            onChange={(e) => setTipoServicio(e.target.value)}
          >
            <option value="">Sin especificar (todos los diseños)</option>
            {TIPOS_SERVICIO.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Campo>

        <Campo label="Diseño de mezcla">
          {disenosFiltrados.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              No hay diseños de mezcla para el tipo de servicio{" "}
              <strong>{tipoServicio}</strong>. Cambia el tipo de servicio o crea el
              diseño correspondiente en Administración › Diseños de mezcla.
            </div>
          ) : (
            <select
              name="diseno_id"
              className={inputCls}
              value={disenoId}
              onChange={(e) => setDisenoId(Number(e.target.value))}
              required
            >
              {disenosFiltrados.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.etiqueta}
                </option>
              ))}
            </select>
          )}
        </Campo>

        <Campo label="Revenimiento">
          <select
            name="revenimiento"
            className={inputCls}
            defaultValue={valores?.revenimiento ?? preset?.revenimientoAsesor ?? ""}
          >
            <option value="">Sin especificar</option>
            {REVENIMIENTOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Campo>

        <Campo label="Plantel">
          <select
            name="plantel_id"
            className={inputCls}
            value={plantelId}
            onChange={(e) => setPlantelId(Number(e.target.value))}
            required
          >
            {planteles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} ({p.zona})
              </option>
            ))}
          </select>
        </Campo>

        <Campo label={usarAmbas ? "Planta (principal)" : "Planta"}>
          <select
            name="planta_id"
            className={inputCls}
            value={plantaId}
            onChange={(e) => setPlantaId(Number(e.target.value))}
            required
          >
            {plantasDelPlantel.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.etiqueta}
              </option>
            ))}
          </select>
          {/* Solo en planteles de 2 plantas: elegir carga en una o en ambas. */}
          {plantasDelPlantel.length >= 2 && (
            <>
              <label className="mt-1 flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  name="usar_ambas_plantas"
                  value="1"
                  checked={usarAmbas}
                  onChange={(e) => {
                    setUsarAmbas(e.target.checked);
                    if (!e.target.checked) setSimultanea(false); // simultánea depende de ambas
                  }}
                  className="mt-0.5 h-3.5 w-3.5 accent-accent"
                />
                <span>
                  Cargar en <strong>ambas plantas</strong> (reparte los viajes entre las
                  2 para acelerar la entrega). Sin marcar, todo carga en la planta elegida.
                </span>
              </label>
              {/* Sub-opción: forzar arranque a la MISMA hora en ambas plantas. */}
              {usarAmbas && (
                <label className="ml-5 mt-1 flex items-start gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    name="carga_simultanea"
                    value="1"
                    checked={simultanea}
                    onChange={(e) => setSimultanea(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-accent"
                  />
                  <span>
                    Carga <strong>simultánea</strong>: forzar que ambas plantas arranquen
                    a la misma hora (máximo paralelismo), no solo repartir por hueco libre.
                  </span>
                </label>
              )}
            </>
          )}
        </Campo>

        <Campo label="Volumen total (m³)">
          <input
            type="number"
            name="volumen_total_m3"
            min="0.5"
            // Admin: cualquier volumen (p. ej. 6.7). Otros roles: múltiplos de 0.5.
            step={esAdmin ? "any" : "0.5"}
            value={volumen}
            onChange={(e) => setVolumen(e.target.value)}
            className={inputCls}
            required
          />
          {esAdmin && (
            <span className="mt-1 block text-[11px] text-muted">
              Como Administrador puedes ingresar cualquier volumen (no solo múltiplos de 0.5).
            </span>
          )}
          {/* Carga reducida por pendiente/acceso difícil: el motor usa la capacidad
              efectiva (config en Administración) en vez de la nominal. */}
          <label className="mt-1 flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              name="carga_reducida"
              value="1"
              checked={reducida}
              onChange={(e) => setReducida(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-accent"
            />
            <span>
              <strong>Carga reducida</strong> (pendiente / acceso difícil): los mixers no
              cargan al 100%; el motor usa la capacidad efectiva reducida.
            </span>
          </label>
        </Campo>

        <Campo label="Fecha y hora de llegada al proyecto">
          <input
            type="datetime-local"
            name="hora_solicitada"
            // Autocompletada con la próxima hora disponible de la planta; editable.
            value={horaLocal}
            onChange={(e) => setHoraLocal(e.target.value)}
            className={inputCls}
            required
          />
          <label className="mt-1 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              name="hora_bloqueada"
              value="1"
              checked={bloqueada}
              onChange={(e) => setBloqueada(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            Hora de llegada fija (no reprogramar automáticamente)
          </label>
        </Campo>

        <Campo label="Hielo (sacos)">
          <input
            type="number"
            name="sacos_hielo_por_m3"
            min="0"
            max="10"
            step="1"
            defaultValue={valores?.sacos_hielo_por_m3 ?? preset?.sacos_hielo_por_m3 ?? 0}
            className={inputCls}
          />
        </Campo>

        <Campo label="Tipo de descarga">
          <select
            name="tipo_descarga"
            className={inputCls}
            value={tipoDescarga}
            onChange={(e) => {
              setTipoDescarga(e.target.value);
              // La bomba solo aplica a descarga por bomba: al cambiar a canal,
              // se limpia la selección para no enviar una bomba inválida.
              if (e.target.value === "Canal directo") setBombaId("");
            }}
            required
          >
            <option value="Canal directo">Canal directo</option>
            <option value="Bomba estacionaria">Bomba estacionaria</option>
            <option value="Bomba pluma">Bomba pluma</option>
          </select>
        </Campo>

        <Campo label="Bomba (opcional)">
          <select
            name="bomba_id"
            className={`${inputCls} disabled:cursor-not-allowed disabled:bg-content disabled:text-muted`}
            value={bombaId}
            onChange={(e) => setBombaId(e.target.value)}
            disabled={!bombaHabilitada}
          >
            <option value="">Sin bomba</option>
            {bombasDisponibles.map((b) => (
              <option key={b.id} value={b.id}>
                {b.etiqueta}
              </option>
            ))}
          </select>
          {!bombaHabilitada && (
            <span className="text-xs text-muted">
              Disponible solo con descarga por bomba.
            </span>
          )}
        </Campo>

        <Campo label="Frecuencia entre camiones (min)">
          <input
            type="number"
            name="frecuencia_entre_camiones_min"
            min="0"
            step="1"
            placeholder="Opcional (según acceso del sitio)"
            value={frecuencia}
            onChange={(e) => setFrecuencia(e.target.value)}
            className={inputCls}
          />
        </Campo>

        <Campo label="Tiempo de transporte (min)">
          <input
            type="number"
            name="tiempo_transporte_min"
            min="0"
            step="1"
            value={transporte}
            onChange={(e) => setTransporte(e.target.value)}
            placeholder="Precargado del cliente"
            className={inputCls}
          />
          <span className="text-xs text-muted">
            Tiempo de ida (el regreso se asume igual). Editable para este pedido.
          </span>
        </Campo>

        <Campo label="Elemento estructural">
          <input
            name="elemento"
            className={inputCls}
            defaultValue={valores?.elemento ?? preset?.elemento ?? ""}
            placeholder="Ej. Losa, columna, zapata"
          />
        </Campo>

        <Campo label="Observaciones">
          <input
            name="observaciones"
            className={inputCls}
            defaultValue={valores?.observaciones ?? ""}
            placeholder="Opcional — se ven en Despacho en vivo y en el Programa DPCR-08"
          />
        </Campo>

        <div className="flex items-end sm:col-span-2">
          <PrimaryButton type="submit" disabled={pendiente} conMas={!esEdicion}>
            {esEdicion
              ? pendiente
                ? "Guardando…"
                : "Guardar cambios"
              : esAdicion
                ? pendiente
                  ? "Adicionando…"
                  : "Adicionar pedido"
                : pendiente
                  ? "Programando…"
                  : "Programar pedido"}
          </PrimaryButton>
        </div>
      </form>

      {analisisFreq && analisisFreq.ok && <AvisoFrecuencia a={analisisFreq} />}

      {estado.mensaje && !estado.ok && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.mensaje}
        </p>
      )}

      {estado.ok && estado.resultado && <ResultadoPanel r={estado.resultado} />}
    </div>
  );
}

function ResultadoPanel({
  r,
}: {
  r: NonNullable<EstadoFormulario["resultado"]>;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-content p-4">
      <h3 className="font-semibold text-ink">
        Pedido #{r.pedidoId} programado — {r.viajes.length} viaje(s)
      </h3>

      {r.volumenSinCubrir > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠️ Quedan <strong>{r.volumenSinCubrir} m³</strong> sin cubrir con flota
          propia + préstamo de zona. Revisa las sugerencias de refuerzo.
        </p>
      )}

      {!!r.avisosChoque?.length && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">
            ⚠️ Este cliente se encima con otro que ya estaba programado
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {r.avisosChoque.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-amber-700">
            No se movió a nadie: los clientes ya programados conservan su horario. Si
            quieres separarlos, edita la hora de llegada o cambia de planta.
          </p>
        </div>
      )}

      {r.avisoSimultaneidad && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠️ No se pudo arrancar en simultáneo: <strong>{r.avisoSimultaneidad.plantaTarde}</strong>{" "}
          empieza ~<strong>{r.avisoSimultaneidad.minutosDiferencia} min</strong> más tarde
          (estaba ocupada). Puedes esperar a que se libere o continuar así.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2">Viaje</th>
              <th className="pr-2">Mixer</th>
              <th className="pr-2">Cap.</th>
              <th className="pr-2">Volumen</th>
              <th className="pr-2">Flota</th>
              <th className="pr-2">Carga</th>
              <th>Regreso</th>
            </tr>
          </thead>
          <tbody>
            {r.viajes.map((v) => (
              <tr key={v.id} className="border-b border-border/60">
                <td className="py-1 pr-2">#{v.id}</td>
                <td className="pr-2">{v.mixerLabel ?? "—"}</td>
                <td className="pr-2">{v.capacidad || "—"}</td>
                <td className="pr-2">{v.volumen} m³</td>
                <td className="pr-2">
                  {v.flota ? (
                    <Badge tono={v.flotaPropia ? "neutro" : "info"}>
                      Flota {v.flota}
                    </Badge>
                  ) : (
                    <Badge tono="danger">Sin cubrir</Badge>
                  )}
                  {v.rutaPorDefecto && (
                    <span className="ml-1 text-xs text-amber-600" title="Cliente sin ruta registrada: tiempos por defecto">
                      · ruta por defecto
                    </span>
                  )}
                </td>
                <td className="pr-2">{v.horaCarga ?? "—"}</td>
                <td>{v.horaRegreso ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {r.sugerencias.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-ink">
            Sugerencias de refuerzo (requieren confirmación)
          </h4>
          <ul className="mt-1 space-y-1 text-sm">
            {r.sugerencias.slice(0, 6).map((s) => (
              <li key={s.mixerId} className="text-muted">
                Mixer {s.identificador ?? `#${s.mixerId}`} ({s.capacidad} m³) de{" "}
                <strong className="text-ink">Flota {s.plantelNombre}</strong> —
                holgura {s.holguraPlantel}
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.alertas.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {r.alertas.map((a, i) => (
            <p key={i}>
              ⚠️ {a.margenMin < 0 ? "Traslape" : "Margen apretado"} en{" "}
              {a.tipoUnidad} #{a.unidadId}: {a.margenMin} min entre viajes #
              {a.viajeAnteriorId} y #{a.viajeSiguienteId}.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Advertencia NO bloqueante sobre la frecuencia entre camiones: dice si la
 * frecuencia pedida es alcanzable con la flota real del día y, si no, muestra el
 * desglose del ciclo (carga/ida/descarga/regreso) para que el Programador detecte
 * un tiempo mal configurado, además de cuántos mixers harían falta. Nunca impide
 * guardar: el pedido se programa a la frecuencia realmente alcanzable.
 */
function AvisoFrecuencia({
  a,
}: {
  a: Awaited<ReturnType<typeof analizarFrecuenciaAction>>;
}) {
  const alcanzable = a.alcanzable === true;
  const cls = alcanzable
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded-lg border px-3 py-3 text-sm ${cls}`}>
      <p className="mb-2 font-medium">
        {alcanzable ? "✓" : "⚠️"} {a.mensaje}
      </p>
      {a.lineas && a.lineas.length > 0 && (
        <div className="rounded-md bg-white/60 px-3 py-2 font-mono text-xs leading-5">
          {a.lineas.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      {!alcanzable && a.frecuenciaAlcanzableMin != null && (
        <p className="mt-2 text-xs">
          Si continúas, el pedido se programará a la cadencia real de{" "}
          <strong>{a.frecuenciaAlcanzableMin} min</strong> entre llegadas (no a los{" "}
          {a.frecuenciaSolicitadaMin} min pedidos).
        </p>
      )}
    </div>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";
