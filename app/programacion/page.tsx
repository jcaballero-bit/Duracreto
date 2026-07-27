import { prisma } from "@/lib/prisma";
import { especDiseno, textoHielo } from "@/lib/formato";
import { sugerirRefuerzo } from "@/lib/motor/asignacion";
import { filtroPedidoPorZona, filtroPlantelPorZona } from "@/lib/auth/acceso";
import { requerirAcceso } from "@/lib/auth/guard";
import { compararPlanteles } from "@/lib/planteles-orden";
import { Card, PageHeader } from "../components/ui";
import { AutoRefresh } from "../components/auto-refresh";
import { Filtros } from "./filtros";
import { NuevoPedidoModal } from "./nuevo-pedido-modal";
import { PendientesDelDia, type PendienteVista } from "./pendientes-panel";
import {
  TablaPedidos,
  type OpcionesModal,
  type PedidoVista,
} from "./tabla-pedidos";

/** Sugiere el diseño más parecido al texto libre del asesor (por resistencia). */
function sugerirDiseno(
  texto: string | null,
  disenos: { id: number; etiqueta_resistencia: string | null; resistencia_psi: number | null }[],
): number | null {
  const digitos = (texto ?? "").replace(/[^0-9]/g, "");
  if (digitos) {
    for (const d of disenos) {
      const ref = String(d.etiqueta_resistencia ?? d.resistencia_psi ?? "").replace(/[^0-9]/g, "");
      if (ref && digitos.includes(ref)) return d.id;
    }
  }
  return disenos[0]?.id ?? null;
}

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

  // Regla: el Programador puede VER días pasados pero no editarlos; el Admin
  // edita cualquier día. (comparación de cadenas "YYYY-MM-DD" es segura)
  const puedeEditar = alcance.esAdmin || fecha >= ymdLocal(new Date());

  const [y, m, d] = fecha.split("-").map(Number);
  const ini = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

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
        ...filtroPedidoPorZona(alcance),
        ...(plantelFiltro !== "todos" ? { plantel_id: Number(plantelFiltro) } : {}),
      },
      include: {
        cliente: true,
        diseno: true,
        plantel: true,
        bomba: { select: { identificador: true } },
        viajes: {
          orderBy: { id: "asc" },
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
    bombas: bombas.map((b) => ({
      id: b.id,
      etiqueta: b.identificador,
      plantelId: b.plantel_base_id,
    })),
    asesores: asesores.map((a) => ({ id: a.id, etiqueta: a.nombre })),
  };

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

    // Descarga: con bomba → código de la bomba; canal directo → texto tal cual.
    const esBomba = p.tipo_descarga !== "Canal directo";
    const descargaDisplay =
      esBomba && p.bomba ? p.bomba.identificador : p.tipo_descarga;

    const vista: PedidoVista = {
      id: p.id,
      orden: p.orden_dia,
      horaFija: p.hora_bloqueada,
      // "Llegada" = hora de llegada al proyecto (lo que se solicita). Se toma la
      // llegada calculada de la cascada; si aún no hay horario, la solicitada.
      horaTxt: fmtHM(horaLlegadaMin(p.viajes) ?? p.hora_solicitada),
      empresa: p.cliente.empresa,
      proyecto: p.cliente.proyecto ?? "",
      disenoCodigo: p.diseno.codigo,
      disenoEspec: especDiseno(p.diseno),
      elemento: p.elemento ?? "—",
      tipoDescarga: descargaDisplay,
      hieloTxt: textoHielo(p.sacos_hielo_por_m3),
      volumen: p.volumen_total_m3,
      confirmado,
      sinCubrir,
      sinCubrirVol,
      sugerencias,
      viajes: p.viajes
        .filter((v) => v.motivo_asignacion !== "Sin cubrir" || v.mixer_id == null)
        .map((v) => ({
          id: v.id,
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
        })),
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
        sacos_hielo_por_m3: p.sacos_hielo_por_m3,
        bomba_id: p.bomba_id,
        asesor_id: p.asesor_id,
        hora_bloqueada: p.hora_bloqueada,
        frecuencia_entre_camiones_min: p.frecuencia_entre_camiones_min,
        tiempo_transporte_min: p.tiempo_transporte_min,
        elemento: p.elemento,
        ubicacion_detalle: p.ubicacion_detalle,
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

  // Proyecciones (Programa Semana) pendientes de este día → panel para convertir.
  // Solo Admin/Programador operan aquí (la ruta ya está limitada a esos roles).
  const disenosSimple = disenos.map((d) => ({
    id: d.id,
    etiqueta_resistencia: d.etiqueta_resistencia,
    resistencia_psi: d.resistencia_psi,
  }));
  const pendientesRaw = puedeEditar
    ? await prisma.solicitudes_anticipadas.findMany({
        where: { estado: "Pendiente", fecha_requerida: { gte: ini, lt: fin } },
        include: { cliente: true, asesor: { select: { nombre: true } } },
        orderBy: { id: "asc" },
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
    tipoDescarga: s.tipo_descarga_estimado ?? "",
    sacosHielo: s.sacos_hielo_por_m3,
    elemento: s.elemento ?? "",
    frecuencia: s.frecuencia_entre_camiones_min,
    observaciones: s.observaciones ?? "",
    plantelId: s.plantel_id,
    disenoSugeridoId: sugerirDiseno(s.tipo_concreto_estimado, disenosSimple),
  }));

  return (
    <>
      <AutoRefresh />
      <PageHeader
        titulo="Programación de pedidos"
        descripcion="Registro de pedidos con asignación automática de mixers, bombas y ventana de despacho."
        accion={
          puedeEditar ? (
            <NuevoPedidoModal {...opciones} fechaInicial={fecha} />
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

      {puedeEditar && (
        <PendientesDelDia pendientes={pendientes} opciones={opciones} fecha={fecha} />
      )}

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
                  puedeEditar={puedeEditar}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
