// ─────────────────────────────────────────────────────────────────────────────
// Planificador de capacidad (PURO, sin BD).
//
// Dado un volumen y las CAPACIDADES de mixer disponibles (p. ej. {11, 9, 7}),
// elige la MEJOR combinación de viajes evaluando TODAS las combinaciones
// factibles de (n11, n9, n7). No es un greedy: un greedy simple falla en casos
// como 14 m³ con 9 y 7 (daría "9 + parcial de 5"; lo óptimo es "7 + 7": mismos
// 2 viajes, sin carga parcial).
//
// Criterios de selección, en orden de prioridad:
//   1. Menor número total de viajes.
//   2. A igual número de viajes, menor volumen sobrante (capacidad ociosa =
//      Σ capacidades − volumen; solo el viaje parcial aporta ociosidad).
//   3. A igual todo lo anterior, usar menos mixers de la capacidad más grande
//      (desempate lexicográfico de la más grande a la más pequeña).
//
// El planificador NO asigna mixers físicos ni valida horarios: solo decide la
// mezcla de capacidades. La reutilización de un mismo mixer en varios viajes
// (cuando sus ciclos no se traslapan) la resuelve el agendador en asignacion.ts;
// por eso aquí un mixer no se "consume": basta con que la CAPACIDAD exista.
// ─────────────────────────────────────────────────────────────────────────────
import type { PlanCombinacion, PlanViaje } from "./tipos";
import { seTraslapan } from "./tiempos";

const EPS = 1e-6;

function redondear(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Un candidato de combinación evaluado, con sus métricas de comparación. */
interface Candidato {
  viajes: PlanViaje[];
  numViajes: number;
  ociosidad: number; // Σ capacidades − volumen (capacidad desperdiciada)
  porCapacidad: number[]; // conteo de viajes por capacidad (mismo orden que sizes desc)
}

/** ¿`a` es estrictamente mejor que `b` según los 3 criterios de prioridad? */
function esMejor(a: Candidato, b: Candidato): boolean {
  if (a.numViajes !== b.numViajes) return a.numViajes < b.numViajes;
  if (Math.abs(a.ociosidad - b.ociosidad) > EPS) return a.ociosidad < b.ociosidad;
  // Desempate: menos viajes de la capacidad más grande, luego la siguiente, etc.
  for (let i = 0; i < a.porCapacidad.length; i++) {
    if (a.porCapacidad[i] !== b.porCapacidad[i]) {
      return a.porCapacidad[i] < b.porCapacidad[i];
    }
  }
  return false;
}

/**
 * Elige la mejor combinación de viajes para `volumen` usando las capacidades de
 * `capacidadesDisponibles` (puede repetir: se toma el conjunto distinto). Un
 * mismo tamaño puede repetirse en varios viajes sin límite (los hará uno o
 * varios mixers, según horarios, en el agendador). Solo hay volumen sin cubrir
 * si NO existe ninguna capacidad disponible.
 */
export function planificarCombinacion(
  volumen: number,
  capacidadesDisponibles: number[],
): PlanCombinacion {
  const V = redondear(volumen);
  if (V <= EPS) return { viajes: [], volumenSinCubrir: 0 };

  const sizes = [...new Set(capacidadesDisponibles)]
    .filter((s) => s > 0)
    .sort((a, b) => b - a); // descendente: [11, 9, 7]
  if (sizes.length === 0) return { viajes: [], volumenSinCubrir: V };

  const maxS = sizes[0];
  let mejor: Candidato | null = null;

  // Construye y evalúa un candidato a partir de cuántas cargas COMPLETAS lleva
  // cada capacidad (`conteos`). El volumen restante, si lo hay, va en un único
  // viaje parcial en la capacidad más pequeña que aún lo contenga.
  const evaluar = (fullSoFar: number, conteos: number[]) => {
    const resto = redondear(V - fullSoFar);
    if (resto < -EPS) return; // se pasó (no debería, por el tope de maxK)
    if (resto > maxS + EPS) return; // no se puede terminar con un solo parcial

    const viajes: PlanViaje[] = [];
    for (let i = 0; i < sizes.length; i++) {
      for (let k = 0; k < conteos[i]; k++) {
        viajes.push({ capacidad: sizes[i], volumen: sizes[i] });
      }
    }
    if (resto > EPS) {
      // Capacidad más pequeña que todavía contiene el volumen restante.
      const contienen = sizes.filter((s) => s + EPS >= resto);
      const cap = contienen.length > 0 ? Math.min(...contienen) : maxS;
      viajes.push({ capacidad: cap, volumen: redondear(resto) });
    }

    const sumaCapacidades = viajes.reduce((acc, v) => acc + v.capacidad, 0);
    const porCapacidad = sizes.map(
      (s) => viajes.filter((v) => v.capacidad === s).length,
    );
    const candidato: Candidato = {
      viajes,
      numViajes: viajes.length,
      ociosidad: redondear(sumaCapacidades - V),
      porCapacidad,
    };
    if (mejor === null || esMejor(candidato, mejor)) mejor = candidato;
  };

  // Enumera cuántas cargas completas lleva cada capacidad, sin exceder V (el
  // sobrante va en el parcial). El espacio de búsqueda es pequeño porque cada
  // conteo está acotado por floor(V / capacidad).
  const conteos = new Array(sizes.length).fill(0);
  const recurse = (i: number, fullSoFar: number) => {
    if (i === sizes.length) {
      evaluar(fullSoFar, conteos);
      return;
    }
    const maxK = Math.floor((V - fullSoFar) / sizes[i] + EPS);
    for (let k = 0; k <= maxK; k++) {
      conteos[i] = k;
      recurse(i + 1, fullSoFar + k * sizes[i]);
    }
    conteos[i] = 0;
  };
  recurse(0, 0);

  // Siempre hay solución: llenar con la capacidad más grande deja un resto < maxS.
  const elegido = mejor as Candidato | null;
  if (elegido === null) return { viajes: [], volumenSinCubrir: V };
  return { viajes: elegido.viajes, volumenSinCubrir: 0 };
}

/** Ventana de ocupación de un viaje (carga → regreso a planta). */
export interface VentanaViaje {
  inicio: Date;
  fin: Date;
}

/**
 * ¿El mixer está libre en `ventana`, dadas sus otras ventanas ese día?
 * Un mixer solo puede estar en un lugar a la vez: si alguna de sus ventanas se
 * traslapa con la nueva, NO está libre. Base de la reutilización por horario:
 * un mismo mixer puede hacer varios viajes en el día si sus ciclos
 * (carga → regreso) no se traslapan entre sí.
 */
export function unidadLibreEnVentana(
  ventana: VentanaViaje,
  ventanasOcupadas: VentanaViaje[],
): boolean {
  return !ventanasOcupadas.some((v) =>
    seTraslapan(ventana.inicio, ventana.fin, v.inicio, v.fin),
  );
}
