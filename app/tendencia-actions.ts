"use server";

// Datos del gráfico de tendencia del Panel Principal, a pedido del navegador.
//
// Por qué una server action y no searchParams: el gráfico tiene tres controles
// (granularidad, periodo y selección de planteles) que solo lo afectan a él. Meterlos en
// la URL los mezclaría con los del calendario, que ya usa `mesProd`/`zonaProd`, y cada
// clic recargaría la página entera. Así solo viaja el dato del gráfico — que agrupado son
// unas 84 filas.
//
// El ALCANCE se recalcula aquí desde la sesión en cada llamada: lo que manda el navegador
// solo puede ACOTAR la selección, nunca ampliarla (`acotarSeleccion`). Filtrar el
// desplegable en la pantalla no sería una restricción.

import { cookies } from "next/headers";
import { alcanceActual } from "@/lib/auth/guard";
import { plantelesCatalogo } from "@/lib/catalogos-cache";
import { accesoTendencia, acotarSeleccion } from "@/lib/produccion/acceso";
import {
  anosConProduccion,
  cobertura,
  historicaEnRango,
  produccionPorPeriodo,
} from "@/lib/produccion/consulta";
import { combinarPorPeriodo } from "@/lib/produccion/historica";
import { colorPorPlantel, COLOR_TOTAL } from "@/lib/color-plantel";
import {
  armarSeries,
  esGranularidad,
  periodosAnio,
  periodosMes,
  periodosSemanaDelMes,
  COOKIE_TENDENCIA,
  type DatosTendencia,
  type Granularidad,
  type Periodo,
} from "@/lib/produccion/tendencia";

const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * Construye los periodos del eje según la granularidad y el ancla de navegación.
 * `ahoraMs` se inyecta para poder probar la regla del futuro sin depender del reloj.
 */
function ejeDe(
  g: Granularidad,
  refMs: number,
  ahoraMs: number,
  rangoAnios: { desde: number; hasta: number } | null,
): { periodos: Periodo[]; titulo: string; hayAnterior: boolean; haySiguiente: boolean } {
  if (g === "semana") {
    // Solo las semanas del MES de la referencia (recortadas al mes), y la navegación
    // mueve el mes: así la mitad derecha del panel mira el mismo periodo que el
    // calendario de la izquierda.
    const ref = new Date(refMs);
    const anio = ref.getFullYear();
    const mes = ref.getMonth() + 1;
    const ahora = new Date(ahoraMs);
    return {
      periodos: periodosSemanaDelMes(anio, mes, ahoraMs),
      titulo: `${MESES_LARGOS[mes - 1]} de ${anio}`,
      hayAnterior: true,
      // No se navega a un mes que todavía no empezó.
      haySiguiente:
        anio < ahora.getFullYear() || (anio === ahora.getFullYear() && mes - 1 < ahora.getMonth()),
    };
  }
  if (g === "mes") {
    const anio = new Date(refMs).getFullYear();
    return {
      periodos: periodosMes(anio, ahoraMs),
      titulo: String(anio),
      hayAnterior: true,
      haySiguiente: anio < new Date(ahoraMs).getFullYear(),
    };
  }
  // Año: todos los años con datos (y siempre el actual, para que el eje no quede vacío
  // cuando la operación acaba de empezar).
  const actual = new Date(ahoraMs).getFullYear();
  const desde = Math.min(rangoAnios?.desde ?? actual, actual);
  const hasta = Math.max(rangoAnios?.hasta ?? actual, actual);
  return {
    periodos: periodosAnio(desde, hasta, ahoraMs),
    titulo: desde === hasta ? String(desde) : `${desde} – ${hasta}`,
    hayAnterior: false, // el modo Año ya muestra toda la historia: no hay a dónde ir
    haySiguiente: false,
  };
}

/**
 * Devuelve las series del gráfico. `plantelIds` vacío o nulo = la línea de TOTAL del
 * alcance del usuario (nacional, de su zona o de sus planteles, según el rol).
 */
export async function datosTendenciaAction(entrada: {
  granularidad?: string;
  /** Ancla de navegación: ms (modo Semana) o cualquier fecha del año (modos Mes/Año). */
  refMs?: number;
  plantelIds?: number[] | null;
  /** Guardar la elección como preferencia del usuario para la próxima visita. */
  recordar?: boolean;
}): Promise<{ ok: boolean; mensaje?: string; datos?: DatosTendencia }> {
  const alcance = await alcanceActual();
  const catalogo = (await plantelesCatalogo()).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    zona: p.zona,
  }));
  const acceso = accesoTendencia(alcance, catalogo);
  if (!acceso.visible) return { ok: false, mensaje: "Tu rol no ve el gráfico de producción." };
  if (acceso.faltaZona) return { ok: false, mensaje: "Tu usuario no tiene una zona asignada." };

  const g: Granularidad = esGranularidad(entrada.granularidad) ? entrada.granularidad : "mes";
  const ahoraMs = Date.now();
  const refMs = Number.isFinite(entrada.refMs) ? Number(entrada.refMs) : ahoraMs;

  // Selección acotada al alcance: `null` = total. Los ids permitidos son el techo de
  // TODA consulta, incluso cuando se grafica el total.
  const seleccion = acotarSeleccion(entrada.plantelIds, acceso);
  const idsPermitidos = acceso.planteles.length ? acceso.planteles.map((p) => p.id) : [-1];
  const idsConsulta = seleccion ?? idsPermitidos;

  const rangoAnios = g === "anio" ? await anosConProduccion(idsPermitidos) : null;
  const { periodos, titulo, hayAnterior, haySiguiente } = ejeDe(g, refMs, ahoraMs, rangoAnios);

  const porPeriodo = await produccionPorPeriodo({
    granularidad: g,
    desde: new Date(periodos[0].desdeMs),
    hasta: new Date(periodos[periodos.length - 1].hastaMs),
    plantelIds: idsConsulta,
  });

  // ── Produccion HISTORICA ──────────────────────────────────────────────────
  // Se combina aqui, donde ya estan los periodos del eje. El sistema tiene precedencia y
  // las dos fuentes NUNCA se suman para el mismo periodo y plantel. Sin filas cargadas,
  // `combinarPorPeriodo` devuelve exactamente lo que entro.
  //
  // Las filas Mensuales solo entran en las vistas de Mes y Ano: repartir un total mensual
  // entre semanas o dias seria inventar el reparto.
  const historicas = await historicaEnRango(
    new Date(periodos[0].desdeMs),
    new Date(periodos[periodos.length - 1].hastaMs),
    idsConsulta,
  );
  let porPeriodoFinal = porPeriodo;
  let periodosHistoricos = new Set<string>();
  if (historicas.length > 0) {
    const cob = await cobertura(
      new Date(periodos[0].desdeMs),
      new Date(periodos[periodos.length - 1].hastaMs),
      idsConsulta,
    );
    const r = combinarPorPeriodo(periodos, porPeriodo, historicas, {
      permiteMensual: g !== "semana",
      mesesConSistema: cob.meses,
      diasConSistema: cob.dias,
    });
    porPeriodoFinal = r.combinado;
    periodosHistoricos = r.periodosHistoricos;
  }

  const nombre = new Map(catalogo.map((p) => [p.id, p.nombre]));
  const series = armarSeries(
    periodos,
    porPeriodoFinal,
    seleccion,
    (id) => nombre.get(id) ?? `Plantel ${id}`,
    colorPorPlantel,
    acceso.etiquetaTotal,
    COLOR_TOTAL,
  );

  if (entrada.recordar) {
    // Preferencia, no dato sensible: solo la granularidad y la selección. Se lee al
    // renderizar el panel para que el gráfico abra donde el usuario lo dejó.
    const c = await cookies();
    c.set(COOKIE_TENDENCIA, JSON.stringify({ g, sel: seleccion }), {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return {
    ok: true,
    datos: {
      granularidad: g,
      periodos: periodos.map((p) => ({
        clave: p.clave,
        etiqueta: p.etiqueta,
        etiquetaLarga: p.etiquetaLarga,
        futuro: p.futuro,
        // El volumen de este periodo incluye una carga historica: la linea se dibuja
        // punteada en ese tramo y el tooltip lo dice.
        historico: periodosHistoricos.has(p.clave),
      })),
      series,
      refMs,
      anio: new Date(refMs).getFullYear(),
      titulo,
      hayAnterior,
      haySiguiente,
    },
  };
}
