// La hora de LLEGADA que se teclea en la programación manual debe QUEDAR guardada, la
// pongan el Administrador, el Programador o el Jefe de Planta, y en CUALQUIERA de las
// plantas del plantel. Se prueba a través de la server action real (con la sesión
// simulada), que es el camino que usa la pantalla.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { agregarViajeManual } from "@/lib/motor/asignacion";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

type Rol = "Administrador" | "Programador" | "JefePlanta" | "Laboratorista";
let rolActual: Rol = "Administrador";
let plantelDelJefe: number[] = [];

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Usuario Prueba", email: "u1@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rolActual], "Norte", null, null, plantelDelJefe),
  requerirAcceso: async () => calcularAlcance([rolActual], "Norte", null, null, plantelDelJefe),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
  exigirGestionFlota: async () => ({ ok: true, userId: "u1" }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { ajustarLlegadaManualAction } = await import("@/app/actions");

/** Hoy a la hora indicada (los roles no-Admin solo operan de hoy en adelante). */
function hoyA(h: number, m: number): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
const hhmm = (f: Date | null) =>
  f ? `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}` : "—";
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Plantel con DOS plantas (como Santa Marta o Tegucigalpa). */
async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Roles",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  const planta2 = await prisma.plantas.create({
    data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 28, tiempo_alistamiento_min: 5 },
  });
  await crearMixers(plantelId, [[11, 4]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixers = await prisma.mixers.findMany({
    where: { plantel_base_id: plantelId },
    orderBy: { id: "asc" },
  });
  plantelDelJefe = [plantelId]; // el Jefe de Planta tiene ESTE plantel asignado

  const viajeEn = async (plantaDestino: number, hora: Date, idx: number) =>
    (
      await agregarViajeManual({
        cliente_id: clienteId,
        diseno_id: disenoId,
        plantel_id: plantelId,
        planta_id: plantaDestino,
        mixer_id: mixers[idx].id,
        volumen: 9,
        inicio_carga: hora,
        tipo_descarga: "Canal directo",
        creado_por: "test",
      })
    ).viajeId;

  return {
    plantelId,
    stalo: plantaId,
    sany: planta2.id,
    enStalo: await viajeEn(plantaId, hoyA(7, 0), 0),
    enSany: await viajeEn(planta2.id, hoyA(8, 0), 1),
  };
}

const llegadaDe = async (id: number) =>
  hhmm((await prisma.viajes.findUniqueOrThrow({ where: { id } })).hora_llegada_proyecto);

beforeEach(async () => {
  await limpiarBD();
  await prisma.configuracion.deleteMany({}); // sin bloqueo horario activo
  rolActual = "Administrador";
  plantelDelJefe = [];
});

describe("la hora de llegada que se teclea se MANTIENE", () => {
  it.each<Rol>(["Administrador", "Programador", "JefePlanta"])(
    "%s la fija y queda guardada, en las DOS plantas del plantel",
    async (rol) => {
      const s = await escenario();
      rolActual = rol;

      // Planta 1 (STALO)
      const r1 = await ajustarLlegadaManualAction(s.enStalo, localInput(hoyA(11, 30)));
      expect(r1.ok, `${rol} en STALO: ${r1.mensaje ?? ""}`).toBe(true);
      expect(await llegadaDe(s.enStalo)).toBe("11:30");

      // Planta 2 (SANY) — mismo resultado, sin importar la planta.
      const r2 = await ajustarLlegadaManualAction(s.enSany, localInput(hoyA(14, 45)));
      expect(r2.ok, `${rol} en SANY: ${r2.mensaje ?? ""}`).toBe(true);
      expect(await llegadaDe(s.enSany)).toBe("14:45");
    },
  );

  it("la hora se conserva al volver a consultarla (no la revierte nada)", async () => {
    const s = await escenario();
    rolActual = "Programador";
    await ajustarLlegadaManualAction(s.enStalo, localInput(hoyA(13, 0)));
    expect(await llegadaDe(s.enStalo)).toBe("13:00");
    // Segunda lectura, sin ninguna otra acción de por medio.
    expect(await llegadaDe(s.enStalo)).toBe("13:00");
    // Y la carga quedó calculada hacia atrás (antes de la llegada).
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: s.enStalo } });
    expect(v.hora_inicio_carga!.getTime()).toBeLessThan(v.hora_llegada_proyecto!.getTime());
  });

  it("un rol sin permiso de programación no puede fijarla", async () => {
    const s = await escenario();
    rolActual = "Laboratorista";
    const r = await ajustarLlegadaManualAction(s.enStalo, localInput(hoyA(13, 0)));
    expect(r.ok).toBe(false);
  });
});
