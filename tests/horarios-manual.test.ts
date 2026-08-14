// Pruebas PURAS de los ajustes de horario del modo manual:
//  · el cálculo hacia atrás desde la hora de LLEGADA es el inverso exacto del cálculo
//    hacia adelante desde la hora de carga;
//  · el reajuste de la cola de un cliente por frecuencia respeta los viajes con hora
//    fija y los que ya iniciaron;
//  · el bloqueo horario de edición aplica a quien debe y nunca al Administrador.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inicioCargaDesdeLlegada,
  minutosCargaALlegada,
  tiemposDeViaje,
  tiemposDesdeLlegada,
  type ParamsTiempoViaje,
} from "@/lib/motor/tiempos";
import { planificarReajusteCliente, type ViajeReajuste } from "@/lib/motor/reajuste-cliente";
import { bloqueaEdicionPrograma, type ConfigBloqueo } from "@/lib/programacion/bloqueo";
import { minutosDeTexto, textoHoraMin } from "@/lib/motor/apertura";

const PARAMS: ParamsTiempoViaje = {
  alistamientoMin: 5,
  capacidadPlantaM3h: 45,
  volumen: 9,
  tViajeMin: 30,
  tRegresoMin: 30,
  tipoDescarga: "Canal directo",
};

const hora = (hhmm: string) => new Date(`2026-08-14T${hhmm}:00`).getTime();
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

describe("cálculo desde la hora de LLEGADA (punto 1)", () => {
  it("es el inverso exacto del cálculo desde la hora de carga", () => {
    const inicio = hora("06:00");
    const llegada = tiemposDeViaje(inicio, PARAMS).llegadaMs;
    expect(inicioCargaDesdeLlegada(llegada, PARAMS)).toBe(inicio);
  });

  it("descuenta alistamiento + dosificación + transporte para llegar a la hora pedida", () => {
    // 5 de alistamiento + 9 m³ a 45 m³/h (12 min) + 30 de transporte = 47 min.
    expect(minutosCargaALlegada(PARAMS)).toBe(47);
    const t = tiemposDesdeLlegada(hora("08:00"), PARAMS);
    expect(hhmm(t.llegadaMs)).toBe("08:00");
    expect(hhmm(t.inicioCargaMs)).toBe("07:13");
    expect(hhmm(t.salidaMs)).toBe("07:30");
  });

  it("calcula hacia adelante la descarga y el regreso desde esa misma llegada", () => {
    const t = tiemposDesdeLlegada(hora("08:00"), PARAMS);
    expect(hhmm(t.inicioDescargaMs)).toBe("08:00");
    // 9 m³ por canaleta a 1.5 min/m³ = 13.5 min → 08:13 (redondeo al minuto en pantalla).
    expect(t.finDescargaMs - t.inicioDescargaMs).toBe(13.5 * 60_000);
    // Regreso = fin de descarga + 30 min de transporte.
    expect(t.regresoMs - t.finDescargaMs).toBe(30 * 60_000);
  });

  it("un volumen mayor obliga a cargar más temprano para la misma llegada", () => {
    const chico = tiemposDesdeLlegada(hora("08:00"), PARAMS);
    const grande = tiemposDesdeLlegada(hora("08:00"), { ...PARAMS, volumen: 18 });
    expect(grande.inicioCargaMs).toBeLessThan(chico.inicioCargaMs);
    expect(hhmm(grande.llegadaMs)).toBe("08:00");
  });
});

describe("reajuste de la cola del cliente por frecuencia (punto 2)", () => {
  const viaje = (id: number, hhmmStr: string, extra: Partial<ViajeReajuste> = {}): ViajeReajuste => ({
    id,
    llegadaMs: hora(hhmmStr),
    horaFija: false,
    yaInicio: false,
    ...extra,
  });

  it("5 viajes con frecuencia 15 quedan a 8:00, 8:15, 8:30, 8:45 y 9:00", () => {
    const viajes = [
      viaje(1, "09:00"),
      viaje(2, "09:20"),
      viaje(3, "09:40"),
      viaje(4, "10:00"),
      viaje(5, "10:20"),
    ];
    const plan = planificarReajusteCliente(viajes, 1, hora("08:00"), 15);
    expect(plan.cambios.map((c) => hhmm(c.llegadaMs))).toEqual([
      "08:00",
      "08:15",
      "08:30",
      "08:45",
      "09:00",
    ]);
    expect(plan.saltados).toHaveLength(0);
  });

  it("no mueve un viaje con hora fija, y el siguiente se encadena a la hora real de ese", () => {
    const viajes = [viaje(1, "09:00"), viaje(2, "09:20", { horaFija: true }), viaje(3, "09:40")];
    const plan = planificarReajusteCliente(viajes, 1, hora("08:00"), 15);
    expect(plan.cambios.map((c) => c.id)).toEqual([1, 3]);
    expect(plan.saltados).toEqual([{ id: 2, motivo: "hora_fija" }]);
    // El viaje 3 sigue al 2 (que quedó a las 09:20), no al 1.
    expect(hhmm(plan.cambios[1].llegadaMs)).toBe("09:35");
  });

  it("no mueve un viaje que ya inició", () => {
    const viajes = [viaje(1, "09:00"), viaje(2, "09:20", { yaInicio: true })];
    const plan = planificarReajusteCliente(viajes, 1, hora("08:00"), 15);
    expect(plan.cambios.map((c) => c.id)).toEqual([1]);
    expect(plan.saltados).toEqual([{ id: 2, motivo: "ya_inicio" }]);
  });

  it("sin frecuencia definida solo se mueve el viaje editado", () => {
    const viajes = [viaje(1, "09:00"), viaje(2, "09:20"), viaje(3, "09:40")];
    for (const f of [null, 0]) {
      const plan = planificarReajusteCliente(viajes, 1, hora("08:00"), f);
      expect(plan.cambios).toHaveLength(1);
      expect(plan.cambios[0].id).toBe(1);
    }
  });

  it("editar un viaje del medio no toca los anteriores", () => {
    const viajes = [viaje(1, "08:00"), viaje(2, "08:20"), viaje(3, "08:40")];
    const plan = planificarReajusteCliente(viajes, 2, hora("09:00"), 15);
    expect(plan.cambios.map((c) => c.id)).toEqual([2, 3]);
    expect(plan.cambios.map((c) => hhmm(c.llegadaMs))).toEqual(["09:00", "09:15"]);
  });
});

describe("bloqueo horario de edición del programa (punto 5)", () => {
  const cfg: ConfigBloqueo = { activo: true, horaCorteMin: 16 * 60 };
  const alcance = (r: Partial<{ esAdmin: boolean; esProgramador: boolean; esJefePlanta: boolean }>) => ({
    esAdmin: false,
    esProgramador: false,
    esJefePlanta: false,
    ...r,
  });
  const alas = (hhmmStr: string) => new Date(`2026-08-14T${hhmmStr}:00`);

  it("bloquea al Programador después de la hora de corte", () => {
    const r = bloqueaEdicionPrograma(cfg, alcance({ esProgramador: true }), alas("16:30"));
    expect(r.bloqueado).toBe(true);
    expect(r.mensaje).toContain("4:00 p.m.");
  });

  it("bloquea también al Jefe de Planta", () => {
    expect(bloqueaEdicionPrograma(cfg, alcance({ esJefePlanta: true }), alas("17:00")).bloqueado).toBe(true);
  });

  it("NO bloquea antes de la hora de corte", () => {
    expect(bloqueaEdicionPrograma(cfg, alcance({ esProgramador: true }), alas("15:59")).bloqueado).toBe(false);
  });

  it("NUNCA bloquea al Administrador (si no, no podría desbloquear)", () => {
    expect(
      bloqueaEdicionPrograma(cfg, alcance({ esAdmin: true, esProgramador: true }), alas("23:00")).bloqueado,
    ).toBe(false);
  });

  it("con el bloqueo desactivado no restringe a nadie", () => {
    const off: ConfigBloqueo = { activo: false, horaCorteMin: 16 * 60 };
    expect(bloqueaEdicionPrograma(off, alcance({ esProgramador: true }), alas("23:59")).bloqueado).toBe(false);
  });

  it("no aplica a roles fuera de la lista (p. ej. un Despachador)", () => {
    expect(bloqueaEdicionPrograma(cfg, alcance({}), alas("18:00")).bloqueado).toBe(false);
  });
});

describe("apertura de planta: texto y parseo (punto 4)", () => {
  it("convierte minutos a HH:MM y de vuelta", () => {
    expect(textoHoraMin(7 * 60)).toBe("07:00");
    expect(textoHoraMin(5 * 60 + 30)).toBe("05:30");
    expect(minutosDeTexto("05:00")).toBe(300);
    expect(minutosDeTexto("7:15")).toBe(435);
  });

  it("rechaza horas inválidas", () => {
    expect(minutosDeTexto("25:00")).toBeNull();
    expect(minutosDeTexto("07:75")).toBeNull();
    expect(minutosDeTexto("abc")).toBeNull();
  });
});

describe("dónde se aplica el bloqueo (cableado de las server actions)", () => {
  // El bloqueo debe cubrir TODA la edición de programación y NINGUNA acción de
  // Despacho en vivo. Si mañana alguien agrega una acción de despacho al guard, la
  // operación del día se detendría a las 4 p.m. — eso es lo que esta prueba impide.
  const fuente = readFileSync(new URL("../app/actions.ts", import.meta.url), "utf8");

  /** Cuerpo de una server action por nombre. */
  const cuerpoDe = (nombre: string): string => {
    const i = fuente.indexOf(`export async function ${nombre}(`);
    expect(i, `no se encontró ${nombre}`).toBeGreaterThan(-1);
    const j = fuente.indexOf("\nexport async function ", i + 1);
    return fuente.slice(i, j === -1 ? undefined : j);
  };

  const PROGRAMACION = [
    "crearPedidoAction",
    "modificarPedidoAction",
    "reordenarPedidoAction",
    "organizarDiaAction",
    "cancelarPedidoAction",
    "eliminarPedidoAction",
    "agregarViajeManualAction",
    "editarViajeManualAction",
    "eliminarViajeManualAction",
    "eliminarViajesManualAction",
    "generarViajesEnSerieAction",
    "ajustarLlegadaManualAction",
    "fijarHoraViajeAction",
  ];

  // Despacho en vivo: registrar la operación del día NUNCA se bloquea.
  const DESPACHO = [
    "avanzarEstadoAction",
    "editarVolumenAction",
    "cambiarOperadorAction",
    "corregirHoraRealAction",
    "reasignarMixerAction",
    "cambiarPlantaViajeAction",
    "agregarViajePedidoAction",
    "cancelarViajeAction",
  ];

  it.each(PROGRAMACION)("%s exige el bloqueo horario", (accion) => {
    expect(cuerpoDe(accion)).toMatch(/autorizarOperacionPedido\("/);
  });

  it.each(DESPACHO)("%s NO se bloquea (la operación del día no se detiene)", (accion) => {
    expect(cuerpoDe(accion)).not.toMatch(/autorizarOperacionPedido\("/);
  });
});
