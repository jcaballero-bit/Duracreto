// Laboratorio: instrucciones de MUESTREO por programa (dónde se elaboran los testigos
// y cuántos cilindros), VARIOS laboratoristas por planta en el control de salida, y la
// observación del turno. Las llenan el Jefe de Laboratorio, el Gerente de Control de
// Calidad y el Administrador; el Laboratorista solo las consulta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { agregarViajeManual } from "@/lib/motor/asignacion";
import { MAX_MUESTRAS, textoMuestreo } from "@/lib/calidad/muestreo";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

type Rol =
  | "Administrador"
  | "JefeLaboratorio"
  | "GerenteControlCalidad"
  | "Laboratorista"
  | "Programador";
let rolActual: Rol = "JefeLaboratorio";
let zonaActual: string | null = "Norte";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "gestor1", name: "Gestor Prueba", email: "g@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rolActual], zonaActual),
  requerirAcceso: async () => calcularAlcance([rolActual], zonaActual),
  exigirAdmin: async () => ({ ok: true, userId: "gestor1" }),
  exigirGestionFlota: async () => ({ ok: true, userId: "gestor1" }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { guardarMuestreoPedidoAction, guardarLaboratoristasPlantaAction } = await import(
  "@/app/laboratorio/actions"
);

// Los correos son unicos por corrida: `limpiarBD` no borra usuarios.
let secuencia = 0;

/** Crea un laboratorista activo de la zona indicada. */
async function crearLab(nombre: string, zona: string | null) {
  const u = await prisma.user.create({
    data: {
      name: nombre,
      email: `lab${++secuencia}-${nombre.replace(/\s/g, "").toLowerCase()}@test.com`,
      activo: true,
      zona,
      debe_cambiar_password: false,
      roles: { create: [{ rol: "Laboratorista" }] },
    },
    select: { id: true },
  });
  return u.id;
}

const hoyISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Lab", zona: "Norte", esHub: true });
  const planta2 = await prisma.plantas.create({
    data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 45, tiempo_alistamiento_min: 5 },
  });
  await crearMixers(plantelId, [[11, 2]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixers = await prisma.mixers.findMany({
    where: { plantel_base_id: plantelId },
    orderBy: { id: "asc" },
  });
  const hoy = new Date();
  hoy.setHours(8, 0, 0, 0);
  const { pedidoId } = await agregarViajeManual({
    cliente_id: clienteId,
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    mixer_id: mixers[0].id,
    volumen: 9,
    inicio_carga: hoy,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  return {
    plantelId,
    plantaId,
    planta2Id: planta2.id,
    pedidoId,
    labA: await crearLab("Lab Norte Uno", "Norte"),
    labB: await crearLab("Lab Norte Dos", "Norte"),
    labSur: await crearLab("Lab Sur", "Centro Sur"),
  };
}

beforeEach(async () => {
  await limpiarBD();
  rolActual = "JefeLaboratorio";
  zonaActual = "Norte";
});

describe("instrucciones de muestreo del programa", () => {
  it.each<Rol>(["Administrador", "JefeLaboratorio", "GerenteControlCalidad"])(
    "%s guarda la ubicación y la cantidad de cilindros",
    async (rol) => {
      const s = await escenario();
      rolActual = rol;

      const res = await guardarMuestreoPedidoAction(s.pedidoId, "En obra", 6);
      expect(res.ok, res.mensaje ?? "").toBe(true);

      const p = await prisma.pedidos.findUniqueOrThrow({ where: { id: s.pedidoId } });
      expect(p.muestras_ubicacion).toBe("En obra");
      expect(p.muestras_cantidad).toBe(6);
    },
  );

  it("acepta las dos ubicaciones y rechaza cualquier otra", async () => {
    const s = await escenario();
    expect((await guardarMuestreoPedidoAction(s.pedidoId, "En planta", 3)).ok).toBe(true);
    expect((await guardarMuestreoPedidoAction(s.pedidoId, "En obra", 3)).ok).toBe(true);
    const malo = await guardarMuestreoPedidoAction(s.pedidoId, "En la calle", 3);
    expect(malo.ok).toBe(false);
    expect(malo.mensaje).toContain("Ubicación");
  });

  it("rechaza cantidades no válidas y deja pasar el campo vacío", async () => {
    const s = await escenario();
    expect((await guardarMuestreoPedidoAction(s.pedidoId, "En obra", -1)).ok).toBe(false);
    expect((await guardarMuestreoPedidoAction(s.pedidoId, "En obra", MAX_MUESTRAS + 1)).ok).toBe(false);
    expect((await guardarMuestreoPedidoAction(s.pedidoId, "En obra", 2.5)).ok).toBe(false);
    // Vacío = sin definir (limpia el campo).
    expect((await guardarMuestreoPedidoAction(s.pedidoId, "", null)).ok).toBe(true);
    const p = await prisma.pedidos.findUniqueOrThrow({ where: { id: s.pedidoId } });
    expect(p.muestras_ubicacion).toBeNull();
    expect(p.muestras_cantidad).toBeNull();
  });

  it("el Laboratorista NO puede escribirlas (solo las consulta)", async () => {
    const s = await escenario();
    rolActual = "Laboratorista";
    const res = await guardarMuestreoPedidoAction(s.pedidoId, "En obra", 6);
    expect(res.ok).toBe(false);
  });

  it("un JefeLaboratorio de otra zona no puede tocar el programa", async () => {
    const s = await escenario();
    zonaActual = "Centro Sur"; // el programa es de Norte
    const res = await guardarMuestreoPedidoAction(s.pedidoId, "En obra", 6);
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("otra zona");
  });

  it("el cambio queda en la bitácora", async () => {
    const s = await escenario();
    await guardarMuestreoPedidoAction(s.pedidoId, "En planta", 4);
    const reg = await prisma.bitacora_auditoria.findFirst({
      where: { campo_modificado: "muestreo", registro_id: s.pedidoId },
    });
    expect(reg).not.toBeNull();
    expect(reg!.valor_nuevo).toContain("En planta");
  });

  it("el texto que ve el laboratorista resume la instrucción", () => {
    expect(textoMuestreo("En obra", 6)).toBe("6 cilindros · en obra");
    expect(textoMuestreo("En planta", 1)).toBe("1 cilindro · en planta");
    expect(textoMuestreo(null, null)).toBe("Sin definir");
  });
});

describe("control de calidad a la salida de planta con VARIOS laboratoristas", () => {
  it("asigna dos laboratoristas a la misma planta el mismo día", async () => {
    const s = await escenario();
    const res = await guardarLaboratoristasPlantaAction(
      s.plantaId,
      hoyISO(),
      [s.labA, s.labB],
      "",
    );
    expect(res.ok, res.mensaje ?? "").toBe(true);

    const filas = await prisma.asignaciones_laboratorista_planta.findMany({
      where: { planta_id: s.plantaId },
    });
    expect(filas.map((f) => f.laboratorista_id).sort()).toEqual([s.labA, s.labB].sort());
  });

  it("guarda la observación del turno y la ve cada laboratorista asignado", async () => {
    const s = await escenario();
    await guardarLaboratoristasPlantaAction(
      s.plantaId,
      hoyISO(),
      [s.labA, s.labB],
      "  Revisar revenimiento en cada carga  ",
    );
    const filas = await prisma.asignaciones_laboratorista_planta.findMany({
      where: { planta_id: s.plantaId },
    });
    expect(filas).toHaveLength(2);
    // La misma indicación queda en la fila de cada laboratorista (y sin espacios).
    for (const f of filas) expect(f.observaciones).toBe("Revisar revenimiento en cada carga");
  });

  it("no duplica al mismo laboratorista aunque venga repetido", async () => {
    const s = await escenario();
    await guardarLaboratoristasPlantaAction(s.plantaId, hoyISO(), [s.labA, s.labA], "");
    expect(await prisma.asignaciones_laboratorista_planta.count()).toBe(1);
  });

  it("una lista vacía deja la planta sin laboratoristas", async () => {
    const s = await escenario();
    await guardarLaboratoristasPlantaAction(s.plantaId, hoyISO(), [s.labA], "nota");
    await guardarLaboratoristasPlantaAction(s.plantaId, hoyISO(), [], "");
    expect(await prisma.asignaciones_laboratorista_planta.count()).toBe(0);
  });

  it("dos plantas distintas pueden tener asignaciones el mismo día", async () => {
    const s = await escenario();
    await guardarLaboratoristasPlantaAction(s.plantaId, hoyISO(), [s.labA], "planta 1");
    await guardarLaboratoristasPlantaAction(s.planta2Id, hoyISO(), [s.labB], "planta 2");
    expect(await prisma.asignaciones_laboratorista_planta.count()).toBe(2);
  });

  it("rechaza un laboratorista de otra zona", async () => {
    const s = await escenario();
    const res = await guardarLaboratoristasPlantaAction(s.plantaId, hoyISO(), [s.labSur], "");
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("otra zona");
  });

  it("el Laboratorista no puede asignar el control de salida", async () => {
    const s = await escenario();
    rolActual = "Laboratorista";
    const res = await guardarLaboratoristasPlantaAction(s.plantaId, hoyISO(), [s.labA], "");
    expect(res.ok).toBe(false);
  });
});
