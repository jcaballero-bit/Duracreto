// Captura de asistencia por el LÍMITE REAL de la server action (Postgres).
//
// Lo que no se puede garantizar desde la interfaz: que un Jefe de Planta no pueda
// capturar a alguien de otro plantel aunque invoque la acción con su id, que el
// Programador quede acotado a su zona, que marcar una ausencia borre las horas, que el
// turno nocturno dé horas positivas y que cada corrección quede en la bitácora con quién
// la hizo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearPlantel, limpiarBD } from "./helpers";
import { calcularAlcance } from "@/lib/auth/acceso";

type Rol = "Administrador" | "JefePlanta" | "Programador" | "Asesor";
let rolActual: Rol = "Administrador";
let zonaActual: string | null = "Norte";
let plantelesJefe: number[] = [];

vi.mock("@/auth", () => ({
  auth: async () => ({
    user: {
      id: "u1",
      name: "Usuario Prueba",
      email: "u1@test.com",
      roles: [rolActual],
    },
  }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rolActual], zonaActual, null, null, plantelesJefe),
  requerirAcceso: async () => calcularAlcance([rolActual], zonaActual, null, null, plantelesJefe),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
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

const { guardarAsistenciaCapturaAction } = await import("@/app/asistencia/actions");

// 2026-08-19 miércoles · 22 sábado · 23 domingo.
const MIERCOLES = "2026-08-19";
const DOMINGO = "2026-08-23";

async function crearPersona(nombre: string, plantelId: number | null) {
  const p = await prisma.operadores.create({
    data: {
      nombre,
      puesto: "Motorista_Mixer",
      salario_mensual: 24_000,
      plantel_asignado_id: plantelId,
    },
  });
  return p.id;
}

async function filaDe(personaId: number, fechaISO: string) {
  const [a, m, d] = fechaISO.split("-").map(Number);
  return prisma.asistencia_operativos.findUnique({
    where: { persona_id_fecha: { persona_id: personaId, fecha: new Date(a, m - 1, d) } },
  });
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.bitacora_auditoria.deleteMany();
  await prisma.operadores.deleteMany();
  rolActual = "Administrador";
  zonaActual = "Norte";
  plantelesJefe = [];
});

describe("cálculo de la jornada al capturar", () => {
  it("miércoles 06:00 a 17:30 da 8 h normales y 3.5 h al 25 %", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Asis", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Basilio Sanchez", plantelId);

    const r = await guardarAsistenciaCapturaAction(personaId, MIERCOLES, {
      entrada: "06:00",
      salida: "17:30",
    });
    expect(r.ok).toBe(true);

    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.horas_normales).toBe(8);
    expect(fila!.horas_extra_25).toBe(3.5);
    expect(fila!.horas_extra_50).toBe(0);
    expect(fila!.horas_extra_75).toBe(0);
    expect(fila!.horas_extra_100).toBe(0);
    expect(fila!.origen).toBe("Manual");
  });

  it("un turno de domingo va TODO al 100 %, con cero horas normales", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Dom", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Rony Rios", plantelId);

    await guardarAsistenciaCapturaAction(personaId, DOMINGO, {
      entrada: "07:00",
      salida: "17:00",
    });
    const fila = await filaDe(personaId, DOMINGO);
    expect(fila!.horas_extra_100).toBe(10);
    expect(fila!.horas_normales).toBe(0);
    expect(fila!.horas_extra_25).toBe(0);
  });

  it("06:28 a 01:00 cruza la medianoche: horas POSITIVAS y recargo nocturno", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Noche", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Darlin Martinez", plantelId);

    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, {
      entrada: "06:28",
      salida: "01:00",
    });
    const fila = await filaDe(personaId, MIERCOLES);
    // La salida quedó en el día siguiente.
    expect(fila!.hora_salida!.getDate()).toBe(20);
    // 06:28-07:00 = 32 min al 25 %; 07:00-15:00 normales; 15:00-19:00 al 25 %;
    // 19:00-22:00 al 50 %; 22:00-24:00 y 00:00-01:00 al 75 %.
    expect(fila!.horas_normales).toBe(8);
    expect(fila!.horas_extra_25).toBe(4.53);
    expect(fila!.horas_extra_50).toBe(3);
    expect(fila!.horas_extra_75).toBe(3);
    const total =
      fila!.horas_normales + fila!.horas_extra_25 + fila!.horas_extra_50 + fila!.horas_extra_75;
    expect(total).toBeCloseTo(18.53, 2); // 18 h 32 min, positivas
  });

  it("al editar la hora de salida se recalculan las horas", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Edit", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Persona", plantelId);

    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { entrada: "07:00", salida: "15:00" });
    expect((await filaDe(personaId, MIERCOLES))!.horas_extra_25).toBe(0);

    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { entrada: "07:00", salida: "18:00" });
    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.horas_normales).toBe(8);
    expect(fila!.horas_extra_25).toBe(3);
    // La corrección deja rastro de quién y cuándo.
    expect(fila!.actualizado_por).toBe("Usuario Prueba");
    expect(fila!.actualizado_en).not.toBeNull();
  });
});

describe("ausencias", () => {
  it("marcar una ausencia borra las horas y no calcula nada", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Aus", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Persona", plantelId);

    // Primero un turno normal.
    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { entrada: "06:00", salida: "17:30" });
    expect((await filaDe(personaId, MIERCOLES))!.horas_extra_25).toBe(3.5);

    // Se marca vacaciones: las horas se van.
    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { tipoAusencia: "Vacaciones" });
    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.tipo_ausencia).toBe("Vacaciones");
    expect(fila!.hora_entrada).toBeNull();
    expect(fila!.hora_salida).toBeNull();
    expect(fila!.horas_normales).toBe(0);
    expect(fila!.horas_extra_25).toBe(0);
  });

  it("aunque lleguen horas junto con la ausencia, la ausencia manda", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Aus2", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Persona", plantelId);

    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, {
      entrada: "06:00",
      salida: "17:30",
      tipoAusencia: "Incapacidad",
    });
    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.tipo_ausencia).toBe("Incapacidad");
    expect(fila!.hora_entrada).toBeNull();
    expect(fila!.horas_normales).toBe(0);
  });

  it("un tipo de ausencia inventado se rechaza", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Aus3", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Persona", plantelId);
    const r = await guardarAsistenciaCapturaAction(personaId, MIERCOLES, {
      tipoAusencia: "Feriado",
    });
    expect(r.ok).toBe(false);
    expect(await filaDe(personaId, MIERCOLES)).toBeNull();
  });

  it("vaciar todo BORRA el registro (no deja una fila en cero)", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Vac", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Persona", plantelId);
    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { entrada: "07:00", salida: "15:00" });
    expect(await filaDe(personaId, MIERCOLES)).not.toBeNull();

    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { entrada: "", salida: "" });
    expect(await filaDe(personaId, MIERCOLES)).toBeNull();
  });
});

describe("alcance por rol, validado en el servidor", () => {
  it("un Jefe de Planta NO puede capturar a alguien de otro plantel", async () => {
    const suyo = await crearPlantel({ nombre: "SM Jefe", zona: "Norte", esHub: true });
    const ajeno = await crearPlantel({ nombre: "CHO Jefe", zona: "Norte", hubId: suyo.plantelId });
    const mio = await crearPersona("De mi plantel", suyo.plantelId);
    const otro = await crearPersona("De otro plantel", ajeno.plantelId);
    const sinPlantel = await crearPersona("Sin plantel", null);

    rolActual = "JefePlanta";
    plantelesJefe = [suyo.plantelId];

    expect((await guardarAsistenciaCapturaAction(mio, MIERCOLES, { entrada: "07:00", salida: "15:00" })).ok).toBe(true);

    const rechazado = await guardarAsistenciaCapturaAction(otro, MIERCOLES, {
      entrada: "07:00",
      salida: "15:00",
    });
    expect(rechazado.ok).toBe(false);
    expect(rechazado.mensaje).toContain("no está en tu alcance");
    expect(await filaDe(otro, MIERCOLES)).toBeNull();

    // Alguien sin plantel asignado solo lo maneja el Administrador.
    const sinAlcance = await guardarAsistenciaCapturaAction(sinPlantel, MIERCOLES, {
      entrada: "07:00",
      salida: "15:00",
    });
    expect(sinAlcance.ok).toBe(false);
  });

  it("un Programador solo captura en su zona", async () => {
    const norte = await crearPlantel({ nombre: "SM Prog", zona: "Norte", esHub: true });
    const centro = await crearPlantel({ nombre: "TGU Prog", zona: "Centro Sur", esHub: true });
    const enNorte = await crearPersona("Del norte", norte.plantelId);
    const enCentro = await crearPersona("Del centro", centro.plantelId);

    rolActual = "Programador";
    zonaActual = "Norte";

    expect((await guardarAsistenciaCapturaAction(enNorte, MIERCOLES, { entrada: "07:00", salida: "15:00" })).ok).toBe(true);
    const fuera = await guardarAsistenciaCapturaAction(enCentro, MIERCOLES, {
      entrada: "07:00",
      salida: "15:00",
    });
    expect(fuera.ok).toBe(false);
    expect(await filaDe(enCentro, MIERCOLES)).toBeNull();
  });

  it("el Administrador captura a cualquiera, incluido quien no tiene plantel", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Admin", zona: "Norte", esHub: true });
    const conPlantel = await crearPersona("Con plantel", plantelId);
    const sinPlantel = await crearPersona("Sin plantel", null);

    rolActual = "Administrador";
    expect((await guardarAsistenciaCapturaAction(conPlantel, MIERCOLES, { entrada: "07:00", salida: "15:00" })).ok).toBe(true);
    expect((await guardarAsistenciaCapturaAction(sinPlantel, MIERCOLES, { entrada: "07:00", salida: "15:00" })).ok).toBe(true);
  });

  it("un rol sin acceso a la pantalla es rechazado aunque invoque la acción", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Rol", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Persona", plantelId);

    rolActual = "Asesor";
    const r = await guardarAsistenciaCapturaAction(personaId, MIERCOLES, {
      entrada: "07:00",
      salida: "15:00",
    });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("permiso");
    expect(await filaDe(personaId, MIERCOLES)).toBeNull();
  });
});

describe("auditoría y origen del dato", () => {
  it("cada captura y cada corrección queda en la bitácora con el antes y el después", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Bit", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Basilio Sanchez", plantelId);

    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { entrada: "07:00", salida: "15:00" });
    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { entrada: "06:00", salida: "17:30" });

    const entradas = await prisma.bitacora_auditoria.findMany({
      where: { tabla_afectada: "asistencia_operativos" },
      orderBy: { id: "asc" },
    });
    expect(entradas).toHaveLength(2);
    expect(entradas[0]).toMatchObject({
      valor_anterior: "sin registro",
      valor_nuevo: "07:00 a 15:00",
      usuario: "Usuario Prueba",
    });
    expect(entradas[1]).toMatchObject({
      valor_anterior: "07:00 a 15:00",
      valor_nuevo: "06:00 a 17:30",
    });
    expect(entradas[1].motivo).toContain("Basilio Sanchez");
  });

  it("corregir a mano un dato del reloj lo marca como Manual (y así lo protege)", async () => {
    const { plantelId } = await crearPlantel({ nombre: "SM Org", zona: "Norte", esHub: true });
    const personaId = await crearPersona("Persona", plantelId);

    // Como si lo hubiera dejado la importación del reloj.
    await prisma.asistencia_operativos.create({
      data: {
        persona_id: personaId,
        fecha: new Date(2026, 7, 19),
        hora_entrada: new Date(2026, 7, 19, 6, 42),
        hora_salida: new Date(2026, 7, 19, 15, 10),
        horas_normales: 8,
        horas_extra_25: 0.47,
        origen: "Biometrico",
      },
    });

    await guardarAsistenciaCapturaAction(personaId, MIERCOLES, { entrada: "06:00", salida: "15:10" });
    const fila = await filaDe(personaId, MIERCOLES);
    expect(fila!.origen).toBe("Manual");
    expect(fila!.hora_entrada!.getHours()).toBe(6);
    expect(fila!.hora_entrada!.getMinutes()).toBe(0);
  });
});
