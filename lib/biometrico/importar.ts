/**
 * Importación del archivo del reloj a `asistencia_operativos`.
 *
 * Aquí vive lo que TOCA la base; la interpretación del archivo es de `parseo.ts` y el
 * cálculo de horas es de `lib/planilla/horas.ts`. Las horas SIEMPRE se recalculan desde
 * las marcas con `calcularHorasTurno`, así que hay una sola fuente de verdad
 * independientemente de si el dato entró por el reloj o a mano.
 *
 * Protección contra sobreescritura: una fila con `origen = "Manual"` (digitada o
 * corregida a mano) NO se reemplaza en silencio. La previsualización la reporta como
 * conflicto y solo se sobrescribe si quien importa lo confirma explícitamente.
 */
import { prisma } from "@/lib/prisma";
import { calcularHorasTurno } from "@/lib/planilla/horas";
import { leerBandas } from "@/lib/planilla/consulta";
import { iso, type RegistroReloj, type ResumenArchivo } from "./parseo";

export interface VinculoPersona {
  codigo: string;
  nombreReloj: string;
  registros: number;
  conMarcas: number;
  ausencias: number;
  departamentos: string[];
  /** Persona del catálogo ya vinculada a este código (si existe). */
  personaId: number | null;
  personaNombre: string | null;
  /** Marcado como "no pertenece al personal operativo". */
  ignorado: boolean;
}

export interface VinculoDepartamento {
  departamento: string;
  registros: number;
  plantelId: number | null;
  plantelNombre: string | null;
}

export interface Conflicto {
  codigo: string;
  persona: string;
  fechaISO: string;
  /** Lo que hay guardado a mano. */
  actual: string;
  /** Lo que traería el archivo. */
  nuevo: string;
}

export interface PreviaImportacion {
  filasDatos: number;
  desdeISO: string | null;
  hastaISO: string | null;
  fechas: string[];
  personasDistintas: number;
  registrosConMarcas: number;
  ausencias: number;
  incompletas: number;
  crucesMedianoche: number;
  vinculos: VinculoPersona[];
  sinVincular: number;
  departamentos: VinculoDepartamento[];
  departamentosSinMapeo: number;
  problemas: ResumenArchivo["problemas"];
  encabezadosInesperados: string[];
  conflictos: Conflicto[];
  /** Registros que sí se pueden importar ahora mismo (código vinculado). */
  importables: number;
}

export interface ReporteImportacion {
  creados: number;
  actualizados: number;
  sinCambio: number;
  omitidosSinVinculo: number;
  omitidosIgnorados: number;
  conflictosOmitidos: number;
  fallidos: { fila: number; codigo: string; motivo: string }[];
}

const hhmm = (f: Date | null) =>
  f ? `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}` : "--:--";

/** Texto corto de un turno o ausencia, para comparar y para la bitácora. */
function resumenTurno(
  entrada: Date | null,
  salida: Date | null,
  tipoAusencia: string | null,
): string {
  if (tipoAusencia) return `ausencia: ${tipoAusencia}`;
  if (!entrada && !salida) return "sin marcas";
  return `${hhmm(entrada)} a ${hhmm(salida)}`;
}

/** Estado de vinculación de los códigos y departamentos que trae el archivo. */
export async function estadoVinculos(resumen: ResumenArchivo): Promise<{
  vinculos: VinculoPersona[];
  departamentos: VinculoDepartamento[];
}> {
  const codigos = resumen.personas.map((p) => p.codigo);
  const [personas, ignorados, mapeos] = await Promise.all([
    prisma.operadores.findMany({
      where: { codigo_biometrico: { in: codigos } },
      select: { id: true, nombre: true, codigo_biometrico: true },
    }),
    prisma.codigos_biometricos_ignorados.findMany({
      where: { codigo: { in: codigos } },
      select: { codigo: true },
    }),
    prisma.mapeo_departamento_biometrico.findMany({
      where: { departamento: { in: resumen.departamentos } },
      include: { plantel: { select: { nombre: true } } },
    }),
  ]);

  const porCodigo = new Map(personas.map((p) => [p.codigo_biometrico!, p]));
  const ignoradosSet = new Set(ignorados.map((i) => i.codigo));

  const vinculos: VinculoPersona[] = resumen.personas.map((p) => {
    const persona = porCodigo.get(p.codigo);
    return {
      codigo: p.codigo,
      nombreReloj: p.nombreReloj,
      registros: p.registros,
      conMarcas: p.conMarcas,
      ausencias: p.ausencias,
      departamentos: p.departamentos,
      personaId: persona?.id ?? null,
      personaNombre: persona?.nombre ?? null,
      ignorado: ignoradosSet.has(p.codigo),
    };
  });

  const registrosPorDepto = new Map<string, number>();
  for (const r of resumen.registros) {
    if (r.departamento === "") continue;
    registrosPorDepto.set(r.departamento, (registrosPorDepto.get(r.departamento) ?? 0) + 1);
  }
  const porDepto = new Map(mapeos.map((m) => [m.departamento, m]));
  const departamentos: VinculoDepartamento[] = resumen.departamentos.map((d) => {
    const m = porDepto.get(d);
    return {
      departamento: d,
      registros: registrosPorDepto.get(d) ?? 0,
      plantelId: m?.plantel_id ?? null,
      plantelNombre: m?.plantel?.nombre ?? null,
    };
  });

  return { vinculos, departamentos };
}

/**
 * Previsualización: qué traería el archivo, qué falta resolver y qué chocaría con datos
 * capturados a mano. NO escribe nada.
 */
export async function previsualizar(resumen: ResumenArchivo): Promise<PreviaImportacion> {
  const { vinculos, departamentos } = await estadoVinculos(resumen);
  const personaPorCodigo = new Map(
    vinculos.filter((v) => v.personaId != null).map((v) => [v.codigo, v]),
  );

  // Conflictos: filas ya guardadas a mano que el archivo cambiaría.
  const conflictos: Conflicto[] = [];
  let importables = 0;

  const porPersonaFecha = new Map<string, RegistroReloj>();
  for (const r of resumen.registros) {
    const v = personaPorCodigo.get(r.codigo);
    if (!v || v.personaId == null) continue;
    importables += 1;
    porPersonaFecha.set(`${v.personaId}|${iso(r.fecha)}`, r);
  }

  if (porPersonaFecha.size > 0 && resumen.desde && resumen.hasta) {
    const finExclusivo = new Date(
      resumen.hasta.getFullYear(),
      resumen.hasta.getMonth(),
      resumen.hasta.getDate() + 1,
    );
    const existentes = await prisma.asistencia_operativos.findMany({
      where: {
        fecha: { gte: resumen.desde, lt: finExclusivo },
        origen: "Manual",
        persona: { codigo_biometrico: { in: [...personaPorCodigo.keys()] } },
      },
      include: { persona: { select: { nombre: true, codigo_biometrico: true } } },
    });
    for (const e of existentes) {
      const r = porPersonaFecha.get(`${e.persona_id}|${iso(e.fecha)}`);
      if (!r) continue;
      const actual = resumenTurno(e.hora_entrada, e.hora_salida, e.tipo_ausencia);
      const nuevo = resumenTurno(r.entrada, r.salida, r.ausente ? "Pendiente" : null);
      if (actual === nuevo) continue; // el archivo dice lo mismo: no hay conflicto
      conflictos.push({
        codigo: e.persona.codigo_biometrico ?? "",
        persona: e.persona.nombre,
        fechaISO: iso(e.fecha),
        actual,
        nuevo,
      });
    }
  }

  return {
    filasDatos: resumen.filasDatos,
    desdeISO: resumen.desde ? iso(resumen.desde) : null,
    hastaISO: resumen.hasta ? iso(resumen.hasta) : null,
    fechas: resumen.fechas,
    personasDistintas: resumen.personas.length,
    registrosConMarcas: resumen.conMarcas,
    ausencias: resumen.ausencias,
    incompletas: resumen.incompletas,
    crucesMedianoche: resumen.crucesMedianoche,
    vinculos,
    sinVincular: vinculos.filter((v) => v.personaId == null && !v.ignorado).length,
    departamentos,
    departamentosSinMapeo: departamentos.filter((d) => d.plantelId == null).length,
    problemas: resumen.problemas,
    encabezadosInesperados: resumen.encabezadosInesperados,
    conflictos: conflictos.sort(
      (a, b) => a.fechaISO.localeCompare(b.fechaISO) || a.persona.localeCompare(b.persona),
    ),
    importables,
  };
}

/**
 * Aplica la importación. Escribe solo las filas de códigos vinculados; las horas se
 * recalculan con las bandas configuradas, y una fila Manual solo se toca si
 * `sobrescribirManuales` es true.
 */
export async function aplicarImportacion(
  resumen: ResumenArchivo,
  opciones: { usuario: string; sobrescribirManuales: boolean },
): Promise<ReporteImportacion> {
  const { vinculos } = await estadoVinculos(resumen);
  const personaPorCodigo = new Map(
    vinculos.filter((v) => v.personaId != null).map((v) => [v.codigo, v.personaId!]),
  );
  const ignorados = new Set(vinculos.filter((v) => v.ignorado).map((v) => v.codigo));
  const bandas = await leerBandas();

  const reporte: ReporteImportacion = {
    creados: 0,
    actualizados: 0,
    sinCambio: 0,
    omitidosSinVinculo: 0,
    omitidosIgnorados: 0,
    conflictosOmitidos: 0,
    fallidos: [],
  };

  for (const r of resumen.registros) {
    if (ignorados.has(r.codigo)) {
      reporte.omitidosIgnorados += 1;
      continue;
    }
    const personaId = personaPorCodigo.get(r.codigo);
    if (personaId == null) {
      reporte.omitidosSinVinculo += 1;
      continue;
    }

    try {
      const previo = await prisma.asistencia_operativos.findUnique({
        where: { persona_id_fecha: { persona_id: personaId, fecha: r.fecha } },
      });

      // Una ausencia del reloj entra como ausencia PENDIENTE de clasificar (el reloj no
      // sabe si fue vacaciones, incapacidad o permiso) y sin horas — no como una jornada
      // de cero horas, que para la planilla no es lo mismo.
      const tipoAusencia = r.ausente ? "Pendiente" : null;
      const horas = calcularHorasTurno(r.entrada, r.salida, bandas);

      const nuevo = resumenTurno(r.entrada, r.salida, tipoAusencia);
      const actual = previo
        ? resumenTurno(previo.hora_entrada, previo.hora_salida, previo.tipo_ausencia)
        : null;

      if (previo && actual === nuevo) {
        reporte.sinCambio += 1;
        continue;
      }
      if (previo && previo.origen === "Manual" && !opciones.sobrescribirManuales) {
        reporte.conflictosOmitidos += 1;
        continue;
      }

      const datos = {
        hora_entrada: r.entrada,
        hora_salida: r.salida,
        horas_normales: horas.horas_normales,
        horas_extra_25: horas.horas_extra_25,
        horas_extra_50: horas.horas_extra_50,
        horas_extra_75: horas.horas_extra_75,
        horas_extra_100: horas.horas_extra_100,
        tipo_ausencia: tipoAusencia,
        // Una ausencia pendiente no tiene costo decidido: NULL, no 0.
        costo_ausencia: null,
        origen: "Importado",
        datos_reloj: r.crudo,
        departamento_reloj: r.departamento === "" ? null : r.departamento,
      };

      const fila = await prisma.asistencia_operativos.upsert({
        where: { persona_id_fecha: { persona_id: personaId, fecha: r.fecha } },
        create: { persona_id: personaId, fecha: r.fecha, creado_por: opciones.usuario, ...datos },
        update: datos,
      });

      await prisma.bitacora_auditoria.create({
        data: {
          tabla_afectada: "asistencia_operativos",
          registro_id: fila.id,
          usuario: opciones.usuario,
          campo_modificado: "asistencia",
          valor_anterior: actual ?? "sin registro",
          valor_nuevo: nuevo,
          // El motivo distingue de dónde vino el dato: importación vs. captura manual.
          motivo:
            previo && previo.origen === "Manual"
              ? `Importación del reloj biométrico (SOBRESCRIBIÓ una corrección manual) — fila ${r.fila}`
              : `Importación del reloj biométrico — fila ${r.fila}`,
        },
      });

      if (previo) reporte.actualizados += 1;
      else reporte.creados += 1;
    } catch (e) {
      reporte.fallidos.push({
        fila: r.fila,
        codigo: r.codigo,
        motivo: e instanceof Error ? e.message : "Error inesperado",
      });
    }
  }

  return reporte;
}

/** Vincula un código del reloj a una persona del catálogo (o lo desvincula). */
export async function vincularCodigo(
  codigo: string,
  personaId: number | null,
  usuario: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const cod = codigo.trim();
  if (cod === "") return { ok: false, mensaje: "Código vacío." };

  if (personaId == null) {
    const previo = await prisma.operadores.findFirst({ where: { codigo_biometrico: cod } });
    if (previo) {
      await prisma.operadores.update({
        where: { id: previo.id },
        data: { codigo_biometrico: null },
      });
      await auditarVinculo(previo.id, cod, "sin vincular", usuario, previo.nombre);
    }
    return { ok: true };
  }

  const persona = await prisma.operadores.findUnique({ where: { id: personaId } });
  if (!persona) return { ok: false, mensaje: "Persona no encontrada." };

  // El código es único: si estaba en otra persona, primero se libera.
  const dueno = await prisma.operadores.findFirst({ where: { codigo_biometrico: cod } });
  if (dueno && dueno.id !== personaId) {
    return {
      ok: false,
      mensaje: `El código ${cod} ya está asignado a ${dueno.nombre}. Quítaselo primero.`,
    };
  }

  await prisma.$transaction([
    prisma.operadores.update({ where: { id: personaId }, data: { codigo_biometrico: cod } }),
    // Si el código estaba marcado como ajeno al personal operativo, deja de estarlo.
    prisma.codigos_biometricos_ignorados.deleteMany({ where: { codigo: cod } }),
  ]);
  await auditarVinculo(personaId, persona.codigo_biometrico ?? "sin vincular", cod, usuario, persona.nombre);
  return { ok: true };
}

/** Marca un código como ajeno al personal operativo (o lo desmarca). */
export async function ignorarCodigo(
  codigo: string,
  nombreReloj: string,
  ignorar: boolean,
  usuario: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const cod = codigo.trim();
  if (cod === "") return { ok: false, mensaje: "Código vacío." };

  if (!ignorar) {
    await prisma.codigos_biometricos_ignorados.deleteMany({ where: { codigo: cod } });
    return { ok: true };
  }

  const dueno = await prisma.operadores.findFirst({ where: { codigo_biometrico: cod } });
  if (dueno) {
    return {
      ok: false,
      mensaje: `El código ${cod} está vinculado a ${dueno.nombre}: desvincúlalo antes de marcarlo como ajeno.`,
    };
  }
  await prisma.codigos_biometricos_ignorados.upsert({
    where: { codigo: cod },
    create: { codigo: cod, nombre_reloj: nombreReloj || null, creado_por: usuario },
    update: { nombre_reloj: nombreReloj || null },
  });
  return { ok: true };
}

/** Correspondencia departamento del reloj → plantel del sistema. */
export async function mapearDepartamento(
  departamento: string,
  plantelId: number | null,
  usuario: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const d = departamento.trim();
  if (d === "") return { ok: false, mensaje: "Departamento vacío." };
  if (plantelId == null) {
    await prisma.mapeo_departamento_biometrico.deleteMany({ where: { departamento: d } });
    return { ok: true };
  }
  const plantel = await prisma.planteles.findUnique({ where: { id: plantelId } });
  if (!plantel) return { ok: false, mensaje: "Plantel no encontrado." };
  await prisma.mapeo_departamento_biometrico.upsert({
    where: { departamento: d },
    create: { departamento: d, plantel_id: plantelId, creado_por: usuario },
    update: { plantel_id: plantelId },
  });
  return { ok: true };
}

async function auditarVinculo(
  personaId: number,
  antes: string,
  despues: string,
  usuario: string,
  nombre: string,
) {
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "operadores",
      registro_id: personaId,
      usuario,
      campo_modificado: "codigo_biometrico",
      valor_anterior: antes,
      valor_nuevo: despues,
      motivo: `Vínculo con el reloj biométrico de ${nombre}`,
    },
  });
}
