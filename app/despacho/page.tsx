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
import { ordenarViajesDespacho } from "@/lib/despacho/orden";
import {
  ESTADO_LABORATORISTA_PLANTA,
  filtroPedidoPorPlantasDelLab,
  plantasDelLaboratorista,
} from "@/lib/calidad/planta-lab";
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
  // Plantas donde este usuario es HOY el laboratorista de báscula (vacío si no lo es).
  let plantasDelLab: number[] = [];
  let puedeCrear = false;
  // Dosificador acotado a SU planta (más fino que el plantel): solo ve/opera los
  // viajes de esa planta. Cada planta de un plantel de 2 necesita su propio usuario.
  const plantaDosificador =
    alcance.esDosificador && !alcance.esAdmin ? alcance.plantaAsignadaId : null;
  if (rolPlenoDespacho) {
    scopePedido = alcance.esAdmin ? {} : filtroPedidoPorZona(alcance); // zona o plantel
    // Con planta asignada, solo pedidos que tengan al menos un viaje en SU planta.
    if (plantaDosificador != null) {
      scopePedido = { ...scopePedido, viajes: { some: { planta_id: plantaDosificador } } };
    }
    puedeCrear = true;
  } else if (alcance.esLaboratorista) {
    // Dos papeles, y se pueden dar los dos el mismo día:
    //  · OBRA: los programas (pedidos) que le asignaron → Llegada/Descargando/Regresando.
    //  · PLANTA: si hoy está en la báscula de una planta, ve TODOS los viajes que
    //    cargan ahí (aunque el proyecto no sea suyo) y solo puede marcar "En ruta".
    plantasDelLab = await plantasDelLaboratorista(userId, ini);
    scopePedido = plantasDelLab.length
      ? { OR: [filtroPedidoPorLaboratorista(userId), filtroPedidoPorPlantasDelLab(plantasDelLab)] }
      : filtroPedidoPorLaboratorista(userId);
    soloLectura = true;
    estadosEditables = [
      ...ESTADOS_LABORATORISTA,
      ...(plantasDelLab.length ? [ESTADO_LABORATORISTA_PLANTA] : []),
    ];
  } else if (alcance.esGerenteControlCalidad || alcance.esGerenteComercial) {
    scopePedido = {}; // ve TODAS las zonas, solo lectura
    soloLectura = true;
    estadosEditables = [];
  } else if (alcance.esJefeLaboratorio) {
    // JefeLaboratorio: SOLO su zona (Tanda 3, punto 12), solo lectura.
    scopePedido = filtroPedidoPorZona(alcance);
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
          // AND (no spread): el filtro de la URL NO puede sobrescribir el scope del
          // rol (JefePlanta/Dosificador usan plantel_id, misma llave → colisión).
          AND: [
            scopePedido,
            plantelFiltro !== "todos" ? { plantel_id: Number(plantelFiltro) } : {},
          ],
        },
        include: {
          cliente: true,
          plantel: true,
          diseno: true,
          bombas: { select: { bomba: { select: { identificador: true } } } },
          // Control de calidad: si hay Laboratorista(s) asignado(s) (para mostrar la
          // captura en la tarjeta) y las preguntas generales ya guardadas del pedido.
          asignaciones_lab: { select: { laboratorista_id: true } },
          control_calidad_general: true,
          viajes: {
            where: {
              mixer_id: { not: null },
              // El Dosificador solo ve los viajes de SU planta.
              ...(plantaDosificador != null ? { planta_id: plantaDosificador } : {}),
            },
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
              planta: { select: { id: true, nombre: true } },
              control_calidad: true, // revenimiento/temperatura ya capturados
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

  // Plantas por plantel (opciones del selector de planta por viaje). Solo tiene
  // sentido editar donde el plantel tenga 2+ plantas (Santa Marta, Tegucigalpa).
  const plantasPorPlantel = new Map<number, { id: number; nombre: string }[]>(
    planteles.map((pl) => [pl.id, pl.plantas.map((x) => ({ id: x.id, nombre: x.nombre }))]),
  );
  // Solo Despachador/Admin/Jefe de Planta cambian la planta de un viaje (el
  // Dosificador está acotado a su planta y no reparte).
  const puedeCambiarPlanta =
    !soloLectura && (alcance.esAdmin || alcance.esDespachador || alcance.esJefePlanta);

  // ¿Puede AGREGAR viajes adicionales a un pedido? Mismos roles que operan pedidos
  // (Admin/Programador/Despachador/JefePlanta/Dosificador). El Programador ve el
  // despacho en solo lectura pero SÍ puede agregar adiciones. Coincide con el gate
  // server-side `autorizarOperacionPedido`.
  const puedeAgregar =
    alcance.esAdmin ||
    alcance.esProgramador ||
    alcance.esDespachador ||
    alcance.esJefePlanta ||
    alcance.esDosificador;

  // ¿Puede CAPTURAR control de calidad dentro de Despacho? Solo los roles de calidad
  // (mismo conjunto que autoriza `puedeCapturarPedido`): Laboratorista (sus proyectos
  // asignados), Admin, JefeLaboratorio (su zona) y GerenteControlCalidad. El
  // Despachador NO captura calidad (marca los estados, sin datos de laboratorio). Los
  // campos además solo aparecen en pedidos CON Laboratorista asignado (ver `tieneLab`).
  const puedeCapturarCalidad =
    alcance.esLaboratorista ||
    alcance.esAdmin ||
    alcance.esJefeLaboratorio ||
    alcance.esGerenteControlCalidad;

  // Número de viaje por CLIENTE y DÍA (dinámico, NO se guarda): reinicia en 1 cada
  // día por cliente. Se ordena por la hora PROGRAMADA de carga (la misma clave que
  // el orden fijo de las tarjetas, `ordenCargaMs`), NUNCA por la hora real: si se
  // usara la real, al marcar "En carga" el viaje tomaría la hora de AHORA y saltaría
  // de número (p. ej. de "Viaje 1" a "Viaje 10"), corriéndose la numeración. Con la
  // hora programada el número es estable y coincide con el orden en pantalla. Se
  // calcula sobre TODOS los pedidos del cliente ese día (aunque sean de distintos
  // planteles/pedidos).
  const porClienteDia = new Map<number, { viajeId: number; ordenMs: number }[]>();
  for (const p of pedidos) {
    for (const v of p.viajes) {
      if (!v.mixer) continue;
      const ordenMs = (v.hora_inicio_carga ?? p.hora_solicitada).getTime();
      const arr = porClienteDia.get(p.cliente_id) ?? [];
      arr.push({ viajeId: v.id, ordenMs });
      porClienteDia.set(p.cliente_id, arr);
    }
  }
  const numViajeCliente = new Map<number, { num: number; total: number }>();
  for (const arr of porClienteDia.values()) {
    arr.sort((a, b) => a.ordenMs - b.ordenMs || a.viajeId - b.viajeId);
    arr.forEach((x, i) => numViajeCliente.set(x.viajeId, { num: i + 1, total: arr.length }));
  }

  // Nota operativa de cada plantel ese dia (la deja la Programacion; vacia = nada).
  const obsPlantel = new Map(
    (
      await prisma.observaciones_plantel.findMany({
        where: { fecha: ini },
        select: { plantel_id: true, texto: true },
      })
    ).map((o) => [o.plantel_id, o.texto]),
  );

  // Agrupar viajes (con mixer) por plantel.
  const gruposMap = new Map<number, GrupoDespacho>();
  const filasTimeline = new Map<number, FilaMixer>();

  for (const p of pedidos) {
    // ── Control de calidad a nivel de PEDIDO (para la captura en Despacho) ─────
    const tieneLab = p.asignaciones_lab.length > 0;
    const cg = p.control_calidad_general;
    const generalCalidad = cg
      ? {
          observaciones: cg.observaciones ?? "",
          humedecio_area: cg.humedecio_area,
          vibro_concreto: cg.vibro_concreto,
          m3_colocados: cg.m3_colocados ?? null,
          aplico_aditivo: cg.aplico_aditivo,
          aditivo_unidades: cg.aditivo_unidades ?? "",
          uso_curador: cg.uso_curador,
          existe_reclamo: cg.existe_reclamo,
          detalle_reclamo: cg.detalle_reclamo ?? "",
        }
      : null;
    const m3SugeridoCalidad =
      Math.round(
        p.viajes
          .filter((v) => v.estado === "Completado")
          .reduce((s, v) => s + (v.volumen_real_m3 ?? v.volumen_asignado_m3), 0) * 10,
      ) / 10;
    // Último viaje del pedido (por hora de carga programada) → ahí va "Finalizar".
    const ordenDe = (v: (typeof p.viajes)[number]) =>
      (v.hora_inicio_carga ?? p.hora_solicitada).getTime();
    const ultimoViajePedidoId =
      [...p.viajes]
        .filter((v) => v.mixer)
        .sort((a, b) => ordenDe(a) - ordenDe(b) || a.id - b.id)
        .at(-1)?.id ?? -1;

    for (const v of p.viajes) {
      if (!v.mixer) continue;
      // Flota: siempre "Flota [Plantel del mixer]"; tono neutro si es del propio
      // plantel del pedido, acento (info) si viene de otro.
      const esPropio = v.mixer.plantel_base_id === p.plantel_id;
      const mixerBadge = {
        texto: `Flota ${v.mixer.plantel_base.nombre}`,
        tono: esPropio ? ("neutro" as const) : ("info" as const),
      };
      // Descarga: con bomba(s) → los códigos separados por coma (un pedido puede
      // llevar varios equipos de bombeo); canal directo → el texto tal cual.
      const descargaDisplay =
        p.tipo_descarga !== "Canal directo" && p.bombas.length
          ? p.bombas.map((x) => x.bomba.identificador).join(", ")
          : p.tipo_descarga;
      // Volumen editable solo antes de que la carga finalice físicamente… salvo para
      // el Administrador, que puede corregirlo aunque el camión ya haya salido (para
      // dejar registrado lo que realmente se cargó). El servidor aplica la misma regla.
      const editableNormal =
        (v.estado === "Programado" || v.estado === "En carga") &&
        v.ts_fin_carga_real == null;
      const volumenEditable = alcance.esAdmin || editableNormal;
      // El Admin está corrigiendo un viaje que ya salió: la interfaz lo dice, para
      // que quede claro que es una corrección de registro y no una programación.
      const volumenCorreccionAdmin = volumenEditable && !editableNormal;

      const numInfo = numViajeCliente.get(v.id);
      const fila: ViajeDespacho = {
        id: v.id,
        pedidoId: p.id,
        codigoViaje: `V-${String(v.id).padStart(6, "0")}`,
        numClienteDia: numInfo?.num ?? 1,
        totalClienteDia: numInfo?.total ?? 1,
        // Orden cronológico FIJO por la hora PROGRAMADA de carga (no la real): así
        // el orden no cambia cuando el viaje se despacha o se registra su hora real.
        ordenCargaMs: (v.hora_inicio_carga ?? p.hora_solicitada).getTime(),
        // Llegada a obra PROGRAMADA: ordena los bloques igual que el DPCR-08.
        ordenLlegadaMs: (
          v.hora_llegada_proyecto ??
          v.hora_inicio_carga ??
          p.hora_solicitada
        ).getTime(),
        horaProgTxt: fmtHM(v.hora_inicio_carga ?? p.hora_solicitada),
        cliente: p.cliente.empresa,
        proyecto: p.cliente.proyecto ?? "",
        disenoCodigo: p.diseno.codigo,
        disenoEspec: especDiseno(p.diseno),
        revenimiento: p.revenimiento ?? "",
        elemento: p.elemento ?? "—",
        tipoDescarga: descargaDisplay,
        hieloTxt: textoHielo(p.sacos_hielo_por_m3),
        // Lo que el despachador ve y edita es el volumen REAL cargado; el
        // programado (`volumen_asignado_m3`) queda intacto para el DPCR-08.
        volumen: v.volumen_real_m3 ?? v.volumen_asignado_m3,
        volumenEditable,
        volumenCorreccionAdmin,
        volumenBloqueoMsg: volumenEditable ? null : "No editable: carga ya finalizada",
        mixerId: v.mixer.id,
        mixerLabel: v.mixer.identificador ?? `#${v.mixer.id}`,
        mixerBadge,
        operadorId: v.operador?.id ?? null,
        operadorNombre: v.operador?.nombre ?? null,
        plantaId: v.planta_id,
        plantaNombre: v.planta?.nombre ?? "—",
        plantasOpciones: plantasPorPlantel.get(p.plantel_id) ?? [],
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
        // Control de calidad (captura del Laboratorista en Despacho).
        tieneLab,
        revenimientoObra: v.control_calidad?.revenimiento_obra ?? null,
        temperaturaConcreto: v.control_calidad?.temperatura_concreto ?? null,
        revenimientoPlanta: v.control_calidad?.revenimiento_planta ?? null,
        temperaturaPlanta: v.control_calidad?.temperatura_planta ?? null,
        // La salida de planta la captura quien está hoy en la báscula de ESA planta
        // (o los roles de calidad con alcance sobre el programa). El servidor lo
        // vuelve a validar en `guardarSalidaPlantaAction`.
        puedeSalidaPlanta:
          alcance.esAdmin ||
          alcance.esGerenteControlCalidad ||
          alcance.esJefeLaboratorio ||
          (v.planta_id != null && plantasDelLab.includes(v.planta_id)),
        cargaIniciada: v.ts_inicio_carga_real != null,
        muestraPlanta: !!v.control_calidad?.muestra_planta,
        muestraObra: !!v.control_calidad?.muestra_obra,
        llegadaAlcanzada: v.ts_llegada_real != null,
        esUltimoDelPedido: v.id === ultimoViajePedidoId,
        generalCalidad,
        m3SugeridoCalidad,
        observaciones: p.observaciones ?? "",
      };
      const g =
        gruposMap.get(p.plantel_id) ??
        {
          plantelNombre: p.plantel.nombre,
          zona: p.plantel.zona,
          observaciones: obsPlantel.get(p.plantel_id) ?? "",
          viajes: [],
        };
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
          etiqueta: `${p.cliente.empresa.slice(0, 10)} ${v.volumen_real_m3 ?? v.volumen_asignado_m3}m³`,
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
  // Orden de las tarjetas: EL MISMO DEL PROGRAMA DPCR-08, pero sin partir a un
  // cliente. Antes iban en fila cronológica pura, así que los viajes de un cliente
  // quedaban intercalados entre los de otro y costaba encontrarlos. Ahora:
  //  1. los viajes se agrupan por PEDIDO (el suministro de un cliente va seguido);
  //  2. los bloques van por la LLEGADA a obra del primer viaje del pedido — la misma
  //     clave que ordena el DPCR-08 (`primeraLlegadaMs` en lib/programa/snapshot.ts),
  //     no el alfabeto: Inversiones Fama (7:00) va completo antes que Terravista (8:00);
  //  3. dentro del bloque se conserva el orden PROGRAMADO de carga, así que despachar
  //     un viaje no lo mueve de lugar.
  for (const g of grupos) {
    g.viajes = ordenarViajesDespacho(g.viajes);
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
        .reduce((s, v) => s + (v.volumen_real_m3 ?? v.volumen_asignado_m3), 0);
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
    bombas: bombas
      .filter((b) => !bombaEnMant.has(b.id))
      .map((b) => ({
        id: b.id,
        etiqueta: b.identificador,
        plantelId: b.plantel_base_id,
      })),
    asesores: asesoresLista.map((a) => ({ id: a.id, etiqueta: a.nombre })),
    esAdmin: alcance.esAdmin, // volumen con step libre solo para Admin
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
        accion={puedeCrear ? <NuevoPedidoModal {...opciones} fechaInicial={fecha} esAdicion /> : undefined}
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
          puedeCambiarPlanta={puedeCambiarPlanta}
          puedeAgregar={puedeAgregar}
          puedeCapturarCalidad={puedeCapturarCalidad}
          esAdmin={alcance.esAdmin}
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
