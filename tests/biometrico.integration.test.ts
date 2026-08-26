// Importación del reloj biométrico por el LÍMITE REAL de las server actions (Postgres).
//
// Lo que se comprueba aquí no se puede garantizar desde la interfaz: que un rol que no
// es Administrador sea rechazado, que las horas se recalculen con las bandas de recargo
// (y NO con el "Tiempo HE" del reloj), que una ausencia entre pendiente de clasificar y
// sin horas, que un turno que cruza la medianoche dé horas positivas con sus recargos
// nocturnos, y que una fila corregida a mano no se reemplace en silencio.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { limpiarBD } from "./helpers";
import { archivoDePruebas, type FilaReloj } from "./biometrico-fixture";

let esAdmin = true;

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Admin Prueba", email: "admin@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  exigirAdmin: async () =>
    esAdmin ? { ok: true, userId: "u1" } : { ok: false, mensaje: "Solo un Administrador." },
  requerirAcceso: async () => ({}),
  alcanceActual: async () => ({}),
  requerirPasswordAlDia: async () => {},
}));
// La caché de catálogos es un paso directo en pruebas: cada consulta va a la base, así
// las aserciones ven el dato fresco (en producción `unstable_cache` la sirve de memoria).
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const {
  previsualizarArchivoAction,
  importarArchivoAction,
  vincularCodigoAction,
  ignorarCodigoAction,
  mapearDepartamentoAction,
} = await import("@/app/planilla/importacion-actions");
const { guardarAsistenciaAction } = await import("@/app/planilla/actions");

/** FormData con el archivo, tal como lo manda el navegador. */
function formDataCon(filas: FilaReloj[]): FormData {
  const bytes = archivoDePruebas(filas);
  const fd = new FormData();
  // `new Uint8Array(bytes).buffer` es un ArrayBuffer concreto (lo que espera File).
  const copia = new Uint8Array(bytes);
  fd.set(
    "archivo",
    new File([copia.buffer as ArrayBuffer], "17-21.xls", { type: "application/vnd.ms-excel" }),
  );
  return fd;
}

/** Persona del catálogo con L 24,000 al mes (L 100 la hora). */
async function crearPersona(nombre: string, codigo?: string) {
  const p = await prisma.operadores.create({
    data: {
      nombre,
      puesto: "Motorista_Mixer",
      salario_mensual: 24_000,
      codigo_biometrico: codigo ?? null,
    },
  });
  return p.id;
}

const dia = (d: number) => new Date(2026, 7, d);

async function filaDe(personaId: number, d: number) {
  return prisma.asistencia_operativos.findUnique({
    where: { persona_id_fecha: { persona_id: personaId, fecha: dia(d) } },
  });
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.bitacora_auditoria.deleteMany(); // limpiarBD no la toca: se acumularia
  await prisma.codigos_biometricos_ignorados.deleteMany();
  await prisma.mapeo_departamento_biometrico.deleteMany();
  await prisma.operadores.deleteMany();
  esAdmin = true;
});

describe("permisos", () => {
  it("un rol que no es Administrador no puede previsualizar ni importar", async () => {
    await crearPersona("Basilio Sanchez", "2000002");
    esAdmin = false;

    const previa = await previsualizarArchivoAction(
      formDataCon([{ codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" }]),
    );
    expect(previa.ok).toBe(false);

    const imp = await importarArchivoAction(
      formDataCon([{ codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" }]),
      false,
    );
    expect(imp.ok).toBe(false);
    expect(await prisma.asistencia_operativos.count()).toBe(0);

    expect((await vincularCodigoAction("2000002", 1)).ok).toBe(false);
    expect((await ignorarCodigoAction("9999", "X", true)).ok).toBe(false);
    expect((await mapearDepartamentoAction("JUTOSA", null)).ok).toBe(false);
  });
});

describe("previsualización", () => {
  it("resume el archivo y no escribe nada", async () => {
    await crearPersona("Basilio Sanchez", "2000002");
    const fd = formDataCon([
      { codigo: "2000002", nombre: "Basilio Sanchez", fecha: "17/8/2026", entrada: "06:42", salida: "15:10" },
      { codigo: "2000002", nombre: "Basilio Sanchez", fecha: "18/8/2026", ausente: true },
      { codigo: "3000003", nombre: "DESCONOCIDO", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
    ]);

    const r = await previsualizarArchivoAction(fd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previa.filasDatos).toBe(3);
    expect(r.previa.personasDistintas).toBe(2);
    expect(r.previa.registrosConMarcas).toBe(2);
    expect(r.previa.ausencias).toBe(1);
    expect(r.previa.desdeISO).toBe("2026-08-17");
    expect(r.previa.hastaISO).toBe("2026-08-18");
    // El código desconocido se reporta y sus filas no son importables todavía.
    expect(r.previa.sinVincular).toBe(1);
    expect(r.previa.importables).toBe(2);
    expect(await prisma.asistencia_operativos.count()).toBe(0);
  });

  it("señala los departamentos sin correspondencia sin descartar la fila", async () => {
    await crearPersona("Basilio", "2000002");
    const plantel = await prisma.planteles.create({
      data: { nombre: "SM Bio", zona: "Norte", capacidad_dosificacion_m3h: 45 },
    });

    const filas: FilaReloj[] = [
      { codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "07:00", salida: "15:00", departamento: "Produccion SPS" },
      { codigo: "2000002", nombre: "Basilio", fecha: "18/8/2026", entrada: "07:00", salida: "15:00", departamento: "JUTOSA" },
    ];
    const antes = await previsualizarArchivoAction(formDataCon(filas));
    if (!antes.ok) throw new Error("previa fallida");
    expect(antes.previa.departamentosSinMapeo).toBe(2);

    expect((await mapearDepartamentoAction("Produccion SPS", plantel.id)).ok).toBe(true);
    const despues = await previsualizarArchivoAction(formDataCon(filas));
    if (!despues.ok) throw new Error("previa fallida");
    expect(despues.previa.departamentosSinMapeo).toBe(1);
    expect(
      despues.previa.departamentos.find((d) => d.departamento === "Produccion SPS")!.plantelNombre,
    ).toBe("SM Bio");

    // El departamento sin correspondencia NO impide importar.
    const imp = await importarArchivoAction(formDataCon(filas), false);
    expect(imp.ok).toBe(true);
    if (imp.ok) expect(imp.reporte.creados).toBe(2);
  });
});

describe("importación", () => {
  it("recalcula las horas con las bandas de recargo, no con el Tiempo HE del reloj", async () => {
    const personaId = await crearPersona("Basilio Sanchez", "2000002");
    // El caso real: martes 18/8, entrada 06:43 y salida 20:50. El reloj dice 04:50:21 de
    // "Tiempo HE"; lo correcto son 17 min al 25 % (06:43-07:00) + 8 h normales +
    // 4 h al 25 % (15:00-19:00) + 1 h 50 min al 50 % (19:00-20:50).
    const r = await importarArchivoAction(
      formDataCon([
        {
          codigo: "2000002",
          nombre: "Basilio Sanchez",
          fecha: "18/8/2026",
          entrada: "06:43",
          salida: "20:50",
          tiempoHE: "04:50:21",
        },
      ]),
      false,
    );
    expect(r.ok).toBe(true);

    const fila = await filaDe(personaId, 18);
    expect(fila!.horas_normales).toBe(8);
    expect(fila!.horas_extra_25).toBe(4.28); // 17 min + 4 h = 4.283 h
    expect(fila!.horas_extra_50).toBe(1.83); // 19:00 a 20:50
    expect(fila!.horas_extra_75).toBe(0);
    expect(fila!.horas_extra_100).toBe(0);
    // El dato del reloj queda solo como referencia.
    expect((fila!.datos_reloj as Record<string, string>)["Tiempo HE"]).toBe("04:50:21");
    expect(fila!.origen).toBe("Biometrico");
  });

  it("un turno que cruza la medianoche da horas POSITIVAS con recargo nocturno", async () => {
    const personaId = await crearPersona("Darlin Martinez", "2000010");
    // Jueves 20/8: entrada 06:28, salida 01:00 del 21. 06:28-07:00 = 32 min al 25 %;
    // 07:00-15:00 = 8 h normales; 15:00-19:00 = 4 h al 25 %; 19:00-22:00 = 3 h al 50 %;
    // 22:00-24:00 = 2 h al 75 %; 00:00-01:00 del viernes = 1 h al 75 %.
    const r = await importarArchivoAction(
      formDataCon([
        { codigo: "2000010", nombre: "Darlin Martinez", fecha: "20/8/2026", entrada: "06:28", salida: "01:00" },
      ]),
      false,
    );
    expect(r.ok).toBe(true);

    const fila = await filaDe(personaId, 20);
    expect(fila!.hora_salida!.getDate()).toBe(21); // la salida quedó al día siguiente
    expect(fila!.horas_normales).toBe(8);
    expect(fila!.horas_extra_25).toBe(4.53); // 32 min + 4 h
    expect(fila!.horas_extra_50).toBe(3);
    expect(fila!.horas_extra_75).toBe(3); // 22-24 del jueves + 00-01 del viernes
    const total =
      fila!.horas_normales + fila!.horas_extra_25 + fila!.horas_extra_50 + fila!.horas_extra_75;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeCloseTo(18.53, 2); // 06:28 a 01:00 son 18 h 32 min
  });

  it("una ausencia entra pendiente de clasificar, sin horas y sin costo decidido", async () => {
    const personaId = await crearPersona("Basilio", "2000002");
    await importarArchivoAction(
      formDataCon([{ codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", ausente: true }]),
      false,
    );

    const fila = await filaDe(personaId, 17);
    expect(fila!.tipo_ausencia).toBe("Pendiente");
    expect(fila!.hora_entrada).toBeNull();
    expect(fila!.hora_salida).toBeNull();
    expect(fila!.horas_normales).toBe(0);
    // NULL, no 0: un costo en cero parecería una decisión ya tomada.
    expect(fila!.costo_ausencia).toBeNull();
  });

  it("una fila con una sola marca se guarda con la marca que existe", async () => {
    const personaId = await crearPersona("Basilio", "2000002");
    await importarArchivoAction(
      formDataCon([{ codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "06:42" }]),
      false,
    );
    const fila = await filaDe(personaId, 17);
    expect(fila!.hora_entrada!.getHours()).toBe(6);
    expect(fila!.hora_salida).toBeNull();
    expect(fila!.horas_normales).toBe(0); // sin salida no hay turno que calcular
  });

  it("las filas de códigos sin vincular no se importan y se reportan", async () => {
    await crearPersona("Basilio", "2000002");
    const r = await importarArchivoAction(
      formDataCon([
        { codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
        { codigo: "9999999", nombre: "DESCONOCIDO", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
      ]),
      false,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reporte.creados).toBe(1);
    expect(r.reporte.omitidosSinVinculo).toBe(1);
    expect(await prisma.asistencia_operativos.count()).toBe(1);
  });

  it("volver a importar el mismo archivo no duplica ni vuelve a escribir", async () => {
    const personaId = await crearPersona("Basilio", "2000002");
    const filas: FilaReloj[] = [
      { codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "06:42", salida: "15:10" },
    ];
    const primera = await importarArchivoAction(formDataCon(filas), false);
    const segunda = await importarArchivoAction(formDataCon(filas), false);
    expect(primera.ok && primera.reporte.creados).toBe(1);
    expect(segunda.ok && segunda.reporte.sinCambio).toBe(1);
    expect(segunda.ok && segunda.reporte.creados).toBe(0);
    expect(await prisma.asistencia_operativos.count()).toBe(1);
    expect((await filaDe(personaId, 17))!.hora_entrada!.getMinutes()).toBe(42);
  });
});

describe("protección contra sobreescritura", () => {
  it("NO reemplaza en silencio una fila corregida a mano; la reporta como conflicto", async () => {
    const personaId = await crearPersona("Basilio", "2000002");
    // Alguien la capturó/corrigió a mano.
    await guardarAsistenciaAction(personaId, "2026-08-17", { entrada: "07:00", salida: "15:00" });
    const manual = await filaDe(personaId, 17);
    expect(manual!.origen).toBe("Manual");

    const filas: FilaReloj[] = [
      { codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "06:42", salida: "20:50" },
    ];

    // La previsualización lo advierte, con el antes y el después.
    const previa = await previsualizarArchivoAction(formDataCon(filas));
    if (!previa.ok) throw new Error("previa fallida");
    expect(previa.previa.conflictos).toHaveLength(1);
    expect(previa.previa.conflictos[0]).toMatchObject({
      fechaISO: "2026-08-17",
      actual: "07:00 a 15:00",
      nuevo: "06:42 a 20:50",
    });

    // Sin confirmar, la importación la deja intacta.
    const sinConfirmar = await importarArchivoAction(formDataCon(filas), false);
    expect(sinConfirmar.ok && sinConfirmar.reporte.conflictosOmitidos).toBe(1);
    const intacta = await filaDe(personaId, 17);
    expect(intacta!.hora_entrada!.getHours()).toBe(7);
    expect(intacta!.origen).toBe("Manual");

    // Confirmando, sí la reemplaza, y la bitácora dice que sobrescribió.
    const confirmada = await importarArchivoAction(formDataCon(filas), true);
    expect(confirmada.ok && confirmada.reporte.actualizados).toBe(1);
    const nueva = await filaDe(personaId, 17);
    expect(nueva!.hora_entrada!.getMinutes()).toBe(42);
    expect(nueva!.origen).toBe("Biometrico");

    const bit = await prisma.bitacora_auditoria.findFirst({
      where: { tabla_afectada: "asistencia_operativos" },
      orderBy: { id: "desc" },
    });
    expect(bit!.motivo).toContain("SOBRESCRIBIÓ una corrección manual");
    expect(bit!.valor_anterior).toBe("07:00 a 15:00");
    expect(bit!.valor_nuevo).toBe("06:42 a 20:50");
  });

  it("si el archivo dice lo MISMO que la corrección manual, no hay conflicto", async () => {
    const personaId = await crearPersona("Basilio", "2000002");
    await guardarAsistenciaAction(personaId, "2026-08-17", { entrada: "06:42", salida: "15:10" });
    const previa = await previsualizarArchivoAction(
      formDataCon([
        { codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "06:42", salida: "15:10" },
      ]),
    );
    if (!previa.ok) throw new Error("previa fallida");
    expect(previa.previa.conflictos).toHaveLength(0);
    expect((await filaDe(personaId, 17))!.origen).toBe("Manual");
  });

  it("la bitácora distingue lo importado de lo digitado a mano", async () => {
    const personaId = await crearPersona("Basilio", "2000002");
    await importarArchivoAction(
      formDataCon([
        { codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "06:42", salida: "15:10" },
      ]),
      false,
    );
    await guardarAsistenciaAction(personaId, "2026-08-18", { entrada: "07:00", salida: "15:00" });

    const entradas = await prisma.bitacora_auditoria.findMany({
      where: { tabla_afectada: "asistencia_operativos" },
      orderBy: { id: "asc" },
    });
    expect(entradas[0].motivo).toContain("Importación del reloj biométrico");
    expect(entradas[1].motivo).not.toContain("Importación");
    // Y el origen queda en la propia fila.
    expect((await filaDe(personaId, 17))!.origen).toBe("Biometrico");
    expect((await filaDe(personaId, 18))!.origen).toBe("Manual");
  });
});

describe("vinculación de códigos", () => {
  it("vincular un código hace importable sus filas", async () => {
    const personaId = await crearPersona("Rony Rios");
    const filas: FilaReloj[] = [
      { codigo: "2000050", nombre: "RONY RIOS", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
    ];

    const antes = await previsualizarArchivoAction(formDataCon(filas));
    if (!antes.ok) throw new Error("previa fallida");
    expect(antes.previa.sinVincular).toBe(1);
    expect(antes.previa.importables).toBe(0);

    expect((await vincularCodigoAction("2000050", personaId)).ok).toBe(true);

    const despues = await previsualizarArchivoAction(formDataCon(filas));
    if (!despues.ok) throw new Error("previa fallida");
    expect(despues.previa.sinVincular).toBe(0);
    expect(despues.previa.importables).toBe(1);
    expect(despues.previa.vinculos[0].personaNombre).toBe("Rony Rios");

    // Y queda en la bitácora.
    const bit = await prisma.bitacora_auditoria.findFirst({
      where: { campo_modificado: "codigo_biometrico" },
      orderBy: { id: "desc" },
    });
    expect(bit!.valor_nuevo).toBe("2000050");
  });

  it("un código ya usado por otra persona se rechaza con un mensaje claro", async () => {
    await crearPersona("Basilio", "2000002");
    const otro = await crearPersona("Otro");
    const r = await vincularCodigoAction("2000002", otro);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Basilio");
  });

  it("un código marcado como ajeno no vuelve a pedir vinculación", async () => {
    await crearPersona("Basilio", "2000002");
    const filas: FilaReloj[] = [
      { codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
      { codigo: "7777777", nombre: "VIGILANTE", fecha: "17/8/2026", entrada: "18:00", salida: "06:00" },
    ];
    expect((await ignorarCodigoAction("7777777", "VIGILANTE", true)).ok).toBe(true);

    const previa = await previsualizarArchivoAction(formDataCon(filas));
    if (!previa.ok) throw new Error("previa fallida");
    expect(previa.previa.sinVincular).toBe(0); // ya está resuelto
    expect(previa.previa.vinculos.find((v) => v.codigo === "7777777")!.ignorado).toBe(true);

    const imp = await importarArchivoAction(formDataCon(filas), false);
    expect(imp.ok && imp.reporte.creados).toBe(1);
    expect(imp.ok && imp.reporte.omitidosIgnorados).toBe(1);
  });

  it("no se puede marcar como ajeno un código que ya está vinculado", async () => {
    await crearPersona("Basilio", "2000002");
    const r = await ignorarCodigoAction("2000002", "Basilio", true);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("desvincúlalo");
  });
});
