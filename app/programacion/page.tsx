import { prisma } from "@/lib/prisma";
import { especDiseno, textoHielo } from "@/lib/formato";
import { sugerirRefuerzo, unidadesEnMantenimiento } from "@/lib/motor/asignacion";
import {
  DEFAULT_TIEMPO_VIAJE_MIN,
  MARGEN_MINIMO_MIN,
  PERMITIR_HORA_CARGA_MANUAL,
  cierreProgramaDe,
} from "@/lib/motor/config";
import { filtroPedidoPorZona, filtroPlantelPorZona } from "@/lib/auth/acceso";
import { requerirAcceso } from "@/lib/auth/guard";
import { compararPlanteles } from "@/lib/planteles-orden";
import { Lock } from "lucide-react";
import { Card, PageHeader } from "../components/ui";
import { AutoRefresh } from "../components/auto-refresh";
import { Filtros } from "./filtros";
import { GanttRecursos, type FilaGantt, type SeccionGantt } from "./gantt-recursos";
import { NuevoPedidoModal } from "./nuevo-pedido-modal";
import { VistaProgramacion } from "./vista-toggle";
import { ModoProgramacion } from "./modo-programacion";
import {
  ManualView,
  type PlantelManual,
  type ClienteOpcionManual,
  type DisenoOpcionManual,
} from "./manual-view";
import type { ClienteCard, EstadoCliente, PlantaMedidor, PlantelSimple } from "./vista-simple";
import { calcularHuecos } from "@/lib/motor/organizador";
import { leerMargenHueco } from "@/lib/motor/config-runtime";
import { HORA_APERTURA_DEFAULT_MIN, leerAperturasDeDia, textoHoraMin } from "@/lib/motor/apertura";
import { estadoBloqueoPrograma } from "@/lib/programacion/bloqueo";
import { PendientesDelDia, type PendienteVista } from "./pendientes-panel";
import {
  TablaPedidos,
  type OpcionesModal,
  type PedidoVista,
} from "./tabla-pedidos";

export const dynamic = "force-dynamic";

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtHM(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}

/** Hora de LLEGADA al proyecto más temprana entre los viajes de un pedido (o null). */
function horaLlegadaMin(
  viajes: { hora_llegada_proyecto: Date | null }[],
): Date | null {
  const horas = viajes
    .map((v) => v.hora_llegada_proyecto?.getTime())
    .filter((t): t is number => t != null);
  return horas.length ? new Date(Math.min(...horas)) : null;
}

/**
 * Cadencia REAL entre llegadas (min): mediana del hueco entre llegadas consecutivas
 * de los viajes CON mixer del pedido. Null si hay menos de 2 llegadas. La mediana
 * (no el promedio) evita que un hueco atípico distorsione el número que ve el
 * Programador. Sirve para comparar contra la frecuencia solicitada.
 */
function frecuenciaRealMin(
  viajes: { mixer_id: number | null; hora_llegada_proyecto: Date | null }[],
): number | null {
  const llegadas = viajes
    .filter((v) => v.mixer_id != null && v.hora_llegada_proyecto != null)
    .map((v) => v.hora_llegada_proyecto!.getTime())
    .sort((a, b) => a - b);
  if (llegadas.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < llegadas.length; i++) {
    gaps.push((llegadas[i] - llegadas[i - 1]) / 60000);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const mediana = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.round(mediana);
}

/** "YYYY-MM-DDTHH:mm" local, para el input datetime-local del formulario. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Fecha por defecto: día del próximo pedido a partir de hoy; si no hay, hoy. */
async function fechaPorDefecto(): Promise<string> {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const prox = await prisma.pedidos.findFirst({
    where: { hora_solicitada: { gte: hoy }, estado_pedido: "Activo" },
    orderBy: { hora_solicitada: "asc" },
    select: { hora_solicitada: true },
  });
  return ymdLocal(prox?.hora_solicitada ?? hoy);
}

export default async function ProgramacionPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; plantel?: string }>;
}) {
  const alcance = await requerirAcceso("/programacion");
  const sp = await searchParams;
  const fecha = sp.fecha ?? (await fechaPorDefecto());
  const plantelFiltro = sp.plantel ?? "todos";

  // Solo estos roles editan Programación (Admin/Programador/JefePlanta). El
  // JefeLaboratorio la ve en SOLO LECTURA. Además, el Programador/JefePlanta solo
  // editan hoy en adelante (los días pasados quedan de solo lectura).
  const rolEditaProg = alcance.esAdmin || alcance.esProgramador || alcance.esJefePlanta;
  const puedeEditar = rolEditaProg && (alcance.esAdmin || fecha >= ymdLocal(new Date()));

  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  // BLOQUEO HORARIO de edicion (config del Admin): pasada la hora de corte, el
  // Programador y el Jefe de Planta pasan a CONSULTA. El servidor rechaza igual
  // cualquier escritura; aqui solo se refleja para no ofrecer controles muertos.
  // No afecta a Despacho en vivo, que es otra pantalla y otras acciones.
  const bloqueo = await estadoBloqueoPrograma(alcance);
  const bloqueoMensaje = bloqueo.bloqueado ? (bloqueo.mensaje ?? null) : null;
  const puedeEditarEfectivo = puedeEditar && !bloqueoMensaje;

  // Congelamiento del Programa DPCR-08: pasado el cierre (la hora de corte del día
  // anterior) solo el Admin puede AGREGAR o QUITAR pedidos del programa; los demás
  // roles siguen pudiendo editar/reordenar. Depende del MISMO interruptor: con el
  // bloqueo horario desactivado no hay corte (antes usaba las 4:00 p.m. fijas del
  // código y bloqueaba aunque el interruptor estuviera apagado). Se refuerza en el
  // servidor (app/actions.ts autorizarCambioPrograma).
  const programaCongelado =
    bloqueo.cfg.activo &&
    new Date().getTime() >= cierreProgramaDe(ini, bloqueo.cfg.horaCorteMin).getTime();
  const puedeAgregarQuitar = alcance.esAdmin || !programaCongelado;

  const [planteles, clientes, disenos, bombas, asesores, pedidos] = await Promise.all([
    prisma.planteles.findMany({
      where: filtroPlantelPorZona(alcance),
      orderBy: { nombre: "asc" },
      include: { plantas: { orderBy: { nombre: "asc" } } },
    }),
    prisma.clientes.findMany({ where: { activo: true }, orderBy: { empresa: "asc" } }),
    prisma.disenos_mezcla.findMany({ orderBy: { codigo: "asc" } }),
    prisma.bombas.findMany({
      where: { estado: "Disponible" },
      orderBy: { identificador: "asc" },
    }),
    prisma.asesores.findMany({ orderBy: { nombre: "asc" } }),
    prisma.pedidos.findMany({
      where: {
        hora_solicitada: { gte: ini, lt: fin },
        estado_pedido: "Activo", // los cancelados salen del programa activo
        // AND (no spread): el filtro de la URL NO puede sobrescribir el scope por
        // zona/plantel del rol (para JefePlanta/Dosificador ambos usan plantel_id).
        AND: [
          filtroPedidoPorZona(alcance),
          plantelFiltro !== "todos" ? { plantel_id: Number(plantelFiltro) } : {},
        ],
      },
      include: {
        cliente: true,
        diseno: true,
        plantel: true,
        bombas: { select: { bomba: { select: { id: true, identificador: true } } } },
        viajes: {
          // Los viajes cancelados en Despacho (1 viaje suelto) no se listan aquí.
          where: { estado: { not: "Cancelado" } },
          // Orden CRONOLÓGICO por hora de carga programada (no por id), para que el
          // detalle liste "Viaje 1, 2, 3…" en secuencia y las horas queden en orden.
          orderBy: [{ hora_inicio_carga: "asc" }, { id: "asc" }],
          include: {
            mixer: {
              select: {
                id: true,
                identificador: true,
                capacidad_m3: true,
                plantel_base_id: true,
                plantel_base: { select: { nombre: true } },
              },
            },
            planta: { select: { nombre: true } },
          },
        },
      },
      orderBy: [{ orden_dia: "asc" }, { hora_solicitada: "asc" }],
    }),
  ]);

  const opciones: OpcionesModal = {
    clientes: clientes.map((c) => ({
      id: c.id,
      etiqueta: c.proyecto ? `${c.empresa} — ${c.proyecto}` : c.empresa,
      asesorId: c.asesor_id,
      transporteMin: c.tiempo_viaje_referencia_min,
      googleMapsUrl: c.google_maps_url,
      latitud: c.latitud,
      longitud: c.longitud,
    })),
    disenos: disenos.map((di) => ({
      id: di.id,
      codigo: di.codigo,
      etiqueta: `${di.codigo} — ${especDiseno(di)}`,
    })),
    planteles: planteles.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      zona: p.zona,
      hubId: p.hub_id,
      plantas: p.plantas.map((pl) => ({
        id: pl.id,
        etiqueta: `${pl.nombre} (${pl.capacidad_m3h} m³/h)`,
      })),
    })),
    bombas: bombas.map((b) => ({
      id: b.id,
      etiqueta: b.identificador,
      plantelId: b.plantel_base_id,
    })),
    asesores: asesores.map((a) => ({ id: a.id, etiqueta: a.nombre })),
    esAdmin: alcance.esAdmin, // volumen con step libre solo para Admin
  };

  // Número de viaje por cliente y día (dinámico, NO se guarda) — mismo criterio que
  // Despacho: 1..N por cliente ese día, ordenado por hora de carga programada. Solo
  // viajes con mixer (los placeholders "Sin cubrir" no cuentan).
  const porClienteDiaProg = new Map<number, { viajeId: number; ordenMs: number }[]>();
  for (const p of pedidos) {
    for (const v of p.viajes) {
      if (v.mixer_id == null) continue;
      const ordenMs = (v.hora_inicio_carga ?? p.hora_solicitada).getTime();
      const arr = porClienteDiaProg.get(p.cliente_id) ?? [];
      arr.push({ viajeId: v.id, ordenMs });
      porClienteDiaProg.set(p.cliente_id, arr);
    }
  }
  const numViajeClienteProg = new Map<number, { num: number; total: number }>();
  for (const arr of porClienteDiaProg.values()) {
    arr.sort((a, b) => a.ordenMs - b.ordenMs || a.viajeId - b.viajeId);
    arr.forEach((x, i) => numViajeClienteProg.set(x.viajeId, { num: i + 1, total: arr.length }));
  }

  // Serializar a la vista de la tabla, agrupada por plantel.
  const grupos = new Map<
    number,
    { nombre: string; zona: string; total: number; pedidos: PedidoVista[] }
  >();
  for (const p of pedidos) {
    const confirmado =
      p.viajes.length > 0 &&
      p.viajes.every((v) => v.estado_confirmacion === "Confirmado");
    const sinCubrirVol =
      Math.round(
        p.viajes
          .filter((v) => v.motivo_asignacion === "Sin cubrir")
          .reduce((s, v) => s + v.volumen_asignado_m3, 0) * 100,
      ) / 100;
    const sinCubrir = sinCubrirVol > 0;

    // Sugerencias de refuerzo (Paso 3) solo si hay volumen sin cubrir.
    const sugerencias = sinCubrir
      ? (
          await sugerirRefuerzo(
            sinCubrirVol,
            p.plantel_id,
            p.plantel.hub_id ?? p.plantel_id,
            p.hora_solicitada,
          )
        )
          .slice(0, 5)
          .map((s) => ({
            mixerId: s.mixerId,
            identificador: s.identificador,
            capacidad: s.capacidad,
            plantelNombre: s.plantelNombre,
          }))
      : [];

    // Descarga: con bomba(s) → los códigos separados por coma; canal directo → texto.
    const esBomba = p.tipo_descarga !== "Canal directo";
    const descargaDisplay =
      esBomba && p.bombas.length
        ? p.bombas.map((x) => x.bomba.identificador).join(", ")
        : p.tipo_descarga;

    // Hora de carga base (más temprana de la cascada) para prellenar el control de
    // hora de carga manual del Admin; si no hay horario aún, la solicitada.
    const cargasMs = p.viajes
      .map((v) => v.hora_inicio_carga?.getTime())
      .filter((t): t is number => t != null);
    const cargaBase = cargasMs.length ? new Date(Math.min(...cargasMs)) : p.hora_solicitada;

    const vista: PedidoVista = {
      id: p.id,
      orden: p.orden_dia,
      horaFija: p.hora_bloqueada,
      // TEMPORAL/REVERSIBLE (override de hora de carga por Admin).
      horaCargaLocal: toLocalInput(cargaBase),
      horaCargaManualLocal: p.hora_carga_manual ? toLocalInput(p.hora_carga_manual) : null,
      // "Llegada" = hora de llegada al proyecto (lo que se solicita). Se toma la
      // llegada calculada de la cascada; si aún no hay horario, la solicitada.
      horaTxt: fmtHM(horaLlegadaMin(p.viajes) ?? p.hora_solicitada),
      empresa: p.cliente.empresa,
      proyecto: p.cliente.proyecto ?? "",
      disenoCodigo: p.diseno.codigo,
      disenoEspec: especDiseno(p.diseno),
      revenimiento: p.revenimiento ?? "",
      elemento: p.elemento ?? "—",
      tipoDescarga: descargaDisplay,
      hieloTxt: textoHielo(p.sacos_hielo_por_m3),
      volumen: p.volumen_total_m3,
      confirmado,
      sinCubrir,
      sinCubrirVol,
      frecuenciaSolicitadaMin: p.frecuencia_entre_camiones_min,
      frecuenciaRealMin: frecuenciaRealMin(p.viajes),
      sugerencias,
      viajes: p.viajes
        .filter((v) => v.motivo_asignacion !== "Sin cubrir" || v.mixer_id == null)
        .map((v) => {
          const numInfo = v.mixer_id != null ? numViajeClienteProg.get(v.id) : undefined;
          return {
          id: v.id,
          codigoViaje: `V-${String(v.id).padStart(6, "0")}`,
          numClienteDia: numInfo?.num ?? null,
          totalClienteDia: numInfo?.total ?? 0,
          plantaNombre: v.planta?.nombre ?? "—",
          mixerLabel: v.mixer ? (v.mixer.identificador ?? `#${v.mixer.id}`) : null,
          flota: v.mixer ? v.mixer.plantel_base.nombre : null,
          flotaPropia: v.mixer ? v.mixer.plantel_base_id === p.plantel_id : false,
          volumen: v.volumen_asignado_m3,
          rutaPorDefecto: v.ruta_por_defecto,
          cargaTxt: fmtHM(v.hora_inicio_carga),
          salidaTxt: fmtHM(v.hora_salida_planta),
          llegadaTxt: fmtHM(v.hora_llegada_proyecto),
          descargaTxt: `${fmtHM(v.hora_inicio_descarga)}–${fmtHM(v.hora_fin_descarga)}`,
          regresoTxt: fmtHM(v.hora_regreso_planta),
          };
        }),
      ubicacion: {
        googleMapsUrl: p.cliente.google_maps_url,
        latitud: p.cliente.latitud,
        longitud: p.cliente.longitud,
      },
      valores: {
        cliente_id: p.cliente_id,
        diseno_id: p.diseno_id,
        plantel_id: p.plantel_id,
        planta_id: p.planta_id,
        volumen_total_m3: p.volumen_total_m3,
        hora_local: toLocalInput(p.hora_solicitada),
        tipo_descarga: p.tipo_descarga,
        revenimiento: p.revenimiento,
        tipo_servicio: p.tipo_servicio,
        sacos_hielo_por_m3: p.sacos_hielo_por_m3,
        bombas_ids: p.bombas.map((x) => x.bomba.id),
        asesor_id: p.asesor_id,
        hora_bloqueada: p.hora_bloqueada,
        usar_ambas_plantas: p.usar_ambas_plantas,
        carga_simultanea: p.carga_simultanea,
        carga_reducida: p.carga_reducida,
        frecuencia_entre_camiones_min: p.frecuencia_entre_camiones_min,
        tiempo_transporte_min: p.tiempo_transporte_min,
        elemento: p.elemento,
        observaciones: p.observaciones,
      },
    };

    const g =
      grupos.get(p.plantel_id) ??
      { nombre: p.plantel.nombre, zona: p.plantel.zona, total: 0, pedidos: [] };
    g.total += p.volumen_total_m3;
    g.pedidos.push(vista);
    grupos.set(p.plantel_id, g);
  }
  const totalGeneral = pedidos.reduce((s, p) => s + p.volumen_total_m3, 0);
  // Todas las vistas de pedido del día, planas: el Modo Manual las usa para las
  // acciones de pedido (editar / cancelar con motivo / eliminar) en la cabecera de
  // cada cliente. Son las MISMAS que alimentan la tabla del modo Avanzado.
  const pedidosVista = [...grupos.values()].flatMap((g) => g.pedidos);

  // Proyecciones (Programa Semana) pendientes de este día → panel para convertir.
  // Solo Admin/Programador/JefePlanta operan aquí (la ruta ya está limitada a esos
  // roles). El Programador y el Jefe de Planta SOLO ven los clientes preprogramados
  // de SU zona asignada; el Admin ve todos.
  // Zona(s) del usuario para acotar los pendientes: Programador por su User.zona,
  // Jefe de Planta por la(s) zona(s) de SUS planteles asignados (M2M). Admin → sin
  // límite. (GerenteComercial/GerenteControlCalidad: sin límite, ven todo.)
  let zonasPendientes: string[] | null = null; // null = sin filtro
  if (!alcance.esAdmin && !alcance.esGerenteComercial && !alcance.esGerenteControlCalidad) {
    const zs = new Set<string>();
    if (alcance.zona) zs.add(alcance.zona);
    if (alcance.plantelAsignadoId != null) {
      const pl = await prisma.planteles.findUnique({
        where: { id: alcance.plantelAsignadoId },
        select: { zona: true },
      });
      if (pl) zs.add(pl.zona);
    }
    if (alcance.plantelesAsignados.length > 0) {
      const suyos = await prisma.planteles.findMany({
        where: { id: { in: alcance.plantelesAsignados } },
        select: { zona: true },
      });
      for (const p of suyos) zs.add(p.zona);
    }
    zonasPendientes = zs.size > 0 ? [...zs] : null;
  }
  // Una proyección es "de la zona" si la atiende una planta de esa zona O si el
  // asesor dueño del cliente pertenece a esa zona (zona_asignada). Así se excluyen
  // las de la otra zona sin ocultar las que aún no tienen planta asignada.
  const filtroZonaPendientes = zonasPendientes
    ? {
        OR: [
          { plantel: { zona: { in: zonasPendientes } } },
          { cliente: { asesor: { zona_asignada: { in: zonasPendientes } } } },
        ],
      }
    : {};

  const pendientesRaw = puedeEditar
    ? await prisma.solicitudes_anticipadas.findMany({
        where: {
          estado: "Pendiente",
          fecha_requerida: { gte: ini, lt: fin },
          ...filtroZonaPendientes,
        },
        include: { cliente: true, asesor: { select: { nombre: true } } },
        // Más antiguas primero (por defecto); el panel permite reordenar.
        orderBy: { creado_en: "asc" },
      })
    : [];
  const pendientes: PendienteVista[] = pendientesRaw.map((s) => ({
    id: s.id,
    clienteId: s.cliente_id,
    empresa: s.cliente.empresa,
    proyecto: s.cliente.proyecto ?? "",
    asesorNombre: s.asesor?.nombre ?? "—",
    volumen: s.volumen_estimado_m3,
    tipoConcreto: s.tipo_concreto_estimado ?? "",
    revenimiento: s.revenimiento ?? "",
    tipoServicio: s.tipo_servicio ?? "",
    tipoDescarga: s.tipo_descarga_estimado ?? "",
    sacosHielo: s.sacos_hielo_por_m3,
    elemento: s.elemento ?? "",
    frecuencia: s.frecuencia_entre_camiones_min,
    observaciones: s.observaciones ?? "",
    plantelId: s.plantel_id,
    creadoEn: s.creado_en ? s.creado_en.toISOString() : null,
  }));

  // ── Gantt de recursos del día (Plantas / Mixers / Bombas, eje compartido) ────
  const COLOR_ORIGEN_GANTT: Record<string, string> = {
    "Flota propia": "bg-emerald-500",
    "Préstamo de zona": "bg-sky-500",
    "Refuerzo excepcional": "bg-amber-500",
  };
  const msDe = (dt: Date | null | undefined) => (dt ? dt.getTime() : null);
  const etiquetaCliente = (empresa: string, proyecto: string | null) =>
    empresa + (proyecto ? ` · ${proyecto}` : "");

  // Plantas: todas las plantas de los planteles que tienen pedidos ese día (para ver
  // también las plantas ociosas de un plantel activo). Respeta el filtro de la vista.
  const plantelesConPedidos = new Set(pedidos.map((p) => p.plantel_id));
  const filasPlanta = new Map<number, FilaGantt>();
  for (const pl of [...planteles].sort((a, b) => compararPlanteles(a.nombre, b.nombre))) {
    if (!plantelesConPedidos.has(pl.id)) continue;
    for (const pt of pl.plantas) filasPlanta.set(pt.id, { id: pt.id, label: pt.nombre, barras: [] });
  }
  const filasMixer = new Map<number, FilaGantt>();
  const filasBomba = new Map<number, FilaGantt>();

  for (const p of pedidos) {
    const etq = etiquetaCliente(p.cliente.empresa, p.cliente.proyecto);
    for (const v of p.viajes) {
      if (v.mixer_id == null) continue; // solo viajes con mixer asignado
      const iniCarga = msDe(v.hora_inicio_carga);
      const finCarga = msDe(v.hora_fin_carga);
      const regreso = msDe(v.hora_regreso_planta);

      // Plantas: bloque de CARGA (planta ocupada mientras dosifica este viaje).
      if (iniCarga != null && finCarga != null) {
        const fila = filasPlanta.get(v.planta_id ?? p.planta_id);
        if (fila)
          fila.barras.push({
            id: `pl-${v.id}`,
            inicioMs: iniCarga,
            finMs: finCarga,
            etiqueta: etq,
            color: "bg-indigo-500",
          });
      }

      // Mixers: ciclo completo carga → regreso (color por procedencia de la flota).
      if (iniCarga != null && regreso != null && v.mixer) {
        const fila =
          filasMixer.get(v.mixer.id) ??
          ({ id: v.mixer.id, label: v.mixer.identificador ?? `#${v.mixer.id}`, barras: [] } as FilaGantt);
        fila.barras.push({
          id: `mx-${v.id}`,
          inicioMs: iniCarga,
          finMs: regreso,
          etiqueta: etq,
          color: COLOR_ORIGEN_GANTT[v.motivo_asignacion ?? ""] ?? "bg-neutral-500",
        });
        filasMixer.set(v.mixer.id, fila);
      }

      // Bombas: ventana de descarga en obra, en la fila de CADA bomba del pedido.
      for (const { bomba } of p.bombas) {
        const iniDesc = msDe(v.hora_inicio_descarga) ?? msDe(v.hora_llegada_proyecto);
        const finDesc = msDe(v.hora_fin_descarga) ?? regreso;
        if (iniDesc != null && finDesc != null) {
          const fila =
            filasBomba.get(bomba.id) ??
            ({ id: bomba.id, label: bomba.identificador ?? `#${bomba.id}`, barras: [] } as FilaGantt);
          fila.barras.push({
            id: `bo-${v.id}`,
            inicioMs: iniDesc,
            finMs: finDesc,
            etiqueta: etq,
            color: "bg-violet-500",
          });
          filasBomba.set(bomba.id, fila);
        }
      }
    }
  }

  const seccionesGantt: SeccionGantt[] = [
    { titulo: "Plantas", filas: [...filasPlanta.values()] },
    { titulo: "Mixers", filas: [...filasMixer.values()].sort((a, b) => a.label.localeCompare(b.label)) },
    { titulo: "Bombas", filas: [...filasBomba.values()].sort((a, b) => a.label.localeCompare(b.label)) },
  ];
  const hayGantt = seccionesGantt.some((s) => s.filas.some((f) => f.barras.length > 0));

  // ── Datos de la VISTA SIMPLE (medidores + tarjetas de cliente + sugerencia) ──
  const JORNADA_MIN_SIMPLE = 10 * 60; // jornada operativa estándar (10 h) para el %
  const aperturaMsSimple = new Date(y, m - 1, d, 7, 0, 0, 0).getTime();
  const cierreMsSimple = aperturaMsSimple + 14 * 3_600_000;
  const margenHuecoSimple = await leerMargenHueco();
  const minEntre = (a: Date | null, b: Date | null) =>
    a && b ? Math.max(0, (b.getTime() - a.getTime()) / 60000) : 0;

  const rawPorPlantel = new Map<number, typeof pedidos>();
  for (const p of pedidos) {
    const arr = rawPorPlantel.get(p.plantel_id);
    if (arr) arr.push(p);
    else rawPorPlantel.set(p.plantel_id, [p]);
  }

  const plantelesSimple: PlantelSimple[] = planteles
    .filter((pl) => rawPorPlantel.has(pl.id))
    .sort((a, b) => compararPlanteles(a.nombre, b.nombre))
    .map((pl) => {
      const suyos = rawPorPlantel.get(pl.id)!;
      const nombrePlanta = (id: number | null) =>
        pl.plantas.find((x) => x.id === id)?.nombre ?? "—";

      // Medidor de capacidad por planta (minutos de carga ocupados / jornada).
      const plantas: (PlantaMedidor & { ocupados: { inicioMs: number; finMs: number }[] })[] =
        pl.plantas.map((planta) => {
          let busy = 0;
          const ocupados: { inicioMs: number; finMs: number }[] = [];
          for (const p of suyos) {
            for (const v of p.viajes) {
              if (v.planta_id !== planta.id || !v.hora_inicio_carga || !v.hora_fin_carga) continue;
              busy += minEntre(v.hora_inicio_carga, v.hora_fin_carga);
              ocupados.push({
                inicioMs: v.hora_inicio_carga.getTime(),
                finMs: v.hora_fin_carga.getTime(),
              });
            }
          }
          return {
            nombre: planta.nombre,
            ocupacionPct: (busy / JORNADA_MIN_SIMPLE) * 100,
            ocupados,
          };
        });

      // Tarjetas de cliente en lenguaje simple (ordenadas por orden_dia).
      const clientes: ClienteCard[] = [...suyos]
        .sort(
          (a, b) =>
            (a.orden_dia ?? 1e9) - (b.orden_dia ?? 1e9) ||
            a.hora_solicitada.getTime() - b.hora_solicitada.getTime(),
        )
        .map((p) => {
          const conMixer = p.viajes.filter((v) => v.mixer_id != null);
          const sinCubrir =
            p.viajes.some((v) => v.motivo_asignacion === "Sin cubrir") || conMixer.length === 0;
          const confirmado =
            conMixer.length > 0 && conMixer.every((v) => v.estado_confirmacion === "Confirmado");
          const estado: EstadoCliente = sinCubrir ? "danger" : confirmado ? "ok" : "warn";
          const frase = sinCubrir
            ? "Esto necesita tu atención: falta flota para cubrir todo el volumen."
            : confirmado
              ? "Va a tiempo, ya confirmado por el asesor."
              : "Programado; falta que el asesor lo confirme.";
          return {
            pedidoId: p.id,
            orden: p.orden_dia ?? 0,
            empresa: p.cliente.empresa,
            proyecto: p.cliente.proyecto ?? "",
            plantaNombre: nombrePlanta(p.viajes[0]?.planta_id ?? p.planta_id),
            estado,
            frase,
            horaTxt: fmtHM(horaLlegadaMin(p.viajes)),
          };
        });

      // Sugerencia: si hay proyecciones pendientes para este plantel y un hueco
      // aprovechable entre entregas, se ofrece en lenguaje llano.
      const pendientesPl = pendientes.filter(
        (pe) => pe.plantelId === pl.id || pe.plantelId == null,
      );
      let sugerencia: string | null = null;
      if (pendientesPl.length > 0) {
        let mejor: { planta: string; ini: number; fin: number; dur: number } | null = null;
        for (const planta of plantas) {
          for (const h of calcularHuecos(
            planta.ocupados,
            aperturaMsSimple,
            cierreMsSimple,
            margenHuecoSimple,
          )) {
            if (h.finMs >= cierreMsSimple) continue; // la cola no es "hueco entre entregas"
            if (!mejor || h.durMin > mejor.dur) {
              mejor = { planta: planta.nombre, ini: h.inicioMs, fin: h.finMs, dur: h.durMin };
            }
          }
        }
        if (mejor) {
          sugerencia =
            `Podemos meter a ${pendientesPl[0].empresa} sin afectar a nadie más: ` +
            `cabe en ${mejor.planta}, entre ${fmtHM(new Date(mejor.ini))} y ` +
            `${fmtHM(new Date(mejor.fin))} (${mejor.dur} min libres).`;
        }
      }

      return {
        plantelId: pl.id,
        nombre: pl.nombre,
        zona: pl.zona,
        plantas: plantas.map(({ nombre, ocupacionPct }) => ({ nombre, ocupacionPct })),
        clientes,
        sugerencia,
      };
    });

  // ── Datos para el MODO MANUAL (solo si el rol puede programar a mano) ──
  const puedeManual = rolEditaProg;
  let plantelesManual: PlantelManual[] = [];
  let clientesManual: ClienteOpcionManual[] = [];
  let disenosManual: DisenoOpcionManual[] = [];
  if (puedeManual) {
    const [mixersTodos, mantMixers] = await Promise.all([
      // TODOS los mixers (cualquier estado) para el panel lateral; los seleccionables
      // se derivan filtrando estado Disponible y sin mantenimiento del día.
      prisma.mixers.findMany({
        select: { id: true, identificador: true, capacidad_m3: true, plantel_base_id: true, estado: true },
        orderBy: { identificador: "asc" },
      }),
      unidadesEnMantenimiento("Mixer", ini),
    ]);
    // Apertura vigente de cada planta ESE dia: excepcion del dia si la hay, si no el
    // valor por defecto de Administracion. Solo se usa para avisar, nunca bloquea.
    const aperturas = await leerAperturasDeDia(
      planteles.flatMap((pl) => pl.plantas.map((pt) => pt.id)),
      ini,
    );
    // Nota operativa de cada plantel ese día (vacía = no se muestra en ningún lado).
    const obsPlantel = new Map(
      (
        await prisma.observaciones_plantel.findMany({
          where: { fecha: ini },
          select: { plantel_id: true, texto: true },
        })
      ).map((o) => [o.plantel_id, o.texto]),
    );
    const filasPorPlantel = new Map<number, PlantelManual["filas"]>();
    for (const p of pedidos) {
      for (const v of p.viajes) {
        // Solo viajes con horario y con planta: los "Sin cubrir" no se colocan en la tabla.
        if (!v.hora_inicio_carga || v.planta_id == null || v.motivo_asignacion === "Sin cubrir") continue;
        const transporteMin =
          p.tiempo_transporte_min ?? p.cliente.tiempo_viaje_referencia_min ?? DEFAULT_TIEMPO_VIAJE_MIN;
        const arr = filasPorPlantel.get(p.plantel_id) ?? [];
        arr.push({
          id: v.id,
          plantaId: v.planta_id,
          pedidoId: p.id,
          ordenDia: p.orden_dia,
          clienteId: p.cliente_id,
          empresa: p.cliente.empresa,
          proyecto: p.cliente.proyecto ?? "",
          mixerId: v.mixer_id,
          volumen: v.volumen_asignado_m3,
          inicioCargaMs: v.hora_inicio_carga.getTime(),
          tipoDescarga: p.tipo_descarga,
          disenoId: p.diseno_id,
          transporteMin,
          horaFija: v.hora_fija,
        });
        filasPorPlantel.set(p.plantel_id, arr);
      }
    }
    plantelesManual = planteles
      .filter((pl) => plantelFiltro === "todos" || pl.id === Number(plantelFiltro))
      .sort((a, b) => compararPlanteles(a.nombre, b.nombre))
      .map((pl) => {
        const hubIds = new Set<number>([pl.id, ...(pl.hub_id != null ? [pl.hub_id] : [])]);
        const delHub = mixersTodos.filter((m) => hubIds.has(m.plantel_base_id));
        // Seleccionables: solo Disponibles y sin mantenimiento la fecha.
        const mixers = delHub
          .filter((m) => m.estado === "Disponible" && !mantMixers.has(m.id))
          .map((m) => ({
            id: m.id,
            label: m.identificador ?? `#${m.id}`,
            capacidad: m.capacidad_m3,
            plantelBaseId: m.plantel_base_id,
          }));
        // Panel lateral: TODOS los del plantel+hub, con su estado y si están en
        // mantenimiento hoy (para ver también los no disponibles).
        const mixersPanel = delHub.map((m) => ({
          id: m.id,
          label: m.identificador ?? `#${m.id}`,
          capacidad: m.capacidad_m3,
          estado: m.estado,
          enMantenimiento: mantMixers.has(m.id),
          esHub: m.plantel_base_id !== pl.id,
        }));
        return {
          plantelId: pl.id,
          nombre: pl.nombre,
          zona: pl.zona,
          observaciones: obsPlantel.get(pl.id) ?? "",
          plantas: pl.plantas.map((pt) => {
            const ap = aperturas.get(pt.id);
            return {
              id: pt.id,
              nombre: pt.nombre,
              capacidadM3h: pt.capacidad_m3h,
              alistamientoMin: pt.tiempo_alistamiento_min,
              aperturaHHMM: textoHoraMin(ap?.minutos ?? HORA_APERTURA_DEFAULT_MIN),
              aperturaEsExcepcion: ap?.esExcepcion ?? false,
            };
          }),
          mixers,
          mixersPanel,
          filas: filasPorPlantel.get(pl.id) ?? [],
        };
      });
    clientesManual = clientes.map((c) => ({
      id: c.id,
      empresa: c.empresa,
      proyecto: c.proyecto ?? "",
      transporteMin: c.tiempo_viaje_referencia_min ?? DEFAULT_TIEMPO_VIAJE_MIN,
    }));
    disenosManual = disenos.map((d) => ({ id: d.id, etiqueta: `${d.codigo} — ${especDiseno(d)}` }));
  }

  return (
    <>
      <AutoRefresh />
      <PageHeader
        titulo="Programación de pedidos"
        descripcion="Registro de pedidos con asignación automática de mixers, bombas y ventana de despacho."
        accion={
          puedeEditar && puedeAgregarQuitar ? (
            <NuevoPedidoModal {...opciones} fechaInicial={fecha} />
          ) : puedeEditar && !puedeAgregarQuitar ? (
            <span className="text-xs text-muted">
              Programa cerrado — solo el Administrador agrega o quita pedidos
            </span>
          ) : (
            <span className="text-xs text-muted">
              Solo lectura (día pasado)
            </span>
          )
        }
      />

      <Filtros
        fecha={fecha}
        plantel={plantelFiltro}
        planteles={planteles.map((p) => ({ id: p.id, nombre: p.nombre, zona: p.zona }))}
      />

      {/* Bloqueo horario del Admin: la programacion pasa a CONSULTA (Despacho sigue). */}
      {bloqueoMensaje && (
        <p className="mb-5 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Lock size={16} className="mt-0.5 shrink-0" />
          <span>
            {bloqueoMensaje} Puedes seguir <strong>consultando</strong> el programa con normalidad;
            el <strong>Despacho en vivo</strong> no se ve afectado.
          </span>
        </p>
      )}

      {puedeEditarEfectivo && (
        <div id="pendientes-por-programar">
          <PendientesDelDia pendientes={pendientes} opciones={opciones} fecha={fecha} />
        </div>
      )}

      {/* Selector de nivel superior: AUTOMÁTICO (el motor arma el día) vs MANUAL
          (el usuario arma todo a mano y el motor solo valida/avisa). El modo Auto
          conserva su sub-toggle Vista simple / Modo avanzado. */}
      <ModoProgramacion
        puedeManual={puedeManual}
        manual={
          <ManualView
            planteles={plantelesManual}
            clientes={clientesManual}
            disenos={disenosManual}
            fecha={fecha}
            margenMin={MARGEN_MINIMO_MIN}
            puedeEditar={puedeEditarEfectivo}
            pedidos={pedidosVista}
            opciones={opciones}
            puedeAgregarQuitar={puedeAgregarQuitar && puedeEditarEfectivo}
          />
        }
        auto={
      <VistaProgramacion
        plantelesSimple={plantelesSimple}
        fecha={fecha}
        puedeOrganizar={puedeEditarEfectivo}
        puedeReordenar={puedeEditarEfectivo}
        puedeAvanzado
        avanzado={
          <>
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">Programa del día por plantel</h2>
                <span className="text-sm text-muted">
                  Total general:{" "}
                  <span className="font-bold text-ink">{totalGeneral.toFixed(1)} m³</span>
                </span>
              </div>

              {grupos.size === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  No hay pedidos para esta fecha.
                  {puedeEditar && (
                    <>
                      {" "}
                      Usa <strong>+ Nuevo pedido</strong> para crear uno.
                    </>
                  )}
                </p>
              ) : (
                <div className="space-y-6">
                  {[...grupos.values()]
                    .sort((a, b) => compararPlanteles(a.nombre, b.nombre))
                    .map((g) => (
                      <div key={g.nombre}>
                        <div className="flex items-center justify-between rounded-t-lg bg-content px-3 py-2">
                          <div className="font-semibold text-ink">
                            {g.nombre}{" "}
                            <span className="font-normal text-muted">({g.zona})</span>
                          </div>
                          <div className="text-sm text-ink">
                            Total plantel:{" "}
                            <span className="font-bold">{g.total.toFixed(1)} m³</span>{" "}
                            <span className="text-muted">· {g.pedidos.length} pedido(s)</span>
                          </div>
                        </div>
                        <TablaPedidos
                          pedidos={g.pedidos}
                          opciones={opciones}
                          puedeEditar={puedeEditarEfectivo}
                          puedeAgregarQuitar={puedeAgregarQuitar && puedeEditarEfectivo}
                          esAdmin={alcance.esAdmin}
                          permitirHoraCargaManual={PERMITIR_HORA_CARGA_MANUAL}
                        />
                      </div>
                    ))}
                </div>
              )}
            </Card>

            {hayGantt && (
              <Card className="mt-5 p-5">
                <h2 className="mb-1 text-lg font-semibold text-ink">
                  Línea de tiempo del día (recursos)
                </h2>
                <p className="mb-4 text-sm text-muted">
                  Plantas, mixers y bombas en el mismo eje de horas. Las líneas verticales
                  marcan cada hora en punto para ver de un vistazo los tiempos muertos entre
                  bloques.
                </p>
                <GanttRecursos secciones={seccionesGantt} />
              </Card>
            )}
          </>
        }
      />
        }
      />
    </>
  );
}
