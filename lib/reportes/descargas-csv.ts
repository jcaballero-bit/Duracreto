// Exportación del reporte de tiempos de descarga a CSV.
//
// PURO: recibe el reporte ya calculado y devuelve el texto. La ruta HTTP solo lo
// envuelve, así que el archivo sale exactamente de los mismos números que la pantalla.
//
// Formato Excel-friendly, la convención del proyecto (`lib/csv.ts`): BOM + `sep=;` +
// CRLF, para que se abra en columnas en cualquier configuración regional de Excel.
import type { ReporteDescargas } from "./descargas-datos";
import type { UmbralesDescarga } from "./descargas";

const SEP = ";";
const CRLF = "\r\n";

/** Escapa una celda: comillas dobladas y entrecomillado si trae separador o salto. */
function celda(v: string | number | null | undefined): string {
  if (v == null) return "";
  const t = String(v);
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const fila = (celdas: (string | number | null | undefined)[]) =>
  celdas.map(celda).join(SEP);

const pad = (n: number) => String(n).padStart(2, "0");
const fecha = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const hora = (ms: number | null) => {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface MetaCsvDescargas {
  desde: string;
  hasta: string;
  alcance: string;
  cliente: string;
  generadoPor: string;
  generadoEn: string;
}

export function descargasACsv(
  r: ReporteDescargas,
  u: UmbralesDescarga,
  meta: MetaCsvDescargas,
): string {
  const L: string[] = [];
  const res = r.resumen;

  L.push("sep=;");
  L.push(fila(["Reporte", "Tiempos de descarga y esperas en obra"]));
  L.push(fila(["Periodo", `${meta.desde} a ${meta.hasta}`]));
  L.push(fila(["Alcance", meta.alcance]));
  L.push(fila(["Cliente", meta.cliente]));
  L.push(fila(["Generado por", meta.generadoPor]));
  L.push(fila(["Generado", meta.generadoEn]));
  L.push(
    fila([
      "Umbrales",
      `espera >= ${u.esperaMin} min`,
      `variabilidad >= ${u.variabilidadMin} min`,
      `tolerancia +${Math.round(u.toleranciaPct * 100)}%`,
    ]),
  );
  L.push("");

  // ── Cobertura de datos: va PRIMERO, para que nadie lea los promedios sin saber
  //    sobre cuántos viajes se calcularon.
  L.push(fila(["COBERTURA DE DATOS"]));
  L.push(fila(["Viajes en el periodo", res.viajes]));
  L.push(fila(["Con datos completos", res.viajesMedidos]));
  L.push(fila(["Incompletos (no entran a los promedios)", res.viajesIncompletos]));
  L.push(fila(["Cobertura (%)", res.coberturaPct]));
  L.push("");

  L.push(fila(["RESUMEN DEL PERIODO"]));
  L.push(fila(["Descarga programada promedio (min)", res.programadaProm ?? ""]));
  L.push(fila(["Descarga real promedio (min)", res.realProm ?? ""]));
  L.push(fila(["Viajes que excedieron lo programado", res.excedieron]));
  L.push(fila(["% que excedio (sobre los medidos)", res.excedieronPct ?? ""]));
  L.push(fila(["Minutos excedidos en total", res.minutosExcedidos]));
  L.push(fila(["Cliente con mayor desviacion acumulada", res.peorCliente?.cliente ?? ""]));
  L.push(fila(["Minutos de ese cliente", res.peorCliente?.minutos ?? ""]));
  L.push(fila(["Espera en obra promedio (min)", res.esperaProm ?? ""]));
  L.push(fila(["Espera en obra total (min)", res.esperaTotalMin]));
  L.push(fila([`Viajes con espera >= ${u.esperaMin} min`, res.esperasSobreUmbral]));
  L.push(fila(["Horas-mixer en espera", res.horasMixerEspera]));
  L.push(fila(["Ciclo promedio del periodo (min)", res.cicloPromMin ?? ""]));
  L.push(fila(["Viajes equivalentes perdidos en espera", res.viajesEquivalentes ?? ""]));
  L.push("");

  L.push(fila(["RESUMEN POR CLIENTE (ordenado por minutos excedidos)"]));
  L.push(
    fila([
      "Cliente",
      "Proyecto",
      "Viajes",
      "Medidos",
      "Descarga programada prom (min)",
      "Descarga real prom (min)",
      "Desviacion prom (min)",
      "Fuera de lo programado",
      "Minutos excedidos",
      "Espera prom (min)",
      "Espera max (min)",
      "Espera total (min)",
      `Esperas >= ${u.esperaMin} min`,
    ]),
  );
  for (const c of r.porCliente) {
    L.push(
      fila([
        c.cliente,
        c.proyecto ?? "",
        c.viajes,
        c.viajesMedidos,
        c.programadaProm ?? "",
        c.realProm ?? "",
        c.desviacionProm ?? "",
        c.fueraDeProgramado,
        c.minutosExcedidos,
        c.esperaProm ?? "",
        c.esperaMax ?? "",
        c.esperaTotalMin,
        c.esperasSobreUmbral,
      ]),
    );
  }
  L.push("");

  L.push(fila(["CUMPLIMIENTO DEL INTERVALO ENTRE CAMIONES"]));
  L.push(
    fila([
      "Fecha",
      "Cliente",
      "Proyecto",
      "Llegadas",
      "Intervalo solicitado (min)",
      "Intervalo real prom (min)",
      "Minimo (min)",
      "Maximo (min)",
      "Variabilidad (max-min)",
      "Desviacion estandar (min)",
      "Irregular",
    ]),
  );
  for (const i of r.intervalos) {
    L.push(
      fila([
        fecha(i.diaMs),
        i.cliente,
        i.proyecto ?? "",
        i.llegadas,
        i.solicitadoMin ?? "",
        i.realPromMin ?? "",
        i.minMin ?? "",
        i.maxMin ?? "",
        i.variabilidadMin ?? "",
        i.desviacionEstandarMin ?? "",
        i.irregular ? "SI" : "no",
      ]),
    );
  }
  L.push("");

  L.push(fila(["DETALLE POR VIAJE"]));
  L.push(
    fila([
      "Fecha",
      "Plantel",
      "Cliente",
      "Proyecto",
      "Viaje",
      "De",
      "Mixer",
      "Volumen (m3)",
      "Llegada a obra",
      "Inicio descarga",
      "Fin descarga",
      "Descarga programada (min)",
      "Descarga real (min)",
      "Desviacion (min)",
      "Desviacion (%)",
      "Espera en obra (min)",
      "Datos faltantes",
    ]),
  );
  for (const v of r.detalle) {
    L.push(
      fila([
        fecha(v.diaMs),
        v.plantel,
        v.cliente,
        v.proyecto ?? "",
        v.numero,
        v.totalDelPedido,
        v.mixer,
        v.volumen,
        hora(v.llegadaMs),
        hora(v.inicioDescargaMs),
        hora(v.finDescargaMs),
        v.programadaMin ?? "",
        v.realMin ?? "",
        v.desviacionMin ?? "",
        v.desviacionPct ?? "",
        v.esperaMin ?? "",
        v.faltantes.join(", "),
      ]),
    );
  }

  return "﻿" + L.join(CRLF) + CRLF;
}

export function nombreArchivoDescargas(desde: Date, hasta: Date): string {
  const f = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  return `Descargas-y-esperas_${f(desde)}_a_${f(hasta)}.csv`;
}
