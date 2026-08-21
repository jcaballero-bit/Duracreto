// Reporte de Control de Calidad: de qué viaje se tomó muestra y dónde, quién dosificó
// y quién controló cada planta, y los dos volúmenes que el documento saca solo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { avanzarEstadoViaje, editarVolumenViaje, programarPedido } from "@/lib/motor/asignacion";
import { ESTADO_VIAJE_COMPLETADO, SECUENCIA_ESTADOS_VIAJE } from "@/lib/motor/config";
import {
  dosificadoresPorPlanta,
  laboratoristasPorPlanta,
  textoMuestraViaje,
  ubicacionDeMuestras,
} from "@/lib/calidad/asignados";
import { volumenDespachadoDe } from "@/lib/calidad/volumen";
import { plantasDelLaboratorista, viajeEsDeSuPlanta } from "@/lib/calidad/planta-lab";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "lab-1", name: "Laboratorista Prueba", email: "l@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance(["Administrador"], null, null, null, []),
  requerirAcceso: async () => calcularAlcance(["Administrador"], null, null, null, []),
  exigirAdmin: async () => ({ ok: true, userId: "lab-1" }),
  exigirGestionFlota: async () => ({ ok: true, userId: "lab-1" }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { guardarControlViajeAction, guardarControlGeneralAction, guardarSalidaPlantaAction } =
  await import("@/app/calidad/actions");

const DIA = new Date(2026, 7, 28, 8, 0, 0, 0);
let seq = 0;
const correo = () => `tmp${Date.now()}${seq++}@verif.local`;

async function completar(viajeId: number) {
  for (const estado of SECUENCIA_ESTADOS_VIAJE) {
    await avanzarEstadoViaje(viajeId, estado);
    if (estado === ESTADO_VIAJE_COMPLETADO) break;
  }
}

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "Santa Marta",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  await crearMixers(plantelId, [[11, 4]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const r = await programarPedido({
    cliente_id: clienteId,
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    volumen_total_m3: 33,
    hora_solicitada: DIA,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  return { plantelId, plantaId, r };
}

const SIN_MARCAR = {
  observaciones: "",
  humedecio_area: false,
  vibro_concreto: false,
  m3_colocados: null as number | null,
  aplico_aditivo: false,
  aditivo_unidades: "",
  uso_curador: false,
  existe_reclamo: false,
  detalle_reclamo: "",
};

beforeEach(async () => {
  await limpiarBD();
  await prisma.asignaciones_laboratorista_planta.deleteMany();
  await prisma.reasignaciones_dosificador_planta.deleteMany();
  // El usuario de la sesión simulada tiene que existir: las lecturas de calidad
  // sellan quién las capturó (FK a `User`).
  await prisma.user.upsert({
    where: { id: "lab-1" },
    update: {},
    create: { id: "lab-1", email: "l@test.com", name: "Laboratorista Prueba", activo: true },
  });
});

describe("de qué viaje se tomó muestra", () => {
  it("se marca por camión, en planta y/o en obra", async () => {
    const e = await escenario();
    const viajes = e.r.viajes.filter((v) => v.mixerId != null);

    // El laboratorista de planta marca el primer camión; el de obra, el segundo.
    // El de planta marca el primer camión (salida) y el de obra el segundo.
    expect((await guardarSalidaPlantaAction(viajes[0].id, 5, 28, true)).ok).toBe(true);
    expect((await guardarControlViajeAction(viajes[1].id, 4.5, 29, true)).ok).toBe(true);

    const cc = await prisma.control_calidad_viaje.findMany({ orderBy: { viaje_id: "asc" } });
    expect(cc.map((x) => [x.muestra_planta, x.muestra_obra])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(textoMuestraViaje(cc[0])).toBe("Planta");
    expect(textoMuestraViaje(cc[1])).toBe("Obra");
    expect(textoMuestraViaje(null)).toBe("—");
  });

  it("un mismo viaje puede tener muestra en los dos lados", async () => {
    const e = await escenario();
    const viaje = e.r.viajes.find((v) => v.mixerId != null)!;
    await guardarSalidaPlantaAction(viaje.id, 5, 28, true);
    await guardarControlViajeAction(viaje.id, 4.5, 29, true);
    const cc = await prisma.control_calidad_viaje.findFirstOrThrow();
    expect(textoMuestraViaje(cc)).toBe("Planta y obra");
  });

  it("el pie del reporte resume dónde se muestreó", () => {
    const con = (planta: boolean, obra: boolean) => ({
      control_calidad: { muestra_planta: planta, muestra_obra: obra },
    });
    expect(ubicacionDeMuestras([con(true, false)])).toBe("En planta");
    expect(ubicacionDeMuestras([con(false, true)])).toBe("En obra (proyecto)");
    expect(ubicacionDeMuestras([con(true, false), con(false, true)])).toBe(
      "En planta y en obra (proyecto)",
    );
    expect(ubicacionDeMuestras([con(false, false)])).toBeNull();
    expect(ubicacionDeMuestras([])).toBeNull();
  });
});

describe("volúmenes del reporte", () => {
  it("los programados salen del PROGRAMA y los colocados de lo despachado", async () => {
    const e = await escenario();
    const viajes = e.r.viajes.filter((v) => v.mixerId != null);
    // Se despachan dos de los tres viajes y en uno se cargó menos de lo programado.
    await editarVolumenViaje(viajes[0].id, 7, "despachador");
    await completar(viajes[0].id);
    await completar(viajes[1].id);

    const res = await guardarControlGeneralAction(e.r.pedidoId, { ...SIN_MARCAR });
    expect(res.ok).toBe(true);

    const cg = await prisma.control_calidad_general.findUniqueOrThrow({
      where: { pedido_id: e.r.pedidoId },
    });
    expect(cg.m3_programados).toBe(33); // línea base del programa
    expect(cg.m3_colocados).toBe(18); // 7 (corregido) + 11; el tercero no salió
  });

  it("el laboratorista puede AJUSTAR los m³ colocados", async () => {
    const e = await escenario();
    const viajes = e.r.viajes.filter((v) => v.mixerId != null);
    await completar(viajes[0].id);

    await guardarControlGeneralAction(e.r.pedidoId, { ...SIN_MARCAR, m3_colocados: 9.5 });
    const cg = await prisma.control_calidad_general.findUniqueOrThrow({
      where: { pedido_id: e.r.pedidoId },
    });
    expect(cg.m3_colocados).toBe(9.5); // en obra se colocaron 9.5 de los 11 que salieron
    expect(cg.m3_programados).toBe(33);
  });

  it("volumenDespachadoDe toma el volumen REAL cuando se corrigió", () => {
    expect(
      volumenDespachadoDe([
        { estado: "Completado", volumen_asignado_m3: 11, volumen_real_m3: 7 },
        { estado: "Completado", volumen_asignado_m3: 9, volumen_real_m3: null },
        { estado: "En ruta", volumen_asignado_m3: 11, volumen_real_m3: null }, // no cuenta
      ]),
    ).toBe(16);
  });
});

describe("responsables de cada planta", () => {
  it("dice quién dosificó y quién fue el laboratorista en planta", async () => {
    const e = await escenario();
    const dosif = await prisma.user.create({
      data: {
        email: correo(),
        name: "Elmer Martinez",
        activo: true,
        planta_predeterminada_id: e.plantaId,
        roles: { create: { rol: "Dosificador" } },
      },
    });
    const lab = await prisma.user.create({
      data: {
        email: correo(),
        name: "Samuel Aguilar",
        activo: true,
        roles: { create: { rol: "Laboratorista" } },
      },
    });
    await prisma.asignaciones_laboratorista_planta.create({
      data: {
        laboratorista_id: lab.id,
        planta_id: e.plantaId,
        fecha: new Date(2026, 7, 28),
        observaciones: "Muestrear cada 3 camiones",
        creado_por: "jefe",
      },
    });

    expect((await dosificadoresPorPlanta(DIA)).get(e.plantaId)).toEqual(["Elmer Martinez"]);
    const enPlanta = (await laboratoristasPorPlanta(DIA)).get(e.plantaId);
    expect(enPlanta?.nombre).toBe("Samuel Aguilar");
    expect(enPlanta?.observaciones).toBe("Muestrear cada 3 camiones");

    await prisma.user.deleteMany({ where: { id: { in: [dosif.id, lab.id] } } });
  });

  it("una reasignación del día gana sobre la planta predeterminada", async () => {
    const e = await escenario();
    const otra = await prisma.plantas.create({
      data: { plantel_id: e.plantelId, nombre: "SANY", capacidad_m3h: 28, tiempo_alistamiento_min: 5 },
    });
    const dosif = await prisma.user.create({
      data: {
        email: correo(),
        name: "Elmer Martinez",
        activo: true,
        planta_predeterminada_id: e.plantaId,
        roles: { create: { rol: "Dosificador" } },
      },
    });
    await prisma.reasignaciones_dosificador_planta.create({
      data: {
        dosificador_id: dosif.id,
        planta_id: otra.id,
        fecha: new Date(2026, 7, 28),
        creado_por: "jefe",
      },
    });

    const mapa = await dosificadoresPorPlanta(DIA);
    expect(mapa.get(otra.id)).toEqual(["Elmer Martinez"]);
    expect(mapa.get(e.plantaId)).toBeUndefined();

    await prisma.user.delete({ where: { id: dosif.id } });
  });
});

describe("laboratorista de planta", () => {
  it("solo puede marcar En ruta, y solo de los viajes de SU planta", async () => {
    const e = await escenario();
    const viaje = e.r.viajes.find((v) => v.mixerId != null)!;
    // Se le asigna la planta del día (es el laboratorista de báscula).
    await prisma.asignaciones_laboratorista_planta.create({
      data: {
        laboratorista_id: "lab-1",
        planta_id: e.plantaId,
        fecha: new Date(2026, 7, 28),
        creado_por: "jefe",
      },
    });

    expect(await viajeEsDeSuPlanta(viaje.id, "lab-1", DIA)).toBe(true);
    expect(await plantasDelLaboratorista("lab-1", DIA)).toEqual([e.plantaId]);
    // Un viaje de OTRA planta no es suyo.
    const otra = await prisma.plantas.create({
      data: { plantel_id: e.plantelId, nombre: "SANY", capacidad_m3h: 28, tiempo_alistamiento_min: 5 },
    });
    await prisma.viajes.update({ where: { id: viaje.id }, data: { planta_id: otra.id } });
    expect(await viajeEsDeSuPlanta(viaje.id, "lab-1", DIA)).toBe(false);
  });

  it("captura la SALIDA DE PLANTA sin pisar las lecturas de obra", async () => {
    const e = await escenario();
    const viaje = e.r.viajes.find((v) => v.mixerId != null)!;
    // Primero el de obra, después el de planta: cada uno escribe lo suyo.
    await guardarControlViajeAction(viaje.id, 4.5, 30, true);
    await guardarSalidaPlantaAction(viaje.id, 5.75, 28, true);

    const cc = await prisma.control_calidad_viaje.findUniqueOrThrow({ where: { viaje_id: viaje.id } });
    expect(cc.revenimiento_planta).toBe(5.75);
    expect(cc.temperatura_planta).toBe(28);
    expect(cc.revenimiento_obra).toBe(4.5); // no se perdió
    expect(cc.temperatura_concreto).toBe(30);
    expect(cc.muestra_planta).toBe(true);
    expect(cc.muestra_obra).toBe(true);
  });
});
