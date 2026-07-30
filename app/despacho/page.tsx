import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { especDiseno, textoHielo } from "@/lib/formato";
import {
  DESVIO_AMARILLO_MAX_MIN,
  DESVIO_VERDE_MAX_MIN,
} from "@/lib/motor/config";
import { unidadesEnMantenimiento, type CampoTsReal } from "@/lib/motor/asignacion";
import {
  filtroPedidoPorAsesor,
  filtroPedidoPorLaboratorista,
  filtroPedidoPorZona,
  filtroPlantelPorZona,
  ESTADOS_LABORATORISTA,
} from "@/lib/auth/acceso";
import { requerirAcceso } from "@/lib/auth/guard";
import { compararPlanteles } from "@/lib/planteles-orden";
import { Card, PageHeader } from "../components/ui";
import { AutoRefresh } from "../components/auto-refresh";
import { Filtros } from "../programacion/filtros";
import { NuevoPedidoModal } from "../programacion/nuevo-pedido-modal";
import { Timeline, type FilaMixer } from "../timeline";
import { ProgresoAtencion, type AtencionCliente } from "./progreso-atencion";
import {
  TableroDespacho,
  type GrupoDespacho,
  type HitoVista,
  type MixerOpcion,
  type OperadorOpcion,
  type ViajeDespacho,
} from "./tablero";

export const dynamic = "force-dynamic";

function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtHM(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Semáforo del desvío real vs programado (a tiempo/adelantado = verde). */
function semaforo(diffMin: number | null): "ok" | "warn" | "danger" | null {
  if (diffMin == null) return null;
  if (diffMin <= DESVIO_VERDE_MAX_MIN) return "ok";
  if (diffMin <= DESVIO_AMARILLO_MAX_MIN) return "warn";
  return "danger";
}
/** Arma un hito: programado (línea base) vs real + desvío en minutos. */
function armarHito(
  label: string,
  estado: string,
  campoReal: CampoTsReal,
  programado: Date | null,
  real: Date | null,
): HitoVista {
  const diffMin =
    programado && real
      ? Math.round((real.getTime() - programado.getTime()) / 60000)
      : null;
  return {
    label,
    estado,
    campoReal,
    progTxt: fmtHM(programado),
    realTxt: real ? fmtHM(real) : null,
    realLocal: real ? toLocalInput(real) : null,
    diffMin,
    tono: semaforo(diffMin),
  };
}
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

export default async function DespachoPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; plantel?: string }>;
}) {
  const alcance = await requerirAcceso("/despacho");
  const sesion = await auth();
  const userId = sesion?.user?.id ?? "";
  const sp = await searchParams;
  const fecha = sp.fecha ?? (await fechaPorDefecto());
  const plantelFiltro = sp.plantel ?? "todos";

  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  // Autorización de despacho por rol: qué pedidos ve, si edita, qué botones de
  // estado puede tocar, y si puede crear pedidos de último momento.
  const rolPlenoDespacho =
    alcance.esAdmin || alcance.esDespachador || alcance.esJefePlanta || alcance.esDosificador;
  let scopePedido: Record<string, unknown>;
  let soloLectura = false; // campos (volumen/mixer/motorista/hora) de solo lectura
  let estadosEditables: string[] | null = null; // null = todos los botones; [] = ninguno
  let puedeCrear = false;
  if (rolPlenoDespacho) {
    scopePedido = alcance.esAdmin ? {} : filtroPedidoPorZona(alcance); // zona o plantel
    puedeCrear = true;
  } else if (alcance.esLaboratorista) {
    // Solo los programas (pedidos) que le asignaron; el día ya lo acota la consulta.
    scopePedido = filtroPedidoPorLaboratorista(userId);
    soloLectura = true;
    estadosEditables = [...ESTADOS_LABORATORISTA]; // Llegada/Descargando/Regresando
  } else if (alcance.esJefeLaboratorio || alcance.esGerenteComercial) {
    scopePedido = {}; // ve TODAS las zonas, solo lectura
    soloLectura = true;
    estadosEditables = [];
  } else if (alcance.esAsesor) {
    scopePedido = filtroPedidoPorAsesor(userId);
    soloLectura = true;
    estadosEditables = [];
  } else {
    scopePedido = filtroPedidoPorZona(alcance);
    soloLectura = true;
    estadosEditables = [];
  }

  const [planteles, clientes, disenos, bombas, asesoresLista, mixersDisp, operadoresDisp, pedidos] =
    await Promise.all([
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
      prisma.mixers.findMany({
        // Reasignación limitada a mixers de la(s) zona(s) del usuario.
        where: { estado: "Disponible", plantel_base: filtroPlantelPorZona(alcance) },
        include: { plantel_base: { select: { nombre: true } } },
        orderBy: { id: "asc" },
      }),
      prisma.operadores.findMany({
        where: { estado: "Disponible" },
        orderBy: { nombre: "asc" },
      }),
      prisma.pedidos.findMany({
        where: {
          hora_solicitada: { gte: ini, lt: fin },
          estado_pedido: "Activo", // los cancelados salen del despacho activo
          ...scopePedido,
          ...(plantelFiltro !== "todos"
            ? { plantel_id: Number(plantelFiltro) }
            : {}),
        },
        include: {
          cliente: true,
          plantel: true,
          diseno: true,
          bomba: { select: { identificador: true } },
          viajes: {
            where: { mixer_id: { not: null } },
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
              operador: { select: { id: true, nombre: true } },
            },
          },
        },
        orderBy: { hora_solicitada: "asc" },
      }),
    ]);

  // Excluir del desplegable de reasignación / selección los mixers y bombas en
  // mantenimiento ese día (Hito 6).
  const [mixEnMant, bombaEnMant] = await Promise.all([
    unidadesEnMantenimiento("Mixer", ini),
    unidadesEnMantenimiento("Bomba", ini),
  ]);
  const mixers: MixerOpcion[] = mixersDisp
    .filter((m) => !mixEnMant.has(m.id))
    .map((m) => ({
      id: m.id,
      etiqueta: `${m.identificador ?? `#${m.id}`} · ${m.capacidad_m3}m³ · ${m.plantel_base.nombre}`,
    }));
  const operadores: OperadorOpcion[] = operadoresDisp.map((o) => ({
    id: o.id,
    nombre: o.nombre,
  }));

  // Agrupar viajes (con mixer) por plantel.
  const gruposMap = new Map<number, GrupoDespacho>();
  const filasTimeline = new Map<number, FilaMixer>();

  for (const p of pedidos) {
    for (const v of p.viajes) {
      if (!v.mixer) continue;
      // Flota: siempre "Flota [Plantel del mixer]"; tono neutro si es del propio
      // plantel del pedido, acento (info) si viene de otro.
      const esPropio = v.mixer.plantel_base_id === p.plantel_id;
      const mixerBadge = {
        texto: `Flota ${v.mixer.plantel_base.nombre}`,
        tono: esPropio ? ("neutro" as const) : ("info" as const),
      };
      // Descarga: con bomba → código de bomba; canal directo → texto tal cual.
      const descargaDisplay =
        p.tipo_descarga !== "Canal directo" && p.bomba
          ? p.bomba.identificador
          : p.tipo_descarga;
      // Volumen editable solo antes de que la carga finalice físicamente.
      const volumenEditable =
        (v.estado === "Programado" || v.estado === "En carga") &&
        v.ts_fin_carga_real == null;

      const fila: ViajeDespacho = {
        id: v.id,
        pedidoId: p.id,
        // Orden cronológico FIJO por la hora PROGRAMADA de carga (no la real): así
        // el orden no cambia cuando el viaje se despacha o se registra su hora real.
        ordenCargaMs: (v.hora_inicio_carga ?? p.hora_solicitada).getTime(),
        horaProgTxt: fmtHM(v.hora_inicio_carga ?? p.hora_solicitada),
        cliente: p.cliente.empresa,
        proyecto: p.cliente.proyecto ?? "",
        disenoCodigo: p.diseno.codigo,
        disenoEspec: especDiseno(p.diseno),
        elemento: p.elemento ?? "—",
        tipoDescarga: descargaDisplay,
        hieloTxt: textoHielo(p.sacos_hielo_por_m3),
        volumen: v.volumen_asignado_m3,
        volumenEditable,
        volumenBloqueoMsg: volumenEditable ? null : "No editable: carga ya finalizada",
        mixerId: v.mixer.id,
        mixerLabel: v.mixer.identificador ?? `#${v.mixer.id}`,
        mixerBadge,
        operadorId: v.operador?.id ?? null,
        operadorNombre: v.operador?.nombre ?? null,
        estado: v.estado,
        // Programado (línea base, Hito 2) vs real (ts_*_real) por hito.
        hitos: [
          armarHito("En carga", "En carga", "ts_inicio_carga_real", v.hora_inicio_carga, v.ts_inicio_carga_real),
          armarHito("En ruta", "En ruta", "ts_salida_real", v.hora_salida_planta, v.ts_salida_real),
          armarHito("Llegada", "Llegada", "ts_llegada_real", v.hora_llegada_proyecto, v.ts_llegada_real),
          armarHito("Descargando", "Descargando", "ts_inicio_descarga_real", v.hora_inicio_descarga, v.ts_inicio_descarga_real),
          armarHito("Regresando", "Regresando", "ts_fin_descarga_real", v.hora_fin_descarga, v.ts_fin_descarga_real),
          armarHito("Completado", "Completado", "ts_regreso_real", v.hora_regreso_planta, v.ts_regreso_real),
        ],
        ubicacion: {
          googleMapsUrl: p.cliente.google_maps_url,
          latitud: p.cliente.latitud,
          longitud: p.cliente.longitud,
        },
      };
      const g =
        gruposMap.get(p.plantel_id) ??
        { plantelNombre: p.plantel.nombre, zona: p.plantel.zona, viajes: [] };
      g.viajes.push(fila);
      gruposMap.set(p.plantel_id, g);

      // Línea de tiempo (solo viajes con horario calculado).
      if (v.hora_inicio_carga && v.hora_regreso_planta) {
        const ft =
          filasTimeline.get(v.mixer.id) ??
          ({
            mixerId: v.mixer.id,
            mixerLabel: v.mixer.identificador ?? `#${v.mixer.id}`,
            barras: [],
          } satisfies FilaMixer);
        ft.barras.push({
          viajeId: v.id,
          inicioMs: v.hora_inicio_carga.getTime(),
          finMs: v.hora_regreso_planta.getTime(),
          etiqueta: `${p.cliente.empresa.slice(0, 10)} ${v.volumen_asignado_m3}m³`,
          origen: v.motivo_asignacion ?? "",
        });
        filasTimeline.set(v.mixer.id, ft);
      }
    }
  }

  // Grupos en el orden de presentación (igual que Programación).
  const grupos = [...gruposMap.values()].sort((a, b) =>
    compararPlanteles(a.plantelNombre, b.plantelNombre),
  );
  for (const g of grupos) {
    // Orden FIJO por hora de carga programada. Los viajes NO se reordenan al
    // despacharse (antes los ya salidos bajaban al final; ya no).
    g.viajes.sort((a, b) => a.ordenCargaMs - b.ordenCargaMs);
  }

  // Clientes en ATENCIÓN ahora: pedidos con al menos un viaje iniciado (no
  // "Programado") y que todavía no están 100% completados. El avance se mide por
  // viaje DESPACHADO = el camión ya SALIÓ de planta (En ruta en adelante), no por
  // viaje completado: así la barra sube en cuanto el concreto sale hacia la obra.
  const DESPACHADO = new Set(["En ruta", "Llegada", "Descargando", "Regresando", "Completado"]);
  const ACTIVOS_EN_CURSO = new Set(["En carga", "En ruta", "Llegada", "Descargando", "Regresando"]);
  const atencion: AtencionCliente[] = pedidos
    .flatMap((p) => {
      const conMixer = p.viajes; // ya filtrados: mixer_id != null
      const iniciado = conMixer.some((v) => v.estado !== "Programado");
      const pendiente = conMixer.some((v) => v.estado !== "Completado");
      if (!iniciado || !pendiente) return []; // aún no empieza o ya terminó
      const total = p.volumen_total_m3;
      const despachadoM3 = conMixer
        .filter((v) => DESPACHADO.has(v.estado))
        .reduce((s, v) => s + v.volumen_asignado_m3, 0);
      return [
        {
          pedidoId: p.id,
          cliente: p.cliente.empresa,
          proyecto: p.cliente.proyecto ?? "",
          plantelNombre: p.plantel.nombre,
          total: Math.round(total * 100) / 100,
          despachado: Math.round(despachadoM3 * 100) / 100,
          pct: total > 0 ? Math.min(100, Math.round((despachadoM3 / total) * 100)) : 0,
          viajesDespachados: conMixer.filter((v) => DESPACHADO.has(v.estado)).length,
          viajesTotales: conMixer.length,
          enCurso: conMixer.some((v) => ACTIVOS_EN_CURSO.has(v.estado)),
        },
      ];
    })
    // En curso primero; luego por orden de plantel y nombre de cliente.
    .sort(
      (a, b) =>
        Number(b.enCurso) - Number(a.enCurso) ||
        compararPlanteles(a.plantelNombre, b.plantelNombre) ||
        a.cliente.localeCompare(b.cliente),
    );

  const opciones = {
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
      etiqueta: `${di.codigo} — ${especDiseno(di)}`,
    })),
    planteles: planteles.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      zona: p.zona,
      plantas: p.plantas.map((pl) => ({
        id: pl.id,
        etiqueta: `${pl.nombre} (${pl.capacidad_m3h} m³/h)`,
      })),
    })),
    bombas: bombas
      .filter((b) => !bombaEnMant.has(b.id))
      .map((b) => ({
        id: b.id,
        etiqueta: b.identificador,
        plantelId: b.plantel_base_id,
      })),
    asesores: asesoresLista.map((a) => ({ id: a.id, etiqueta: a.nombre })),
  };

  return (
    <>
      <AutoRefresh intervalMs={10000} />
      <PageHeader
        titulo="Despacho en vivo"
        descripcion={
          soloLectura
            ? "Seguimiento del día (solo lectura)."
            : "Tablero del día: avanza el estado de cada viaje, reasigna mixers al vuelo y crea pedidos de último momento."
        }
        accion={puedeCrear ? <NuevoPedidoModal {...opciones} fechaInicial={fecha} /> : undefined}
      />

      <Filtros
        fecha={fecha}
        plantel={plantelFiltro}
        planteles={planteles.map((p) => ({ id: p.id, nombre: p.nombre, zona: p.zona }))}
        basePath="/despacho"
      />

      <Card className="mb-6 p-5">
        <h2 className="mb-4 text-lg font-semibold text-ink">Viajes del día</h2>
        <TableroDespacho
          grupos={grupos}
          mixers={mixers}
          operadores={operadores}
          soloLectura={soloLectura}
          estadosEditables={estadosEditables}
        />
      </Card>

      <Card className="mb-6 p-5">
        <h2 className="mb-1 text-lg font-semibold text-ink">
          Clientes en atención
        </h2>
        <p className="mb-4 text-sm text-muted">
          Avance de despacho (m³ entregados vs. programados) de los pedidos en curso.
        </p>
        <ProgresoAtencion items={atencion} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-lg font-semibold text-ink">
          Línea de tiempo por mixer (verificación de traslapes)
        </h2>
        <Timeline filas={[...filasTimeline.values()]} />
      </Card>
    </>
  );
}
