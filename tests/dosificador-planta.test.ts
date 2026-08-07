// Planta efectiva del Dosificador: predeterminada + reasignación por día.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolverPlantaDosificador } from "@/lib/dosificador/planta";
import { limpiarBD } from "./helpers";

const EMAIL = "dosi.test@duracreto.test";

async function crearEscenario() {
  const plantel = await prisma.planteles.create({
    data: {
      nombre: "Santa Marta Test",
      zona: "Norte",
      capacidad_dosificacion_m3h: 45,
      plantas: {
        create: [
          { nombre: "STALO", capacidad_m3h: 45 },
          { nombre: "SANY", capacidad_m3h: 50 },
        ],
      },
    },
    include: { plantas: true },
  });
  const stalo = plantel.plantas.find((p) => p.nombre === "STALO")!;
  const sany = plantel.plantas.find((p) => p.nombre === "SANY")!;
  const dosi = await prisma.user.create({
    data: {
      name: "Dosi Test",
      email: EMAIL,
      activo: true,
      planta_predeterminada_id: stalo.id,
      plantel_asignado_id: plantel.id,
      roles: { create: [{ rol: "Dosificador" }] },
    },
  });
  return { plantel, stalo, sany, dosi };
}

function medianoche(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

describe("resolverPlantaDosificador (planta efectiva del día)", () => {
  beforeEach(async () => {
    await limpiarBD();
    await prisma.reasignaciones_dosificador_planta.deleteMany();
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  });

  it("sin reasignación → planta PREDETERMINADA (STALO)", async () => {
    const { stalo, dosi, plantel } = await crearEscenario();
    const r = await resolverPlantaDosificador(dosi.id, stalo.id, new Date());
    expect(r.plantaId).toBe(stalo.id);
    expect(r.plantelId).toBe(plantel.id);
    expect(r.zona).toBe("Norte");
  });

  it("con reasignación de HOY → esa planta (SANY)", async () => {
    const { stalo, sany, dosi } = await crearEscenario();
    const hoy = new Date();
    await prisma.reasignaciones_dosificador_planta.create({
      data: { dosificador_id: dosi.id, planta_id: sany.id, fecha: medianoche(hoy), creado_por: "jefe" },
    });
    const r = await resolverPlantaDosificador(dosi.id, stalo.id, hoy);
    expect(r.plantaId).toBe(sany.id);
  });

  it("al día SIGUIENTE (sin reasignación esa fecha) vuelve automáticamente a STALO", async () => {
    const { stalo, sany, dosi } = await crearEscenario();
    const hoy = new Date();
    const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
    // Reasignación SOLO para hoy.
    await prisma.reasignaciones_dosificador_planta.create({
      data: { dosificador_id: dosi.id, planta_id: sany.id, fecha: medianoche(hoy), creado_por: "jefe" },
    });
    expect((await resolverPlantaDosificador(dosi.id, stalo.id, hoy)).plantaId).toBe(sany.id);
    // Mañana no tiene reasignación → predeterminada.
    expect((await resolverPlantaDosificador(dosi.id, stalo.id, manana)).plantaId).toBe(stalo.id);
  });

  it("upsert por (dosificador, fecha) NO acumula: la nueva reemplaza a la anterior", async () => {
    const { stalo, sany, dosi } = await crearEscenario();
    const dia = medianoche(new Date());
    const clave = { dosificador_id_fecha: { dosificador_id: dosi.id, fecha: dia } };
    await prisma.reasignaciones_dosificador_planta.upsert({
      where: clave,
      update: { planta_id: sany.id, creado_por: "jefe" },
      create: { dosificador_id: dosi.id, planta_id: sany.id, fecha: dia, creado_por: "jefe" },
    });
    await prisma.reasignaciones_dosificador_planta.upsert({
      where: clave,
      update: { planta_id: stalo.id, creado_por: "programador" },
      create: { dosificador_id: dosi.id, planta_id: stalo.id, fecha: dia, creado_por: "programador" },
    });
    const count = await prisma.reasignaciones_dosificador_planta.count({
      where: { dosificador_id: dosi.id },
    });
    expect(count).toBe(1);
    expect((await resolverPlantaDosificador(dosi.id, sany.id, new Date())).plantaId).toBe(stalo.id);
  });
});
