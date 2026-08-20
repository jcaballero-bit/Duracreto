// El Administrador puede CORREGIR el volumen de un viaje que ya salió de planta.
//
// El caso real: el camión se fue y el volumen quedó mal capturado. Para todos los
// demás roles la celda se cierra cuando termina la carga (el dato ya es histórico y
// alimenta los m³ suministrados); el Admin sí puede ajustarlo, con el cambio en la
// bitácora. Se prueba en la server action, no en el motor, porque el privilegio sale
// de la sesión: ocultar el lápiz en la pantalla no sería una restricción real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { agregarViajeManual, avanzarEstadoViaje } from "@/lib/motor/asignacion";
import { SECUENCIA_ESTADOS_VIAJE } from "@/lib/motor/config";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

let rolActual: "Administrador" | "Despachador" = "Despachador";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Usuario Prueba", email: "u1@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  alcanceActual: async () => calcularAlcance([rolActual], "Norte", null, null, []),
  requerirAcceso: async () => calcularAlcance([rolActual], "Norte", null, null, []),
  exigirAdmin: async () => ({ ok: true, userId: "u1" }),
  exigirGestionFlota: async () => ({ ok: true, userId: "u1" }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { editarVolumenAction } = await import("@/app/actions");

/** Un viaje de hoy, avanzado hasta que el camión ya salió de planta. */
async function viajeDespachado(estadoFinal = "Completado") {
  const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Vol", zona: "Norte", esHub: true });
  await crearMixers(plantelId, [[11, 1]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixer = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: plantelId } });
  const hoy = new Date();
  hoy.setHours(8, 0, 0, 0);
  const { viajeId } = await agregarViajeManual({
    cliente_id: clienteId,
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    mixer_id: mixer.id,
    volumen: 9,
    inicio_carga: hoy,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  // Recorre la secuencia real de estados hasta el pedido (no se saltan pasos).
  for (const estado of SECUENCIA_ESTADOS_VIAJE) {
    await avanzarEstadoViaje(viajeId, estado);
    if (estado === estadoFinal) break;
  }
  return viajeId;
}

beforeEach(async () => {
  await limpiarBD();
  rolActual = "Despachador";
});

describe("corregir el volumen de un viaje ya despachado", () => {
  it("el Administrador lo corrige aunque el viaje esté Completado", async () => {
    const viajeId = await viajeDespachado("Completado");
    rolActual = "Administrador";

    const res = await editarVolumenAction(viajeId, 7.5);
    expect(res.ok).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    // La corrección va al volumen REAL; el programado (dato del DPCR-08) no se toca.
    expect(v.volumen_real_m3).toBe(7.5);
    expect(v.volumen_asignado_m3).toBe(9);
    // El estado y las horas reales no se tocan: solo se corrigió el volumen.
    expect(v.estado).toBe("Completado");
    expect(v.ts_inicio_carga_real).not.toBeNull();
  });

  it("la corrección queda en la bitácora, identificada como del Administrador", async () => {
    const viajeId = await viajeDespachado("Completado");
    rolActual = "Administrador";
    await editarVolumenAction(viajeId, 6);

    const reg = await prisma.bitacora_auditoria.findFirstOrThrow({
      where: { tabla_afectada: "viajes", registro_id: viajeId, campo_modificado: "volumen_real_m3" },
      orderBy: { id: "desc" },
    });
    expect(reg.valor_anterior).toBe("9");
    expect(reg.valor_nuevo).toBe("6");
    expect(reg.motivo).toContain("Administrador");
  });

  it("un Despachador NO puede: la carga ya finalizó", async () => {
    const viajeId = await viajeDespachado("En ruta"); // ya salió de planta
    rolActual = "Despachador";

    const res = await editarVolumenAction(viajeId, 7.5);
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("carga ya finalizó");
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.volumen_real_m3).toBeNull();
    expect(v.volumen_asignado_m3).toBe(9);
  });

  it("ni el Administrador puede pasarse de la capacidad física del mixer", async () => {
    const viajeId = await viajeDespachado("Completado");
    rolActual = "Administrador";

    const res = await editarVolumenAction(viajeId, 15); // el mixer es de 11 m³
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("capacidad del mixer");
  });
});
