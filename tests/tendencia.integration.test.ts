// Gráfico de tendencia de producción contra Postgres, por la server action.
//
// Los dos contratos que se protegen:
//
//  1. **El gráfico y el calendario cuentan lo MISMO.** Están uno al lado del otro en el
//     Panel Principal: si el total de agosto del gráfico no cuadra con la suma de los
//     planteles del calendario, uno de los dos está mintiendo. Aquí se comparan contra
//     `produccionDelMes`, que es la fuente del calendario.
//  2. **El alcance se aplica en el SERVIDOR.** Se prueba por la action y no por la
//     consulta, porque lo que manda el navegador solo puede acotar, nunca ampliar:
//     filtrar el desplegable en la pantalla no sería una restricción.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import { produccionDelMes } from "@/lib/produccion/consulta";
import { accesoTendencia, acotarSeleccion } from "@/lib/produccion/acceso";
import { claveDe } from "@/lib/produccion/tendencia";

type Rol = "Administrador" | "Programador" | "JefePlanta" | "Asesor" | "Laboratorista";
let rol: Rol = "Administrador";
let zona: string | null = null;
let plantelesJefe: number[] = [];

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Prueba", email: "u1@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rol], zona, null, null, plantelesJefe),
  requerirAcceso: async () => ({}),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));
// La action guarda la preferencia en una cookie; en pruebas no hay request.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const { datosTendenciaAction } = await import("@/app/tendencia-actions");

/** Un viaje Completado del volumen indicado, atribuido a la fecha del pedido. */
async function producir(p: { plantelId: number; plantaId: number; fecha: Date; m3: number }) {
  const clienteId = await crearCliente(true);
  const disenoId = await crearDiseno();
  const mixer = await prisma.mixers.create({
    data: { marca: "T", capacidad_m3: 12, plantel_base_id: p.plantelId },
  });
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: clienteId,
      diseno_id: disenoId,
      volumen_total_m3: p.m3,
      volumen_programado: p.m3,
      hora_solicitada: p.fecha,
      plantel_id: p.plantelId,
      planta_id: p.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "prueba",
    },
  });
  await prisma.viajes.create({
    data: {
      pedido_id: pedido.id,
      planta_id: p.plantaId,
      mixer_id: mixer.id,
      capacidad_asignada_m3: 11,
      volumen_asignado_m3: p.m3,
      hora_solicitada: p.fecha,
      hora_inicio_carga: p.fecha,
      estado: "Completado",
    },
  });
}

/** Tres planteles: dos en Norte y uno en Centro Sur. */
async function escenario() {
  const sm = await crearPlantel({ nombre: "SM Tend", zona: "Norte", esHub: true });
  const cho = await crearPlantel({ nombre: "CHO Tend", zona: "Norte" });
  const tgu = await crearPlantel({ nombre: "TGU Tend", zona: "Centro Sur", esHub: true });
  return { sm, cho, tgu };
}

const jul = (d: number) => new Date(2026, 6, d, 8, 0);
const ago = (d: number) => new Date(2026, 7, d, 8, 0);

async function pedir(entrada: Parameters<typeof datosTendenciaAction>[0] = {}) {
  const r = await datosTendenciaAction(entrada);
  expect(r.ok, r.mensaje).toBe(true);
  return r.datos!;
}

/** Valor de un periodo por su clave (evita depender del índice del arreglo). */
function valorEn(datos: Awaited<ReturnType<typeof pedir>>, clave: string, serie = 0) {
  const i = datos.periodos.findIndex((p) => p.clave === clave);
  expect(i, `no existe el periodo ${clave}`).toBeGreaterThanOrEqual(0);
  return datos.series[serie].valores[i];
}

beforeEach(async () => {
  await limpiarBD();
  rol = "Administrador";
  zona = null;
  plantelesJefe = [];
});

describe("(a) total nacional: UNA línea que cuadra con el calendario", () => {
  it("una sola serie, y su valor del mes es la suma de todos los planteles", async () => {
    const { sm, cho, tgu } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await producir({ ...cho, fecha: ago(10), m3: 12 });
    await producir({ ...tgu, fecha: ago(20), m3: 8 });

    const datos = await pedir({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(datos.series).toHaveLength(1);
    expect(datos.series[0].plantelId).toBeNull();
    expect(datos.series[0].nombre).toBe("Total nacional");
    expect(valorEn(datos, "2026-08")).toBe(50);

    // Y coincide EXACTAMENTE con lo que el calendario muestra para ese mes.
    const cal = await produccionDelMes({ anio: 2026, mes: 8 });
    const totalCalendario = [...cal.porDia.values()].reduce((s, d) => s + d.m3, 0);
    expect(valorEn(datos, "2026-08")).toBe(Math.round(totalCalendario * 10) / 10);

    // Y con la suma del desglose por plantel del calendario.
    const porPlantel = [...cal.porDiaPlantel.values()]
      .flat()
      .reduce((s, p) => s + p.m3, 0);
    expect(Math.round(porPlantel * 10) / 10).toBe(50);
  });

  it("un mes sin producción vale CERO, no queda sin dato", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    const datos = await pedir({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(valorEn(datos, "2026-07")).toBe(0);
    expect(valorEn(datos, "2026-08")).toBe(30);
  });
});

describe("(b) y (c) selección de planteles", () => {
  it("un solo plantel: UNA línea, únicamente la de ese plantel", async () => {
    const { sm, cho } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await producir({ ...cho, fecha: ago(4), m3: 12 });

    const datos = await pedir({
      granularidad: "mes",
      refMs: ago(15).getTime(),
      plantelIds: [cho.plantelId],
    });
    expect(datos.series).toHaveLength(1);
    expect(datos.series[0].plantelId).toBe(cho.plantelId);
    expect(datos.series[0].nombre).toBe("CHO Tend");
    expect(valorEn(datos, "2026-08")).toBe(12); // el volumen de SM no se cuela
  });

  it("tres planteles: TRES líneas, cada una con su color, y suman el total", async () => {
    const { sm, cho, tgu } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await producir({ ...cho, fecha: ago(4), m3: 12 });
    await producir({ ...tgu, fecha: ago(5), m3: 8 });

    const ids = [sm.plantelId, cho.plantelId, tgu.plantelId];
    const datos = await pedir({ granularidad: "mes", refMs: ago(15).getTime(), plantelIds: ids });
    expect(datos.series).toHaveLength(3);
    expect(datos.series.map((s) => s.plantelId).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      [...ids].sort((a, b) => a - b),
    );
    // Colores distintos entre sí (dos líneas del mismo color serían un error de lectura).
    expect(new Set(datos.series.map((s) => s.color)).size).toBe(3);

    const i = datos.periodos.findIndex((p) => p.clave === "2026-08");
    const suma = datos.series.reduce((s, x) => s + (x.valores[i] ?? 0), 0);
    expect(suma).toBe(50);
    // Y esa suma es la misma que la línea de total.
    const total = await pedir({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(valorEn(total, "2026-08")).toBe(suma);
  });
});

describe("(d) cambiar de granularidad no altera los totales", () => {
  it("semana, mes y año suman lo mismo", async () => {
    const { sm } = await escenario();
    // Dos días de la misma semana y uno de otra, todos de agosto de 2026.
    await producir({ ...sm, fecha: ago(3), m3: 10 }); // lunes 3
    await producir({ ...sm, fecha: ago(5), m3: 20 }); // miércoles 5
    await producir({ ...sm, fecha: ago(12), m3: 5 }); // miércoles 12
    await producir({ ...sm, fecha: jul(15), m3: 7 }); // julio

    const porMes = await pedir({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(valorEn(porMes, "2026-08")).toBe(35);
    expect(valorEn(porMes, "2026-07")).toBe(7);

    const porAnio = await pedir({ granularidad: "anio" });
    expect(valorEn(porAnio, "2026")).toBe(42); // 35 + 7

    // Semana: los dos viajes del 3 y el 5 caen en la MISMA semana ISO.
    const porSemana = await pedir({ granularidad: "semana", refMs: ago(15).getTime() });
    const sem1 = valorEn(porSemana, "2026-W32"); // 3–9 de agosto
    const sem2 = valorEn(porSemana, "2026-W33"); // 10–16 de agosto
    expect(sem1).toBe(30);
    expect(sem2).toBe(5);

    // INVARIANTE del modo Semana acotado al mes: la suma de las semanas mostradas es
    // exactamente el total del mes. Es lo que hace comparable la mitad derecha del panel
    // con la izquierda, incluso con semanas parciales en los bordes.
    const sumaSemanas = porSemana.series[0].valores.reduce<number>((a, v) => a + (v ?? 0), 0);
    expect(Math.round(sumaSemanas * 10) / 10).toBe(valorEn(porMes, "2026-08"));
  });
});

describe("(e) alcance por rol, validado en el servidor", () => {
  it("un Jefe de Planta con un solo plantel solo grafica ese, y su total es el de ese", async () => {
    const { sm, cho } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await producir({ ...cho, fecha: ago(4), m3: 12 });

    rol = "JefePlanta";
    plantelesJefe = [cho.plantelId];

    // Su "total" es el de SU plantel, no el nacional.
    const total = await pedir({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(total.series).toHaveLength(1);
    expect(valorEn(total, "2026-08")).toBe(12);
    expect(total.series[0].nombre).toBe("Total CHO Tend");

    // Y pedir el plantel AJENO no lo amplía: se ignora y cae a su propio total.
    const ajeno = await pedir({
      granularidad: "mes",
      refMs: ago(15).getTime(),
      plantelIds: [sm.plantelId],
    });
    expect(ajeno.series).toHaveLength(1);
    expect(valorEn(ajeno, "2026-08")).toBe(12);
    expect(ajeno.series[0].plantelId).toBeNull(); // cayó al total, no graficó SM
  });

  it("un Programador ve su zona, y su total se llama Total Zona Norte", async () => {
    const { sm, cho, tgu } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await producir({ ...cho, fecha: ago(4), m3: 12 });
    await producir({ ...tgu, fecha: ago(5), m3: 8 }); // Centro Sur: no debe contarse

    rol = "Programador";
    zona = "Norte";
    const datos = await pedir({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(datos.series[0].nombre).toBe("Total Zona Norte");
    expect(valorEn(datos, "2026-08")).toBe(42); // 30 + 12, sin los 8 de Centro Sur

    // Pedir el plantel de la otra zona no lo amplía.
    const ajeno = await pedir({
      granularidad: "mes",
      refMs: ago(15).getTime(),
      plantelIds: [tgu.plantelId],
    });
    expect(valorEn(ajeno, "2026-08")).toBe(42);
  });

  it("una selección MIXTA se recorta a lo permitido", async () => {
    const { sm, cho, tgu } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await producir({ ...tgu, fecha: ago(5), m3: 8 });
    rol = "Programador";
    zona = "Norte";

    const datos = await pedir({
      granularidad: "mes",
      refMs: ago(15).getTime(),
      plantelIds: [sm.plantelId, tgu.plantelId, cho.plantelId],
    });
    // Solo los dos del Norte quedan como líneas.
    expect(datos.series).toHaveLength(2);
    expect(datos.series.some((s) => s.plantelId === tgu.plantelId)).toBe(false);
  });

  it("el Asesor y el Laboratorista NO ven el gráfico", async () => {
    await escenario();
    for (const r of ["Asesor", "Laboratorista"] as Rol[]) {
      rol = r;
      const res = await datosTendenciaAction({ granularidad: "mes" });
      expect(res.ok, r).toBe(false);
      expect(res.datos).toBeUndefined();
    }
  });

  it("los planteles ofrecidos coinciden con el filtro del calendario", async () => {
    // El selector no puede ofrecer más de lo que el calendario dejaría pasar.
    const { sm, cho, tgu } = await escenario();
    const catalogo = await prisma.planteles.findMany({
      select: { id: true, nombre: true, zona: true },
    });
    const casos: { que: string; alcance: ReturnType<typeof calcularAlcance>; esperados: number[] }[] = [
      { que: "Admin", alcance: calcularAlcance(["Administrador"], null), esperados: catalogo.map((p) => p.id) },
      {
        que: "Programador Norte",
        alcance: calcularAlcance(["Programador"], "Norte"),
        esperados: [sm.plantelId, cho.plantelId],
      },
      {
        que: "Despachador Centro Sur",
        alcance: calcularAlcance(["Despachador"], "Centro Sur"),
        esperados: [tgu.plantelId],
      },
      {
        que: "Jefe de Planta",
        alcance: calcularAlcance(["JefePlanta"], null, null, undefined, [cho.plantelId]),
        esperados: [cho.plantelId],
      },
      {
        que: "Jefe de Planta sin planteles",
        alcance: calcularAlcance(["JefePlanta"], null, null, undefined, []),
        esperados: [],
      },
    ];
    for (const { que, alcance, esperados } of casos) {
      const acc = accesoTendencia(alcance, catalogo);
      expect(acc.planteles.map((p) => p.id).sort((a, b) => a - b), que).toEqual(
        [...esperados].sort((a, b) => a - b),
      );
      // Y una selección vacía o no permitida cae al total, nunca a "todo".
      expect(acotarSeleccion([], acc), que).toBeNull();
      expect(acotarSeleccion([999999], acc), que).toBeNull();
    }
  });
});

describe("(f) periodos futuros: sin dato, no cero", () => {
  it("los meses que no han empezado quedan en null y el mes en curso sí se grafica", async () => {
    const { sm } = await escenario();
    // Producción en el mes actual, para que el punto en curso exista.
    const hoy = new Date();
    hoy.setHours(8, 0, 0, 0);
    await producir({ ...sm, fecha: hoy, m3: 15 });

    const datos = await pedir({ granularidad: "mes" });
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    // El mes en curso es dato real (parcial), no futuro.
    expect(datos.periodos.find((p) => p.clave === mesActual)?.futuro).toBe(false);
    expect(valorEn(datos, mesActual)).toBe(15);

    // Todo lo posterior al mes en curso va sin dato.
    const i = datos.periodos.findIndex((p) => p.clave === mesActual);
    for (let k = i + 1; k < datos.periodos.length; k++) {
      expect(datos.periodos[k].futuro, datos.periodos[k].clave).toBe(true);
      expect(datos.series[0].valores[k], datos.periodos[k].clave).toBeNull();
    }
  });

  it("no se puede navegar hacia adelante más allá del presente", async () => {
    await escenario();
    const datos = await pedir({ granularidad: "mes" });
    expect(datos.haySiguiente).toBe(false); // ya se está en el año en curso
    expect(datos.hayAnterior).toBe(true);
  });
});

describe("lo que NO cuenta como producción", () => {
  it("un viaje programado sin completar y un pedido cancelado no aportan", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });

    // Viaje que no se completó.
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const pedido = await prisma.pedidos.create({
      data: {
        cliente_id: clienteId,
        diseno_id: disenoId,
        volumen_total_m3: 99,
        hora_solicitada: ago(4),
        plantel_id: sm.plantelId,
        planta_id: sm.plantaId,
        tipo_descarga: "Canal directo",
        creado_por: "prueba",
      },
    });
    const mixer = await prisma.mixers.create({
      data: { marca: "T", capacidad_m3: 12, plantel_base_id: sm.plantelId },
    });
    await prisma.viajes.create({
      data: {
        pedido_id: pedido.id,
        planta_id: sm.plantaId,
        mixer_id: mixer.id,
        capacidad_asignada_m3: 11,
        volumen_asignado_m3: 99,
        hora_solicitada: ago(4),
        estado: "En ruta",
      },
    });

    // Pedido cancelado con su viaje Completado.
    await producir({ ...sm, fecha: ago(6), m3: 77 });
    const ultimo = await prisma.pedidos.findFirstOrThrow({ orderBy: { id: "desc" } });
    await prisma.pedidos.update({
      where: { id: ultimo.id },
      data: { estado_pedido: "Cancelado" },
    });

    const datos = await pedir({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(valorEn(datos, "2026-08")).toBe(30);
  });

  it("cuenta el volumen REAL cuando el despachador lo corrigió", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 11 });
    const v = await prisma.viajes.findFirstOrThrow({ orderBy: { id: "desc" } });
    await prisma.viajes.update({ where: { id: v.id }, data: { volumen_real_m3: 7 } });

    const datos = await pedir({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(valorEn(datos, "2026-08")).toBe(7);
    // Y el calendario dice lo mismo (es la razón de usar la misma expresión).
    const cal = await produccionDelMes({ anio: 2026, mes: 8 });
    expect([...cal.porDia.values()].reduce((s, d) => s + d.m3, 0)).toBe(7);
  });
});

describe("modo Semana: solo las semanas del MES", () => {
  it("no aparece volumen de otro mes, y la semana del borde se recorta", async () => {
    const { sm } = await escenario();
    // 31 de julio (viernes) y 1 de agosto (sábado) están en la MISMA semana ISO (W31).
    await producir({ ...sm, fecha: jul(31), m3: 40 });
    await producir({ ...sm, fecha: ago(1), m3: 9 });
    await producir({ ...sm, fecha: ago(12), m3: 5 });

    const agosto = await pedir({ granularidad: "semana", refMs: ago(15).getTime() });
    // El punto de la semana del borde cuenta SOLO los días de agosto: 9, no 49.
    expect(valorEn(agosto, "2026-W31")).toBe(9);
    // Y la suma de las semanas es el total del mes (9 + 5), sin los 40 de julio.
    const suma = agosto.series[0].valores.reduce<number>((a, v) => a + (v ?? 0), 0);
    expect(Math.round(suma * 10) / 10).toBe(14);

    // La misma semana, vista desde JULIO, cuenta los 40 de julio.
    const julio = await pedir({ granularidad: "semana", refMs: jul(15).getTime() });
    expect(valorEn(julio, "2026-W31")).toBe(40);
    const sumaJul = julio.series[0].valores.reduce<number>((a, v) => a + (v ?? 0), 0);
    expect(Math.round(sumaJul * 10) / 10).toBe(40);
  });

  it("el eje trae solo las semanas de ese mes (4 a 6 puntos), no 12", async () => {
    await escenario();
    const d = await pedir({ granularidad: "semana", refMs: ago(15).getTime() });
    expect(d.periodos.length).toBeGreaterThanOrEqual(4);
    expect(d.periodos.length).toBeLessThanOrEqual(6);
    expect(d.titulo).toBe("agosto de 2026");
  });

  it("la navegación mueve el MES y no se pasa del mes en curso", async () => {
    await escenario();
    // Un mes pasado: se puede avanzar.
    const jun = await pedir({ granularidad: "semana", refMs: new Date(2026, 5, 15).getTime() });
    expect(jun.titulo).toBe("junio de 2026");
    expect(jun.haySiguiente).toBe(true);
    expect(jun.hayAnterior).toBe(true);

    // El mes en curso: ya no se avanza.
    const hoy = new Date();
    const actual = await pedir({ granularidad: "semana", refMs: hoy.getTime() });
    expect(actual.haySiguiente).toBe(false);
  });

  it("la suma de las semanas cuadra con el calendario del mismo mes", async () => {
    // Se usa JULIO (mes ya cerrado) a propósito: en el mes EN CURSO los días que aún no
    // llegan son "sin dato", así que la suma de las semanas mostradas no incluiría una
    // producción fechada en el futuro — que de todos modos sería un error de captura.
    const { sm, cho } = await escenario();
    await producir({ ...sm, fecha: jul(1), m3: 30 }); // miércoles: semana parcial inicial
    await producir({ ...cho, fecha: jul(15), m3: 12 });
    await producir({ ...sm, fecha: jul(31), m3: 7 }); // viernes: semana parcial final

    const d = await pedir({ granularidad: "semana", refMs: jul(15).getTime() });
    expect(d.titulo).toBe("julio de 2026");
    expect(d.periodos.every((p) => !p.futuro)).toBe(true);
    const suma = d.series[0].valores.reduce<number>((a, v) => a + (v ?? 0), 0);

    const cal = await produccionDelMes({ anio: 2026, mes: 7 });
    const totalCal = Math.round([...cal.porDia.values()].reduce((s, x) => s + x.m3, 0) * 10) / 10;
    expect(Math.round(suma * 10) / 10).toBe(totalCal);
    expect(totalCal).toBe(49);
  });

  it("en el mes EN CURSO, los días que aún no llegan quedan sin dato", async () => {
    const { sm } = await escenario();
    const hoy = new Date();
    hoy.setHours(8, 0, 0, 0);
    await producir({ ...sm, fecha: hoy, m3: 15 });

    const d = await pedir({ granularidad: "semana", refMs: hoy.getTime() });
    // La semana en curso es dato real (parcial); las posteriores del mes, sin dato.
    // Se ubica por CLAVE (lo que de verdad viaja al navegador), no por milisegundos.
    const iHoy = d.periodos.findIndex((p) => p.clave === claveDe(hoy, "semana"));
    expect(iHoy, "la semana de hoy tiene que estar en el eje").toBeGreaterThanOrEqual(0);
    expect(d.periodos[iHoy].futuro).toBe(false);
    expect(d.series[0].valores[iHoy]).toBe(15);
    for (let k = iHoy + 1; k < d.periodos.length; k++) {
      expect(d.periodos[k].futuro).toBe(true);
      expect(d.series[0].valores[k]).toBeNull();
    }
  });
});
