// Reporte de despachos en horario extraordinario, contra Postgres.
//
// Cubre los casos de la validación pedida: la clasificación por hora de salida, que el
// horario sea POR PLANTA (cambiarlo reclasifica el mismo viaje), el domingo completo,
// que volumen normal + extra cuadre exactamente con el total en los dos niveles, que
// "Considerado en ficha" sea el producto exacto, y que un Jefe de Planta solo vea sus
// planteles asignados.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import { calcularExtraordinario, leerCostoFicha } from "@/lib/extraordinario/metricas";
import { alcanceDeParams, rangoDeParams } from "@/lib/extraordinario/filtro";
import { calcularAlcance } from "@/lib/auth/acceso";
import { reporteACsv } from "@/lib/extraordinario/csv";

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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { guardarHorarioPlantaAction, guardarCostoFichaAction } = await import(
  "@/app/administracion/horarios-actions"
);

// 2026-08-18 es MARTES; 22 sábado; 23 domingo.
const en = (dia: number, h: number, m = 0) => new Date(2026, 7, dia, h, m, 0, 0);
const RANGO = { desde: new Date(2026, 7, 1), hasta: new Date(2026, 8, 1) };

/** Horario normal de una planta (lo que en producción se configura en Administración). */
async function fijarHorario(
  plantaId: number,
  tipoDia: string,
  aperturaMin: number,
  cierreMin: number,
) {
  await prisma.horario_normal_planta.upsert({
    where: { planta_id_tipo_dia: { planta_id: plantaId, tipo_dia: tipoDia } },
    create: {
      planta_id: plantaId,
      tipo_dia: tipoDia,
      hora_apertura_min: aperturaMin,
      hora_cierre_min: cierreMin,
    },
    update: { hora_apertura_min: aperturaMin, hora_cierre_min: cierreMin, activo: true },
  });
}

interface OpcionesViaje {
  plantelId: number;
  plantaId: number;
  clienteId: number;
  disenoId: number;
  salida: Date;
  volumen: number;
  operadorId?: number;
  /** false = sin hora real (se clasifica con la programada y cuenta como estimado). */
  real?: boolean;
  volumenReal?: number;
}

/** Crea un pedido con un viaje que salió de planta a la hora indicada. */
async function crearViaje(o: OpcionesViaje) {
  const pedido = await prisma.pedidos.create({
    data: {
      cliente_id: o.clienteId,
      diseno_id: o.disenoId,
      volumen_total_m3: o.volumen,
      volumen_programado: o.volumen,
      hora_solicitada: o.salida,
      plantel_id: o.plantelId,
      planta_id: o.plantaId,
      tipo_descarga: "Canal directo",
      creado_por: "prueba",
    },
  });
  const mixer = await prisma.mixers.create({
    data: { marca: "Test", capacidad_m3: 12, plantel_base_id: o.plantelId, estado: "Disponible" },
  });
  return prisma.viajes.create({
    data: {
      pedido_id: pedido.id,
      planta_id: o.plantaId,
      mixer_id: mixer.id,
      operador_id: o.operadorId ?? null,
      capacidad_asignada_m3: 11,
      volumen_asignado_m3: o.volumen,
      volumen_real_m3: o.volumenReal ?? null,
      hora_solicitada: o.salida,
      hora_salida_planta: o.salida,
      ts_salida_real: o.real === false ? null : o.salida,
      estado: "Completado",
    },
  });
}

async function escenario() {
  const norte = await crearPlantel({ nombre: "SM Extra", zona: "Norte", esHub: true });
  const centro = await crearPlantel({ nombre: "TGU Extra", zona: "Centro Sur", esHub: true });
  const clienteId = await crearCliente(true);
  const disenoId = await crearDiseno();
  // Jornada por defecto en ambas plantas: L-V 07:00-15:00 y sábado 07:00-11:00.
  for (const p of [norte.plantaId, centro.plantaId]) {
    await fijarHorario(p, "LunVie", 420, 900);
    await fijarHorario(p, "Sabado", 420, 660);
  }
  return { norte, centro, clienteId, disenoId };
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.operadores.deleteMany();
  await prisma.configuracion.deleteMany();
  esAdmin = true;
});

describe("clasificación de un despacho", () => {
  it("16:30 de un martes es extraordinario y 10:00 es normal", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    const base = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    await crearViaje({ ...base, salida: en(18, 10), volumen: 8 });
    await crearViaje({ ...base, salida: en(18, 16, 30), volumen: 9 });

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.ejecutivo.viajesTotal).toBe(2);
    expect(r.ejecutivo.volumenNormal).toBe(8);
    expect(r.ejecutivo.volumenExtra).toBe(9);
    expect(r.ejecutivo.viajesExtra).toBe(1);
  });

  it("si el Administrador extiende el cierre a las 17:00, ESE MISMO viaje pasa a normal", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    await crearViaje({
      plantelId: norte.plantelId,
      plantaId: norte.plantaId,
      clienteId,
      disenoId,
      salida: en(18, 16, 30),
      volumen: 9,
    });

    const antes = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(antes.ejecutivo.volumenExtra).toBe(9);

    // Por la acción real de Administración (no escribiendo la tabla a mano).
    const res = await guardarHorarioPlantaAction(norte.plantaId, "LunVie", "07:00", "17:00", true);
    expect(res.ok).toBe(true);

    const despues = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(despues.ejecutivo.volumenExtra).toBe(0);
    expect(despues.ejecutivo.volumenNormal).toBe(9);

    // Y el cambio quedó en la bitácora.
    const bit = await prisma.bitacora_auditoria.findFirst({
      where: { tabla_afectada: "horario_normal_planta" },
      orderBy: { id: "desc" },
    });
    expect(bit!.valor_anterior).toBe("07:00 a 15:00");
    expect(bit!.valor_nuevo).toBe("07:00 a 17:00");
  });

  it("dos plantas con horario distinto clasifican distinto el mismo horario", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    // Segunda planta del mismo plantel, con cierre extendido (caso STALO/SANY).
    const sany = await prisma.plantas.create({
      data: { plantel_id: norte.plantelId, nombre: "SANY", capacidad_m3h: 50 },
    });
    await fijarHorario(sany.id, "LunVie", 420, 1020); // hasta las 17:00

    const base = { plantelId: norte.plantelId, clienteId, disenoId, salida: en(18, 16), volumen: 10 };
    await crearViaje({ ...base, plantaId: norte.plantaId }); // cierra 15:00 → extra
    await crearViaje({ ...base, plantaId: sany.id }); // cierra 17:00 → normal

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.ejecutivo.volumenExtra).toBe(10);
    expect(r.ejecutivo.volumenNormal).toBe(10);

    const stalo = r.porPlanta.find((p) => p.plantaId === norte.plantaId)!;
    const otra = r.porPlanta.find((p) => p.plantaId === sany.id)!;
    expect(stalo.volumenExtra).toBe(10);
    expect(otra.volumenExtra).toBe(0);
    expect(otra.horarios).toContain("L-V 07:00 a 17:00");
  });

  it("un viaje de domingo es extraordinario a cualquier hora", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    const base = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    await crearViaje({ ...base, salida: en(23, 9), volumen: 7 }); // domingo 9 a.m.
    await crearViaje({ ...base, salida: en(23, 13), volumen: 6 }); // domingo 1 p.m.

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.ejecutivo.volumenNormal).toBe(0);
    expect(r.ejecutivo.volumenExtra).toBe(13);
    expect(r.ejecutivo.pctExtra).toBe(100);
    // Y todo su volumen entra en la banda del 100 %.
    expect(r.bandasExtra).toEqual([{ porcentaje: 100, viajes: 2, volumen: 13 }]);
  });

  it("el volumen extra se desglosa por banda de recargo, no en un solo 'extra'", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    const base = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    await crearViaje({ ...base, salida: en(18, 16), volumen: 5 }); // 25 %
    await crearViaje({ ...base, salida: en(18, 20), volumen: 4 }); // 50 %
    await crearViaje({ ...base, salida: en(18, 23), volumen: 3 }); // 75 %
    await crearViaje({ ...base, salida: en(23, 9), volumen: 2 }); // domingo, 100 %

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.bandasExtra).toEqual([
      { porcentaje: 25, viajes: 1, volumen: 5 },
      { porcentaje: 50, viajes: 1, volumen: 4 },
      { porcentaje: 75, viajes: 1, volumen: 3 },
      { porcentaje: 100, viajes: 1, volumen: 2 },
    ]);
  });

  it("un viaje sin hora real se clasifica con la programada y se cuenta como estimado", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    const base = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    await crearViaje({ ...base, salida: en(18, 16, 30), volumen: 9, real: false });
    await crearViaje({ ...base, salida: en(18, 10), volumen: 8 });

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.ejecutivo.viajesEstimados).toBe(1);
    expect(r.ejecutivo.volumenExtra).toBe(9);
    // Las estadísticas de hora usan SOLO las salidas reales, y reportan las que faltan.
    const global = r.horaSalida.find((h) => h.planta === "GLOBAL")!;
    expect(global.conHora).toBe(1);
    expect(global.sinHora).toBe(1);
  });

  it("cuenta el volumen REAL despachado, no el programado", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    await crearViaje({
      plantelId: norte.plantelId,
      plantaId: norte.plantaId,
      clienteId,
      disenoId,
      salida: en(18, 16),
      volumen: 11,
      volumenReal: 7, // el despachador cargó menos
    });
    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.ejecutivo.volumenExtra).toBe(7);
  });
});

describe("los totales cuadran", () => {
  it("normal + extra = total, por planta y en el total general", async () => {
    const { norte, centro, clienteId, disenoId } = await escenario();
    const n = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    const c = { plantelId: centro.plantelId, plantaId: centro.plantaId, clienteId, disenoId };
    await crearViaje({ ...n, salida: en(18, 8), volumen: 8 });
    await crearViaje({ ...n, salida: en(18, 16), volumen: 9.5 });
    await crearViaje({ ...n, salida: en(23, 9), volumen: 6 });
    await crearViaje({ ...c, salida: en(19, 9), volumen: 7.25 });
    await crearViaje({ ...c, salida: en(19, 18), volumen: 10 });

    const r = await calcularExtraordinario({
      ...RANGO,
      plantelIds: [norte.plantelId, centro.plantelId],
    });

    // Total general.
    expect(r.ejecutivo.volumenNormal + r.ejecutivo.volumenExtra).toBe(r.ejecutivo.volumenTotal);
    expect(r.ejecutivo.volumenTotal).toBe(40.75);
    expect(r.ejecutivo.viajesNormal + r.ejecutivo.viajesExtra).toBe(r.ejecutivo.viajesTotal);

    // Por planta, y la suma de las plantas es el total.
    let suma = 0;
    for (const p of r.porPlanta) {
      expect(Math.round((p.volumenNormal + p.volumenExtra) * 100) / 100).toBe(p.volumen);
      expect(p.viajesNormal + p.viajesExtra).toBe(p.viajes);
      suma += p.volumen;
    }
    expect(Math.round(suma * 100) / 100).toBe(r.ejecutivo.volumenTotal);

    // Por día también.
    let sumaDias = 0;
    for (const d of r.porDia) {
      expect(Math.round((d.volumenNormal + d.volumenExtra) * 100) / 100).toBe(d.volumen);
      sumaDias += d.volumen;
    }
    expect(Math.round(sumaDias * 100) / 100).toBe(r.ejecutivo.volumenTotal);

    // Y el desglose por banda suma exactamente el volumen extraordinario.
    const sumaBandas = r.bandasExtra.reduce((s, b) => s + b.volumen, 0);
    expect(Math.round(sumaBandas * 100) / 100).toBe(r.ejecutivo.volumenExtra);
  });

  it("el análisis por motorista usa el id, no el nombre escrito", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    // Dos personas DISTINTAS con el mismo nombre: si se agrupara por texto, saldrían
    // como una sola (el problema del Excel actual).
    const a = await prisma.operadores.create({ data: { nombre: "Juan Pérez" } });
    const b = await prisma.operadores.create({ data: { nombre: "Juan Pérez" } });
    const base = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    await crearViaje({ ...base, salida: en(18, 8), volumen: 8, operadorId: a.id });
    await crearViaje({ ...base, salida: en(18, 16), volumen: 9, operadorId: a.id });
    await crearViaje({ ...base, salida: en(19, 9), volumen: 7, operadorId: b.id });

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.porMotorista).toHaveLength(2);
    const fa = r.porMotorista.find((m) => m.operadorId === a.id)!;
    expect(fa.viajes).toBe(2);
    expect(fa.diasTrabajados).toBe(1);
    expect(fa.viajesExtra).toBe(1);
    expect(fa.promedioViajesDia).toBe(2);
    expect(r.ejecutivo.motoristasActivos).toBe(2);
  });
});

describe("absorción de costo", () => {
  it("Considerado en ficha = costo por m3 x volumen total, exacto", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    const base = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    await crearViaje({ ...base, salida: en(18, 8), volumen: 10 });
    await crearViaje({ ...base, salida: en(18, 16), volumen: 15 });

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    // Default L 30.78 por m³ sobre los 25 m³ TOTALES (no solo los extraordinarios).
    expect(r.absorcion.costoFicha).toBe(30.78);
    expect(r.absorcion.volumenTotal).toBe(25);
    expect(r.absorcion.consideradoEnFicha).toBe(769.5); // 30.78 x 25, verificable a mano

    // Y si el Administrador cambia el parámetro, el número lo sigue.
    expect((await guardarCostoFichaAction("40")).ok).toBe(true);
    expect(await leerCostoFicha()).toBe(40);
    const r2 = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r2.absorcion.consideradoEnFicha).toBe(1000); // 40 x 25
  });

  it("el pago actual toma las horas extra de TODO el personal operativo (interpretación elegida)", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    await crearViaje({
      plantelId: norte.plantelId,
      plantaId: norte.plantaId,
      clienteId,
      disenoId,
      salida: en(18, 16),
      volumen: 10,
    });

    // L 24,000 al mes = L 100 la hora. Un motorista con 4 h al 25 % (500) y un
    // dosificador con 2 h al 50 % (300).
    const motorista = await prisma.operadores.create({
      data: {
        nombre: "Motorista Extra",
        puesto: "Motorista_Mixer",
        salario_mensual: 24_000,
        plantel_asignado_id: norte.plantelId,
      },
    });
    const dosificador = await prisma.operadores.create({
      data: {
        nombre: "Dosificador Extra",
        puesto: "Dosificador",
        salario_mensual: 24_000,
        plantel_asignado_id: norte.plantelId,
      },
    });
    await prisma.asistencia_operativos.create({
      data: {
        persona_id: motorista.id,
        fecha: new Date(2026, 7, 18),
        horas_normales: 8,
        horas_extra_25: 4,
      },
    });
    await prisma.asistencia_operativos.create({
      data: {
        persona_id: dosificador.id,
        fecha: new Date(2026, 7, 18),
        horas_normales: 8,
        horas_extra_50: 2,
      },
    });

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    const a = r.absorcion;
    // 4 x 100 x 1.25 = 500 ; 2 x 100 x 1.50 = 300. Las horas NORMALES no entran.
    expect(a.pagoActual).toBe(800);
    expect(a.personasConSobretiempo).toBe(2);
    expect(a.pagoPorPuesto.map((p) => [p.puesto, p.monto])).toEqual([
      ["Motoristas de mixer", 500],
      ["Dosificadores", 300],
    ]);
    expect(a.horasExtraPorNivel).toEqual([
      { porcentaje: 25, horas: 4 },
      { porcentaje: 50, horas: 2 },
    ]);
    // Diferencia = 30.78 x 10 - 800 = 307.80 - 800 = -492.20 (fuga de margen).
    expect(a.consideradoEnFicha).toBe(307.8);
    expect(a.diferencia).toBe(-492.2);
    expect(a.diferenciaNeta).toBe(-492.2); // sin cobros al cliente
  });

  it("un cobro al cliente en el rango entra en la diferencia neta", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    await crearViaje({
      plantelId: norte.plantelId,
      plantaId: norte.plantaId,
      clienteId,
      disenoId,
      salida: en(18, 16),
      volumen: 10,
    });
    await prisma.cobros_sobretiempo.create({
      data: { fecha: new Date(2026, 7, 18), monto: 1500, cliente_id: clienteId },
    });
    // Uno FUERA del rango no debe contarse.
    await prisma.cobros_sobretiempo.create({
      data: { fecha: new Date(2026, 6, 10), monto: 999, cliente_id: clienteId },
    });

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.absorcion.cobroCliente).toBe(1500);
    expect(r.absorcion.diferenciaNeta).toBe(
      Math.round((r.absorcion.diferencia + 1500) * 100) / 100,
    );
  });

  it("filtrando por plantel, el personal sin plantel asignado se reporta como excluido", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    await crearViaje({
      plantelId: norte.plantelId,
      plantaId: norte.plantaId,
      clienteId,
      disenoId,
      salida: en(18, 16),
      volumen: 10,
    });
    const suelto = await prisma.operadores.create({
      data: { nombre: "Sin plantel", puesto: "Motorista_Mixer", salario_mensual: 24_000 },
    });
    await prisma.asistencia_operativos.create({
      data: { persona_id: suelto.id, fecha: new Date(2026, 7, 18), horas_extra_25: 4 },
    });

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    // No entra al pago (no se puede atribuir a un plantel), pero NO se esconde.
    expect(r.absorcion.pagoActual).toBe(0);
    expect(r.absorcion.excluidoSinPlantel).toEqual({ personas: 1, monto: 500 });
  });
});

describe("alcance por rol", () => {
  it("un Jefe de Planta solo ve sus planteles asignados, aunque pida otro en la URL", async () => {
    const { norte, centro, clienteId, disenoId } = await escenario();
    await crearViaje({
      plantelId: norte.plantelId,
      plantaId: norte.plantaId,
      clienteId,
      disenoId,
      salida: en(18, 16),
      volumen: 10,
    });
    await crearViaje({
      plantelId: centro.plantelId,
      plantaId: centro.plantaId,
      clienteId,
      disenoId,
      salida: en(18, 16),
      volumen: 20,
    });

    // Jefe de Planta con SOLO el plantel del norte.
    const jefe = calcularAlcance(["JefePlanta"], null, null, null, [norte.plantelId]);
    const ambito = await alcanceDeParams(jefe, {});
    expect(ambito.plantelIds).toEqual([norte.plantelId]);
    const suyo = await calcularExtraordinario({ ...RANGO, plantelIds: ambito.plantelIds });
    expect(suyo.ejecutivo.volumenTotal).toBe(10);

    // Pide por URL el plantel ajeno: el filtro no amplía su alcance.
    const forzado = await alcanceDeParams(jefe, { plantel: String(centro.plantelId) });
    expect(forzado.plantelIds).toEqual([norte.plantelId]);
    const r = await calcularExtraordinario({ ...RANGO, plantelIds: forzado.plantelIds });
    expect(r.ejecutivo.volumenTotal).toBe(10);

    // El Admin sí ve los dos.
    const admin = calcularAlcance(["Administrador"], null, null, null, []);
    const todo = await alcanceDeParams(admin, {});
    const rAdmin = await calcularExtraordinario({ ...RANGO, plantelIds: todo.plantelIds });
    expect(rAdmin.ejecutivo.volumenTotal).toBe(30);
  });

  it("un Jefe de Planta SIN planteles asignados no ve nada (no lo ve todo)", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    await crearViaje({
      plantelId: norte.plantelId,
      plantaId: norte.plantaId,
      clienteId,
      disenoId,
      salida: en(18, 16),
      volumen: 10,
    });
    const jefe = calcularAlcance(["JefePlanta"], null, null, null, []);
    const ambito = await alcanceDeParams(jefe, {});
    expect(ambito.plantelIds).toEqual([-1]);
    const r = await calcularExtraordinario({ ...RANGO, plantelIds: ambito.plantelIds });
    expect(r.ejecutivo.volumenTotal).toBe(0);
  });

  it("un rol sin permiso no puede cambiar el horario ni el costo de la ficha", async () => {
    const { norte } = await escenario();
    esAdmin = false;
    expect((await guardarHorarioPlantaAction(norte.plantaId, "LunVie", "07:00", "17:00", true)).ok).toBe(
      false,
    );
    expect((await guardarCostoFichaAction("99")).ok).toBe(false);
    const h = await prisma.horario_normal_planta.findUnique({
      where: { planta_id_tipo_dia: { planta_id: norte.plantaId, tipo_dia: "LunVie" } },
    });
    expect(h!.hora_cierre_min).toBe(900); // sin cambios
  });
});

describe("rango y exportación", () => {
  it("el rango por defecto es del primer día del mes a hoy, y se ordena si viene invertido", () => {
    const hoy = new Date(2026, 7, 25, 14, 30);
    const porDefecto = rangoDeParams({}, hoy);
    expect(porDefecto.desdeISO).toBe("2026-08-01");
    expect(porDefecto.hastaISO).toBe("2026-08-25");
    // `hasta` es exclusivo: el 25 completo queda incluido.
    expect(porDefecto.hasta.getDate()).toBe(26);

    const invertido = rangoDeParams({ desde: "2026-08-20", hasta: "2026-08-10" }, hoy);
    expect(invertido.desdeISO).toBe("2026-08-10");
    expect(invertido.hastaISO).toBe("2026-08-20");
  });

  it("un viaje fuera del rango no entra", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    const base = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    await crearViaje({ ...base, salida: en(18, 16), volumen: 10 });
    await crearViaje({ ...base, salida: new Date(2026, 6, 18, 16), volumen: 99 }); // julio

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    expect(r.ejecutivo.volumenTotal).toBe(10);
  });

  it("el CSV lleva las secciones y los mismos totales que la pantalla", async () => {
    const { norte, clienteId, disenoId } = await escenario();
    const base = { plantelId: norte.plantelId, plantaId: norte.plantaId, clienteId, disenoId };
    await crearViaje({ ...base, salida: en(18, 8), volumen: 10 });
    await crearViaje({ ...base, salida: en(18, 16), volumen: 15 });

    const r = await calcularExtraordinario({ ...RANGO, plantelIds: [norte.plantelId] });
    const csv = reporteACsv(r, {
      desde: "2026-08-01",
      hasta: "2026-08-31",
      alcance: "Plantel SM Extra",
      generadoPor: "Admin Prueba",
      generadoEn: "25/08/2026, 14:30",
    });

    for (const seccion of [
      "RESUMEN EJECUTIVO",
      "RESUMEN POR PLANTA",
      "TENDENCIA DIARIA",
      "ANALISIS POR MOTORISTA",
      "ESTADISTICAS DE HORA DE SALIDA POR PLANTA",
      "DISTRIBUCION HORARIA",
      "ANALISIS DE ABSORCION DE COSTO",
    ]) {
      expect(csv).toContain(seccion);
    }
    // Excel-friendly y con los números del reporte.
    expect(csv.startsWith("﻿sep=;")).toBe(true);
    expect(csv).toContain("Volumen total despachado (m3);25");
    expect(csv).toContain("Volumen en horario extraordinario (m3);15");
    expect(csv).toContain("769.5"); // considerado en ficha
    expect(csv).toContain("TOTAL");
  });
});
