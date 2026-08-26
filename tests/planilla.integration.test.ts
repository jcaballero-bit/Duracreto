// Planilla en el LÍMITE REAL de las server actions (Postgres).
//
// Lo que no se puede garantizar desde la interfaz: que un rol que no es Administrador
// sea rechazado aunque invoque la acción directamente (la pantalla tiene salarios), que
// las horas se recalculen al editar una hora, que la ausencia sugiera su costo y que
// las bandas PRECARGADAS por la migración sean las que dice el requerimiento.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { limpiarBD } from "./helpers";
import { leerBandas, planillaDelPeriodo, periodoEfectivo } from "@/lib/planilla/consulta";
import { calcularHorasTurno } from "@/lib/planilla/horas";
import { periodoPorIndice } from "@/lib/planilla/periodos";

let esAdmin = true;

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Admin Prueba", email: "admin@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  exigirAdmin: async () =>
    esAdmin
      ? { ok: true, userId: "u1" }
      : { ok: false, mensaje: "Solo un Administrador puede hacer esto." },
  requerirAcceso: async () => ({}),
  alcanceActual: async () => ({}),
  exigirGestionFlota: async () => ({ ok: true, userId: "u1" }),
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

const { asignarMixerOperadorAction } = await import("@/app/flota/actions");
const {
  guardarAsistenciaAction,
  guardarSalarioAction,
  cambiarEstadoPeriodoAction,
  ajustarPeriodoAction,
} = await import("@/app/planilla/actions");

/** Persona de prueba con L 24,000 al mes (L 800 el día, L 100 la hora). */
async function crearPersona(puesto = "Motorista_Mixer", salario: number | null = 24_000) {
  const p = await prisma.operadores.create({
    data: { nombre: `Persona ${puesto}`, puesto, salario_mensual: salario },
  });
  return p.id;
}

// Periodo ancla (06 al 19 de julio de 2026): el 15 es miércoles, el 18 sábado y el 19
// domingo, así que sirve para los tres tipos de día.
const MIERCOLES = "2026-07-15";
const SABADO = "2026-07-18";
const DOMINGO = "2026-07-19";

async function filaDe(personaId: number, fechaISO: string) {
  const [a, m, d] = fechaISO.split("-").map(Number);
  return prisma.asistencia_operativos.findUnique({
    where: { persona_id_fecha: { persona_id: personaId, fecha: new Date(a, m - 1, d) } },
  });
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.asistencia_operativos.deleteMany();
  await prisma.operadores.deleteMany();
  esAdmin = true;
});

describe("configuración precargada", () => {
  it("las bandas de recargo son las del requerimiento", async () => {
    const bandas = await leerBandas();
    const lunVie = bandas.filter((b) => b.tipoDia === "LunVie");
    expect(lunVie.map((b) => [b.desdeMin, b.hastaMin, b.porcentaje])).toEqual([
      [0, 300, 75],
      [300, 420, 25],
      [420, 900, 0],
      [900, 1140, 25],
      [1140, 1320, 50],
      [1320, 1440, 75],
    ]);
    const sabado = bandas.filter((b) => b.tipoDia === "Sabado");
    expect(sabado.map((b) => [b.desdeMin, b.hastaMin, b.porcentaje])).toEqual([
      [0, 300, 75],
      [300, 420, 25],
      [420, 660, 0],
      [660, 1140, 25],
      [1140, 1320, 50],
      [1320, 1440, 75],
    ]);
    // Domingo: todo el día al 100 %.
    const domingo = bandas.filter((b) => b.tipoDia === "Domingo");
    expect(domingo).toHaveLength(1);
    expect(domingo[0]).toMatchObject({ desdeMin: 0, hastaMin: 1440, porcentaje: 100 });
  });

  it("el periodo ancla existe en la base y se paga 6 días después del cierre", async () => {
    const p = await periodoEfectivo(0);
    expect(p.id).not.toBeNull();
    expect((p.pago.getTime() - p.fin.getTime()) / 86_400_000).toBe(6);
  });

  it("con las bandas REALES de la base, 06:00 a 17:30 un miércoles da 8 h y 3.5 h al 25 %", async () => {
    const bandas = await leerBandas();
    const r = calcularHorasTurno(
      new Date(2026, 6, 15, 6, 0),
      new Date(2026, 6, 15, 17, 30),
      bandas,
    );
    expect(r.horas_normales).toBe(8);
    expect(r.horas_extra_25).toBe(3.5);
  });
});

describe("permisos", () => {
  it("un rol que no es Administrador es rechazado aunque invoque la acción directo", async () => {
    const personaId = await crearPersona();
    esAdmin = false;

    const asist = await guardarAsistenciaAction(personaId, MIERCOLES, {
      entrada: "06:00",
      salida: "17:30",
    });
    expect(asist.ok).toBe(false);
    expect(await filaDe(personaId, MIERCOLES)).toBeNull();

    const salario = await guardarSalarioAction(personaId, "30000");
    expect(salario.ok).toBe(false);
    const persona = await prisma.operadores.findUnique({ where: { id: personaId } });
    expect(persona!.salario_mensual).toBe(24_000); // no se movió

    expect((await cambiarEstadoPeriodoAction(0, "Cerrado")).ok).toBe(false);
    expect((await ajustarPeriodoAction(0, "2026-07-19", "2026-07-25")).ok).toBe(false);
  });
});

describe("captura de asistencia", () => {
  it("guarda el turno con sus horas repartidas por nivel", async () => {
    const personaId = await crearPersona();
    const r = await guardarAsistenciaAction(personaId, MIERCOLES, {
      entrada: "06:00",
      salida: "17:30",
    });
    expect(r.ok).toBe(true);

    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.horas_normales).toBe(8);
    expect(fila!.horas_extra_25).toBe(3.5);
    expect(fila!.horas_extra_50).toBe(0);
    expect(fila!.hora_entrada!.getHours()).toBe(6);
    expect(fila!.hora_salida!.getHours()).toBe(17);
  });

  it("al EDITAR la hora de salida se recalculan las horas", async () => {
    const personaId = await crearPersona();
    await guardarAsistenciaAction(personaId, MIERCOLES, { entrada: "07:00", salida: "15:00" });
    expect((await filaDe(personaId, MIERCOLES))!.horas_normales).toBe(8);

    // Se queda 4 horas más: 15:00-19:00 al 25 %.
    await guardarAsistenciaAction(personaId, MIERCOLES, { entrada: "07:00", salida: "19:00" });
    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.horas_normales).toBe(8);
    expect(fila!.horas_extra_25).toBe(4);
  });

  it("un turno nocturno guarda la salida en el día siguiente y reparte las horas", async () => {
    const personaId = await crearPersona();
    await guardarAsistenciaAction(personaId, MIERCOLES, { entrada: "22:00", salida: "06:00" });

    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.hora_salida!.getDate()).toBe(16); // pasó al día siguiente
    expect(fila!.horas_extra_75).toBe(7); // 22-24 y 00-05
    expect(fila!.horas_extra_25).toBe(1); // 05-06
  });

  it("el domingo entero se paga al 100 % y el sábado tarde al 25 %", async () => {
    const personaId = await crearPersona();
    await guardarAsistenciaAction(personaId, DOMINGO, { entrada: "07:00", salida: "15:00" });
    expect((await filaDe(personaId, DOMINGO))!.horas_extra_100).toBe(8);
    expect((await filaDe(personaId, DOMINGO))!.horas_normales).toBe(0);

    await guardarAsistenciaAction(personaId, SABADO, { entrada: "07:00", salida: "13:00" });
    const sab = await filaDe(personaId, SABADO);
    expect(sab!.horas_normales).toBe(4);
    expect(sab!.horas_extra_25).toBe(2);
  });

  it("vaciar la celda BORRA el registro (no deja una fila en cero)", async () => {
    const personaId = await crearPersona();
    await guardarAsistenciaAction(personaId, MIERCOLES, { entrada: "07:00", salida: "15:00" });
    expect(await filaDe(personaId, MIERCOLES)).not.toBeNull();

    await guardarAsistenciaAction(personaId, MIERCOLES, { entrada: "", salida: "" });
    expect(await filaDe(personaId, MIERCOLES)).toBeNull();
  });

  it("una hora mal escrita se rechaza y no guarda nada", async () => {
    const personaId = await crearPersona();
    const r = await guardarAsistenciaAction(personaId, MIERCOLES, { entrada: "7am", salida: "15:00" });
    expect(r.ok).toBe(false);
    expect(await filaDe(personaId, MIERCOLES)).toBeNull();
  });
});

describe("ausencias", () => {
  it("vacaciones sugieren el salario diario y no dejan horas", async () => {
    const personaId = await crearPersona();
    await guardarAsistenciaAction(personaId, MIERCOLES, { tipoAusencia: "Vacaciones" });

    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.tipo_ausencia).toBe("Vacaciones");
    expect(fila!.costo_ausencia).toBe(800); // 24000 / 30
    expect(fila!.horas_normales).toBe(0);
    expect(fila!.hora_entrada).toBeNull();
  });

  it("el permiso sin goce sugiere 0 y el costo se puede editar a mano", async () => {
    const personaId = await crearPersona();
    await guardarAsistenciaAction(personaId, MIERCOLES, { tipoAusencia: "Permiso_Sin_Goce" });
    expect((await filaDe(personaId, MIERCOLES))!.costo_ausencia).toBe(0);

    await guardarAsistenciaAction(personaId, MIERCOLES, {
      tipoAusencia: "Incapacidad",
      costoAusencia: "450.50",
    });
    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.tipo_ausencia).toBe("Incapacidad");
    expect(fila!.costo_ausencia).toBe(450.5);
  });

  it("un tipo de ausencia inventado se rechaza", async () => {
    const personaId = await crearPersona();
    const r = await guardarAsistenciaAction(personaId, MIERCOLES, { tipoAusencia: "Feriado" });
    expect(r.ok).toBe(false);
    expect(await filaDe(personaId, MIERCOLES)).toBeNull();
  });
});

describe("totales del periodo", () => {
  it("agrupa por puesto y el costo cuadra con la fórmula, ausencias incluidas", async () => {
    const motorista = await crearPersona("Motorista_Mixer");
    const dosificador = await crearPersona("Dosificador");

    // Motorista: miércoles 06:00-17:30 (8 h normales + 3.5 h al 25 %) y un día de
    // vacaciones el jueves.
    await guardarAsistenciaAction(motorista, MIERCOLES, { entrada: "06:00", salida: "17:30" });
    await guardarAsistenciaAction(motorista, "2026-07-16", { tipoAusencia: "Vacaciones" });
    // Dosificador: domingo 07:00-15:00 (8 h al 100 %).
    await guardarAsistenciaAction(dosificador, DOMINGO, { entrada: "07:00", salida: "15:00" });

    const filas = await planillaDelPeriodo(periodoPorIndice(0));
    const m = filas.find((f) => f.id === motorista)!;
    const d = filas.find((f) => f.id === dosificador)!;

    // 8 x 100 + 3.5 x 100 x 1.25 = 1237.50 de horas, más 800 de vacaciones.
    expect(m.totales.normales).toBe(8);
    expect(m.totales.extra25).toBe(3.5);
    expect(m.costoHoras).toBe(1237.5);
    expect(m.costoAusencias).toBe(800);
    expect(m.costoTotal).toBe(2037.5);
    expect(m.diasAusencia).toBe(1);

    // 8 x 100 x 2 = 1600.
    expect(d.totales.extra100).toBe(8);
    expect(d.costoTotal).toBe(1600);

    // El motorista va antes que el dosificador (orden de presentación por puesto).
    expect(filas.map((f) => f.puesto)).toEqual(["Motorista_Mixer", "Dosificador"]);
    // Los 14 días del periodo salen siempre, con o sin captura.
    expect(m.dias).toHaveLength(14);
  });

  it("sin salario capturado la persona sale con costo 0 (no rompe el total)", async () => {
    const personaId = await crearPersona("Operador_Cargadora", null);
    await guardarAsistenciaAction(personaId, MIERCOLES, { entrada: "06:00", salida: "17:30" });

    const filas = await planillaDelPeriodo(periodoPorIndice(0));
    const p = filas.find((f) => f.id === personaId)!;
    expect(p.totales.normales).toBe(8); // las horas SÍ se cuentan
    expect(p.costoTotal).toBe(0); // pero no se pueden valorizar
  });

  it("un día fuera del periodo no entra en sus totales", async () => {
    const personaId = await crearPersona();
    // 20 de julio: primer día del periodo SIGUIENTE.
    await guardarAsistenciaAction(personaId, "2026-07-20", { entrada: "07:00", salida: "15:00" });

    const ancla = await planillaDelPeriodo(periodoPorIndice(0));
    expect(ancla.find((f) => f.id === personaId)!.totales.normales).toBe(0);

    const siguiente = await planillaDelPeriodo(periodoPorIndice(1));
    expect(siguiente.find((f) => f.id === personaId)!.totales.normales).toBe(8);
  });
});

describe("salario y periodo", () => {
  it("el Administrador cambia el salario y queda en la bitácora", async () => {
    const personaId = await crearPersona("Dosificador", 15_000);
    const r = await guardarSalarioAction(personaId, "18500.50");
    expect(r.ok).toBe(true);

    const persona = await prisma.operadores.findUnique({ where: { id: personaId } });
    expect(persona!.salario_mensual).toBe(18_500.5);

    const bit = await prisma.bitacora_auditoria.findFirst({
      where: { tabla_afectada: "operadores", campo_modificado: "salario_mensual" },
      orderBy: { id: "desc" },
    });
    expect(bit!.valor_anterior).toBe("15000.00");
    expect(bit!.valor_nuevo).toBe("18500.50");
  });

  it("el estado del periodo se guarda y el ajuste manual respeta el orden de fechas", async () => {
    expect((await cambiarEstadoPeriodoAction(2, "Pagado")).ok).toBe(true);
    expect((await periodoEfectivo(2)).estado).toBe("Pagado");

    // El pago no puede ser antes del cierre.
    const malo = await ajustarPeriodoAction(2, "2026-08-30", "2026-08-20");
    expect(malo.ok).toBe(false);

    const bueno = await ajustarPeriodoAction(2, "2026-08-30", "2026-09-07");
    expect(bueno.ok).toBe(true);
    const p = await periodoEfectivo(2);
    expect(p.fin.getDate()).toBe(30);
    expect(p.pago.getDate()).toBe(7);
  });
});

describe("el puesto limita quién puede ser motorista de un mixer", () => {
  it("un dosificador NO puede quedar como motorista habitual de un mixer", async () => {
    // La tabla `operadores` guarda a todo el personal operativo y el motor copia el
    // motorista habitual del mixer al viaje: si un dosificador cupiera aquí, saldría
    // como motorista en la programación.
    const plantel = await prisma.planteles.create({
      data: { nombre: "SM Planilla", zona: "Norte", capacidad_dosificacion_m3h: 45 },
    });
    const mixer = await prisma.mixers.create({
      data: { marca: "STALO", capacidad_m3: 11, plantel_base_id: plantel.id, identificador: "M-P1" },
    });
    const dosificador = await crearPersona("Dosificador");
    const motorista = await crearPersona("Motorista_Mixer");

    const malo = await asignarMixerOperadorAction(dosificador, mixer.id);
    expect(malo.ok).toBe(false);
    expect(malo.mensaje).toContain("Dosificador");
    expect(
      (await prisma.mixers.findUnique({ where: { id: mixer.id } }))!.operador_asignado_id,
    ).toBeNull();

    const bueno = await asignarMixerOperadorAction(motorista, mixer.id);
    expect(bueno.ok).toBe(true);
    expect(
      (await prisma.mixers.findUnique({ where: { id: mixer.id } }))!.operador_asignado_id,
    ).toBe(motorista);
  });
});
