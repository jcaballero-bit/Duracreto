// Interpolación cúbica MONÓTONA (Fritsch–Carlson) para las líneas del gráfico de
// tendencia. Módulo PURO: solo geometría, sin React ni SVG más allá del texto del `path`.
//
// Por qué monótona y no una curva de Bézier libre. No es un detalle estético:
//
//   Una curva libre (`curveBasis`, `curveCardinal`, o un simple "suavizado" con puntos de
//   control a ojo) PUEDE SOBREPASAR los valores reales entre dos puntos. En un gráfico de
//   producción eso significa dibujar, por ejemplo, un pico de 4,200 m³ entre dos meses de
//   3,800 y 4,000 — un valor que nunca existió y que alguien puede leer como real. Peor
//   aún hacia abajo: entre un 0 y un valor alto, una curva libre baja por debajo de cero,
//   y producción negativa no significa nada.
//
//   La interpolación monótona limita las tangentes para que la curva NUNCA salga del rango
//   de los dos puntos que une, y para que en un máximo o mínimo local la tangente sea 0
//   (así tampoco se pasa por arriba de un pico ni por debajo de un valle). El trazo se ve
//   suave y cada valor dibujado está entre datos que sí ocurrieron.
//
// El método es el clásico de Fritsch & Carlson (1980): tangentes por promedio de secantes
// y luego un limitador que las recorta al círculo de radio 3, que es la condición
// suficiente de monotonía. Es lo mismo que hace `curveMonotoneX` de d3; aquí se escribe a
// mano porque el gráfico dibuja su propio SVG y el proyecto no tiene librería de gráficos
// (el registro corporativo bloquea `npm install`).

export interface Punto {
  x: number;
  y: number;
}

/**
 * Tangentes monótonas en cada punto. `xs` debe venir estrictamente creciente.
 *
 * Se expone aparte de `rutaMonotona` para poder probar la propiedad que importa (que la
 * tangente se anule en los extremos locales) sin tener que leer un texto de `path`.
 */
export function tangentesMonotonas(puntos: Punto[]): number[] {
  const n = puntos.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Pendientes de las secantes entre puntos consecutivos.
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = puntos[i + 1].x - puntos[i].x;
    delta.push(dx === 0 ? 0 : (puntos[i + 1].y - puntos[i].y) / dx);
  }

  // Tangente inicial: la secante en los extremos, el promedio en el interior.
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) / 2;

  // Limitador de Fritsch–Carlson: es lo que impide el sobrepaso.
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      // Tramo plano: si la curva tuviera pendiente aquí, se saldría del rango de los dos
      // puntos (que valen lo mismo). Se aplana.
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    let a = m[i] / delta[i];
    let b = m[i + 1] / delta[i];
    // Signo contrario al de la secante = hay un extremo local en ese punto: tangente 0,
    // así la curva no se pasa por arriba del pico ni por debajo del valle.
    //
    // OJO con el orden: `a` y `b` se ACTUALIZAN al anular la tangente. Calcular el
    // limitador de abajo con los valores viejos vuelve a meter la tangente equivocada y
    // la curva se sale — con [0, 5, 0, 300, 0, 0] bajaba a -1.4 m³, y con
    // [400, 5, 6, 5, 400] caía a 4.72 por debajo del 5. Lo atraparon las pruebas.
    if (a < 0) {
      m[i] = 0;
      a = 0;
    }
    if (b < 0) {
      m[i + 1] = 0;
      b = 0;
    }
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * delta[i];
      m[i + 1] = tau * b * delta[i];
    }
  }
  return m;
}

/**
 * `d` de un `<path>` SVG que pasa EXACTAMENTE por cada punto con trazo suave.
 *
 * Con un solo punto devuelve un `M` (el marcador del punto lo dibuja el componente);
 * con cero puntos, cadena vacía.
 */
export function rutaMonotona(puntos: Punto[], decimales = 2): string {
  const n = puntos.length;
  if (n === 0) return "";
  const r = (v: number) => Number(v.toFixed(decimales));
  if (n === 1) return `M${r(puntos[0].x)},${r(puntos[0].y)}`;

  const m = tangentesMonotonas(puntos);
  let d = `M${r(puntos[0].x)},${r(puntos[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    // Hermite cúbico a Bézier: los controles caen a un tercio del ancho del tramo, con la
    // altura que marca la tangente. Es una identidad exacta, no una aproximación.
    const h = puntos[i + 1].x - puntos[i].x;
    const c1x = puntos[i].x + h / 3;
    const c1y = puntos[i].y + (m[i] * h) / 3;
    const c2x = puntos[i + 1].x - h / 3;
    const c2y = puntos[i + 1].y - (m[i + 1] * h) / 3;
    d += `C${r(c1x)},${r(c1y)} ${r(c2x)},${r(c2y)} ${r(puntos[i + 1].x)},${r(puntos[i + 1].y)}`;
  }
  return d;
}

/**
 * Muestrea la curva que dibuja `rutaMonotona`, con `porTramo` puntos por segmento.
 *
 * Existe para las pruebas: permite verificar sobre la MISMA curva que se dibuja que no
 * hay sobrepaso ni valores negativos entre dos datos. Evaluar el `path` de otra forma
 * sería probar una reimplementación, no lo que se ve en pantalla.
 */
export function muestrearMonotona(puntos: Punto[], porTramo = 40): Punto[] {
  const n = puntos.length;
  if (n <= 1) return [...puntos];
  const m = tangentesMonotonas(puntos);
  const out: Punto[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = puntos[i];
    const p1 = puntos[i + 1];
    const h = p1.x - p0.x;
    const c1 = { x: p0.x + h / 3, y: p0.y + (m[i] * h) / 3 };
    const c2 = { x: p1.x - h / 3, y: p1.y - (m[i + 1] * h) / 3 };
    for (let k = 0; k <= porTramo; k++) {
      const t = k / porTramo;
      const u = 1 - t;
      // Bézier cúbica.
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
      });
    }
  }
  return out;
}
