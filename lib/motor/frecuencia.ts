// ─────────────────────────────────────────────────────────────────────────────
// Frecuencia entre camiones — cálculo PURO (sin BD).
//
// La "frecuencia entre camiones" es la cadencia con la que los mixers LLEGAN a la
// obra (cada N minutos). Para sostenerla hay que tener suficientes mixers girando:
// un mixer, tras cargar y salir, tarda un CICLO completo en regresar y estar listo
// para el siguiente viaje. Si el ciclo dura C minutos y quiero una llegada cada F
// minutos, necesito ~ceil(C/F) mixers trabajando en paralelo.
//
// Este módulo calcula ese desglose para poder (1) reclutar la flota mínima y
// (2) advertir al Programador ANTES de confirmar cuando la frecuencia pedida no es
// alcanzable con la flota disponible, mostrando el porqué (desglose del ciclo).
//
// Reutiliza los mismos helpers de tiempo que el motor (`tiempos.ts`) para que el
// cálculo sea idéntico al que luego produce la cascada real.
// ─────────────────────────────────────────────────────────────────────────────
import { minutosDeCarga, minutosDeDescarga } from "./tiempos";
import { MIN_SALIDA_TRAS_CARGA } from "./config";

/** Desglose (en minutos) de un ciclo completo de un mixer para un viaje típico. */
export interface DesgloseCiclo {
  cargaMin: number; // alistamiento de planta + tiempo de dosificación del volumen
  salidaMin: number; // preparación entre fin de carga y salida de planta
  idaMin: number; // transporte planta → obra
  descargaMin: number; // vaciado en obra
  regresoMin: number; // transporte obra → planta
  cicloMin: number; // suma de todo lo anterior (inicio de carga → regreso a planta)
}

/** Datos necesarios para evaluar la frecuencia de un pedido. */
export interface EntradaFrecuencia {
  /** m³ de un viaje representativo (la carga de planeación del mixer típico). */
  volumenPorViaje: number;
  /** Capacidad de dosificación de la planta (m³/h) — determina el tiempo de carga. */
  capacidadPlantaM3h: number;
  /** `plantas.tiempo_alistamiento_min` de la planta que carga. */
  alistamientoMin: number;
  /** Transporte ida (min). */
  tiempoIdaMin: number;
  /** Transporte regreso (min). */
  tiempoRegresoMin: number;
  /** Tipo de descarga (define el ritmo de vaciado). */
  tipoDescarga: string;
  /** Cuántos mixers hay DISPONIBLES ese día para este pedido (flota reclutable). */
  mixersDisponibles: number;
  /** Bahías de carga que trabajan en paralelo (1, o 2 en Santa Marta/Tegucigalpa). */
  numeroBahias: number;
  /** Frecuencia que pidió el asesor/programador (min). */
  frecuenciaSolicitadaMin: number;
}

/** Resultado del análisis de frecuencia. */
export interface ResultadoFrecuencia {
  ciclo: DesgloseCiclo;
  /** Frecuencia que se solicitó (eco de la entrada, para mensajes). */
  frecuenciaSolicitadaMin: number;
  /** Mixers necesarios para sostener la frecuencia SOLICITADA (= ceil(ciclo/freq)). */
  mixersMinimos: number;
  /** Frecuencia real que se puede sostener con los mixers/bahías disponibles (min). */
  frecuenciaAlcanzableMin: number;
  /** Copia de la flota disponible considerada. */
  mixersDisponibles: number;
  /** ¿La frecuencia solicitada es alcanzable con lo disponible? */
  alcanzable: boolean;
  /** Qué restringe la cadencia cuando NO es alcanzable. */
  limitadoPor: "ok" | "mixers" | "bahias";
}

const EPS = 1e-9;

/** Desglose del ciclo de un viaje típico (inicio de carga → regreso a planta). */
export function desglosarCiclo(
  entrada: Pick<
    EntradaFrecuencia,
    | "volumenPorViaje"
    | "capacidadPlantaM3h"
    | "alistamientoMin"
    | "tiempoIdaMin"
    | "tiempoRegresoMin"
    | "tipoDescarga"
  >,
): DesgloseCiclo {
  const cargaMin =
    entrada.alistamientoMin + minutosDeCarga(entrada.volumenPorViaje, entrada.capacidadPlantaM3h);
  const salidaMin = MIN_SALIDA_TRAS_CARGA;
  const idaMin = entrada.tiempoIdaMin;
  const descargaMin = minutosDeDescarga(entrada.volumenPorViaje, entrada.tipoDescarga);
  const regresoMin = entrada.tiempoRegresoMin;
  const cicloMin = cargaMin + salidaMin + idaMin + descargaMin + regresoMin;
  return { cargaMin, salidaMin, idaMin, descargaMin, regresoMin, cicloMin };
}

/**
 * Analiza la frecuencia de un pedido: desglose del ciclo, mixers mínimos para la
 * frecuencia pedida, y la frecuencia realmente alcanzable con la flota disponible.
 *
 * Dos restricciones fijan la cadencia mínima entre llegadas:
 *  1. Flota: con M mixers girando en ciclos de C min, no puede llegar uno más
 *     seguido que cada C/M min.
 *  2. Bahías de carga: con B bahías que tardan `carga` min por viaje, no se puede
 *     DESPACHAR (y por tanto no puede llegar) uno más seguido que cada carga/B min.
 * La frecuencia alcanzable es la MAYOR (más lenta) de las dos: la que manda.
 */
export function analizarFrecuencia(entrada: EntradaFrecuencia): ResultadoFrecuencia {
  const ciclo = desglosarCiclo(entrada);
  const mixers = Math.max(0, entrada.mixersDisponibles);
  const bahias = Math.max(1, entrada.numeroBahias);
  const freq = entrada.frecuenciaSolicitadaMin;

  // Intervalo mínimo por cada restricción.
  const intervaloPorMixers = mixers > 0 ? ciclo.cicloMin / mixers : Infinity;
  const intervaloPorBahias = ciclo.cargaMin / bahias;

  // La restricción que manda es la MÁS lenta (mayor intervalo).
  const intervaloReal = Math.max(intervaloPorMixers, intervaloPorBahias);
  const frecuenciaAlcanzableMin = Number.isFinite(intervaloReal)
    ? Math.max(1, Math.ceil(intervaloReal - EPS))
    : Infinity;

  // Mixers necesarios para sostener la frecuencia PEDIDA (según el ciclo).
  const mixersMinimos = freq > 0 ? Math.ceil(ciclo.cicloMin / freq - EPS) : 0;

  const alcanzable = Number.isFinite(frecuenciaAlcanzableMin)
    ? freq >= frecuenciaAlcanzableMin
    : false;

  let limitadoPor: ResultadoFrecuencia["limitadoPor"] = "ok";
  if (!alcanzable) {
    limitadoPor = intervaloPorBahias > intervaloPorMixers ? "bahias" : "mixers";
  }

  return {
    ciclo,
    frecuenciaSolicitadaMin: freq,
    mixersMinimos,
    frecuenciaAlcanzableMin,
    mixersDisponibles: mixers,
    alcanzable,
    limitadoPor,
  };
}
