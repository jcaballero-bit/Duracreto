/**
 * Exportación del reporte de horario extraordinario a CSV (PURO).
 *
 * Respeta la estructura de secciones del reporte para que se pueda compartir con
 * gerencia sin depender del sistema. Se genera para abrir EN COLUMNAS en Excel: BOM,
 * la directiva `sep=;` y saltos CRLF, la misma convención de `lib/csv.ts`.
 */
import { textoMin } from "@/lib/planilla/recargos";
import { resumirMotoristas } from "@/lib/extraordinario/metricas";
import type { ResumenExtraordinario } from "./metricas";

const DELIM = ";";
const BOM = "﻿";
const NL = "\r\n";

/** Escapa un valor para CSV (comillas y separador). */
function celda(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : v;
  return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fila(...valores: (string | number | null | undefined)[]): string {
  return valores.map(celda).join(DELIM);
}

const hora = (min: number | null) => (min == null ? "" : textoMin(min));

export interface MetaReporte {
  desde: string;
  hasta: string;
  alcance: string;
  generadoPor: string;
  generadoEn: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function reporteACsv(r: ResumenExtraordinario, meta: MetaReporte): string {
  const L: string[] = [];
  const seccion = (titulo: string) => {
    L.push("");
    L.push(fila(titulo.toUpperCase()));
  };

  L.push(fila("REPORTE DE DESPACHOS EN HORARIO EXTRAORDINARIO"));
  L.push(fila("Periodo", `${meta.desde} al ${meta.hasta}`));
  L.push(fila("Alcance", meta.alcance));
  L.push(fila("Generado por", meta.generadoPor));
  L.push(fila("Generado el", meta.generadoEn));

  const e = r.ejecutivo;
  seccion("Resumen ejecutivo");
  L.push(fila("Volumen total despachado (m3)", e.volumenTotal));
  L.push(fila("Volumen en horario normal (m3)", e.volumenNormal));
  L.push(fila("Volumen en horario extraordinario (m3)", e.volumenExtra));
  L.push(fila("% en horario normal", e.pctNormal));
  L.push(fila("% en horario extraordinario", e.pctExtra));
  L.push(fila("Total de viajes", e.viajesTotal));
  L.push(fila("Viajes en horario normal", e.viajesNormal));
  L.push(fila("Viajes en horario extraordinario", e.viajesExtra));
  L.push(fila("Motoristas activos", e.motoristasActivos));
  L.push(fila("Dias con despacho", e.diasConDespacho));
  L.push(fila("Promedio de viajes por dia", e.promedioViajesDia));
  L.push(fila("Viajes sin hora real de salida (estimados)", e.viajesEstimados));

  seccion("Volumen extraordinario por banda de recargo");
  L.push(fila("Banda", "Viajes", "Volumen (m3)"));
  for (const b of r.bandasExtra) {
    L.push(fila(b.porcentaje === 0 ? "Sin recargo" : `${b.porcentaje}%`, b.viajes, b.volumen));
  }

  seccion("Resumen por planta");
  L.push(
    fila(
      "Plantel", "Planta", "Horario normal configurado", "Viajes totales", "Volumen total (m3)",
      "Volumen normal (m3)", "Volumen extra (m3)", "% volumen extra", "Viajes normal", "Viajes extra",
    ),
  );
  for (const p of r.porPlanta) {
    L.push(
      fila(p.plantel, p.planta, p.horarios, p.viajes, p.volumen, p.volumenNormal, p.volumenExtra, p.pctExtra, p.viajesNormal, p.viajesExtra),
    );
  }
  L.push(
    fila(
      "TOTAL", "", "",
      r.porPlanta.reduce((s, p) => s + p.viajes, 0),
      e.volumenTotal, e.volumenNormal, e.volumenExtra, e.pctExtra,
      e.viajesNormal, e.viajesExtra,
    ),
  );

  seccion("Tendencia diaria");
  L.push(fila("Fecha", "Dia", "Viajes", "Volumen total (m3)", "Volumen normal (m3)", "Volumen extra (m3)", "% volumen extra"));
  for (const d of r.porDia) {
    L.push(fila(d.fechaISO, d.diaSemana, d.viajes, d.volumen, d.volumenNormal, d.volumenExtra, d.pctExtra));
  }
  L.push(
    fila(
      "TOTAL", "", e.viajesTotal, e.volumenTotal, e.volumenNormal, e.volumenExtra, e.pctExtra,
    ),
  );
  L.push(
    fila(
      "PROMEDIO POR DIA", "",
      e.promedioViajesDia,
      r.porDia.length > 0 ? Math.round((e.volumenTotal / r.porDia.length) * 100) / 100 : 0,
      "", "", "",
    ),
  );

  seccion("Analisis por motorista");
  L.push(fila("Motorista", "Viajes totales", "Volumen total (m3)", "Dias trabajados", "Promedio viajes/dia", "Viajes en hora extra", "Plantas donde opero"));
  for (const m of r.porMotorista) {
    L.push(fila(m.nombre, m.viajes, m.volumen, m.diasTrabajados, m.promedioViajesDia, m.viajesExtra, m.plantas.join(" / ")));
  }
  if (r.porMotorista.length > 0) {
    // Mismo pie que la pantalla, con la misma derivacion: el archivo no puede desviarse
    // de lo que se ve. En "viajes/dia" el TOTAL lleva viajes totales / dias totales, y el
    // PROMEDIO deja esa columna vacia a proposito (promediar promedios no corresponde a
    // ningun conjunto real de viajes y dias).
    const rm = resumirMotoristas(r.porMotorista);
    L.push(fila(`TOTAL (${rm.motoristas} motoristas)`, rm.viajes, rm.volumen, rm.dias, r2(rm.viajesPorDia), rm.viajesExtra, ""));
    L.push(fila("PROMEDIO POR MOTORISTA", r2(rm.promViajes), r2(rm.promVolumen), r2(rm.promDias), "", r2(rm.promViajesExtra), ""));
  }

  seccion("Estadisticas de hora de salida por planta");
  L.push(fila("Planta", "Hora minima", "Hora maxima", "Hora promedio", "Hora mediana", "Viajes con hora registrada", "Viajes sin hora registrada"));
  for (const h of r.horaSalida) {
    L.push(fila(h.planta, hora(h.minMin), hora(h.maxMin), hora(h.promedioMin), hora(h.medianaMin), h.conHora, h.sinHora));
  }

  seccion("Distribucion horaria");
  L.push(fila("Franja", "Viajes", "Volumen (m3)", "Viajes extra", "Volumen extra (m3)"));
  for (const d of r.distribucion) {
    L.push(fila(d.etiqueta, d.viajes, d.volumen, d.viajesExtra, d.volumenExtra));
  }

  const a = r.absorcion;
  seccion("Analisis de absorcion de costo");
  L.push(fila("Concepto", "Valor (L)", "Detalle"));
  L.push(fila("Costo en ficha por m3", a.costoFicha, "Parametro configurable en Administracion"));
  L.push(fila("Considerado en ficha", a.consideradoEnFicha, `${a.costoFicha} x ${a.volumenTotal} m3 (volumen TOTAL del periodo)`));
  L.push(fila("Pago actual de sobretiempo", a.pagoActual, "Horas extra de TODO el personal operativo, tomadas de la planilla"));
  L.push(fila("Diferencia", a.diferencia, a.diferencia < 0 ? "Negativa: se paga mas sobretiempo del que la ficha absorbe" : "Positiva: la ficha absorbe el sobretiempo pagado"));
  L.push(fila("% de desviacion", a.pctDesviacion ?? "", ""));
  L.push(fila("Cobro realizado a cliente", a.cobroCliente, "Captura manual"));
  L.push(fila("Diferencia neta (con el cobro)", a.diferenciaNeta, ""));
  if (a.excluidoSinPlantel) {
    L.push(
      fila(
        "EXCLUIDO del pago actual", a.excluidoSinPlantel.monto,
        `${a.excluidoSinPlantel.personas} persona(s) con sobretiempo y sin plantel asignado (el reporte esta filtrado por plantel)`,
      ),
    );
  }
  L.push("");
  L.push(fila("Horas extra del periodo por nivel"));
  L.push(fila("Nivel", "Horas"));
  for (const h of a.horasExtraPorNivel) L.push(fila(`${h.porcentaje}%`, h.horas));
  L.push("");
  L.push(fila("Sobretiempo por puesto"));
  L.push(fila("Puesto", "Personas", "Monto (L)"));
  for (const p of a.pagoPorPuesto) L.push(fila(p.puesto, p.personas, p.monto));

  L.push("");
  L.push(
    fila(
      "Nota",
      "El horario normal es por PLANTA y se configura en Administracion; es distinto de las bandas de recargo de ley, que aplican a las personas. El pago de sobretiempo es costo BRUTO: no incluye deducciones ni neto a pagar.",
    ),
  );

  return `${BOM}sep=${DELIM}${NL}${L.join(NL)}${NL}`;
}

/** Nombre de archivo del reporte: dia-mes-anio, como el resto de las descargas. */
export function nombreArchivoCsv(desde: Date, hasta: Date): string {
  const f = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  return `Horario-extraordinario_${f(desde)}_al_${f(hasta)}.csv`;
}
