// Lectura del reporte de tiempos de descarga y esperas en obra.
//
// La define UNA sola función porque la pantalla y la exportación a CSV la comparten:
// así el archivo no puede desviarse de lo que se ve (el mismo patrón que
// `lib/extraordinario/metricas.ts` y `lib/programa/snapshot.ts`).
//
// ── Universo del reporte ────────────────────────────────────────────────────
// Viajes con mixer, **no cancelados**, de pedidos **activos**, cuyo día de PEDIDO
// (`hora_solicitada`) cae en el rango. Se atribuye al día del pedido —no al de la
// descarga— para que el reporte cuadre con el DPCR-08 y con el calendario de
// producción, que usan la misma clave.
//
// Los viajes que aún no han llegado a obra NO se excluyen: aparecen con sus campos
// vacíos y se cuentan como incompletos. Esconderlos daría un reporte optimista sin
// decir sobre cuántos viajes se calculó (ver B6 en `descargas.ts`).
import { prisma } from "@/lib/prisma";
import {
  analizarIntervalos,
  analizarViaje,
  resumirPeriodo,
  resumirPorCliente,
  type IntervaloPedido,
  type ResumenCliente,
  type ResumenPeriodo,
  type UmbralesDescarga,
  type ViajeAnalizado,
  type ViajeEntrada,
} from "./descargas";

export interface ReporteDescargas {
  detalle: ViajeAnalizado[];
  porCliente: ResumenCliente[];
  intervalos: IntervaloPedido[];
  resumen: ResumenPeriodo;
  /** Clientes con al menos un viaje en el periodo, para el selector. */
  clientes: { id: number; etiqueta: string }[];
}

export async function calcularDescargas({
  desde,
  hasta,
  plantelIds,
  clienteId,
  umbrales,
}: {
  desde: Date;
  /** EXCLUSIVO. */
  hasta: Date;
  /** Planteles del alcance ya validado. `[-1]` = ninguno (no ve nada). */
  plantelIds: number[];
  /** Filtro opcional de cliente/proyecto. */
  clienteId?: number | null;
  umbrales: UmbralesDescarga;
}): Promise<ReporteDescargas> {
  const viajes = await prisma.viajes.findMany({
    where: {
      mixer_id: { not: null },
      estado: { not: "Cancelado" },
      pedido: {
        estado_pedido: "Activo",
        hora_solicitada: { gte: desde, lt: hasta },
        plantel_id: { in: plantelIds },
        ...(clienteId ? { cliente_id: clienteId } : {}),
      },
    },
    select: {
      id: true,
      volumen_asignado_m3: true,
      volumen_real_m3: true,
      hora_inicio_carga: true,
      ts_inicio_carga_real: true,
      ts_llegada_real: true,
      ts_inicio_descarga_real: true,
      ts_fin_descarga_real: true,
      ts_regreso_real: true,
      mixer: { select: { identificador: true, id: true } },
      pedido: {
        select: {
          id: true,
          cliente_id: true,
          hora_solicitada: true,
          frecuencia_entre_camiones_min: true,
          plantel_id: true,
          cliente: { select: { empresa: true, proyecto: true } },
          plantel: { select: { nombre: true } },
        },
      },
    },
    orderBy: [{ pedido: { hora_solicitada: "asc" } }, { hora_inicio_carga: "asc" }, { id: "asc" }],
  });

  // Numeración "viaje N de M" por CLIENTE y día, la misma que usan Programación y
  // Despacho: se recorre en el orden ya consultado (día, luego hora de carga).
  const claveDia = (d: Date) =>
    `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const contador = new Map<string, number>();
  const totalPorPedido = new Map<number, number>();
  for (const v of viajes) {
    totalPorPedido.set(v.pedido.id, (totalPorPedido.get(v.pedido.id) ?? 0) + 1);
  }

  const entradas: ViajeEntrada[] = viajes.map((v) => {
    const k = `${v.pedido.cliente_id}|${claveDia(v.pedido.hora_solicitada)}`;
    const n = (contador.get(k) ?? 0) + 1;
    contador.set(k, n);
    const dia = v.pedido.hora_solicitada;
    return {
      viajeId: v.id,
      pedidoId: v.pedido.id,
      clienteId: v.pedido.cliente_id,
      cliente: v.pedido.cliente.empresa,
      proyecto: v.pedido.cliente.proyecto,
      plantelId: v.pedido.plantel_id,
      plantel: v.pedido.plantel.nombre,
      diaMs: new Date(dia.getFullYear(), dia.getMonth(), dia.getDate()).getTime(),
      numero: n,
      totalDelPedido: totalPorPedido.get(v.pedido.id) ?? 1,
      mixer: v.mixer?.identificador ?? (v.mixer ? `#${v.mixer.id}` : "—"),
      // Volumen REAL si el despachador lo corrigió (lo que de verdad se descargó).
      volumen: v.volumen_real_m3 ?? v.volumen_asignado_m3,
      llegadaMs: v.ts_llegada_real?.getTime() ?? null,
      inicioDescargaMs: v.ts_inicio_descarga_real?.getTime() ?? null,
      finDescargaMs: v.ts_fin_descarga_real?.getTime() ?? null,
      programadaMin: v.pedido.frecuencia_entre_camiones_min,
    };
  });

  const detalle = entradas.map((e) => analizarViaje(e, umbrales));
  const porCliente = resumirPorCliente(detalle);

  // ── Cumplimiento del intervalo entre camiones (B5) ────────────────────────
  // Solo pedidos con MÁS DE UNA llegada real: con una sola no hay intervalo.
  const llegadasPorPedido = new Map<number, number[]>();
  for (const v of viajes) {
    if (!v.ts_llegada_real) continue;
    const arr = llegadasPorPedido.get(v.pedido.id);
    if (arr) arr.push(v.ts_llegada_real.getTime());
    else llegadasPorPedido.set(v.pedido.id, [v.ts_llegada_real.getTime()]);
  }
  const metaPedido = new Map(
    viajes.map((v) => [
      v.pedido.id,
      {
        pedidoId: v.pedido.id,
        cliente: v.pedido.cliente.empresa,
        proyecto: v.pedido.cliente.proyecto,
        diaMs: new Date(
          v.pedido.hora_solicitada.getFullYear(),
          v.pedido.hora_solicitada.getMonth(),
          v.pedido.hora_solicitada.getDate(),
        ).getTime(),
        solicitadoMin: v.pedido.frecuencia_entre_camiones_min,
      },
    ]),
  );
  const intervalos: IntervaloPedido[] = [];
  for (const [pedidoId, llegadas] of llegadasPorPedido) {
    const meta = metaPedido.get(pedidoId);
    if (!meta) continue;
    const r = analizarIntervalos(meta, llegadas, umbrales);
    if (r) intervalos.push(r);
  }
  // Los más irregulares primero: son los que hay que revisar.
  intervalos.sort(
    (a, b) => (b.variabilidadMin ?? 0) - (a.variabilidadMin ?? 0) || a.cliente.localeCompare(b.cliente),
  );

  // Ciclos completos medidos (carga real → regreso real), para traducir las horas de
  // espera a "viajes que no se pudieron hacer".
  const ciclosMin = viajes
    .filter((v) => v.ts_inicio_carga_real != null && v.ts_regreso_real != null)
    .map((v) => (v.ts_regreso_real!.getTime() - v.ts_inicio_carga_real!.getTime()) / 60000)
    .filter((m) => m > 0 && m < 12 * 60); // descarta lecturas absurdas de captura

  const resumen = resumirPeriodo(detalle, porCliente, ciclosMin);

  // Clientes del periodo para el selector: los que tienen algún viaje en el alcance,
  // sin aplicar el filtro de cliente (si no, al elegir uno desaparecerían los demás).
  const delPeriodo = await prisma.pedidos.findMany({
    where: {
      estado_pedido: "Activo",
      hora_solicitada: { gte: desde, lt: hasta },
      plantel_id: { in: plantelIds },
      viajes: { some: { mixer_id: { not: null }, estado: { not: "Cancelado" } } },
    },
    select: { cliente_id: true, cliente: { select: { empresa: true, proyecto: true } } },
    distinct: ["cliente_id"],
    orderBy: { cliente: { empresa: "asc" } },
  });
  const clientes = delPeriodo.map((p) => ({
    id: p.cliente_id,
    etiqueta: p.cliente.proyecto
      ? `${p.cliente.empresa} — ${p.cliente.proyecto}`
      : p.cliente.empresa,
  }));

  return { detalle, porCliente, intervalos, resumen, clientes };
}
