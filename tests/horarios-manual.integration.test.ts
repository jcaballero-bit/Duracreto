// Integración del ajuste de horarios del modo manual contra la BD. Cubre los
// escenarios del Paso final: (a) recálculo de la cadena desde la llegada, (b) reajuste
// de la cola del cliente por frecuencia sin tocar a otros clientes, (c) carga
// simultánea con la MISMA hora de inicio en las 2 plantas, (d) aviso —sin bloquear—
// cuando la carga caería antes de la apertura, y (e) apertura excepcional de un día.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { agregarViajeManual } from "@/lib/motor/asignacion";
import { ajustarLlegadaManual } from "@/lib/motor/manual-horarios";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

beforeEach(async () => {
  await limpiarBD();
});

const DIA = "2026-08-14";
const d = (hhmm: string) => new Date(`${DIA}T${hhmm}:00`);
const hhmm = (fecha: Date | null) => {
  if (!fecha) return "—";
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
};

/** Plantel con 2 plantas (como Santa Marta), mixers y un par de clientes. */
async function escenario() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Horarios",
    zona: "Norte",
    esHub: true,
    capacidadPlantaM3h: 45,
  });
  // Segunda planta del mismo plantel (para la carga simultánea).
  const planta2 = await prisma.plantas.create({
    data: { plantel_id: plantelId, nombre: "SANY", capacidad_m3h: 45, tiempo_alistamiento_min: 5 },
  });
  await crearMixers(plantelId, [[11, 8]]);
  const clienteA = await crearCliente(true, 30, 30);
  const clienteB = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixers = await prisma.mixers.findMany({
    where: { plantel_base_id: plantelId },
    orderBy: { id: "asc" },
  });
  return { plantelId, plantaId, planta2Id: planta2.id, clienteA, clienteB, disenoId, mixers };
}

type Esc = Awaited<ReturnType<typeof escenario>>;

/** Crea N viajes de un cliente en una planta, cargando cada `pasoMin`. */
async function crearViajes(
  s: Esc,
  clienteId: number,
  plantaId: number,
  horas: string[],
  desdeMixer = 0,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < horas.length; i++) {
    const { viajeId } = await agregarViajeManual({
      cliente_id: clienteId,
      diseno_id: s.disenoId,
      plantel_id: s.plantelId,
      planta_id: plantaId,
      mixer_id: s.mixers[(desdeMixer + i) % s.mixers.length].id,
      volumen: 9,
      inicio_carga: d(horas[i]),
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    ids.push(viajeId);
  }
  return ids;
}

const viajeDe = (id: number) =>
  prisma.viajes.findUniqueOrThrow({
    where: { id },
    select: {
      hora_inicio_carga: true,
      hora_fin_carga: true,
      hora_salida_planta: true,
      hora_llegada_proyecto: true,
      hora_inicio_descarga: true,
      hora_fin_descarga: true,
      hora_regreso_planta: true,
      pedido_id: true,
    },
  });

describe("ajuste de horarios en modo manual", () => {
  it("(a) al fijar la LLEGADA recalcula la cadena hacia atrás y hacia adelante", async () => {
    const s = await escenario();
    const [id] = await crearViajes(s, s.clienteA, s.plantaId, ["06:00"]);

    const res = await ajustarLlegadaManual(id, d("08:00"));
    expect(res.ok).toBe(true);

    const v = await viajeDe(id);
    // Llegada exacta a la hora comprometida.
    expect(hhmm(v.hora_llegada_proyecto)).toBe("08:00");
    // Hacia atrás: 30 min de transporte + 12 de dosificación (9 m³ a 45 m³/h) + 5 de
    // alistamiento → carga a las 07:13, salida a las 07:30.
    expect(hhmm(v.hora_salida_planta)).toBe("07:30");
    expect(hhmm(v.hora_fin_carga)).toBe("07:30");
    expect(hhmm(v.hora_inicio_carga)).toBe("07:13");
    // Hacia adelante: descarga al llegar y regreso 30 min después de terminarla.
    expect(hhmm(v.hora_inicio_descarga)).toBe("08:00");
    expect(v.hora_regreso_planta!.getTime() - v.hora_fin_descarga!.getTime()).toBe(30 * 60_000);
  });

  it("(b) reacomoda los demás viajes DE ESE cliente por frecuencia, sin mover a otros", async () => {
    const s = await escenario();
    const ids = await crearViajes(s, s.clienteA, s.plantaId, ["06:00", "06:30", "07:00", "07:30", "08:00"]);
    // Otro cliente en la misma planta: no se debe mover.
    const [idB] = await crearViajes(s, s.clienteB, s.plantaId, ["10:00"], 5);
    const antesB = await viajeDe(idB);

    await prisma.pedidos.updateMany({
      where: { cliente_id: s.clienteA },
      data: { frecuencia_entre_camiones_min: 15 },
    });

    const res = await ajustarLlegadaManual(ids[0], d("08:00"));
    expect(res.ok).toBe(true);
    expect(res.movidos).toBe(5);

    const llegadas: string[] = [];
    for (const id of ids) llegadas.push(hhmm((await viajeDe(id)).hora_llegada_proyecto));
    expect(llegadas).toEqual(["08:00", "08:15", "08:30", "08:45", "09:00"]);

    // El viaje del otro cliente quedó intacto.
    const despuesB = await viajeDe(idB);
    expect(despuesB.hora_inicio_carga!.getTime()).toBe(antesB.hora_inicio_carga!.getTime());
    expect(despuesB.hora_llegada_proyecto!.getTime()).toBe(antesB.hora_llegada_proyecto!.getTime());
  });

  it("(b bis) respeta un viaje con hora fija y lo reporta", async () => {
    const s = await escenario();
    const ids = await crearViajes(s, s.clienteA, s.plantaId, ["06:00", "06:30", "07:00"]);
    await prisma.pedidos.updateMany({
      where: { cliente_id: s.clienteA },
      data: { frecuencia_entre_camiones_min: 15 },
    });
    // El segundo viaje queda clavado a su hora.
    await prisma.viajes.update({ where: { id: ids[1] }, data: { hora_fija: true } });
    const antes = await viajeDe(ids[1]);

    const res = await ajustarLlegadaManual(ids[0], d("08:00"));
    expect(res.ok).toBe(true);
    expect(res.avisos.some((a) => a.includes("hora fija"))).toBe(true);

    const fijo = await viajeDe(ids[1]);
    expect(fijo.hora_llegada_proyecto!.getTime()).toBe(antes.hora_llegada_proyecto!.getTime());
  });

  it("(c) con carga simultánea, el primer viaje de cada planta arranca a la MISMA hora", async () => {
    const s = await escenario();
    const enStalo = await crearViajes(s, s.clienteA, s.plantaId, ["06:00", "06:40"]);
    const enSany = await crearViajes(s, s.clienteA, s.planta2Id, ["09:00", "09:40"], 4);

    // Mismo pedido (mismo cliente/plantel/diseño/día) con carga simultánea.
    const pedidoId = (await viajeDe(enStalo[0])).pedido_id;
    expect((await viajeDe(enSany[0])).pedido_id).toBe(pedidoId);
    await prisma.pedidos.update({
      where: { id: pedidoId },
      data: { carga_simultanea: true, frecuencia_entre_camiones_min: 20 },
    });

    const res = await ajustarLlegadaManual(enStalo[0], d("08:00"));
    expect(res.ok).toBe(true);

    const a = await viajeDe(enStalo[0]);
    const b = await viajeDe(enSany[0]);
    // Las dos plantas empiezan a cargar exactamente a la vez.
    expect(b.hora_inicio_carga!.getTime()).toBe(a.hora_inicio_carga!.getTime());
  });

  it("(d) avisa —sin bloquear— si la carga caería antes de la apertura (7:00)", async () => {
    const s = await escenario();
    const [id] = await crearViajes(s, s.clienteA, s.plantaId, ["09:00"]);

    // Llegar a las 07:30 obliga a cargar a las 06:43, antes de la apertura.
    const res = await ajustarLlegadaManual(id, d("07:30"));
    expect(res.ok).toBe(true); // NO bloquea
    const aviso = res.avisos.find((a) => a.includes("apertura"));
    expect(aviso).toBeDefined();
    expect(aviso).toContain("07:00");
    // Y el cambio SÍ se guardó tal como lo pidió el usuario.
    expect(hhmm((await viajeDe(id)).hora_llegada_proyecto)).toBe("07:30");
  });

  it("(e) con apertura excepcional a las 5:00 ese día/planta ya no avisa", async () => {
    const s = await escenario();
    const [id] = await crearViajes(s, s.clienteA, s.plantaId, ["09:00"]);
    await prisma.aperturas_planta.create({
      data: {
        planta_id: s.plantaId,
        fecha: new Date(`${DIA}T00:00:00`),
        hora_apertura_min: 5 * 60,
        creado_por: "test",
      },
    });

    const res = await ajustarLlegadaManual(id, d("07:30"));
    expect(res.ok).toBe(true);
    expect(res.avisos.some((a) => a.includes("apertura"))).toBe(false);

    // La excepción es de ESE día: otra fecha sigue con la apertura por defecto.
    const otroDia = await prisma.aperturas_planta.findFirst({
      where: { planta_id: s.plantaId, fecha: new Date("2026-08-15T00:00:00") },
    });
    expect(otroDia).toBeNull();
  });

  it("no permite mover un viaje que ya inició carga", async () => {
    const s = await escenario();
    const [id] = await crearViajes(s, s.clienteA, s.plantaId, ["07:30"]);
    await prisma.viajes.update({ where: { id }, data: { ts_inicio_carga_real: d("07:31") } });

    const res = await ajustarLlegadaManual(id, d("10:00"));
    expect(res.ok).toBe(false);
    expect(res.mensaje).toContain("ya inició");
  });
});

describe("caso reportado: fijar la llegada de un cliente y que QUEDE", () => {
  it("fija 1:00 p.m. en un viaje del medio y el resto del cliente se recorre con su cadencia", async () => {
    const s = await escenario();
    // Cola parecida a la reportada: llegadas cada 25 min (12:30, 12:55, 13:20) SIN
    // frecuencia declarada en el pedido — antes esto dejaba los otros viajes quietos.
    const ids = await crearViajes(s, s.clienteA, s.plantaId, ["11:28", "11:53", "12:18"]);
    const antes: string[] = [];
    for (const id of ids) antes.push(hhmm((await viajeDe(id)).hora_llegada_proyecto));
    // Con 9 m³ a 45 m³/h + 5 de alistamiento + 30 de transporte, cargar a las 11:28
    // llega 12:15. Lo que importa es la CADENCIA de 25 min entre llegadas.
    expect(antes).toEqual(["12:15", "12:40", "13:05"]);

    const pedidoId = (await viajeDe(ids[0])).pedido_id;
    const pedido = await prisma.pedidos.findUniqueOrThrow({ where: { id: pedidoId } });
    expect(pedido.frecuencia_entre_camiones_min).toBeNull(); // sin frecuencia declarada

    // El usuario pone el primero a la 1:00 p.m.
    const res = await ajustarLlegadaManual(ids[0], d("13:00"));
    expect(res.ok).toBe(true);

    const despues: string[] = [];
    for (const id of ids) despues.push(hhmm((await viajeDe(id)).hora_llegada_proyecto));
    // Queda a la 1:00 p.m. (no vuelve a 12:30) y la cola conserva su ritmo de 25 min.
    expect(despues).toEqual(["13:00", "13:25", "13:50"]);
  });

  it("avisa si la nueva carga se encima con la de OTRO cliente en la misma planta", async () => {
    const s = await escenario();
    const [idA] = await crearViajes(s, s.clienteA, s.plantaId, ["09:00"]);
    // Otro cliente cargando a las 11:00 en la misma planta.
    await crearViajes(s, s.clienteB, s.plantaId, ["11:00"], 1);

    // Llegar a las 12:00 obliga a cargar ~11:13 → se encima con el cliente B.
    const res = await ajustarLlegadaManual(idA, d("12:00"));
    expect(res.ok).toBe(true);
    expect(res.avisos.some((a) => a.includes("se encima con la de"))).toBe(true);
  });

  it("avisa si el mixer queda en el suministro de otro cliente a la misma hora", async () => {
    const s = await escenario();
    const [idA] = await crearViajes(s, s.clienteA, s.plantaId, ["09:00"]);
    // Cliente B usando EL MISMO mixer (índice 0) a media mañana.
    const [idB] = await crearViajes(s, s.clienteB, s.plantaId, ["10:30"], 0);
    expect((await prisma.viajes.findUniqueOrThrow({ where: { id: idB } })).mixer_id).toBe(
      (await prisma.viajes.findUniqueOrThrow({ where: { id: idA } })).mixer_id,
    );

    const res = await ajustarLlegadaManual(idA, d("11:30"));
    expect(res.ok).toBe(true);
    expect(res.avisos.some((a) => a.includes("ya está en el suministro de"))).toBe(true);
  });
});
