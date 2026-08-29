// Correccion de la hora REAL: la fecha tiene que ser la del viaje.
//
// El caso que lo motivo: en el programa del 7 de agosto, un viaje mostraba un desvio de
// "-30571 min". Son 21 dias, 5 h y 31 min: la hora real habia quedado guardada en el 17 de
// JULIO. Nadie lo noto antes porque la tarjeta solo muestra la HORA ("11:00 a. m."), no la
// fecha, y el editor es un `datetime-local` donde equivocarse en el segmento del dia o del
// mes es facil — son cajitas de dos digitos por las que se tabula.
//
// La validacion que existia solo revisaba que los hitos quedaran en orden ENTRE SI, asi
// que una fecha de semanas atras pasaba en silencio.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { agregarViajeManual, avanzarEstadoViaje, corregirHoraReal } from "@/lib/motor/asignacion";
import { DIAS_MAX_CORRECCION_HORA_REAL } from "@/lib/motor/config";
import { crearCliente, crearDiseno, crearMixers, crearPlantel, limpiarBD } from "./helpers";

/** Un viaje programado para el 7 de agosto a las 16:30, ya en carga. */
async function viajeDel7DeAgosto() {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Fecha",
    zona: "Norte",
    esHub: true,
  });
  await crearMixers(plantelId, [[11, 1]]);
  const clienteId = await crearCliente(true, 30, 30);
  const disenoId = await crearDiseno();
  const mixer = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: plantelId } });
  const carga = new Date(2026, 7, 7, 16, 30, 0, 0); // 7 de agosto de 2026, 16:30
  const { viajeId } = await agregarViajeManual({
    cliente_id: clienteId,
    diseno_id: disenoId,
    plantel_id: plantelId,
    planta_id: plantaId,
    mixer_id: mixer.id,
    volumen: 9,
    inicio_carga: carga,
    tipo_descarga: "Canal directo",
    creado_por: "test",
  });
  await avanzarEstadoViaje(viajeId, "En carga");
  return { viajeId, carga };
}

beforeEach(async () => {
  await limpiarBD();
});

describe("la hora real corregida debe caer en el dia del viaje", () => {
  it("RECHAZA el caso reportado: viaje del 7 de agosto con la hora real en el 17 de julio", async () => {
    const { viajeId } = await viajeDel7DeAgosto();
    const antes = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });

    const r = await corregirHoraReal(
      viajeId,
      "ts_inicio_carga_real",
      new Date(2026, 6, 17, 11, 0), // 17 de JULIO: el error de captura
      "despachador",
    );

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Revisa la FECHA");
    expect(r.mensaje).toContain("21 dias");
    // Y no se guardo nada.
    const despues = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(despues.ts_inicio_carga_real).toEqual(antes.ts_inicio_carga_real);
  });

  it("ACEPTA una correccion del mismo dia (el uso normal)", async () => {
    const { viajeId } = await viajeDel7DeAgosto();
    const r = await corregirHoraReal(
      viajeId,
      "ts_inicio_carga_real",
      new Date(2026, 7, 7, 16, 45),
      "despachador",
    );
    expect(r.ok, r.mensaje).toBe(true);
    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    expect(v.ts_inicio_carga_real).toEqual(new Date(2026, 7, 7, 16, 45));
  });

  it("ACEPTA el turno que cruza la medianoche (carga 23:00, regresa 04:00 del dia siguiente)", async () => {
    // Es la razon de que la ventana sea de dias y no de horas: un viaje nocturno es
    // normal y no puede quedar bloqueado por la guarda.
    const { plantelId, plantaId } = await crearPlantel({
      nombre: "SM Noche",
      zona: "Norte",
      esHub: true,
    });
    await crearMixers(plantelId, [[11, 1]]);
    const clienteId = await crearCliente(true, 30, 30);
    const disenoId = await crearDiseno();
    const mixer = await prisma.mixers.findFirstOrThrow({ where: { plantel_base_id: plantelId } });
    const { viajeId } = await agregarViajeManual({
      cliente_id: clienteId,
      diseno_id: disenoId,
      plantel_id: plantelId,
      planta_id: plantaId,
      mixer_id: mixer.id,
      volumen: 9,
      inicio_carga: new Date(2026, 7, 7, 23, 0),
      tipo_descarga: "Canal directo",
      creado_por: "test",
    });
    // Se inyecta el reloj: `avanzarEstadoViaje` sella la hora REAL del momento en que se
    // pulsa el boton, y aqui hay que simular que el viaje se despacho esa noche.
    const noche = [
      ["En carga", new Date(2026, 7, 7, 23, 0)],
      ["En ruta", new Date(2026, 7, 7, 23, 25)],
      ["Llegada", new Date(2026, 7, 7, 23, 55)],
      ["Descargando", new Date(2026, 7, 8, 0, 5)],
      ["Regresando", new Date(2026, 7, 8, 0, 40)],
    ] as const;
    for (const [e, t] of noche) await avanzarEstadoViaje(viajeId, e, t);
    // El regreso, de madrugada del dia siguiente.
    const r = await corregirHoraReal(
      viajeId,
      "ts_regreso_real",
      new Date(2026, 7, 8, 4, 0),
      "despachador",
    );
    expect(r.ok, r.mensaje).toBe(true);
  });

  it("acepta hasta el limite de la ventana y rechaza pasado ese punto", async () => {
    const { viajeId, carga } = await viajeDel7DeAgosto();
    const dia = 86400000;

    // Justo dentro de la ventana.
    const dentro = new Date(carga.getTime() + DIAS_MAX_CORRECCION_HORA_REAL * dia - 60000);
    expect((await corregirHoraReal(viajeId, "ts_inicio_carga_real", dentro, "u")).ok).toBe(true);

    // Un minuto mas alla.
    const fuera = new Date(carga.getTime() + DIAS_MAX_CORRECCION_HORA_REAL * dia + 60000);
    const r = await corregirHoraReal(viajeId, "ts_inicio_carga_real", fuera, "u");
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Revisa la FECHA");
  });

  it("tambien atrapa el error hacia ADELANTE (mes equivocado)", async () => {
    const { viajeId } = await viajeDel7DeAgosto();
    const r = await corregirHoraReal(
      viajeId,
      "ts_inicio_carga_real",
      new Date(2026, 8, 7, 16, 30), // septiembre en vez de agosto
      "despachador",
    );
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("31 dias");
  });

  it("la validacion de ORDEN sigue vigente (no la reemplaza la de fecha)", async () => {
    const { viajeId, carga } = await viajeDel7DeAgosto();
    // Se sella la salida a las 16:50 del mismo dia.
    await avanzarEstadoViaje(viajeId, "En ruta", new Date(2026, 7, 7, 16, 50));

    // Ahora se intenta poner el INICIO de carga despues de la salida: misma fecha (pasa
    // la guarda nueva) pero rompe el orden de los hitos.
    const r = await corregirHoraReal(
      viajeId,
      "ts_inicio_carga_real",
      new Date(2026, 7, 7, 18, 0),
      "despachador",
    );
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("orden lógico");
    expect(carga.getDate()).toBe(7); // el viaje es del 7, no hubo problema de fecha
  });

  it("documenta el ORIGEN mas probable del caso reportado", async () => {
    // `avanzarEstadoViaje` sella el reloj REAL del momento en que se pulsa el boton. Si
    // alguien abre un programa de otra fecha y avanza los estados —cosa que el
    // Administrador puede hacer en cualquier dia—, los `ts_*_real` quedan en el dia en
    // que se pulso, no en el del viaje. Es el comportamiento correcto (registra cuando
    // paso de verdad), pero produce el desvio enorme del reporte.
    const { viajeId } = await viajeDel7DeAgosto();
    await avanzarEstadoViaje(viajeId, "En ruta", new Date(2026, 6, 17, 11, 20)); // 17 de julio

    const v = await prisma.viajes.findUniqueOrThrow({ where: { id: viajeId } });
    const desvio = Math.round(
      (v.ts_salida_real!.getTime() - v.hora_salida_planta!.getTime()) / 60000,
    );
    // Un numero del mismo orden que el "-30571 min" que se vio en pantalla.
    expect(Math.abs(desvio)).toBeGreaterThan(20 * 1440);
    // Lo que cambia es que ahora la pantalla lo muestra en DIAS y con la fecha, en vez de
    // esconderlo detras de un conteo de minutos.
    expect(v.ts_salida_real!.getMonth()).not.toBe(v.hora_salida_planta!.getMonth());
  });
});
