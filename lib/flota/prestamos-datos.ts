// Lectura de los préstamos de unidades (las reglas viven en `prestamos.ts`, puro).
import { prisma } from "@/lib/prisma";
import { indexarPrestamos, type IndicePrestamos } from "./prestamos";

const inicioDelDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const finDelDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

/**
 * Índice de los préstamos vigentes ese día: "Tipo|id" → plantel destino.
 *
 * Lo consume el motor en cada cálculo, así que es una consulta única y estrecha (el
 * día completo suele tener un puñado de filas). Si no hay ninguna, el índice va vacío
 * y todo se comporta exactamente como antes de que existiera esta funcionalidad.
 */
export async function prestamosDelDia(dia: Date): Promise<IndicePrestamos> {
  const filas = await prisma.prestamos_unidad.findMany({
    where: { fecha: { gte: inicioDelDia(dia), lt: finDelDia(dia) } },
    select: { unidad_tipo: true, unidad_id: true, plantel_destino_id: true },
  });
  return indexarPrestamos(
    filas.map((f) => ({
      unidadTipo: f.unidad_tipo,
      unidadId: f.unidad_id,
      destinoId: f.plantel_destino_id,
    })),
  );
}

/** Un préstamo con los nombres resueltos, para la pantalla. */
export interface PrestamoVista {
  id: number;
  unidadTipo: string;
  unidadId: number;
  /** Identificador legible de la unidad ("SM-07"); `#id` si no tiene. */
  unidad: string;
  /** Detalle corto: capacidad del mixer, tipo de bomba, placa… */
  detalle: string;
  origenId: number;
  origen: string;
  destinoId: number;
  destino: string;
  fechaISO: string;
  motivo: string | null;
  creadoPor: string;
}

const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Préstamos de un día, con los nombres de unidad y plantel resueltos.
 *
 * `plantelIds` acota a los préstamos que le tocan al usuario: los que SALEN de sus
 * planteles y los que LLEGAN a ellos (le interesan los dos lados). `null` = sin
 * límite (Administrador).
 */
export async function prestamosDeDiaVista(
  dia: Date,
  plantelIds: number[] | null,
): Promise<PrestamoVista[]> {
  const filas = await prisma.prestamos_unidad.findMany({
    where: {
      fecha: { gte: inicioDelDia(dia), lt: finDelDia(dia) },
      ...(plantelIds
        ? {
            OR: [
              { plantel_origen_id: { in: plantelIds } },
              { plantel_destino_id: { in: plantelIds } },
            ],
          }
        : {}),
    },
    include: {
      origen: { select: { nombre: true } },
      destino: { select: { nombre: true } },
    },
    orderBy: [{ unidad_tipo: "asc" }, { id: "asc" }],
  });
  if (filas.length === 0) return [];

  // Los nombres de las unidades: una consulta por tipo presente, solo de los ids que
  // aparecen (no se trae el catálogo completo).
  const porTipo = new Map<string, number[]>();
  for (const f of filas) {
    const arr = porTipo.get(f.unidad_tipo);
    if (arr) arr.push(f.unidad_id);
    else porTipo.set(f.unidad_tipo, [f.unidad_id]);
  }
  const nombres = new Map<string, { unidad: string; detalle: string }>();
  const guardar = (tipo: string, id: number, unidad: string | null, detalle: string) =>
    nombres.set(`${tipo}|${id}`, { unidad: unidad ?? `#${id}`, detalle });

  if (porTipo.has("Mixer")) {
    for (const m of await prisma.mixers.findMany({
      where: { id: { in: porTipo.get("Mixer")! } },
      select: { id: true, identificador: true, capacidad_m3: true, marca: true },
    })) {
      guardar("Mixer", m.id, m.identificador, `${m.capacidad_m3} m³ · ${m.marca}`);
    }
  }
  if (porTipo.has("Bomba")) {
    for (const b of await prisma.bombas.findMany({
      where: { id: { in: porTipo.get("Bomba")! } },
      select: { id: true, identificador: true },
    })) {
      guardar("Bomba", b.id, b.identificador, "");
    }
  }
  if (porTipo.has("Camion")) {
    for (const c of await prisma.camiones.findMany({
      where: { id: { in: porTipo.get("Camion")! } },
      select: { id: true, identificador: true, placa: true },
    })) {
      guardar("Camion", c.id, c.identificador, c.placa ?? "");
    }
  }
  if (porTipo.has("Pickup")) {
    for (const p of await prisma.pickups.findMany({
      where: { id: { in: porTipo.get("Pickup")! } },
      select: { id: true, identificador: true, placa: true },
    })) {
      guardar("Pickup", p.id, p.identificador, p.placa ?? "");
    }
  }

  return filas.map((f) => {
    const n = nombres.get(`${f.unidad_tipo}|${f.unidad_id}`);
    return {
      id: f.id,
      unidadTipo: f.unidad_tipo,
      unidadId: f.unidad_id,
      unidad: n?.unidad ?? `#${f.unidad_id}`,
      detalle: n?.detalle ?? "",
      origenId: f.plantel_origen_id,
      origen: f.origen.nombre,
      destinoId: f.plantel_destino_id,
      destino: f.destino.nombre,
      fechaISO: ymd(f.fecha),
      motivo: f.motivo,
      creadoPor: f.creado_por,
    };
  });
}

/** Una unidad ofrecible en el desplegable de préstamo. */
export interface UnidadPrestable {
  tipo: string;
  id: number;
  etiqueta: string;
  plantelBaseId: number;
  plantelBase: string;
  estado: string;
  /** Ya está prestada ese día (a qué plantel), para no ofrecerla dos veces. */
  prestadaA: string | null;
}

/**
 * Unidades que el usuario puede prestar: las de SUS planteles (`plantelIds`), de los
 * cuatro tipos. Marca las que ya están prestadas ese día para que la interfaz no las
 * ofrezca de nuevo (el servidor lo rechaza igual por el índice único).
 */
export async function unidadesPrestables(
  dia: Date,
  plantelIds: number[] | null,
): Promise<UnidadPrestable[]> {
  const donde = plantelIds ? { plantel_base_id: { in: plantelIds } } : {};
  const [mixers, bombas, camiones, pickups, prestados] = await Promise.all([
    prisma.mixers.findMany({
      where: donde,
      select: { id: true, identificador: true, capacidad_m3: true, marca: true, estado: true, plantel_base_id: true, plantel_base: { select: { nombre: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.bombas.findMany({
      where: donde,
      select: { id: true, identificador: true, estado: true, plantel_base_id: true, plantel_base: { select: { nombre: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.camiones.findMany({
      where: donde,
      select: { id: true, identificador: true, placa: true, estado: true, plantel_base_id: true, plantel_base: { select: { nombre: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.pickups.findMany({
      where: donde,
      select: { id: true, identificador: true, placa: true, estado: true, plantel_base_id: true, plantel_base: { select: { nombre: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.prestamos_unidad.findMany({
      where: { fecha: { gte: inicioDelDia(dia), lt: finDelDia(dia) } },
      include: { destino: { select: { nombre: true } } },
    }),
  ]);

  const yaPrestada = new Map(
    prestados.map((p) => [`${p.unidad_tipo}|${p.unidad_id}`, p.destino.nombre]),
  );
  const arma = (
    tipo: string,
    id: number,
    identificador: string | null,
    detalle: string,
    estado: string,
    plantelBaseId: number,
    plantelBase: string,
  ): UnidadPrestable => ({
    tipo,
    id,
    etiqueta: `${identificador ?? `#${id}`}${detalle ? ` · ${detalle}` : ""}`,
    plantelBaseId,
    plantelBase,
    estado,
    prestadaA: yaPrestada.get(`${tipo}|${id}`) ?? null,
  });

  return [
    ...mixers.map((m) =>
      arma("Mixer", m.id, m.identificador, `${m.capacidad_m3} m³`, m.estado, m.plantel_base_id, m.plantel_base.nombre),
    ),
    ...bombas.map((b) =>
      arma("Bomba", b.id, b.identificador, "", b.estado, b.plantel_base_id, b.plantel_base.nombre),
    ),
    ...camiones.map((c) =>
      arma("Camion", c.id, c.identificador, c.placa ?? "", c.estado, c.plantel_base_id, c.plantel_base.nombre),
    ),
    ...pickups.map((p) =>
      arma("Pickup", p.id, p.identificador, p.placa ?? "", p.estado, p.plantel_base_id, p.plantel_base.nombre),
    ),
  ];
}

/**
 * Viajes que un MIXER tiene comprometidos ese día (para advertir antes de prestarlo:
 * al salir del plantel, esos viajes se quedan sin unidad). Para los otros tipos no
 * aplica: no los asigna el motor. Las bombas se cuentan por `pedidos_bombas`.
 */
export async function compromisosDeUnidad(
  unidadTipo: string,
  unidadId: number,
  dia: Date,
): Promise<number> {
  const rango = { gte: inicioDelDia(dia), lt: finDelDia(dia) };
  if (unidadTipo === "Mixer") {
    return prisma.viajes.count({
      where: {
        mixer_id: unidadId,
        estado: { not: "Cancelado" },
        pedido: { hora_solicitada: rango, estado_pedido: "Activo" },
      },
    });
  }
  if (unidadTipo === "Bomba") {
    return prisma.pedidos.count({
      where: {
        hora_solicitada: rango,
        estado_pedido: "Activo",
        bombas: { some: { bomba_id: unidadId } },
      },
    });
  }
  return 0;
}
