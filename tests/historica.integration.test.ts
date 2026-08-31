// Producción histórica contra Postgres, por las server actions y las consultas reales.
//
// Cubre los casos (a)–(f) de la validación pedida. Lo que más importa es (a): con la tabla
// vacía, el calendario y el gráfico se comportan EXACTAMENTE como antes de que esta
// funcionalidad existiera.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import { produccionDelMes, produccionPorPeriodo } from "@/lib/produccion/consulta";

type Rol = "Administrador" | "Programador";
let rol: Rol = "Administrador";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Admin Prueba", email: "a@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  exigirAdmin: async () =>
    rol === "Administrador"
      ? { ok: true, userId: "u1" }
      : { ok: false, mensaje: "Solo un Administrador." },
  alcanceActual: async () => calcularAlcance([rol], "Norte", null, null, []),
  requerirAcceso: async () => ({}),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const {
  eliminarLoteHistoricaAction,
  guardarHistoricaAction,
  verificarChoqueAction,
  eliminarHistoricaAction,
  previsualizarHistoricaAction,
  importarHistoricaAction,
  vincularAliasAction,
} = await import("@/app/administracion/historica-actions");
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

async function escenario() {
  const sm = await crearPlantel({ nombre: "SM Hist", zona: "Norte", esHub: true });
  const cho = await crearPlantel({ nombre: "CHO Hist", zona: "Norte" });
  return { sm, cho };
}

const ago = (d: number) => new Date(2026, 7, d, 8, 0);
const totalMes = (m: Map<string, { m3: number }>) =>
  Math.round([...m.values()].reduce((s, d) => s + d.m3, 0) * 10) / 10;

async function pedirGrafico(entrada: Parameters<typeof datosTendenciaAction>[0]) {
  const r = await datosTendenciaAction(entrada);
  expect(r.ok, r.mensaje).toBe(true);
  return r.datos!;
}
function valorEn(datos: Awaited<ReturnType<typeof pedirGrafico>>, clave: string) {
  const i = datos.periodos.findIndex((p) => p.clave === clave);
  return i < 0 ? undefined : datos.series[0].valores[i];
}

beforeEach(async () => {
  await limpiarBD(); // ya limpia produccion_historica y sus alias
  await prisma.bitacora_auditoria.deleteMany();
  rol = "Administrador";
});

describe("(a) con la tabla VACIA, todo se comporta como antes", () => {
  it("el calendario da lo mismo con y sin el parámetro de histórica", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });

    const sinHistorica = await produccionDelMes({ anio: 2026, mes: 8 });
    const conParametro = await produccionDelMes({ anio: 2026, mes: 8, plantelesHistorico: null });

    expect(totalMes(sinHistorica.porDia)).toBe(30);
    expect(totalMes(conParametro.porDia)).toBe(30);
    expect([...conParametro.porDia.keys()]).toEqual([...sinHistorica.porDia.keys()]);
    expect(conParametro.diasHistoricos?.size ?? 0).toBe(0);
    expect(conParametro.soloMensual ?? false).toBe(false);
  });

  it("el gráfico da lo mismo", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    const d = await pedirGrafico({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(valorEn(d, "2026-08")).toBe(30);
    expect(d.periodos.every((p) => !p.historico)).toBe(true);
  });
});

describe("(b) una carga histórica aparece en el gráfico", () => {
  it("un mes de 2025 sale en la vista de Mes y de Año, marcado como histórico", async () => {
    const { sm } = await escenario();
    const r = await guardarHistoricaAction({
      fechaIso: "2025-07-15",
      plantelId: sm.plantelId,
      volumen: 900,
      granularidad: "Mensual",
      observaciones: "Excel 2025",
    });
    expect(r.ok, r.mensaje).toBe(true);
    // Mensual se ancla al día 1 del mes.
    const fila = await prisma.produccion_historica.findFirstOrThrow();
    expect(fila.fecha.getDate()).toBe(1);
    expect(fila.fecha.getMonth()).toBe(6);

    const mes = await pedirGrafico({
      granularidad: "mes",
      refMs: new Date(2025, 6, 15).getTime(),
    });
    expect(valorEn(mes, "2025-07")).toBe(900);
    expect(mes.periodos.find((p) => p.clave === "2025-07")?.historico).toBe(true);

    const anio = await pedirGrafico({ granularidad: "anio" });
    expect(valorEn(anio, "2025")).toBe(900);
    expect(anio.periodos.find((p) => p.clave === "2025")?.historico).toBe(true);
  });
});

describe("(c) choque con datos del sistema", () => {
  it("avisa antes de guardar", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    const chequeo = await verificarChoqueAction({
      fechaIso: "2026-08-03",
      plantelId: sm.plantelId,
      granularidad: "Diaria",
    });
    expect(chequeo.ok).toBe(true);
    expect(chequeo.choca).toBe(true);
  });

  it("si se guarda igual, NO se suma ni reemplaza al dato del sistema", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await guardarHistoricaAction({
      fechaIso: "2026-08-03",
      plantelId: sm.plantelId,
      volumen: 999,
      granularidad: "Diaria",
    });
    // La fila quedó archivada…
    expect(await prisma.produccion_historica.count()).toBe(1);

    // …pero el calendario y el gráfico siguen mostrando los 30 del sistema.
    const cal = await produccionDelMes({ anio: 2026, mes: 8, plantelesHistorico: null });
    expect(totalMes(cal.porDia)).toBe(30);
    expect(cal.diasHistoricos?.size ?? 0).toBe(0);

    const d = await pedirGrafico({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(valorEn(d, "2026-08")).toBe(30); // ni 999 ni 1029
  });

  it("un día SIN viajes del sistema sí toma el histórico, y se marca", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await guardarHistoricaAction({
      fechaIso: "2026-08-10",
      plantelId: sm.plantelId,
      volumen: 12,
      granularidad: "Diaria",
    });
    const cal = await produccionDelMes({ anio: 2026, mes: 8, plantelesHistorico: null });
    expect(totalMes(cal.porDia)).toBe(42); // 30 del sistema + 12 histórico de otro día
    expect(cal.diasHistoricos?.has("2026-08-10")).toBe(true);
    expect(cal.diasHistoricos?.has("2026-08-03")).toBe(false);
  });
});

describe("(d) granularidad Mensual", () => {
  it("no aparece en el calendario diario, y la pantalla lo explica", async () => {
    const { sm } = await escenario();
    await guardarHistoricaAction({
      fechaIso: "2025-07-01",
      plantelId: sm.plantelId,
      volumen: 900,
      granularidad: "Mensual",
    });
    const cal = await produccionDelMes({ anio: 2025, mes: 7, plantelesHistorico: null });
    expect(totalMes(cal.porDia)).toBe(0);
    // En vez de quedar vacío sin explicación, la pantalla dice que solo hay mensual.
    expect(cal.soloMensual).toBe(true);
  });

  it("no aparece en la vista de SEMANA del gráfico", async () => {
    const { sm } = await escenario();
    await guardarHistoricaAction({
      fechaIso: "2025-07-01",
      plantelId: sm.plantelId,
      volumen: 900,
      granularidad: "Mensual",
    });
    const sem = await pedirGrafico({
      granularidad: "semana",
      refMs: new Date(2025, 6, 15).getTime(),
    });
    const suma = sem.series[0].valores.reduce<number>((a, v) => a + (v ?? 0), 0);
    expect(suma).toBe(0);
    expect(sem.periodos.every((p) => !p.historico)).toBe(true);
  });

  it("no deja cargar Diaria y Mensual del mismo mes y plantel", async () => {
    const { sm } = await escenario();
    await guardarHistoricaAction({
      fechaIso: "2025-07-03",
      plantelId: sm.plantelId,
      volumen: 40,
      granularidad: "Diaria",
    });
    const r = await guardarHistoricaAction({
      fechaIso: "2025-07-01",
      plantelId: sm.plantelId,
      volumen: 900,
      granularidad: "Mensual",
    });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("duplicaría");
    expect(await prisma.produccion_historica.count()).toBe(1);
  });
});

describe("(e) el total anual es la suma de los meses, sin duplicar", () => {
  it("mezcla de sistema e histórico cuadra en Mes y en Año", async () => {
    const { sm } = await escenario();
    // Sistema: agosto de 2026.
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    // Histórico: dos meses de 2026 sin datos del sistema.
    await guardarHistoricaAction({
      fechaIso: "2026-03-01",
      plantelId: sm.plantelId,
      volumen: 500,
      granularidad: "Mensual",
    });
    await guardarHistoricaAction({
      fechaIso: "2026-04-01",
      plantelId: sm.plantelId,
      volumen: 250,
      granularidad: "Mensual",
    });

    const mes = await pedirGrafico({ granularidad: "mes", refMs: ago(15).getTime() });
    const sumaMeses = mes.series[0].valores.reduce<number>((a, v) => a + (v ?? 0), 0);
    expect(sumaMeses).toBe(780); // 500 + 250 + 30

    const anio = await pedirGrafico({ granularidad: "anio" });
    expect(valorEn(anio, "2026")).toBe(780);
  });
});

describe("(f) acceso restringido al Administrador", () => {
  it("un rol que no es Administrador no puede cargar, ni previsualizar, ni borrar", async () => {
    const { sm } = await escenario();
    rol = "Programador";
    const guardar = await guardarHistoricaAction({
      fechaIso: "2025-07-01",
      plantelId: sm.plantelId,
      volumen: 900,
      granularidad: "Mensual",
    });
    expect(guardar.ok).toBe(false);
    expect(await previsualizarHistoricaAction("fecha;plantel;volumen_m3\n", "Mensual", {
      fecha: "fecha",
      plantel: "plantel",
      volumen: "volumen_m3",
    })).toMatchObject({ ok: false });
    expect(await verificarChoqueAction({
      fechaIso: "2025-07-01",
      plantelId: sm.plantelId,
      granularidad: "Mensual",
    })).toMatchObject({ ok: false });
    expect(await eliminarHistoricaAction(1)).toMatchObject({ ok: false });
    expect(await vincularAliasAction("SPS", sm.plantelId)).toMatchObject({ ok: false });
    expect(await prisma.produccion_historica.count()).toBe(0);
  });
});

describe("importación desde archivo", () => {
  const csv = (filas: string) => `fecha;plantel;volumen_m3\n${filas}`;
  const mapeo = { fecha: "fecha", plantel: "plantel", volumen: "volumen_m3" };

  it("previsualiza sin escribir nada", async () => {
    await escenario();
    await vincularAliasAction("SM Hist", (await prisma.planteles.findFirstOrThrow()).id);
    const r = await previsualizarHistoricaAction(
      csv("01/07/2025;SM Hist;120,5\n02/07/2025;SM Hist;80\n"),
      "Diaria",
      mapeo,
    );
    expect(r.ok).toBe(true);
    expect(r.resumen?.crear).toBe(2);
    expect(await prisma.produccion_historica.count()).toBe(0); // no escribió
  });

  it("resuelve el plantel por ALIAS y lo recuerda", async () => {
    const { sm } = await escenario();
    // Sin alias, la fila no se puede importar.
    const antes = await previsualizarHistoricaAction(csv("01/07/2025;SPS;120\n"), "Diaria", mapeo);
    expect(antes.resumen?.plantelesSinVincular).toEqual(["SPS"]);

    await vincularAliasAction("SPS", sm.plantelId);
    const despues = await previsualizarHistoricaAction(csv("01/07/2025;SPS;120\n"), "Diaria", mapeo);
    expect(despues.resumen?.plantelesSinVincular).toEqual([]);
    expect(despues.resumen?.crear).toBe(1);
  });

  it("el alias no distingue acentos ni mayúsculas", async () => {
    const { sm } = await escenario();
    await vincularAliasAction("Puerto Cortés", sm.plantelId);
    const r = await previsualizarHistoricaAction(csv("01/07/2025;PUERTO CORTES;90\n"), "Diaria", mapeo);
    expect(r.resumen?.crear).toBe(1);
  });

  it("importa y deja la bitácora", async () => {
    const { sm } = await escenario();
    await vincularAliasAction("SM Hist", sm.plantelId);
    const r = await importarHistoricaAction(
      csv("01/07/2025;SM Hist;120,5\n02/07/2025;SM Hist;80\n"),
      "Diaria",
      mapeo,
      "Excel de producción 2025",
    );
    expect(r.ok).toBe(true);
    expect(r.creadas).toBe(2);
    const filas = await prisma.produccion_historica.findMany({ orderBy: { fecha: "asc" } });
    expect(filas.map((f) => f.volumen_m3)).toEqual([120.5, 80]);
    expect(filas[0].observaciones).toBe("Excel de producción 2025");
    expect(await prisma.bitacora_auditoria.count({ where: { tabla_afectada: "produccion_historica" } })).toBe(2);
  });

  it("una fila con fecha o volumen inválido se reporta y no se importa", async () => {
    const { sm } = await escenario();
    await vincularAliasAction("SM Hist", sm.plantelId);
    const r = await previsualizarHistoricaAction(
      csv("31/02/2025;SM Hist;120\n01/07/2025;SM Hist;abc\n01/07/2025;SM Hist;90\n"),
      "Diaria",
      mapeo,
    );
    expect(r.resumen?.error).toBe(2);
    expect(r.resumen?.crear).toBe(1);
    expect(r.filas?.find((f) => f.linea === 2)?.motivo).toContain("fecha");
    expect(r.filas?.find((f) => f.linea === 3)?.motivo).toContain("volumen");
  });

  it("volver a importar el mismo archivo ACTUALIZA, no duplica", async () => {
    const { sm } = await escenario();
    await vincularAliasAction("SM Hist", sm.plantelId);
    await importarHistoricaAction(csv("01/07/2025;SM Hist;120\n"), "Diaria", mapeo, "");
    const r = await importarHistoricaAction(csv("01/07/2025;SM Hist;150\n"), "Diaria", mapeo, "");
    expect(r.actualizadas).toBe(1);
    expect(await prisma.produccion_historica.count()).toBe(1);
    expect((await prisma.produccion_historica.findFirstOrThrow()).volumen_m3).toBe(150);
  });
});

describe("(7) lo que NO debe cambiar", () => {
  it("ningún proceso del sistema escribe en produccion_historica", async () => {
    // Se opera un día completo —crear pedido, despachar, completar— y la tabla sigue vacía.
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await produccionDelMes({ anio: 2026, mes: 8, plantelesHistorico: null });
    await pedirGrafico({ granularidad: "mes", refMs: ago(15).getTime() });
    expect(await prisma.produccion_historica.count()).toBe(0);
  });

  it("la producción del sistema (viajes completados) se calcula igual que siempre", async () => {
    const { sm, cho } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await producir({ ...cho, fecha: ago(4), m3: 12 });
    // Con una carga histórica de OTRO mes, que no debe afectar a agosto.
    await guardarHistoricaAction({
      fechaIso: "2025-07-01",
      plantelId: sm.plantelId,
      volumen: 900,
      granularidad: "Mensual",
    });
    const cal = await produccionDelMes({ anio: 2026, mes: 8, plantelesHistorico: null });
    expect(totalMes(cal.porDia)).toBe(42);

    // Y la consulta cruda del sistema no ve nada de la histórica.
    const soloSistema = await produccionPorPeriodo({
      granularidad: "mes",
      desde: new Date(2025, 0, 1),
      hasta: new Date(2027, 0, 1),
      plantelIds: null,
    });
    expect(soloSistema.get("2025-07")).toBeUndefined();
    expect([...(soloSistema.get("2026-08")?.values() ?? [])].reduce((a, b) => a + b, 0)).toBe(42);
  });
});

describe("el archivo real del usuario (julio 2026, Santa Marta)", () => {
  // Reproduce el caso reportado: la produccion del 2/7/2026 se registraba como 1/7/2026.
  // Causa: la importacion re-parseaba la fecha con `new Date("2026-07-02")`, que el
  // estandar manda interpretar como UTC — en UTC-6 eso es el 1 de julio a las 18:00.
  const CABECERA = "fecha;plantel;volumen_m3";
  const mapeo = { fecha: "fecha", plantel: "plantel", volumen: "volumen_m3" };

  it("cada fila queda en SU dia, sin correrse uno", async () => {
    const { sm } = await escenario();
    await vincularAliasAction("Santa Marta", sm.plantelId);
    const csv = [
      CABECERA,
      "1/7/2026;Santa Marta;184",
      "2/7/2026;Santa Marta;207.1",
      "3/7/2026;Santa Marta;131.1",
      "31/7/2026;Santa Marta;239",
      "",
    ].join("\n");

    const r = await importarHistoricaAction(csv, "Diaria", mapeo, "Excel de produccion");
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.creadas).toBe(4);

    const filas = await prisma.produccion_historica.findMany({ orderBy: { fecha: "asc" } });
    const dias = filas.map((f) => `${f.fecha.getDate()}/${f.fecha.getMonth() + 1}`);
    expect(dias).toEqual(["1/7", "2/7", "3/7", "31/7"]);
    // El caso exacto del reporte: 207.1 es del DIA 2, no del 1.
    const dos = filas.find((f) => f.fecha.getDate() === 2)!;
    expect(dos.volumen_m3).toBe(207.1);
    expect(dos.fecha.getMonth()).toBe(6); // julio
  });

  it("una celda de volumen VACIA no se carga como 0", async () => {
    // El Excel deja en blanco los domingos; guardar un 0 llenaba la lista de "0.00" que
    // nadie escribio, y ademas marcaba ese dia como cubierto por la carga historica.
    const { sm } = await escenario();
    await vincularAliasAction("Santa Marta", sm.plantelId);
    const csv = [CABECERA, "4/7/2026;Santa Marta;108.36", "5/7/2026;Santa Marta;", ""].join(
      "\n",
    );

    const previa = await previsualizarHistoricaAction(csv, "Diaria", mapeo);
    expect(previa.resumen?.crear).toBe(1);
    expect(previa.resumen?.vacias).toBe(1);
    expect(previa.resumen?.error).toBe(0); // no es un error de formato

    await importarHistoricaAction(csv, "Diaria", mapeo, "");
    const filas = await prisma.produccion_historica.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0].fecha.getDate()).toBe(4);
  });

  it("el archivo completo del usuario da los 26 dias con volumen", async () => {
    const { sm } = await escenario();
    await vincularAliasAction("Santa Marta", sm.plantelId);
    // Los 31 dias de julio, con 5 domingos en blanco (5, 12, 19, 26 y uno mas).
    const volumenes: (number | null)[] = [
      184, 207.1, 131.1, 108.36, null, 52.9, 322.3, 160, 190, 251.5, 32, null, 111.5, 9.9,
      74.5, 285, 98, 14, null, 167.5, 97.5, 59.9, 188.4, 208.4, 210, null, 285.4, 212.9,
      143.9, 339.1, 239,
    ];
    const csv = [
      CABECERA,
      ...volumenes.map((v, i) => `${i + 1}/7/2026;Santa Marta;${v ?? ""}`),
      "",
    ].join("\n");

    const r = await importarHistoricaAction(csv, "Diaria", mapeo, "Excel 2026");
    const conVolumen = volumenes.filter((v) => v != null).length;
    expect(r.creadas).toBe(conVolumen);
    expect(r.omitidas).toBe(volumenes.length - conVolumen);

    const filas = await prisma.produccion_historica.findMany({ orderBy: { fecha: "asc" } });
    // Todas en julio, ninguna se corrio a junio.
    expect(filas.every((f) => f.fecha.getMonth() === 6)).toBe(true);
    expect(filas[0].fecha.getDate()).toBe(1);
    expect(filas[filas.length - 1].fecha.getDate()).toBe(31);
    // Y el volumen total es el del archivo.
    const total = Math.round(filas.reduce((a, f) => a + f.volumen_m3, 0) * 100) / 100;
    const esperado =
      Math.round(volumenes.reduce<number>((a, v) => a + (v ?? 0), 0) * 100) / 100;
    expect(total).toBe(esperado);
  });
});

describe("borrado EN LOTE (deshacer una importacion equivocada)", () => {
  async function cargarJulio(sm: { plantelId: number }) {
    for (let d = 1; d <= 5; d++) {
      await guardarHistoricaAction({
        fechaIso: `2026-07-0${d}`,
        plantelId: sm.plantelId,
        volumen: 100 + d,
        granularidad: "Diaria",
      });
    }
  }

  it("borra todas las cargas de un ano de una sola vez", async () => {
    const { sm } = await escenario();
    await cargarJulio(sm);
    await guardarHistoricaAction({
      fechaIso: "2025-03-01",
      plantelId: sm.plantelId,
      volumen: 500,
      granularidad: "Mensual",
    });
    expect(await prisma.produccion_historica.count()).toBe(6);

    const r = await eliminarLoteHistoricaAction({ anio: 2026 });
    expect(r.ok).toBe(true);
    expect(r.borradas).toBe(5);
    expect(r.volumen).toBe(515); // 101+102+103+104+105
    // El ano que NO se pidio queda intacto.
    const quedan = await prisma.produccion_historica.findMany();
    expect(quedan).toHaveLength(1);
    expect(quedan[0].fecha.getFullYear()).toBe(2025);
  });

  it("sin ano borra TODO (el boton lo advierte antes)", async () => {
    const { sm } = await escenario();
    await cargarJulio(sm);
    const r = await eliminarLoteHistoricaAction({ anio: null });
    expect(r.borradas).toBe(5);
    expect(await prisma.produccion_historica.count()).toBe(0);
  });

  it("deja UNA entrada de bitacora con el alcance y el total, no una por fila", async () => {
    const { sm } = await escenario();
    await cargarJulio(sm);
    await prisma.bitacora_auditoria.deleteMany();

    await eliminarLoteHistoricaAction({ anio: 2026 });
    const entradas = await prisma.bitacora_auditoria.findMany({
      where: { tabla_afectada: "produccion_historica" },
    });
    expect(entradas).toHaveLength(1);
    expect(entradas[0].motivo).toContain("EN LOTE");
    expect(entradas[0].motivo).toContain("2026");
    expect(entradas[0].motivo).toContain("5 filas");
  });

  it("NO toca los viajes ni nada del sistema", async () => {
    const { sm } = await escenario();
    await producir({ ...sm, fecha: ago(3), m3: 30 });
    await cargarJulio(sm);

    await eliminarLoteHistoricaAction({ anio: null });

    // El volumen del sistema sigue exactamente igual.
    expect(await prisma.viajes.count({ where: { estado: "Completado" } })).toBe(1);
    const cal = await produccionDelMes({ anio: 2026, mes: 8, plantelesHistorico: null });
    expect(totalMes(cal.porDia)).toBe(30);
  });

  it("un rol que no es Administrador no puede borrar en lote", async () => {
    const { sm } = await escenario();
    await cargarJulio(sm);
    rol = "Programador";
    const r = await eliminarLoteHistoricaAction({ anio: 2026 });
    expect(r.ok).toBe(false);
    expect(await prisma.produccion_historica.count()).toBe(5); // nada se borro
  });

  it("sin filas que borrar no falla ni escribe bitacora", async () => {
    await escenario();
    await prisma.bitacora_auditoria.deleteMany();
    const r = await eliminarLoteHistoricaAction({ anio: 1999 });
    expect(r).toMatchObject({ ok: true, borradas: 0 });
    expect(await prisma.bitacora_auditoria.count()).toBe(0);
  });
});

describe("carga por PLANTEL o por PLANTA", () => {
  /** Un plantel con DOS plantas dosificadoras, como Santa Marta (STALO y SANY). */
  async function conDosPlantas() {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "SM Dos",
      zona: "Norte",
      esHub: true,
    });
    await prisma.plantas.update({ where: { id: plantaId }, data: { nombre: "STALO" } });
    const sany = await prisma.plantas.create({
      data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 50 },
    });
    return { plantelId, stalo: plantaId, sany: sany.id };
  }

  const guardar = (plantelId: number, plantaId: number | null, dia: number, volumen: number) =>
    guardarHistoricaAction({
      fechaIso: `2025-08-${String(dia).padStart(2, "0")}`,
      plantelId,
      plantaId,
      volumen,
      granularidad: "Diaria",
    });

  const calendario = (plantelId: number) =>
    produccionDelMes({ anio: 2025, mes: 8, plantelesHistorico: [plantelId] });

  it("guarda el volumen de UNA planta y lo atribuye a su plantel", async () => {
    const { plantelId, stalo } = await conDosPlantas();
    expect((await guardar(plantelId, stalo, 5, 120)).ok).toBe(true);

    const fila = await prisma.produccion_historica.findFirstOrThrow({});
    expect(fila.planta_id).toBe(stalo);
    expect(fila.plantel_id).toBe(plantelId);

    const cal = await calendario(plantelId);
    expect(cal.porDia.get("2025-08-05")?.m3).toBe(120);
  });

  it("las DOS plantas de un plantel se SUMAN en el total del día", async () => {
    const { plantelId, stalo, sany } = await conDosPlantas();
    expect((await guardar(plantelId, stalo, 5, 70)).ok).toBe(true);
    expect((await guardar(plantelId, sany, 5, 50.5)).ok).toBe(true);

    const cal = await calendario(plantelId);
    // El total del día es la suma de las dos plantas, no una sola ni el doble.
    expect(cal.porDia.get("2025-08-05")?.m3).toBe(120.5);
    const delPlantel = cal.porDiaPlantel.get("2025-08-05") ?? [];
    expect(delPlantel).toHaveLength(1);
    expect(delPlantel[0].m3).toBe(120.5);
  });

  it("el desglose del día muestra CADA planta con su volumen", async () => {
    const { plantelId, stalo, sany } = await conDosPlantas();
    await guardar(plantelId, stalo, 5, 70);
    await guardar(plantelId, sany, 5, 50);

    const plantas =
      (await calendario(plantelId)).porDiaPlantel.get("2025-08-05")?.[0].plantas ?? [];
    expect(plantas.map((p) => [p.nombre, p.m3])).toEqual([
      ["STALO", 70],
      ["SANY", 50],
    ]);
    // Un dato histórico es volumen, no viajes: el conteo se queda en 0 y no inventa nada.
    expect(plantas.every((p) => p.viajes === 0)).toBe(true);
  });

  it("una carga del PLANTEL completo no se reparte entre plantas (no se inventa el detalle)", async () => {
    const { plantelId } = await conDosPlantas();
    await guardar(plantelId, null, 5, 200);

    const delPlantel = (await calendario(plantelId)).porDiaPlantel.get("2025-08-05")?.[0];
    expect(delPlantel?.m3).toBe(200);
    expect(delPlantel?.plantas).toEqual([]);
  });

  it("RECHAZA el total del plantel si ese día ya tiene detalle por planta", async () => {
    const { plantelId, stalo } = await conDosPlantas();
    await guardar(plantelId, stalo, 5, 70);

    const r = await guardar(plantelId, null, 5, 200);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/dos veces/);
    // Y no se guardó nada de más: sigue habiendo una sola fila.
    expect(await prisma.produccion_historica.count()).toBe(1);
  });

  it("RECHAZA una planta si ese día ya tiene el total del plantel", async () => {
    const { plantelId, stalo } = await conDosPlantas();
    await guardar(plantelId, null, 5, 200);

    const r = await guardar(plantelId, stalo, 5, 70);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/dos veces/);
    expect(await prisma.produccion_historica.count()).toBe(1);
  });

  it("el rechazo es POR DÍA: otro día sí admite el otro alcance", async () => {
    const { plantelId, stalo } = await conDosPlantas();
    await guardar(plantelId, stalo, 5, 70);
    // El 6 no tiene detalle por planta, así que el total del plantel entra sin problema.
    expect((await guardar(plantelId, null, 6, 200)).ok).toBe(true);
    expect(await prisma.produccion_historica.count()).toBe(2);
  });

  it("RECHAZA una planta que no es de ese plantel", async () => {
    const { plantelId } = await conDosPlantas();
    const otro = await crearPlantel({ nombre: "CHO Dos", zona: "Norte" });

    const r = await guardar(plantelId, otro.plantaId, 5, 70);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/no pertenece/);
    expect(await prisma.produccion_historica.count()).toBe(0);
  });

  it("volver a guardar la MISMA planta actualiza, no duplica", async () => {
    const { plantelId, stalo, sany } = await conDosPlantas();
    await guardar(plantelId, stalo, 5, 70);
    await guardar(plantelId, sany, 5, 50);
    expect((await guardar(plantelId, stalo, 5, 88)).ok).toBe(true);

    const filas = await prisma.produccion_historica.findMany({ orderBy: { planta_id: "asc" } });
    expect(filas).toHaveLength(2);
    expect(filas.find((f) => f.planta_id === stalo)?.volumen_m3).toBe(88);
    expect(filas.find((f) => f.planta_id === sany)?.volumen_m3).toBe(50);
  });

  it("el sistema sigue teniendo precedencia, y se decide por PLANTEL", async () => {
    const { plantelId, stalo, sany } = await conDosPlantas();
    // El sistema tiene un viaje de la planta STALO ese día.
    await producir({ plantelId, plantaId: stalo, fecha: new Date(2025, 7, 5, 8, 0), m3: 11 });
    // Se carga histórico de la OTRA planta el mismo día: no se grafica igual, porque no
    // hay forma de saber si el archivo viejo cubría también lo que el sistema ya registró.
    expect((await guardar(plantelId, sany, 5, 500)).ok).toBe(true);

    const cal = await calendario(plantelId);
    expect(cal.porDia.get("2025-08-05")?.m3).toBe(11);
    expect(cal.diasHistoricos?.has("2025-08-05")).toBe(false);
  });

  it("en el gráfico de tendencia las plantas suman en la línea de su plantel", async () => {
    const { plantelId, stalo, sany } = await conDosPlantas();
    await guardar(plantelId, stalo, 5, 70);
    await guardar(plantelId, sany, 12, 30);

    const datos = await pedirGrafico({
      granularidad: "mes",
      refMs: new Date(2025, 7, 15).getTime(),
    });
    expect(valorEn(datos, "2025-08")).toBe(100);
  });
});

describe("importar un archivo CON detalle por planta", () => {
  async function conDosPlantas() {
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "SM Imp",
      zona: "Norte",
      esHub: true,
    });
    await prisma.plantas.update({ where: { id: plantaId }, data: { nombre: "STALO" } });
    const sany = await prisma.plantas.create({
      data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 50 },
    });
    await prisma.alias_plantel_historico.create({
      data: { alias: "sm imp", plantel_id: plantelId, creado_por: "prueba" },
    });
    return { plantelId, stalo: plantaId, sany: sany.id };
  }

  const MAPEO = { fecha: "fecha", plantel: "plantel", volumen: "volumen_m3", planta: "planta" };
  const CSV = [
    "fecha;plantel;planta;volumen_m3",
    "05/08/2025;SM Imp;STALO;70",
    "05/08/2025;SM Imp;SANY;50.5",
  ].join("\n");

  it("resuelve cada planta DENTRO de su plantel y las guarda por separado", async () => {
    const { plantelId, stalo, sany } = await conDosPlantas();
    const r = await importarHistoricaAction(CSV, "Diaria", MAPEO, "archivo 2025");
    expect(r.ok).toBe(true);
    expect(r.creadas).toBe(2);

    const filas = await prisma.produccion_historica.findMany({ orderBy: { volumen_m3: "desc" } });
    expect(filas.map((f) => [f.plantel_id, f.planta_id, f.volumen_m3])).toEqual([
      [plantelId, stalo, 70],
      [plantelId, sany, 50.5],
    ]);
  });

  it("el nombre de la planta no distingue acentos ni mayúsculas", async () => {
    const { stalo } = await conDosPlantas();
    const csv = ["fecha;plantel;planta;volumen_m3", "05/08/2025;SM Imp;stalo;70"].join("\n");
    expect((await importarHistoricaAction(csv, "Diaria", MAPEO, "")).creadas).toBe(1);
    expect((await prisma.produccion_historica.findFirstOrThrow({})).planta_id).toBe(stalo);
  });

  it("una planta que ese plantel no tiene se REPORTA y no se importa", async () => {
    await conDosPlantas();
    const csv = [
      "fecha;plantel;planta;volumen_m3",
      "05/08/2025;SM Imp;STALO;70",
      "05/08/2025;SM Imp;PLANTA X;50",
    ].join("\n");

    const previa = await previsualizarHistoricaAction(csv, "Diaria", MAPEO);
    expect(previa.resumen?.error).toBe(1);
    expect(previa.resumen?.plantasSinReconocer).toEqual(["PLANTA X (SM Imp)"]);

    const r = await importarHistoricaAction(csv, "Diaria", MAPEO, "");
    expect(r.creadas).toBe(1);
    expect(r.omitidas).toBe(1);
    expect(await prisma.produccion_historica.count()).toBe(1);
  });

  it("SIN columna de planta, cada fila es el total del plantel (como siempre)", async () => {
    const { plantelId } = await conDosPlantas();
    const csv = ["fecha;plantel;volumen_m3", "05/08/2025;SM Imp;200"].join("\n");

    const r = await importarHistoricaAction(
      csv,
      "Diaria",
      { fecha: "fecha", plantel: "plantel", volumen: "volumen_m3" },
      "",
    );
    expect(r.creadas).toBe(1);
    const fila = await prisma.produccion_historica.findFirstOrThrow({});
    expect(fila.planta_id).toBeNull();
    expect(fila.plantel_id).toBe(plantelId);
  });

  it("reimportar el mismo archivo ACTUALIZA cada planta, no duplica", async () => {
    await conDosPlantas();
    await importarHistoricaAction(CSV, "Diaria", MAPEO, "");
    const r = await importarHistoricaAction(CSV, "Diaria", MAPEO, "");
    expect(r.creadas).toBe(0);
    expect(r.actualizadas).toBe(2);
    expect(await prisma.produccion_historica.count()).toBe(2);
  });

  it("un archivo por planta sobre un día que ya tiene el total del plantel se OMITE", async () => {
    const { plantelId } = await conDosPlantas();
    await guardarHistoricaAction({
      fechaIso: "2025-08-05",
      plantelId,
      volumen: 200,
      granularidad: "Diaria",
    });

    const r = await importarHistoricaAction(CSV, "Diaria", MAPEO, "");
    // Las dos filas por planta se rechazan: sumarlas al total del plantel duplicaría.
    expect(r.omitidas).toBe(2);
    expect(r.creadas).toBe(0);
    const filas = await prisma.produccion_historica.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0].volumen_m3).toBe(200);
  });

  it("el borrado en lote también se lleva las cargas por planta", async () => {
    await conDosPlantas();
    await importarHistoricaAction(CSV, "Diaria", MAPEO, "");
    const r = await eliminarLoteHistoricaAction({ anio: 2025 });
    expect(r.borradas).toBe(2);
    expect(r.volumen).toBe(120.5);
    expect(await prisma.produccion_historica.count()).toBe(0);
  });
});
