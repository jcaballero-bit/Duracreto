// ─────────────────────────────────────────────────────────────────────────────
// Generación EN SERIE de viajes (modo manual) — planificación PURA (sin BD).
//
// El usuario captura de una sola vez muchos viajes iguales: N viajes, cada uno a una
// cadencia fija (minutos entre inicios de carga), ALTERNANDO una o varias plantas
// (round-robin) y ROTANDO una o varias mixers (round-robin). Esto reemplaza la
// captura fila por fila del Excel de hoy. Es solo el PLAN (qué planta / qué mixer /
// a qué hora carga cada viaje); la escritura a BD la hace el motor sin cascada.
// ─────────────────────────────────────────────────────────────────────────────

export interface ParamsSerie {
  cantidad: number; // cuántos viajes generar
  frecuenciaMin: number; // minutos entre inicios de carga consecutivos
  inicioMs: number; // inicio de carga del PRIMER viaje (ms epoch)
  plantaIds: number[]; // plantas a alternar (round-robin); al menos una
  mixerIds: number[]; // mixers a rotar (round-robin); al menos una
}

export interface ViajeSerie {
  indice: number; // 0..cantidad-1
  inicioCargaMs: number;
  plantaId: number;
  mixerId: number;
}

/**
 * Planifica la serie: el viaje `i` carga en `inicio + i·frecuencia`, en la planta
 * `plantaIds[i % nPlantas]` y con el mixer `mixerIds[i % nMixers]`. Determinista:
 * las horas y asignaciones quedan EXACTAMENTE como se pidió (no interviene el motor).
 */
export function planificarSerie(p: ParamsSerie): ViajeSerie[] {
  if (p.cantidad <= 0 || p.plantaIds.length === 0 || p.mixerIds.length === 0) return [];
  const out: ViajeSerie[] = [];
  for (let i = 0; i < p.cantidad; i++) {
    out.push({
      indice: i,
      inicioCargaMs: p.inicioMs + i * p.frecuenciaMin * 60_000,
      plantaId: p.plantaIds[i % p.plantaIds.length],
      mixerId: p.mixerIds[i % p.mixerIds.length],
    });
  }
  return out;
}
