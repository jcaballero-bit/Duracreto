// ─────────────────────────────────────────────────────────────────────────────
// Validaciones del MODO MANUAL de programación (PURO, sin BD).
//
// En modo manual el usuario arma el día a mano y el sistema NUNCA reprograma ni
// corrige: solo detecta problemas y avisa. Estas funciones toman el estado actual
// de la tabla (los viajes tal como el usuario los tiene) y devuelven avisos. El
// usuario decide si continúa igual (conoce condiciones de campo que el sistema no).
// ─────────────────────────────────────────────────────────────────────────────
import { seTraslapan } from "./tiempos";

/** Un viaje tal como vive en la tabla editable del modo manual. */
export interface ViajeManual {
  id: number | string; // id real (number) o temporal de fila nueva (string)
  plantaId: number;
  clienteId: number;
  mixerId: number | null;
  volumen: number;
  inicioCargaMs: number;
  finCargaMs: number;
  llegadaMs: number;
  regresoMs: number;
}

/** Traslape de un mixer: dos viajes del MISMO mixer cuyos ciclos (carga→regreso)
 *  se enciman. El ciclo ocupa al mixer desde el inicio de carga hasta el regreso. */
export interface TraslapeMixer {
  mixerId: number;
  viajeId: ViajeManual["id"];
  conViajeId: ViajeManual["id"];
}

/** Detecta traslapes de mixer entre todos los viajes (de cualquier planta: un mixer
 *  se comparte entre plantas del hub, así que un traslape cruza plantas). */
export function detectarTraslapesMixer(viajes: ViajeManual[]): TraslapeMixer[] {
  const conflictos: TraslapeMixer[] = [];
  const porMixer = new Map<number, ViajeManual[]>();
  for (const v of viajes) {
    if (v.mixerId == null) continue;
    (porMixer.get(v.mixerId) ?? porMixer.set(v.mixerId, []).get(v.mixerId)!).push(v);
  }
  for (const [mixerId, lista] of porMixer) {
    const ord = [...lista].sort((a, b) => a.inicioCargaMs - b.inicioCargaMs);
    for (let i = 0; i < ord.length; i++) {
      for (let j = i + 1; j < ord.length; j++) {
        // El ciclo del mixer ocupa [inicioCarga, regreso). Bordes que se tocan NO cuentan.
        if (
          seTraslapan(
            new Date(ord[i].inicioCargaMs),
            new Date(ord[i].regresoMs),
            new Date(ord[j].inicioCargaMs),
            new Date(ord[j].regresoMs),
          )
        ) {
          conflictos.push({ mixerId, viajeId: ord[i].id, conViajeId: ord[j].id });
        } else if (ord[j].inicioCargaMs >= ord[i].regresoMs) {
          break; // ordenados por inicio: si j ya no traslapa con i, los siguientes tampoco
        }
      }
    }
  }
  return conflictos;
}

/** Set de ids de viaje involucrados en algún traslape (para pintar en rojo). */
export function idsEnTraslape(conflictos: TraslapeMixer[]): Set<ViajeManual["id"]> {
  const s = new Set<ViajeManual["id"]>();
  for (const c of conflictos) {
    s.add(c.viajeId);
    s.add(c.conViajeId);
  }
  return s;
}

/** Traslape de CARGA en una planta: dos viajes de la MISMA planta cuyas ventanas de
 *  carga [inicioCarga, finCarga) se enciman. Es DISTINTO del traslape de mixer y del
 *  exceso de capacidad por hora: aquí una boca de carga no puede llenar 2 mixers a la
 *  vez. `solapeMin` = minutos que se encima (para el mensaje). */
export interface TraslapeCarga {
  plantaId: number;
  viajeId: ViajeManual["id"];
  conViajeId: ViajeManual["id"];
  inicioCargaMs: number; // del viaje `viajeId` (para mensajes)
  conInicioCargaMs: number; // del viaje `conViajeId`
  solapeMin: number;
}

/**
 * Detecta traslapes de la BOCA DE CARGA por planta: para cada planta, ordena sus
 * viajes por inicio de carga y marca los pares cuyas ventanas [inicioCarga, finCarga)
 * se encimen (bordes que se tocan NO cuentan). Una planta solo puede cargar un mixer
 * a la vez, así que esto es un problema físico aunque el volumen/hora esté dentro de
 * la capacidad.
 */
export function detectarTraslapesCarga(viajes: ViajeManual[]): TraslapeCarga[] {
  const conflictos: TraslapeCarga[] = [];
  const porPlanta = new Map<number, ViajeManual[]>();
  for (const v of viajes) {
    (porPlanta.get(v.plantaId) ?? porPlanta.set(v.plantaId, []).get(v.plantaId)!).push(v);
  }
  for (const [plantaId, lista] of porPlanta) {
    const ord = [...lista].sort((a, b) => a.inicioCargaMs - b.inicioCargaMs);
    for (let i = 0; i < ord.length; i++) {
      for (let j = i + 1; j < ord.length; j++) {
        const solapeMs = Math.min(ord[i].finCargaMs, ord[j].finCargaMs) - Math.max(ord[i].inicioCargaMs, ord[j].inicioCargaMs);
        if (solapeMs > 0) {
          conflictos.push({
            plantaId,
            viajeId: ord[i].id,
            conViajeId: ord[j].id,
            inicioCargaMs: ord[i].inicioCargaMs,
            conInicioCargaMs: ord[j].inicioCargaMs,
            solapeMin: Math.round(solapeMs / 60_000),
          });
        } else if (ord[j].inicioCargaMs >= ord[i].finCargaMs) {
          break; // ordenados por inicio: si j ya no encima con i, los siguientes tampoco
        }
      }
    }
  }
  return conflictos;
}

/** Set de ids de viaje involucrados en algún traslape de carga (para pintar en rojo). */
export function idsEnTraslapeCarga(conflictos: TraslapeCarga[]): Set<ViajeManual["id"]> {
  const s = new Set<ViajeManual["id"]>();
  for (const c of conflictos) {
    s.add(c.viajeId);
    s.add(c.conViajeId);
  }
  return s;
}

/** Aviso de capacidad de planta excedida en alguna ventana de 60 min. */
export interface AvisoCapacidad {
  plantaId: number;
  ventanaInicioMs: number;
  volumenEnVentana: number;
  capacidadM3h: number;
}

/**
 * Capacidad de planta: si en CUALQUIER ventana de 60 min la suma de volumen de las
 * cargas que arrancan dentro de ella supera `capacidadM3h`, avisa. Se evalúa una
 * ventana por cada inicio de carga (basta con esas para hallar el pico).
 */
export function capacidadExcedida(
  viajesDePlanta: ViajeManual[],
  capacidadM3h: number,
): AvisoCapacidad[] {
  const avisos: AvisoCapacidad[] = [];
  const ord = [...viajesDePlanta].sort((a, b) => a.inicioCargaMs - b.inicioCargaMs);
  for (const base of ord) {
    const fin = base.inicioCargaMs + 3_600_000;
    let suma = 0;
    for (const v of ord) {
      if (v.inicioCargaMs >= base.inicioCargaMs && v.inicioCargaMs < fin) suma += v.volumen;
    }
    if (suma > capacidadM3h + 1e-6) {
      avisos.push({
        plantaId: base.plantaId,
        ventanaInicioMs: base.inicioCargaMs,
        volumenEnVentana: suma,
        capacidadM3h,
      });
    }
  }
  return avisos;
}

/** Aviso de margen apretado entre el regreso de un mixer y su siguiente carga. */
export interface AvisoMargen {
  mixerId: number;
  viajeAnteriorId: ViajeManual["id"];
  viajeSiguienteId: ViajeManual["id"];
  margenMin: number;
}

/**
 * Margen apretado: para cada mixer, ordena sus viajes por inicio de carga; si entre
 * el regreso de uno y el inicio de carga del siguiente quedan MENOS de `margenMin`
 * minutos (pero no negativo — eso ya es traslape), avisa.
 */
export function margenApretado(viajes: ViajeManual[], margenMin: number): AvisoMargen[] {
  const avisos: AvisoMargen[] = [];
  const porMixer = new Map<number, ViajeManual[]>();
  for (const v of viajes) {
    if (v.mixerId == null) continue;
    (porMixer.get(v.mixerId) ?? porMixer.set(v.mixerId, []).get(v.mixerId)!).push(v);
  }
  for (const [mixerId, lista] of porMixer) {
    const ord = [...lista].sort((a, b) => a.inicioCargaMs - b.inicioCargaMs);
    for (let i = 1; i < ord.length; i++) {
      const gapMin = (ord[i].inicioCargaMs - ord[i - 1].regresoMs) / 60_000;
      if (gapMin >= 0 && gapMin < margenMin) {
        avisos.push({
          mixerId,
          viajeAnteriorId: ord[i - 1].id,
          viajeSiguienteId: ord[i].id,
          margenMin: Math.round(gapMin),
        });
      }
    }
  }
  return avisos;
}

/**
 * Frecuencia real entre camiones por cliente: mediana del hueco entre LLEGADAS
 * consecutivas de los viajes de cada cliente. Null si el cliente tiene < 2 viajes.
 * (Mediana, no promedio, para que un hueco atípico no distorsione el número.)
 */
export function frecuenciaRealPorCliente(viajes: ViajeManual[]): Map<number, number | null> {
  const porCliente = new Map<number, number[]>();
  for (const v of viajes) {
    (porCliente.get(v.clienteId) ?? porCliente.set(v.clienteId, []).get(v.clienteId)!).push(v.llegadaMs);
  }
  const out = new Map<number, number | null>();
  for (const [clienteId, llegadas] of porCliente) {
    if (llegadas.length < 2) {
      out.set(clienteId, null);
      continue;
    }
    const ord = [...llegadas].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < ord.length; i++) gaps.push((ord[i] - ord[i - 1]) / 60_000);
    gaps.sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    const mediana = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
    out.set(clienteId, Math.round(mediana));
  }
  return out;
}
