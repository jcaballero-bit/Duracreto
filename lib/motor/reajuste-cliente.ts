// Reajuste de la cola de UN cliente por frecuencia (modo manual). PURO: sin BD.
//
// Cuando el Programador fija la hora de LLEGADA del primer viaje de un cliente, los
// demás viajes DE ESE MISMO CLIENTE se reacomodan a la cadencia que el asesor pidió
// (`frecuencia_entre_camiones_min`): viaje 2 llega a llegada_1 + frecuencia, viaje 3 a
// llegada_2 + frecuencia, y así.
//
// Regla central del modo manual: el sistema NO reprograma a terceros. Este módulo solo
// devuelve las horas de los viajes del cliente editado; los de otros clientes ni se
// consultan. Y respeta los viajes intocables:
//  · `horaFija` — el usuario los clavó a una hora (no se mueven, pero SÍ sirven de
//    referencia para el siguiente: la cadena sigue la llegada REAL del anterior).
//  · `yaInicio` — el camión ya cargó o el viaje se completó: es historia, no se toca.
// En ambos casos se reporta el salto para poder avisarlo en pantalla.

/** Un viaje del cliente, tal como está hoy. */
export interface ViajeReajuste {
  id: number;
  /** Llegada actual a obra (ms epoch). */
  llegadaMs: number;
  /** Hora fijada a mano: no se mueve. */
  horaFija: boolean;
  /** Ya inició carga o está completado: no se mueve. */
  yaInicio: boolean;
}

export interface SaltoReajuste {
  id: number;
  motivo: "hora_fija" | "ya_inicio";
}

export interface PlanReajuste {
  /** Viajes que deben moverse, con su nueva hora de llegada. */
  cambios: { id: number; llegadaMs: number }[];
  /** Viajes que quedaron fuera del reajuste (y por qué). */
  saltados: SaltoReajuste[];
}

/**
 * Cadencia (minutos) que YA tiene la cola: mediana de los huecos entre llegadas
 * consecutivas. Sirve de respaldo cuando el pedido no trae
 * `frecuencia_entre_camiones_min`: al mover el primer viaje, el resto conserva el
 * ritmo con el que estaba armado en vez de quedarse atrás. Se usa la mediana (no el
 * promedio) para que un hueco atípico no distorsione el resultado.
 * Devuelve null si hay menos de 2 llegadas o si los huecos no dan un valor usable.
 */
export function cadenciaActual(llegadasMs: number[]): number | null {
  if (llegadasMs.length < 2) return null;
  const orden = [...llegadasMs].sort((a, b) => a - b);
  const huecos: number[] = [];
  for (let i = 1; i < orden.length; i++) huecos.push((orden[i] - orden[i - 1]) / 60_000);
  huecos.sort((a, b) => a - b);
  const mid = Math.floor(huecos.length / 2);
  const mediana =
    huecos.length % 2 ? huecos[mid] : (huecos[mid - 1] + huecos[mid]) / 2;
  const min = Math.round(mediana);
  return min > 0 ? min : null;
}

/**
 * Calcula las nuevas llegadas de los viajes de un cliente a partir de la llegada del
 * primero. `viajes` puede venir en cualquier orden: se ordena por su llegada actual
 * (desempate por id) para reconstruir la cola.
 *
 * `frecuenciaMin` nulo o ≤ 0 → no hay cadencia definida: solo se mueve el viaje
 * editado (`primeroId`) y el resto se deja como está. Quien llama puede pasar la
 * cadencia inferida con `cadenciaActual` para conservar el ritmo existente.
 */
export function planificarReajusteCliente(
  viajes: ViajeReajuste[],
  primeroId: number,
  llegadaPrimeroMs: number,
  frecuenciaMin: number | null,
): PlanReajuste {
  const cambios: { id: number; llegadaMs: number }[] = [];
  const saltados: SaltoReajuste[] = [];

  const orden = [...viajes].sort((a, b) => a.llegadaMs - b.llegadaMs || a.id - b.id);
  const iPrimero = orden.findIndex((v) => v.id === primeroId);
  if (iPrimero < 0) return { cambios, saltados };

  // El viaje editado siempre toma la hora que pidió el usuario.
  cambios.push({ id: primeroId, llegadaMs: llegadaPrimeroMs });

  // Sin frecuencia no hay cola que reacomodar.
  if (frecuenciaMin == null || frecuenciaMin <= 0) return { cambios, saltados };

  const pasoMs = frecuenciaMin * 60_000;
  // Referencia = llegada EFECTIVA del viaje anterior de la cola (la nueva si se movió,
  // la suya propia si quedó fijo).
  let anteriorMs = llegadaPrimeroMs;

  for (const v of orden.slice(iPrimero + 1)) {
    if (v.yaInicio) {
      saltados.push({ id: v.id, motivo: "ya_inicio" });
      anteriorMs = v.llegadaMs;
      continue;
    }
    if (v.horaFija) {
      saltados.push({ id: v.id, motivo: "hora_fija" });
      anteriorMs = v.llegadaMs;
      continue;
    }
    const nueva = anteriorMs + pasoMs;
    cambios.push({ id: v.id, llegadaMs: nueva });
    anteriorMs = nueva;
  }

  return { cambios, saltados };
}
