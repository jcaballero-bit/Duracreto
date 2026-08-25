/**
 * Lecturas de base de datos de la planilla. Aquí no hay reglas de negocio: las reglas
 * viven en los módulos puros (horas.ts, costo.ts, periodos.ts, ausencias.ts) y este
 * archivo solo trae los datos y los arma para la pantalla.
 */
import { prisma } from "@/lib/prisma";
import { costoHoras, sumarTotales, totalesCero, totalesDeFila, type TotalesHoras } from "./costo";
import { etiquetaAusencia } from "./ausencias";
import { diasDelPeriodo, periodoPorIndice, type PeriodoPago } from "./periodos";
import type { BandaRecargo, TipoDia } from "./recargos";
import { redondearMonto, salarioDiario, salarioHora } from "./salario";
import { ORDEN_PUESTOS, type Puesto } from "./puestos";

/** Bandas de recargo configuradas (Administración › Recargos de ley). */
export async function leerBandas(): Promise<BandaRecargo[]> {
  const filas = await prisma.configuracion_recargos.findMany({
    orderBy: [{ tipo_dia: "asc" }, { hora_desde_min: "asc" }],
  });
  return filas.map((f) => ({
    tipoDia: f.tipo_dia as TipoDia,
    desdeMin: f.hora_desde_min,
    hastaMin: f.hora_hasta_min,
    porcentaje: f.porcentaje_recargo,
  }));
}

/**
 * El periodo `indice` tal como debe usarse: si ya existe en la BD manda la fila
 * (el Administrador pudo ajustarla a mano); si no, se usa el cálculo desde el ancla.
 * NO crea la fila: la pantalla es de consulta y solo se escribe al cambiar el estado.
 */
export async function periodoEfectivo(
  indice: number,
): Promise<PeriodoPago & { id: number | null; estado: string }> {
  const calc = periodoPorIndice(indice);
  const fila = await prisma.periodos_pago.findUnique({ where: { fecha_inicio: calc.inicio } });
  if (!fila) return { ...calc, id: null, estado: "Abierto" };
  return {
    indice,
    inicio: fila.fecha_inicio,
    fin: fila.fecha_fin,
    pago: fila.fecha_pago,
    id: fila.id,
    estado: fila.estado,
  };
}

export interface DiaAsistencia {
  /** "YYYY-MM-DD" del día del periodo. */
  fechaISO: string;
  /** Día de la semana abreviado, para la fila. */
  diaSemana: string;
  esFinDeSemana: boolean;
  entrada: string; // "HH:MM" o ""
  salida: string; // "HH:MM" o ""
  /** La salida quedó en el día siguiente (turno nocturno). */
  cruzaMedianoche: boolean;
  normales: number;
  extra25: number;
  extra50: number;
  extra75: number;
  extra100: number;
  tipoAusencia: string; // "" si trabajó
  costoAusencia: number | null;
  observaciones: string;
}

export interface AusenciaResumen {
  tipo: string;
  etiqueta: string;
  dias: number;
  costo: number;
}

export interface PersonaPlanilla {
  id: number;
  nombre: string;
  puesto: string;
  plantel: string;
  salarioMensual: number | null;
  salarioDiario: number;
  salarioHora: number;
  totales: TotalesHoras;
  ausencias: AusenciaResumen[];
  diasAusencia: number;
  costoHoras: number;
  costoAusencias: number;
  costoTotal: number;
  dias: DiaAsistencia[];
}

const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function iso(f: Date): string {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

function hhmm(f: Date | null): string {
  if (!f) return "";
  return `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}`;
}

/**
 * Todo el personal operativo con su asistencia del periodo, ya totalizado.
 * Ordenado por puesto (orden de presentación) y por nombre dentro del puesto.
 */
export async function planillaDelPeriodo(periodo: PeriodoPago): Promise<PersonaPlanilla[]> {
  const dias = diasDelPeriodo(periodo);
  const finExclusivo = new Date(
    periodo.fin.getFullYear(),
    periodo.fin.getMonth(),
    periodo.fin.getDate() + 1,
  );

  const [personas, asistencias] = await Promise.all([
    prisma.operadores.findMany({
      orderBy: { nombre: "asc" },
      include: { plantel_asignado: { select: { nombre: true } } },
    }),
    prisma.asistencia_operativos.findMany({
      where: { fecha: { gte: periodo.inicio, lt: finExclusivo } },
    }),
  ]);

  const porPersona = new Map<number, Map<string, (typeof asistencias)[number]>>();
  for (const a of asistencias) {
    const mapa = porPersona.get(a.persona_id) ?? new Map();
    mapa.set(iso(a.fecha), a);
    porPersona.set(a.persona_id, mapa);
  }

  const resultado = personas.map((p) => {
    const mapa = porPersona.get(p.id) ?? new Map();
    let totales = totalesCero();
    const ausenciasPorTipo = new Map<string, { dias: number; costo: number }>();

    const filas: DiaAsistencia[] = dias.map((d) => {
      const a = mapa.get(iso(d));
      const entrada = a?.hora_entrada ?? null;
      const salida = a?.hora_salida ?? null;
      if (a) {
        totales = sumarTotales(totales, totalesDeFila(a));
        if (a.tipo_ausencia) {
          const acum = ausenciasPorTipo.get(a.tipo_ausencia) ?? { dias: 0, costo: 0 };
          acum.dias += 1;
          acum.costo += a.costo_ausencia ?? 0;
          ausenciasPorTipo.set(a.tipo_ausencia, acum);
        }
      }
      return {
        fechaISO: iso(d),
        diaSemana: DIAS_SEMANA[d.getDay()],
        esFinDeSemana: d.getDay() === 0 || d.getDay() === 6,
        entrada: hhmm(entrada),
        salida: hhmm(salida),
        cruzaMedianoche: !!(entrada && salida && iso(salida) !== iso(entrada)),
        normales: a?.horas_normales ?? 0,
        extra25: a?.horas_extra_25 ?? 0,
        extra50: a?.horas_extra_50 ?? 0,
        extra75: a?.horas_extra_75 ?? 0,
        extra100: a?.horas_extra_100 ?? 0,
        tipoAusencia: a?.tipo_ausencia ?? "",
        costoAusencia: a?.costo_ausencia ?? null,
        observaciones: a?.observaciones ?? "",
      };
    });

    const ausencias: AusenciaResumen[] = [...ausenciasPorTipo.entries()].map(([tipo, v]) => ({
      tipo,
      etiqueta: etiquetaAusencia(tipo),
      dias: v.dias,
      costo: redondearMonto(v.costo),
    }));
    const costoAusencias = redondearMonto(ausencias.reduce((s, a) => s + a.costo, 0));
    const cHoras = costoHoras(totales, p.salario_mensual);

    return {
      id: p.id,
      nombre: p.nombre,
      puesto: p.puesto,
      plantel: p.plantel_asignado?.nombre ?? "—",
      salarioMensual: p.salario_mensual,
      salarioDiario: redondearMonto(salarioDiario(p.salario_mensual)),
      salarioHora: Math.round(salarioHora(p.salario_mensual) * 10000) / 10000,
      totales,
      ausencias,
      diasAusencia: ausencias.reduce((s, a) => s + a.dias, 0),
      costoHoras: cHoras,
      costoAusencias,
      costoTotal: redondearMonto(cHoras + costoAusencias),
      dias: filas,
    };
  });

  const rank = (puesto: string) => {
    const i = ORDEN_PUESTOS.indexOf(puesto as Puesto);
    return i === -1 ? ORDEN_PUESTOS.length : i;
  };
  return resultado.sort(
    (a, b) => rank(a.puesto) - rank(b.puesto) || a.nombre.localeCompare(b.nombre),
  );
}
