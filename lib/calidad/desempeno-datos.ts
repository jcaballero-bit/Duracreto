// Lectura del desempeño de los laboratoristas (las reglas viven en `desempeno.ts`).
//
// Universo: los usuarios con rol **Laboratorista** activos. El Jefe de Laboratorio
// está limitado a SU zona (misma regla que `/laboratorio`); el Gerente de Control de
// Calidad y el Administrador ven las dos.
import { prisma } from "@/lib/prisma";
import { ESTADOS_DESPACHADO } from "@/lib/motor/config";
import {
  calificar,
  ordenarCalificaciones,
  resumirEquipo,
  type Calificacion,
  type ConteosLaboratorista,
  type ResumenEquipo,
} from "./desempeno";

export interface DesempenoLaboratorio {
  filas: Calificacion[];
  resumen: ResumenEquipo;
}

/** Un programa sin finalizar, para la lista de pendientes accionables. */
export interface PendienteFinalizar {
  pedidoId: number;
  cliente: string;
  proyecto: string | null;
  plantel: string;
  diaMs: number;
  laboratoristas: string[];
  viajesDespachados: number;
  /** Viajes despachados a los que les falta alguna lectura de obra. */
  viajesSinLectura: number;
}

export async function calcularDesempenoLaboratorio({
  desde,
  hasta,
  zona,
}: {
  desde: Date;
  /** EXCLUSIVO. */
  hasta: Date;
  /** Zona a la que se limita (Jefe de Laboratorio). `null` = las dos. */
  zona: string | null;
}): Promise<DesempenoLaboratorio> {
  const rango = { gte: desde, lt: hasta };

  const laboratoristas = await prisma.user.findMany({
    where: {
      activo: true,
      roles: { some: { rol: "Laboratorista" } },
      ...(zona ? { zona } : {}),
    },
    select: { id: true, name: true, email: true, zona: true },
    orderBy: { name: "asc" },
  });
  if (laboratoristas.length === 0) {
    return { filas: [], resumen: resumirEquipo([]) };
  }
  const ids = laboratoristas.map((l) => l.id);

  // ── Papel de OBRA: programas asignados y sus viajes ─────────────────────
  const asignaciones = await prisma.asignaciones_laboratorista.findMany({
    where: {
      laboratorista_id: { in: ids },
      pedido: {
        hora_solicitada: rango,
        estado_pedido: "Activo",
        ...(zona ? { plantel: { zona } } : {}),
      },
    },
    select: {
      laboratorista_id: true,
      pedido: {
        select: {
          id: true,
          control_calidad_general: { select: { id: true } },
          viajes: {
            where: { mixer_id: { not: null }, estado: { not: "Cancelado" } },
            select: {
              id: true,
              estado: true,
              ts_llegada_real: true,
              control_calidad: {
                select: {
                  revenimiento_obra: true,
                  temperatura_concreto: true,
                  muestra_obra: true,
                  creado_en: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // ── Papel de PLANTA: turnos y los viajes que cargaron ahí ese día ───────
  const turnos = await prisma.asignaciones_laboratorista_planta.findMany({
    where: {
      laboratorista_id: { in: ids },
      fecha: rango,
      ...(zona ? { planta: { plantel: { zona } } } : {}),
    },
    select: { laboratorista_id: true, planta_id: true, fecha: true },
  });

  // Viajes que cargaron en las plantas con turno, en esos días. Se consulta UNA vez
  // por el rango completo y se reparte en memoria: son pocas plantas y pocos días.
  const plantasConTurno = [...new Set(turnos.map((t) => t.planta_id))];
  const viajesPlanta =
    plantasConTurno.length === 0
      ? []
      : await prisma.viajes.findMany({
          where: {
            planta_id: { in: plantasConTurno },
            mixer_id: { not: null },
            estado: { not: "Cancelado" },
            pedido: { hora_solicitada: rango, estado_pedido: "Activo" },
          },
          select: {
            id: true,
            planta_id: true,
            ts_fin_carga_real: true,
            pedido: { select: { hora_solicitada: true } },
            control_calidad: {
              select: {
                revenimiento_planta: true,
                temperatura_planta: true,
                muestra_planta: true,
                creado_en: true,
              },
            },
          },
        });

  const claveDia = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  /** planta|día → viajes que cargaron ahí. */
  const porPlantaDia = new Map<string, typeof viajesPlanta>();
  for (const v of viajesPlanta) {
    if (v.planta_id == null) continue;
    const k = `${v.planta_id}|${claveDia(v.pedido.hora_solicitada)}`;
    const arr = porPlantaDia.get(k);
    if (arr) arr.push(v);
    else porPlantaDia.set(k, [v]);
  }

  // ── Conteos por laboratorista ───────────────────────────────────────────
  const base = (l: (typeof laboratoristas)[number]): ConteosLaboratorista => ({
    laboratoristaId: l.id,
    nombre: l.name ?? l.email ?? "(sin nombre)",
    correo: l.email ?? "—",
    zona: l.zona,
    programasAsignados: 0,
    programasFinalizables: 0,
    programasFinalizados: 0,
    viajesEnObra: 0,
    revenimientoObra: 0,
    temperaturaObra: 0,
    turnosPlanta: 0,
    viajesEnPlanta: 0,
    revenimientoPlanta: 0,
    temperaturaPlanta: 0,
    muestras: 0,
    demorasMin: [],
  });
  const conteos = new Map(laboratoristas.map((l) => [l.id, base(l)]));
  const min = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 60000);

  for (const a of asignaciones) {
    const c = conteos.get(a.laboratorista_id);
    if (!c) continue;
    c.programasAsignados += 1;

    const despachados = a.pedido.viajes.filter((v) =>
      (ESTADOS_DESPACHADO as readonly string[]).includes(v.estado),
    );
    // Un programa sin nada despachado no se puede finalizar: no entra al denominador.
    if (despachados.length > 0) {
      c.programasFinalizables += 1;
      if (a.pedido.control_calidad_general) c.programasFinalizados += 1;
    }

    for (const v of a.pedido.viajes) {
      // La muestra de OBRA se toma al llegar el mixer: si no llegó, no es un dato que
      // el laboratorista dejó de tomar.
      if (v.ts_llegada_real == null) continue;
      c.viajesEnObra += 1;
      const cc = v.control_calidad;
      if (cc?.revenimiento_obra != null) c.revenimientoObra += 1;
      if (cc?.temperatura_concreto != null) c.temperaturaObra += 1;
      if (cc?.muestra_obra) c.muestras += 1;
      if (cc && (cc.revenimiento_obra != null || cc.temperatura_concreto != null)) {
        c.demorasMin.push(min(v.ts_llegada_real, cc.creado_en));
      }
    }
  }

  for (const t of turnos) {
    const c = conteos.get(t.laboratorista_id);
    if (!c) continue;
    c.turnosPlanta += 1;
    for (const v of porPlantaDia.get(`${t.planta_id}|${claveDia(t.fecha)}`) ?? []) {
      // La muestra de salida se toma antes de que el mixer salga: solo cuenta si ya
      // terminó de cargar.
      if (v.ts_fin_carga_real == null) continue;
      c.viajesEnPlanta += 1;
      const cc = v.control_calidad;
      if (cc?.revenimiento_planta != null) c.revenimientoPlanta += 1;
      if (cc?.temperatura_planta != null) c.temperaturaPlanta += 1;
      if (cc?.muestra_planta) c.muestras += 1;
      if (cc && (cc.revenimiento_planta != null || cc.temperatura_planta != null)) {
        c.demorasMin.push(min(v.ts_fin_carga_real, cc.creado_en));
      }
    }
  }

  const filas = ordenarCalificaciones([...conteos.values()].map(calificar));
  return { filas, resumen: resumirEquipo(filas) };
}

/**
 * Programas con despacho que quedaron SIN finalizar. Es la lista accionable: no dice
 * solo "falta un 20 %", dice a qué cliente le falta el control cerrado.
 */
export async function pendientesDeFinalizar({
  desde,
  hasta,
  zona,
  laboratoristaId,
}: {
  desde: Date;
  hasta: Date;
  zona: string | null;
  laboratoristaId?: string | null;
}): Promise<PendienteFinalizar[]> {
  const pedidos = await prisma.pedidos.findMany({
    where: {
      hora_solicitada: { gte: desde, lt: hasta },
      estado_pedido: "Activo",
      control_calidad_general: null,
      asignaciones_lab: {
        some: laboratoristaId ? { laboratorista_id: laboratoristaId } : {},
      },
      ...(zona ? { plantel: { zona } } : {}),
    },
    select: {
      id: true,
      hora_solicitada: true,
      cliente: { select: { empresa: true, proyecto: true } },
      plantel: { select: { nombre: true } },
      asignaciones_lab: {
        select: { laboratorista: { select: { name: true, email: true } } },
      },
      viajes: {
        where: { mixer_id: { not: null }, estado: { not: "Cancelado" } },
        select: {
          estado: true,
          ts_llegada_real: true,
          control_calidad: {
            select: { revenimiento_obra: true, temperatura_concreto: true },
          },
        },
      },
    },
    orderBy: { hora_solicitada: "asc" },
  });

  const out: PendienteFinalizar[] = [];
  for (const p of pedidos) {
    const despachados = p.viajes.filter((v) =>
      (ESTADOS_DESPACHADO as readonly string[]).includes(v.estado),
    );
    if (despachados.length === 0) continue; // todavía no se puede finalizar
    const sinLectura = p.viajes.filter(
      (v) =>
        v.ts_llegada_real != null &&
        (v.control_calidad?.revenimiento_obra == null ||
          v.control_calidad?.temperatura_concreto == null),
    ).length;
    const d = p.hora_solicitada;
    out.push({
      pedidoId: p.id,
      cliente: p.cliente.empresa,
      proyecto: p.cliente.proyecto,
      plantel: p.plantel.nombre,
      diaMs: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
      laboratoristas: p.asignaciones_lab.map(
        (a) => a.laboratorista.name ?? a.laboratorista.email ?? "(sin nombre)",
      ),
      viajesDespachados: despachados.length,
      viajesSinLectura: sinLectura,
    });
  }
  return out;
}
