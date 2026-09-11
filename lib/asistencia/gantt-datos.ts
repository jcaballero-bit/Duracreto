/**
 * Datos del Gantt de jornada vs. viajes: qué viajes le corresponden a cada persona
 * según su PUESTO, y con qué tramo del viaje se mide su trabajo.
 *
 * Cada puesto participa en un segmento distinto del ciclo, así que medir a todos con el
 * ciclo completo sería falso:
 *
 *   Motorista de mixer / de camión → el CICLO completo (carga → regreso) de los viajes
 *                                    donde va como motorista.
 *   Dosificador                    → el tiempo de CARGA de los viajes cargados en SU
 *                                    planta (la del día: reasignación o predeterminada).
 *   Operador de bomba              → el tiempo de DESCARGA de los viajes que usaron SU
 *                                    bomba y que caen DENTRO de su jornada. Una bomba
 *                                    puede tener varios operadores que se relevan por
 *                                    turno el mismo dia: el reparto sale de la jornada
 *                                    de cada uno, sin capturar el turno aparte.
 *   Operador de cargadora / Otro   → no hay medición por viaje definida: solo jornada.
 *
 * Si falta el timestamp REAL de un segmento se usa el programado y el tramo queda
 * marcado como estimado (la vista lo dibuja punteado).
 */
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolverPlantaDosificador } from "@/lib/dosificador/planta";
import { etiquetaPuesto } from "@/lib/planilla/puestos";
import { etiquetaAusencia } from "@/lib/planilla/ausencias";
import {
  cruzarJornada,
  perteneceAlDia,
  rangoEje,
  type ResumenJornada,
  type Tramo,
  type TramoTrabajo,
} from "./gantt";

/** Puestos sin una medición por viaje definida todavía. */
export const PUESTOS_SIN_MEDICION = ["Operador_Cargadora", "Otro"];

export interface UmbralesPuesto {
  minutos_hueco: number;
  verde_pct: number;
  amarillo_pct: number;
}

export const UMBRALES_POR_DEFECTO: UmbralesPuesto = {
  minutos_hueco: 45,
  verde_pct: 20,
  amarillo_pct: 40,
};

export interface DetalleViaje {
  id: number;
  cliente: string;
  proyecto: string | null;
  volumen: number;
  planta: string;
  mixer: string | null;
  /** Horarios del ciclo, ya formateados. */
  ciclo: { etiqueta: string; hora: string }[];
  estimado: boolean;
}

export interface FilaGantt {
  personaId: number;
  nombre: string;
  puesto: string;
  etiquetaPuesto: string;
  plantel: string;
  /** Unidad que operó (mixer, planta o bomba, según el puesto). */
  unidad: string;
  jornadaInicioMs: number | null;
  jornadaFinMs: number | null;
  jornadaTexto: string;
  cruzaMedianoche: boolean;
  /** Ausencia del día, si la tiene (entonces no hay jornada que medir). */
  ausencia: string | null;
  /** Este puesto se mide por viaje. */
  mide: boolean;
  /** Por qué no se mide (para decirlo en pantalla en vez de mostrar un 0 engañoso). */
  motivoNoMide: string | null;
  /** Hizo viajes pero no tiene entrada/salida capturada. */
  faltaJornada: boolean;
  /** Viajes suyos que no tienen ni hora real ni programada del segmento. */
  viajesSinHorario: number;
  /**
   * Descargas que además caen en la jornada de OTRO operador de la misma bomba (relevo
   * traslapado). Se cuentan para los dos, pero se avisa: el total del plantel no debe
   * leerse como horas de bomba.
   */
  descargasCompartidas: number;
  resumen: ResumenJornada;
  umbrales: UmbralesPuesto;
  viajes: DetalleViaje[];
}

export interface ResumenGantt {
  horasJornada: number;
  horasProductivas: number;
  horasSinViaje: number;
  pctSinViaje: number;
  personasEnRojo: number;
  personasMedidas: number;
  personasSinJornada: number;
  /**
   * Descargas de bombas CON operadores registrados que no cayeron en la jornada de
   * ninguno: o falta capturar esa jornada, o falta registrar quién operó la bomba.
   */
  descargasSinOperador: number;
}

export interface DatosGantt {
  filas: FilaGantt[];
  resumen: ResumenGantt;
  ejeDesdeMs: number | null;
  ejeHastaMs: number | null;
}

export interface PersonaParaGantt {
  id: number;
  nombre: string;
  puesto: string;
  plantel_asignado_id: number | null;
  plantelNombre: string;
  usuarioId: string | null;
  plantaPredeterminadaId: number | null;
  /** Bombas que opera (pueden ser varias personas por bomba, ver bombas_operadores). */
  bombaIds: number[];
  /** Mixer habitual (respaldo cuando no hizo viajes). */
  mixerHabitual: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (f: Date | null) => (f ? `${pad(f.getHours())}:${pad(f.getMinutes())}` : "—");
const HORA = 60;

/**
 * Personal para el Gantt. `plantelIds` en null significa "todos" (Administrador);
 * cualquier otro valor viene del alcance del rol, que resuelve la pantalla.
 */
export async function personasParaGantt(
  plantelIds: number[] | null,
): Promise<PersonaParaGantt[]> {
  const filas = await prisma.operadores.findMany({
    where: {
      activo: true,
      ...(plantelIds ? { plantel_asignado_id: { in: plantelIds } } : {}),
    },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      puesto: true,
      plantel_asignado_id: true,
      plantel_asignado: { select: { nombre: true } },
      usuario_id: true,
      usuario: { select: { planta_predeterminada_id: true } },
      bombas_operadas: { select: { bomba_id: true } },
      mixers_asignados: { select: { identificador: true } },
    },
  });
  return filas.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    puesto: p.puesto,
    plantel_asignado_id: p.plantel_asignado_id,
    plantelNombre: p.plantel_asignado?.nombre ?? "Sin plantel",
    usuarioId: p.usuario_id,
    plantaPredeterminadaId: p.usuario?.planta_predeterminada_id ?? null,
    bombaIds: p.bombas_operadas.map((b) => b.bomba_id),
    mixerHabitual: p.mixers_asignados[0]?.identificador ?? null,
  }));
}

/** Umbrales configurados por puesto (Administración › Umbrales de tiempo sin viaje). */
export async function leerUmbrales(): Promise<Map<string, UmbralesPuesto>> {
  const filas = await prisma.umbrales_ocio_puesto.findMany();
  return new Map(
    filas.map((f) => [
      f.puesto,
      { minutos_hueco: f.minutos_hueco, verde_pct: f.verde_pct, amarillo_pct: f.amarillo_pct },
    ]),
  );
}

/**
 * Planta del dosificador ese día. Su planta vive en el USUARIO del sistema
 * (`planta_predeterminada_id` + la reasignación del día), no en la ficha de personal:
 *  1. Con usuario vinculado, se resuelve con la regla que ya usa Despacho.
 *  2. Sin usuario, si su plantel tiene UNA sola planta no hay ambigüedad: es esa.
 *  3. Si el plantel tiene dos plantas y no hay vínculo, se dice que no se pudo resolver
 *     en vez de adivinar y atribuirle las cargas de la otra planta.
 */
async function plantaDelDosificador(
  persona: PersonaParaGantt,
  dia: Date,
): Promise<{ plantaId: number | null; motivo: string | null }> {
  if (persona.usuarioId) {
    const r = await resolverPlantaDosificador(
      persona.usuarioId,
      persona.plantaPredeterminadaId,
      dia,
    );
    if (r.plantaId != null) return { plantaId: r.plantaId, motivo: null };
  }
  if (persona.plantel_asignado_id != null) {
    const plantas = await prisma.plantas.findMany({
      where: { plantel_id: persona.plantel_asignado_id },
      select: { id: true },
    });
    if (plantas.length === 1) return { plantaId: plantas[0].id, motivo: null };
    if (plantas.length > 1) {
      return {
        plantaId: null,
        motivo:
          "su plantel tiene varias plantas y su ficha no está vinculada a un usuario del sistema, así que no se sabe en cuál dosificó",
      };
    }
  }
  return { plantaId: null, motivo: "no tiene planta asignada" };
}

/** Viaje tal como se necesita para el Gantt. */
type ViajeGantt = Awaited<ReturnType<typeof leerViajes>>[number];

/** A quien puede pertenecer un viaje de esta pantalla. Ver `leerViajes`. */
interface AlcanceViajes {
  /** Ids del personal listado: un viaje es suyo si va como `operador_id`. */
  personaIds: number[];
  /** Plantas donde dosificaron los dosificadores listados ese dia. */
  plantaIds: number[];
  /** Bombas que operan las personas listadas. */
  bombaIds: number[];
}

/**
 * Viajes que pueden pertenecer a alguien de la lista.
 *
 * **NO se filtra por PLANTEL, a proposito.** Lo que hace suyo un viaje a una persona no
 * depende del plantel: el motorista va como `operador_id` (puede cargar en Choloma por
 * la manana y en Santa Marta por la tarde), el dosificador se identifica por la PLANTA
 * donde estuvo ese dia (y la reasignacion diaria puede mandarlo a la planta de otro
 * plantel) y el operador de bomba por su BOMBA (que puede estar prestada a otro
 * plantel). Filtrar por plantel dejaba fuera esos viajes: la persona aparecia con menos
 * trabajo del que hizo y su tiempo "sin viaje asignado" salia inflado. El filtro de
 * plantel de la pantalla acota **a quien se lista**, nunca los viajes de esa gente.
 *
 * El `OR` es deliberadamente un SUPERCONJUNTO: solo sirve para no traer de la base
 * viajes que no le tocan a nadie de la lista. Quien decide de quien es cada viaje es el
 * filtro en memoria de `datosGantt` (por `operador_id`, por planta o por bomba), asi
 * que un `OR` de mas es inofensivo y uno de menos se ve en las pruebas.
 */
async function leerViajes(desde: Date, hasta: Date, alcance: AlcanceViajes) {
  const dueno: Prisma.viajesWhereInput[] = [];
  if (alcance.personaIds.length) dueno.push({ operador_id: { in: alcance.personaIds } });
  if (alcance.plantaIds.length) {
    // La planta del viaje, con la del pedido como respaldo (misma regla que el filtro
    // en memoria: `v.planta_id ?? v.pedido.planta_id`).
    dueno.push({ planta_id: { in: alcance.plantaIds } });
    dueno.push({ planta_id: null, pedido: { planta_id: { in: alcance.plantaIds } } });
  }
  if (alcance.bombaIds.length) {
    dueno.push({ pedido: { bombas: { some: { bomba_id: { in: alcance.bombaIds } } } } });
  }
  // Nadie de la lista puede tener viajes: no se consulta nada.
  if (dueno.length === 0) return [];

  return prisma.viajes.findMany({
    where: {
      estado: { not: "Cancelado" },
      pedido: { estado_pedido: "Activo" },
      AND: [{ OR: dueno }],
      OR: [
        { ts_inicio_carga_real: { gte: desde, lt: hasta } },
        { AND: [{ ts_inicio_carga_real: null }, { hora_inicio_carga: { gte: desde, lt: hasta } }] },
      ],
    },
    select: {
      id: true,
      operador_id: true,
      planta_id: true,
      volumen_asignado_m3: true,
      volumen_real_m3: true,
      hora_inicio_carga: true,
      hora_fin_carga: true,
      hora_salida_planta: true,
      hora_llegada_proyecto: true,
      hora_inicio_descarga: true,
      hora_fin_descarga: true,
      hora_regreso_planta: true,
      ts_inicio_carga_real: true,
      ts_fin_carga_real: true,
      ts_salida_real: true,
      ts_llegada_real: true,
      ts_inicio_descarga_real: true,
      ts_fin_descarga_real: true,
      ts_regreso_real: true,
      mixer: { select: { identificador: true, id: true } },
      planta: { select: { id: true, nombre: true } },
      pedido: {
        select: {
          planta_id: true,
          cliente: { select: { empresa: true, proyecto: true } },
          planta: { select: { id: true, nombre: true } },
          bombas: { select: { bomba_id: true } },
        },
      },
    },
  });
}

/** Extremo de un segmento: real si existe, si no el programado (marcando estimado). */
function extremo(real: Date | null, programado: Date | null): { f: Date | null; estimado: boolean } {
  if (real) return { f: real, estimado: false };
  return { f: programado, estimado: true };
}

type Segmento = "ciclo" | "carga" | "descarga";

/** Tramo de trabajo de un viaje según el segmento que le toca al puesto. */
function tramoDeViaje(v: ViajeGantt, segmento: Segmento): TramoTrabajo | null {
  let ini: { f: Date | null; estimado: boolean };
  let fin: { f: Date | null; estimado: boolean };
  if (segmento === "ciclo") {
    ini = extremo(v.ts_inicio_carga_real, v.hora_inicio_carga);
    fin = extremo(v.ts_regreso_real, v.hora_regreso_planta);
  } else if (segmento === "carga") {
    ini = extremo(v.ts_inicio_carga_real, v.hora_inicio_carga);
    fin = extremo(v.ts_fin_carga_real, v.hora_fin_carga);
  } else {
    ini = extremo(v.ts_inicio_descarga_real, v.hora_inicio_descarga);
    fin = extremo(v.ts_fin_descarga_real, v.hora_fin_descarga);
  }
  if (!ini.f || !fin.f) return null; // sin horario: no se puede ubicar en el tiempo
  const inicioMs = ini.f.getTime();
  const finMs = fin.f.getTime();
  if (finMs <= inicioMs) return null;
  return { viajeId: v.id, inicioMs, finMs, estimado: ini.estimado || fin.estimado };
}

function detalleDe(v: ViajeGantt, segmento: Segmento): DetalleViaje {
  const planta = v.planta ?? v.pedido.planta;
  const t = tramoDeViaje(v, segmento);
  return {
    id: v.id,
    cliente: v.pedido.cliente.empresa,
    proyecto: v.pedido.cliente.proyecto,
    volumen: v.volumen_real_m3 ?? v.volumen_asignado_m3,
    planta: planta?.nombre ?? "—",
    mixer: v.mixer?.identificador ?? null,
    ciclo: [
      { etiqueta: "Inicio de carga", hora: hm(v.ts_inicio_carga_real ?? v.hora_inicio_carga) },
      { etiqueta: "Fin de carga", hora: hm(v.ts_fin_carga_real ?? v.hora_fin_carga) },
      { etiqueta: "Salida de planta", hora: hm(v.ts_salida_real ?? v.hora_salida_planta) },
      { etiqueta: "Llegada a obra", hora: hm(v.ts_llegada_real ?? v.hora_llegada_proyecto) },
      { etiqueta: "Inicio de descarga", hora: hm(v.ts_inicio_descarga_real ?? v.hora_inicio_descarga) },
      { etiqueta: "Fin de descarga", hora: hm(v.ts_fin_descarga_real ?? v.hora_fin_descarga) },
      { etiqueta: "Regreso a planta", hora: hm(v.ts_regreso_real ?? v.hora_regreso_planta) },
    ],
    estimado: t?.estimado ?? true,
  };
}

/**
 * Arma el Gantt del día para un conjunto de personas YA acotado por el alcance del rol
 * (la pantalla resuelve el alcance; aquí no se decide quién se ve).
 */
export async function datosGantt(
  dia: Date,
  personas: PersonaParaGantt[],
  umbrales: Map<string, UmbralesPuesto>,
): Promise<DatosGantt> {
  const inicioDia = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate());
  const finDia = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1);
  // La consulta trae una ventana AMPLIA (medio día más) porque un turno de noche puede
  // seguir cargando pasada la medianoche y esos viajes son de la jornada de este día.
  // El recorte fino lo hace `perteneceAlDia` por persona: lo que arranque el día
  // siguiente y no toque su jornada NO se dibuja aquí.
  const finAmplio = new Date(finDia.getTime() + 12 * 60 * 60_000);

  // La planta de cada dosificador se resuelve ANTES de leer los viajes: entra en el
  // alcance de la consulta (ver `leerViajes`) y ademas asi las N consultas salen en
  // paralelo en vez de una por vuelta del bucle de abajo.
  const plantaPorDosificador = new Map<number, { plantaId: number | null; motivo: string | null }>(
    await Promise.all(
      personas
        .filter((p) => p.puesto === "Dosificador")
        .map(
          async (p) =>
            [p.id, await plantaDelDosificador(p, dia)] as [
              number,
              { plantaId: number | null; motivo: string | null },
            ],
        ),
    ),
  );

  // A quien puede pertenecer un viaje de esta pantalla. NO lleva plantel: un viaje es
  // de una persona por su motorista, su planta o su bomba, y ninguno de los tres se
  // limita al plantel donde la persona esta asignada (ver `leerViajes`).
  const alcance: AlcanceViajes = {
    personaIds: personas.map((p) => p.id),
    plantaIds: [
      ...new Set(
        [...plantaPorDosificador.values()]
          .map((x) => x.plantaId)
          .filter((x): x is number => x != null),
      ),
    ],
    bombaIds: [...new Set(personas.flatMap((p) => p.bombaIds))],
  };

  const [asistencias, viajes] = await Promise.all([
    prisma.asistencia_operativos.findMany({
      where: {
        fecha: { gte: inicioDia, lt: finDia },
        persona_id: { in: personas.length ? personas.map((p) => p.id) : [-1] },
      },
    }),
    leerViajes(inicioDia, finAmplio, alcance),
  ]);
  const asistPorPersona = new Map(asistencias.map((a) => [a.persona_id, a]));

  // ── Relevos de bomba ────────────────────────────────────────────────────
  // Una bomba puede tener varios operadores que se relevan el mismo día. El turno de
  // cada uno se deduce de SU jornada, así que aquí se guarda, por bomba, la jornada de
  // cada operador: con eso se sabe a quién le toca cada descarga, cuáles quedaron
  // compartidas (relevo traslapado) y cuáles no cayeron en la jornada de nadie.
  const jornadaDe = new Map<number, Tramo | null>();
  for (const p of personas) {
    const a = asistPorPersona.get(p.id);
    jornadaDe.set(
      p.id,
      a?.hora_entrada && a?.hora_salida
        ? { inicioMs: a.hora_entrada.getTime(), finMs: a.hora_salida.getTime() }
        : null,
    );
  }
  const operadoresDeBomba = new Map<number, number[]>();
  for (const p of personas) {
    for (const bombaId of p.bombaIds) {
      operadoresDeBomba.set(bombaId, [...(operadoresDeBomba.get(bombaId) ?? []), p.id]);
    }
  }
  /** ¿La jornada de esta persona cubre (aunque sea en parte) este tramo? */
  const cubre = (personaId: number, t: TramoTrabajo) => {
    const j = jornadaDe.get(personaId);
    return !!j && t.finMs > j.inicioMs && t.inicioMs < j.finMs;
  };

  const filas: FilaGantt[] = [];

  for (const persona of personas) {
    const a = asistPorPersona.get(persona.id) ?? null;
    const jornada: Tramo | null =
      a?.hora_entrada && a?.hora_salida
        ? { inicioMs: a.hora_entrada.getTime(), finMs: a.hora_salida.getTime() }
        : null;
    const umb = umbrales.get(persona.puesto) ?? UMBRALES_POR_DEFECTO;

    // ── Qué viajes son suyos y con qué segmento se miden ────────────────────
    let mios: ViajeGantt[] = [];
    let segmento: Segmento = "ciclo";
    let mide = true;
    let motivoNoMide: string | null = null;
    let unidad = "—";
    /** Solo cuentan los viajes que toquen la jornada (turnos compartidos). */
    let soloDentroDeJornada = false;

    if (PUESTOS_SIN_MEDICION.includes(persona.puesto)) {
      mide = false;
      motivoNoMide = "sin medición por viaje";
    } else if (persona.puesto === "Dosificador") {
      segmento = "carga";
      soloDentroDeJornada = true;
      const { plantaId, motivo } = plantaPorDosificador.get(persona.id) ?? {
        plantaId: null,
        motivo: "no tiene planta asignada",
      };
      if (plantaId == null) {
        mide = false;
        motivoNoMide = motivo;
      } else {
        mios = viajes.filter((v) => (v.planta_id ?? v.pedido.planta_id) === plantaId);
        unidad = mios[0]?.planta?.nombre ?? mios[0]?.pedido.planta?.nombre ?? `Planta ${plantaId}`;
      }
    } else if (persona.puesto === "Operador_Bomba") {
      segmento = "descarga";
      soloDentroDeJornada = true;
      if (persona.bombaIds.length === 0) {
        mide = false;
        motivoNoMide = "no tiene bomba asignada";
      } else {
        const suyas = new Set(persona.bombaIds);
        mios = viajes.filter((v) => v.pedido.bombas.some((b) => suyas.has(b.bomba_id)));
        const bombas = await prisma.bombas.findMany({
          where: { id: { in: persona.bombaIds } },
          select: { identificador: true },
        });
        unidad = bombas.map((b) => b.identificador).join(", ");
      }
    } else {
      // Motorista de mixer o de camión: el ciclo completo de SUS viajes.
      segmento = "ciclo";
      mios = viajes.filter((v) => v.operador_id === persona.id);
      const usados = [...new Set(mios.map((v) => v.mixer?.identificador).filter(Boolean))];
      unidad = usados.length ? usados.join(", ") : persona.mixerHabitual ?? "—";
    }

    // ── Tramos ─────────────────────────────────────────────────────────────
    let viajesSinHorario = 0;
    let descargasCompartidas = 0;
    const tramos: TramoTrabajo[] = [];
    const detalles: DetalleViaje[] = [];
    if (mide) {
      for (const v of mios) {
        const t = tramoDeViaje(v, segmento);
        if (!t) {
          // Sin horario no se puede ubicar en el tiempo, pero su carga sí tiene fecha
          // (la consulta filtra por ella): si arrancó otro día, no es asunto de hoy.
          const arranque = (v.ts_inicio_carga_real ?? v.hora_inicio_carga)?.getTime();
          if (arranque != null && arranque >= inicioDia.getTime() && arranque < finDia.getTime()) {
            viajesSinHorario += 1;
          }
          continue;
        }
        // Solo el trabajo de ESTE día: lo que arrancó hoy (aunque termine de madrugada)
        // más lo que cae en una jornada de hoy que cruza la medianoche.
        if (!perteneceAlDia(t, inicioDia.getTime(), finDia.getTime(), jornada)) continue;
        // Para dosificador y operador de bomba, un viaje fuera de su jornada es del
        // turno de otra persona: no se le atribuye ni se marca como anomalía.
        if (soloDentroDeJornada && jornada) {
          if (t.finMs <= jornada.inicioMs || t.inicioMs >= jornada.finMs) continue;
        }
        // Relevo traslapado: la descarga cae también en la jornada de otro operador de
        // la misma bomba. Se cuenta para los dos (los dos estaban en turno), pero queda
        // avisado para que el total del plantel no se lea como horas de bomba.
        if (persona.puesto === "Operador_Bomba") {
          const bombasDelViaje = v.pedido.bombas.map((b) => b.bomba_id);
          const otrosEnTurno = bombasDelViaje
            .flatMap((b) => operadoresDeBomba.get(b) ?? [])
            .filter((id) => id !== persona.id && cubre(id, t));
          if (otrosEnTurno.length > 0) descargasCompartidas += 1;
        }
        tramos.push(t);
        detalles.push(detalleDe(v, segmento));
      }
    }

    const resumen = cruzarJornada(mide ? jornada : null, mide ? tramos : [], umb.minutos_hueco);

    filas.push({
      personaId: persona.id,
      nombre: persona.nombre,
      puesto: persona.puesto,
      etiquetaPuesto: etiquetaPuesto(persona.puesto),
      plantel: persona.plantelNombre,
      unidad,
      jornadaInicioMs: jornada?.inicioMs ?? null,
      jornadaFinMs: jornada?.finMs ?? null,
      jornadaTexto: jornada
        ? `${hm(a!.hora_entrada)} - ${hm(a!.hora_salida)}`
        : a?.tipo_ausencia
          ? etiquetaAusencia(a.tipo_ausencia)
          : "sin jornada registrada",
      cruzaMedianoche: !!(
        a?.hora_entrada &&
        a?.hora_salida &&
        a.hora_salida.getDate() !== a.hora_entrada.getDate()
      ),
      ausencia: a?.tipo_ausencia ? etiquetaAusencia(a.tipo_ausencia) : null,
      mide,
      motivoNoMide,
      faltaJornada: !jornada && !a?.tipo_ausencia && tramos.length > 0,
      viajesSinHorario,
      descargasCompartidas,
      resumen,
      umbrales: umb,
      viajes: detalles,
    });
  }

  // ── Resumen del plantel ──────────────────────────────────────────────────
  const medidas = filas.filter((f) => f.mide && f.resumen.minutosJornada > 0);
  const minJornada = medidas.reduce((s, f) => s + f.resumen.minutosJornada, 0);
  const minProd = medidas.reduce((s, f) => s + f.resumen.minutosProductivos, 0);
  const minOcio = medidas.reduce((s, f) => s + f.resumen.minutosSinViaje, 0);
  const enRojo = medidas.filter((f) => f.resumen.pctSinViaje > f.umbrales.amarillo_pct).length;

  // Descargas que no cayeron en la jornada de ningún operador de esa bomba: falta
  // capturar una jornada, o falta registrar quién la operó.
  let descargasSinOperador = 0;
  for (const v of viajes) {
    const bombasConGente = v.pedido.bombas
      .map((b) => b.bomba_id)
      .filter((b) => (operadoresDeBomba.get(b) ?? []).length > 0);
    if (bombasConGente.length === 0) continue;
    const t = tramoDeViaje(v, "descarga");
    if (!t) continue;
    const alguien = bombasConGente
      .flatMap((b) => operadoresDeBomba.get(b) ?? [])
      .some((id) => cubre(id, t));
    // Solo este día: una descarga del día siguiente no es una alerta de hoy.
    if (!alguien && perteneceAlDia(t, inicioDia.getTime(), finDia.getTime(), null)) {
      descargasSinOperador += 1;
    }
  }

  const paraEje: Tramo[] = [];
  for (const f of filas) {
    if (f.jornadaInicioMs != null && f.jornadaFinMs != null) {
      paraEje.push({ inicioMs: f.jornadaInicioMs, finMs: f.jornadaFinMs });
    }
    paraEje.push(...f.resumen.tramos, ...f.resumen.fueraDeJornada);
  }
  const eje = rangoEje(paraEje);

  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    filas,
    resumen: {
      horasJornada: r1(minJornada / HORA),
      horasProductivas: r1(minProd / HORA),
      horasSinViaje: r1(minOcio / HORA),
      pctSinViaje: minJornada > 0 ? r1((minOcio / minJornada) * 100) : 0,
      personasEnRojo: enRojo,
      personasMedidas: medidas.length,
      personasSinJornada: filas.filter((f) => f.faltaJornada).length,
      descargasSinOperador,
    },
    ejeDesdeMs: eje?.desdeMs ?? null,
    ejeHastaMs: eje?.hastaMs ?? null,
  };
}
