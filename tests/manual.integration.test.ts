// Modo MANUAL: el motor NO reprograma nada. Estas pruebas cubren los escenarios
// críticos del Paso final: (a) insertar un viaje en medio de la cola de otro cliente
// NO cambia la hora de ningún viaje existente; (b) asignar el mismo mixer a 2 viajes
// que se traslapan se GUARDA igual (la validación avisa, no bloquea).
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { agregarViajeManual, editarViajeManual } from "@/lib/motor/asignacion";
import { detectarTraslapesMixer, type ViajeManual } from "@/lib/motor/validacion-manual";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

beforeEach(async () => {
  await limpiarBD();
});

async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Manual", zona: "Norte", esHub: true });
  await crearMixers(plantelId, [[11, 4]]);
  const clienteA = await crearCliente(true, 30, 30);
  const clienteB = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixers = await prisma.mixers.findMany({ where: { plantel_base_id: plantelId }, orderBy: { id: "asc" } });
  return { plantelId, plantaId, clienteA, clienteB, disenoId, mixers };
}

function d(hhmm: string): Date {
  return new Date(`2026-08-10T${hhmm}:00`);
}

describe("modo manual — no reprograma nada", () => {
  it("(a) insertar un viaje de otro cliente EN MEDIO no cambia la hora de los existentes", async () => {
    const s = await escenario();
    const base = {
      diseno_id: s.disenoId,
      plantel_id: s.plantelId,
      planta_id: s.plantaId,
      volumen: 11,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };
    // Cliente A: dos viajes (08:00 y 09:00) en el mismo pedido.
    const a1 = await agregarViajeManual({ ...base, cliente_id: s.clienteA, mixer_id: s.mixers[0].id, inicio_carga: d("08:00") });
    const a2 = await agregarViajeManual({ ...base, cliente_id: s.clienteA, mixer_id: s.mixers[1].id, inicio_carga: d("09:00") });

    const a1Antes = await prisma.viajes.findUniqueOrThrow({ where: { id: a1.viajeId } });
    const a2Antes = await prisma.viajes.findUniqueOrThrow({ where: { id: a2.viajeId } });

    // Insertar cliente B EN MEDIO (08:30).
    const b = await agregarViajeManual({ ...base, cliente_id: s.clienteB, mixer_id: s.mixers[2].id, inicio_carga: d("08:30") });

    const a1Despues = await prisma.viajes.findUniqueOrThrow({ where: { id: a1.viajeId } });
    const a2Despues = await prisma.viajes.findUniqueOrThrow({ where: { id: a2.viajeId } });
    const bViaje = await prisma.viajes.findUniqueOrThrow({ where: { id: b.viajeId } });

    // Ningún viaje existente cambió de hora de carga.
    expect(a1Despues.hora_inicio_carga!.getTime()).toBe(a1Antes.hora_inicio_carga!.getTime());
    expect(a2Despues.hora_inicio_carga!.getTime()).toBe(a2Antes.hora_inicio_carga!.getTime());
    // El nuevo quedó exactamente donde se pidió (08:30), sin empujar a nadie.
    expect(bViaje.hora_inicio_carga!.getTime()).toBe(d("08:30").getTime());
    // A1 y A2 son del mismo pedido; B es de otro (cliente distinto).
    expect(a1Antes.pedido_id).toBe(a2Antes.pedido_id);
    expect(bViaje.pedido_id).not.toBe(a1Antes.pedido_id);
  });

  it("(b) el MISMO mixer en 2 viajes que se traslapan se guarda; la validación lo detecta", async () => {
    const s = await escenario();
    const base = {
      diseno_id: s.disenoId,
      plantel_id: s.plantelId,
      planta_id: s.plantaId,
      volumen: 11,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };
    const mismoMixer = s.mixers[0].id;
    // Dos viajes con el MISMO mixer que se enciman en el tiempo (08:00 y 08:30; el
    // ciclo de un viaje dura ~96 min, así que 08:30 cae dentro del ciclo del de 08:00).
    const v1 = await agregarViajeManual({ ...base, cliente_id: s.clienteA, mixer_id: mismoMixer, inicio_carga: d("08:00") });
    const v2 = await agregarViajeManual({ ...base, cliente_id: s.clienteB, mixer_id: mismoMixer, inicio_carga: d("08:30") });

    // Ambos se guardaron (no lanzó, ambos tienen el mismo mixer asignado).
    const g1 = await prisma.viajes.findUniqueOrThrow({ where: { id: v1.viajeId } });
    const g2 = await prisma.viajes.findUniqueOrThrow({ where: { id: v2.viajeId } });
    expect(g1.mixer_id).toBe(mismoMixer);
    expect(g2.mixer_id).toBe(mismoMixer);

    // La validación (que solo avisa) detecta el traslape.
    const viajes: ViajeManual[] = [g1, g2].map((v) => ({
      id: v.id,
      plantaId: v.planta_id!,
      clienteId: 0,
      mixerId: v.mixer_id,
      volumen: v.volumen_asignado_m3,
      inicioCargaMs: v.hora_inicio_carga!.getTime(),
      finCargaMs: v.hora_fin_carga!.getTime(),
      llegadaMs: v.hora_llegada_proyecto!.getTime(),
      regresoMs: v.hora_regreso_planta!.getTime(),
    }));
    const conf = detectarTraslapesMixer(viajes);
    expect(conf.length).toBe(1);
    expect(conf[0].mixerId).toBe(mismoMixer);
  });

  it("editar la hora de un viaje a mano solo mueve ESE viaje", async () => {
    const s = await escenario();
    const base = {
      diseno_id: s.disenoId,
      plantel_id: s.plantelId,
      planta_id: s.plantaId,
      volumen: 11,
      tipo_descarga: "Canal directo",
      creado_por: "test",
    };
    const a1 = await agregarViajeManual({ ...base, cliente_id: s.clienteA, mixer_id: s.mixers[0].id, inicio_carga: d("08:00") });
    const a2 = await agregarViajeManual({ ...base, cliente_id: s.clienteA, mixer_id: s.mixers[1].id, inicio_carga: d("09:00") });

    const res = await editarViajeManual(a1.viajeId, { inicio_carga: d("10:15"), creado_por: "test" });
    expect(res.ok).toBe(true);

    const g1 = await prisma.viajes.findUniqueOrThrow({ where: { id: a1.viajeId } });
    const g2 = await prisma.viajes.findUniqueOrThrow({ where: { id: a2.viajeId } });
    expect(g1.hora_inicio_carga!.getTime()).toBe(d("10:15").getTime()); // se movió el editado
    expect(g2.hora_inicio_carga!.getTime()).toBe(d("09:00").getTime()); // el otro, intacto
  });
});
