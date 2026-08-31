"use server";

// Carga de PRODUCCION HISTORICA: importación desde archivo y captura manual.
//
// Solo el Administrador. Es un dato que altera los reportes históricos de toda la
// empresa, así que no puede tocarlo cualquiera — y como todo en este sistema, el permiso
// se valida aquí, en el servidor, no ocultando el menú.
//
// Ninguna otra parte del sistema escribe en esta tabla: se llena únicamente desde aquí.

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/guard";
import { parseCSV } from "@/lib/csv";
import {
  chocaConSistema,
  conflictoDeAlcance,
  esGranularidadHistorica,
  normalizarAlias,
  ym,
  ymd,
  type GranularidadHistorica,
} from "@/lib/produccion/historica";
import { cobertura } from "@/lib/produccion/consulta";

export interface Res {
  ok: boolean;
  mensaje?: string;
}

async function usuario(): Promise<string> {
  const s = await auth();
  return s?.user?.name ?? s?.user?.email ?? "sistema";
}

/** Fecha "YYYY-MM-DD" o "DD/MM/YYYY" a medianoche LOCAL. `null` si no se entiende. */
export async function parsearFechaHistorica(texto: string): Promise<Date | null> {
  return parsearFecha(texto);
}

function parsearFecha(texto: string): Date | null {
  const t = texto.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  // Día primero: es la convención de Honduras y la del resto del sistema.
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return valida(Number(m[3]), Number(m[2]), Number(m[1]));
  // Solo mes: "2025-07" o "07/2025" — se ancla al día 1.
  m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return valida(Number(m[1]), Number(m[2]), 1);
  m = t.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) return valida(Number(m[2]), Number(m[1]), 1);
  return null;
}

/** Rechaza fechas que no existen en el calendario (31/02 no rebota a marzo). */
function valida(anio: number, mes: number, dia: number): Date | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(anio, mes - 1, dia);
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return d;
}

/**
 * "YYYY-MM-DD" a medianoche LOCAL.
 *
 * NUNCA se debe usar `new Date("2026-07-01")` para esto: el estándar manda parsear una
 * fecha sin hora como UTC, así que en UTC-6 se vuelve el 30 de junio a las 18:00 y todo el
 * archivo se guarda **un día antes**. Pasó exactamente eso al importar julio de 2026.
 */
function desdeIso(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

/** Número con coma o punto decimal. Una celda VACÍA no es 0: es "sin dato". */
function parsearVolumen(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null; // celda vacía: el día no se carga (ver `vacias` abajo)
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface FilaPrevia {
  linea: number;
  fechaIso: string;
  plantelTexto: string;
  plantelId: number | null;
  /** Texto de la columna de planta, si el archivo trae el detalle por planta. */
  plantaTexto?: string;
  /** Planta resuelta; `null` = la fila es del PLANTEL completo. */
  plantaId: number | null;
  volumen: number | null;
  /** "crear" | "actualizar" | "choca" | "error" */
  accion: string;
  motivo?: string;
}

export interface Previsualizacion {
  ok: boolean;
  mensaje?: string;
  filas?: FilaPrevia[];
  resumen?: {
    crear: number;
    actualizar: number;
    choca: number;
    error: number;
    /** Filas con la celda de volumen en blanco: no se cargan (no son un 0). */
    vacias: number;
    plantelesSinVincular: string[];
    /** Nombres de la columna de planta que no calzaron con ninguna planta del plantel. */
    plantasSinReconocer: string[];
  };
}

/**
 * Lee el archivo y dice QUÉ pasaría, sin escribir nada.
 *
 * `mapeo` traduce los encabezados del archivo a los tres campos que se necesitan; los
 * archivos históricos vienen de hojas con formatos distintos y casi nunca traen los
 * nombres esperados.
 */
export async function previsualizarHistoricaAction(
  texto: string,
  granularidad: string,
  mapeo: { fecha: string; plantel: string; volumen: string; planta?: string },
): Promise<Previsualizacion> {
  const guard = await exigirAdmin();
  if (!guard.ok) return { ok: false, mensaje: guard.mensaje };
  if (!esGranularidadHistorica(granularidad)) {
    return { ok: false, mensaje: "Granularidad inválida." };
  }

  const filasCsv = parseCSV(texto);
  if (filasCsv.length === 0) return { ok: false, mensaje: "El archivo no tiene filas." };

  const alias = new Map(
    (await prisma.alias_plantel_historico.findMany()).map((a) => [a.alias, a.plantel_id]),
  );
  const existentes = new Map(
    (
      await prisma.produccion_historica.findMany({
        where: { granularidad },
        select: { fecha: true, plantel_id: true, planta_id: true },
      })
    ).map((f) => [`${ymd(f.fecha)}|${f.plantel_id}|${f.planta_id ?? ""}`, true]),
  );

  // Plantas dosificadoras, indexadas por plantel + nombre normalizado. El archivo viejo
  // trae el codigo tal cual lo escribio quien lo llevaba ("STALO", "Sany"), asi que la
  // comparacion ignora acentos y mayusculas, igual que la de planteles.
  const plantasPorPlantel = new Map<number, Map<string, number>>();
  for (const pl of await prisma.plantas.findMany({
    select: { id: true, nombre: true, plantel_id: true },
  })) {
    const delPlantel = plantasPorPlantel.get(pl.plantel_id) ?? new Map<string, number>();
    delPlantel.set(normalizarAlias(pl.nombre), pl.id);
    plantasPorPlantel.set(pl.plantel_id, delPlantel);
  }

  const filas: FilaPrevia[] = [];
  const sinVincular = new Set<string>();
  const plantasSinReconocer = new Set<string>();
  const candidatas: { fechaMs: number; plantelId: number }[] = [];

  filasCsv.forEach((fila, i) => {
    const linea = i + 2; // +1 por el encabezado, +1 porque las líneas se cuentan desde 1
    const fechaTxt = (fila[mapeo.fecha] ?? "").trim();
    const plantelTxt = (fila[mapeo.plantel] ?? "").trim();
    const volTxt = (fila[mapeo.volumen] ?? "").trim();
    // La columna de planta es OPCIONAL: sin ella, cada fila es del plantel completo.
    const plantaTxt = mapeo.planta ? (fila[mapeo.planta] ?? "").trim() : "";
    if (!fechaTxt && !plantelTxt && !volTxt) return; // fila vacía: se ignora

    const base = {
      linea,
      fechaIso: fechaTxt,
      plantelTexto: plantelTxt,
      plantaTexto: plantaTxt || undefined,
      plantaId: null as number | null,
      volumen: null as number | null,
    };
    const fecha = parsearFecha(fechaTxt);
    if (!fecha) {
      filas.push({ ...base, plantelId: null, accion: "error", motivo: "fecha inválida" });
      return;
    }
    const volumen = parsearVolumen(volTxt);
    if (volumen === null) {
      // Una celda VACÍA (el Excel deja en blanco los días sin producción) no es un error
      // de formato ni un 0: simplemente no se carga. Un día sin fila se ve igual que un
      // día en 0, y así la lista no se llena de "0.00" que nadie escribió.
      filas.push({
        ...base,
        plantelId: null,
        accion: volTxt.trim() === "" ? "vacia" : "error",
        motivo: volTxt.trim() === "" ? "sin volumen: no se carga" : "volumen inválido",
      });
      return;
    }
    const plantelId = alias.get(normalizarAlias(plantelTxt)) ?? null;
    if (plantelId === null) {
      sinVincular.add(plantelTxt);
      filas.push({
        ...base,
        volumen,
        plantelId: null,
        accion: "error",
        motivo: "plantel sin vincular",
      });
      return;
    }
    // La planta se busca DENTRO del plantel de la fila: dos planteles pueden tener
    // plantas con nombres parecidos, y el archivo no siempre las distingue.
    let plantaId: number | null = null;
    if (plantaTxt) {
      plantaId = plantasPorPlantel.get(plantelId)?.get(normalizarAlias(plantaTxt)) ?? null;
      if (plantaId === null) {
        plantasSinReconocer.add(`${plantaTxt} (${plantelTxt})`);
        filas.push({
          ...base,
          volumen,
          plantelId,
          accion: "error",
          motivo: "ese plantel no tiene una planta con ese nombre",
        });
        return;
      }
    }
    // Mensual se ancla al día 1: un total del mes no pertenece a un día concreto.
    const fechaFinal =
      granularidad === "Mensual" ? new Date(fecha.getFullYear(), fecha.getMonth(), 1) : fecha;
    candidatas.push({ fechaMs: fechaFinal.getTime(), plantelId });
    filas.push({
      linea,
      fechaIso: ymd(fechaFinal),
      plantelTexto: plantelTxt,
      plantaTexto: plantaTxt || undefined,
      plantelId,
      plantaId,
      volumen,
      accion: existentes.has(`${ymd(fechaFinal)}|${plantelId}|${plantaId ?? ""}`)
        ? "actualizar"
        : "crear",
    });
  });

  // Choques con el sistema: hay viajes completados en ese periodo y plantel.
  if (candidatas.length > 0) {
    const desde = new Date(Math.min(...candidatas.map((c) => c.fechaMs)));
    const hastaBase = new Date(Math.max(...candidatas.map((c) => c.fechaMs)));
    const hasta = new Date(hastaBase.getFullYear(), hastaBase.getMonth() + 1, 1);
    const cob = await cobertura(desde, hasta, null);
    for (const f of filas) {
      if (f.accion !== "crear" && f.accion !== "actualizar") continue;
      if (f.plantelId === null) continue;
      const choca = chocaConSistema(
        {
          fechaMs: desdeIso(f.fechaIso).getTime(),
          plantelId: f.plantelId,
          granularidad: granularidad as GranularidadHistorica,
        },
        cob.dias,
        cob.meses,
      );
      if (choca) {
        f.accion = "choca";
        f.motivo =
          "el sistema ya tiene viajes completados de ese periodo: el dato se archiva pero NO se grafica";
      }
    }
  }

  return {
    ok: true,
    filas,
    resumen: {
      crear: filas.filter((f) => f.accion === "crear").length,
      actualizar: filas.filter((f) => f.accion === "actualizar").length,
      choca: filas.filter((f) => f.accion === "choca").length,
      error: filas.filter((f) => f.accion === "error").length,
      vacias: filas.filter((f) => f.accion === "vacia").length,
      plantelesSinVincular: [...sinVincular],
      plantasSinReconocer: [...plantasSinReconocer],
    },
  };
}

/** Confirma la importación previsualizada. */
export async function importarHistoricaAction(
  texto: string,
  granularidad: string,
  mapeo: { fecha: string; plantel: string; volumen: string; planta?: string },
  observaciones: string,
): Promise<Res & { creadas?: number; actualizadas?: number; omitidas?: number }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  const previa = await previsualizarHistoricaAction(texto, granularidad, mapeo);
  if (!previa.ok || !previa.filas) return { ok: false, mensaje: previa.mensaje };

  const quien = await usuario();
  let creadas = 0;
  let actualizadas = 0;
  let omitidas = 0;

  for (const f of previa.filas) {
    if (f.accion === "error" || f.accion === "vacia" || f.plantelId === null || f.volumen === null) {
      omitidas += 1;
      continue;
    }
    const r = await guardarFila(
      desdeIso(f.fechaIso),
      f.plantelId,
      f.plantaId,
      f.volumen,
      granularidad as GranularidadHistorica,
      observaciones,
      quien,
    );
    if (!r.ok) {
      omitidas += 1;
      continue;
    }
    if (r.creada) creadas += 1;
    else actualizadas += 1;
  }
  revalidatePath("/administracion");
  revalidatePath("/");
  return { ok: true, creadas, actualizadas, omitidas };
}

/**
 * Alta o actualización de una fila, con las dos reglas que impiden duplicar el volumen:
 *
 *  · no se puede tener detalle DIARIO y total MENSUAL del mismo mes y plantel — el
 *    mensual sería la suma de los diarios contada dos veces;
 *  · no se puede tener el total del PLANTEL y el detalle de sus PLANTAS en la misma
 *    fecha, por lo mismo (`conflictoDeAlcance`).
 *
 * `plantaId` en `null` significa que la fila es del plantel completo.
 */
async function guardarFila(
  fecha: Date,
  plantelId: number,
  plantaId: number | null,
  volumen: number,
  granularidad: GranularidadHistorica,
  observaciones: string,
  quien: string,
): Promise<Res & { creada?: boolean }> {
  // La planta tiene que ser de ESE plantel: si no, el volumen quedaría atribuido a un
  // plantel al que no pertenece y el desglose mentiría.
  if (plantaId != null) {
    const planta = await prisma.plantas.findUnique({
      where: { id: plantaId },
      select: { plantel_id: true },
    });
    if (!planta) return { ok: false, mensaje: "No existe esa planta." };
    if (planta.plantel_id !== plantelId) {
      return { ok: false, mensaje: "Esa planta no pertenece al plantel elegido." };
    }
  }

  const inicioMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  const finMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 1);
  const opuesta = granularidad === "Diaria" ? "Mensual" : "Diaria";
  const choque = await prisma.produccion_historica.findFirst({
    where: {
      plantel_id: plantelId,
      granularidad: opuesta,
      fecha: { gte: inicioMes, lt: finMes },
    },
  });
  if (choque) {
    return {
      ok: false,
      mensaje:
        granularidad === "Mensual"
          ? "Ese mes ya tiene detalle DIARIO cargado para este plantel: el total mensual duplicaría el volumen."
          : "Ese mes ya tiene un total MENSUAL cargado para este plantel: agregar días duplicaría el volumen. Elimina el total mensual primero.",
    };
  }

  // Lo que ya hay para esa misma fecha, plantel y granularidad — con qué ALCANCE se
  // cargó cada fila (una planta concreta, o el plantel completo).
  const hermanas = await prisma.produccion_historica.findMany({
    where: { fecha, plantel_id: plantelId, granularidad },
    select: { id: true, planta_id: true, volumen_m3: true },
  });
  const previa = hermanas.find((h) => h.planta_id === plantaId) ?? null;
  const conflicto = conflictoDeAlcance(
    plantaId,
    hermanas.filter((h) => h.id !== previa?.id).map((h) => h.planta_id),
  );
  if (conflicto) return { ok: false, mensaje: conflicto };

  // La unicidad la aplican dos índices PARCIALES (uno para las filas de plantel y otro
  // para las de planta), que Prisma no puede expresar como `@@unique`, así que aquí no
  // se puede hacer `upsert` por clave compuesta: se busca y se decide.
  const fila = previa
    ? await prisma.produccion_historica.update({
        where: { id: previa.id },
        data: { volumen_m3: volumen, observaciones: observaciones || null, cargado_por: quien },
      })
    : await prisma.produccion_historica.create({
        data: {
          fecha,
          plantel_id: plantelId,
          planta_id: plantaId,
          volumen_m3: volumen,
          granularidad,
          observaciones: observaciones || null,
          cargado_por: quien,
        },
      });

  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "produccion_historica",
      registro_id: fila.id,
      usuario: quien,
      campo_modificado: "volumen_m3",
      valor_anterior: previa ? String(previa.volumen_m3) : null,
      valor_nuevo: String(volumen),
      motivo: previa
        ? "Actualizacion de produccion historica"
        : `Carga de produccion historica (${granularidad}${plantaId != null ? ", por planta" : ""})`,
    },
  });
  return { ok: true, creada: !previa };
}

/** Captura manual de una fila. */
export async function guardarHistoricaAction(entrada: {
  fechaIso: string;
  plantelId: number;
  /** Planta dosificadora, o nada/`null` para cargar el total del plantel. */
  plantaId?: number | null;
  volumen: number;
  granularidad: string;
  observaciones?: string;
}): Promise<Res> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  if (!esGranularidadHistorica(entrada.granularidad)) {
    return { ok: false, mensaje: "Granularidad inválida." };
  }
  const fecha = parsearFecha(entrada.fechaIso);
  if (!fecha) return { ok: false, mensaje: "Fecha inválida." };
  if (!(entrada.volumen >= 0)) return { ok: false, mensaje: "El volumen debe ser 0 o más." };

  const fechaFinal =
    entrada.granularidad === "Mensual"
      ? new Date(fecha.getFullYear(), fecha.getMonth(), 1)
      : fecha;

  const r = await guardarFila(
    fechaFinal,
    entrada.plantelId,
    entrada.plantaId ?? null,
    entrada.volumen,
    entrada.granularidad,
    entrada.observaciones ?? "",
    await usuario(),
  );
  if (r.ok) {
    revalidatePath("/administracion");
    revalidatePath("/");
  }
  return r;
}

/** ¿Esta carga chocaría con datos del sistema? Se consulta ANTES de guardar, para avisar. */
export async function verificarChoqueAction(entrada: {
  fechaIso: string;
  plantelId: number;
  granularidad: string;
}): Promise<{ ok: boolean; choca?: boolean; mensaje?: string }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return { ok: false, mensaje: guard.mensaje };
  if (!esGranularidadHistorica(entrada.granularidad)) return { ok: false, mensaje: "Granularidad inválida." };
  const fecha = parsearFecha(entrada.fechaIso);
  if (!fecha) return { ok: false, mensaje: "Fecha inválida." };

  const inicio = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  const fin = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 1);
  const cob = await cobertura(inicio, fin, [entrada.plantelId]);
  return {
    ok: true,
    choca: chocaConSistema(
      {
        fechaMs: fecha.getTime(),
        plantelId: entrada.plantelId,
        granularidad: entrada.granularidad,
      },
      cob.dias,
      cob.meses,
    ),
  };
}

export async function eliminarHistoricaAction(id: number): Promise<Res> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  const fila = await prisma.produccion_historica.findUnique({ where: { id } });
  if (!fila) return { ok: false, mensaje: "No existe esa carga." };
  await prisma.produccion_historica.delete({ where: { id } });
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "produccion_historica",
      registro_id: id,
      usuario: await usuario(),
      campo_modificado: "volumen_m3",
      valor_anterior: String(fila.volumen_m3),
      valor_nuevo: null,
      motivo: `Baja de produccion historica (${ym(fila.fecha)})`,
    },
  });
  revalidatePath("/administracion");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Borra EN LOTE las cargas que coinciden con el filtro de la pantalla.
 *
 * Existe porque una importación equivocada deja decenas de filas y borrarlas una por una
 * no es razonable — pasó con el archivo de julio de 2026, que entró con las fechas
 * corridas un día. Es una operación destructiva, así que:
 *  · exige Administrador (como todo lo de esta pantalla),
 *  · el filtro es EXPLÍCITO: sin año se borra todo, y la pantalla lo dice antes,
 *  · deja UNA entrada de bitácora con el alcance, el conteo y el volumen total, en vez de
 *    inundar el registro con una entrada por fila.
 */
export async function eliminarLoteHistoricaAction(entrada: {
  anio: number | null;
  plantelId?: number | null;
  granularidad?: string | null;
}): Promise<Res & { borradas?: number; volumen?: number }> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;

  const where = {
    ...(entrada.anio
      ? { fecha: { gte: new Date(entrada.anio, 0, 1), lt: new Date(entrada.anio + 1, 0, 1) } }
      : {}),
    ...(entrada.plantelId ? { plantel_id: entrada.plantelId } : {}),
    ...(entrada.granularidad && esGranularidadHistorica(entrada.granularidad)
      ? { granularidad: entrada.granularidad }
      : {}),
  };

  // Se mide ANTES de borrar: es lo que se va a registrar y lo que se le informa al usuario.
  const afectadas = await prisma.produccion_historica.findMany({
    where,
    select: { volumen_m3: true },
  });
  if (afectadas.length === 0) return { ok: true, borradas: 0, volumen: 0 };
  const volumen = Math.round(afectadas.reduce((a, f) => a + f.volumen_m3, 0) * 100) / 100;

  const r = await prisma.produccion_historica.deleteMany({ where });
  const alcance = [
    entrada.anio ? `año ${entrada.anio}` : "todos los años",
    entrada.plantelId ? `plantel ${entrada.plantelId}` : null,
    entrada.granularidad ?? null,
  ]
    .filter(Boolean)
    .join(", ");
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "produccion_historica",
      registro_id: 0, // baja en lote: no es una fila concreta
      usuario: await usuario(),
      campo_modificado: "volumen_m3",
      valor_anterior: String(volumen),
      valor_nuevo: null,
      motivo: `Baja EN LOTE de produccion historica (${alcance}): ${r.count} filas, ${volumen} m3`,
    },
  });
  revalidatePath("/administracion");
  revalidatePath("/");
  return { ok: true, borradas: r.count, volumen };
}

/** Recuerda cómo se llama un plantel en los archivos históricos. */
export async function vincularAliasAction(alias: string, plantelId: number): Promise<Res> {
  const guard = await exigirAdmin();
  if (!guard.ok) return guard;
  const clave = normalizarAlias(alias);
  if (!clave) return { ok: false, mensaje: "El alias no puede ir vacío." };
  const quien = await usuario();
  await prisma.alias_plantel_historico.upsert({
    where: { alias: clave },
    create: { alias: clave, plantel_id: plantelId, creado_por: quien },
    update: { plantel_id: plantelId },
  });
  revalidatePath("/administracion");
  return { ok: true };
}
