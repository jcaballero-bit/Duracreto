// Clasificación de un despacho como normal o extraordinario (módulo PURO).
//
// La distinción que se prueba aquí es la que se confunde en la práctica: el horario
// NORMAL es de la planta (jornada operativa) y decide si el despacho fue fuera de
// horario; la banda de RECARGO es de ley y decide cuánto cuesta esa hora. Son dos
// cosas distintas y pueden no coincidir.
import { describe, expect, it } from "vitest";
import {
  esExtraordinario,
  horarioDe,
  porcentajeDeRecargo,
  textoHorario,
  type HorarioPlanta,
} from "@/lib/extraordinario/horario";
import type { BandaRecargo } from "@/lib/planilla/recargos";

// Planta 1 con la jornada por defecto; planta 2 con cierre extendido a las 17:00.
const HORARIOS: HorarioPlanta[] = [
  { plantaId: 1, tipoDia: "LunVie", aperturaMin: 420, cierreMin: 900, activo: true },
  { plantaId: 1, tipoDia: "Sabado", aperturaMin: 420, cierreMin: 660, activo: true },
  { plantaId: 2, tipoDia: "LunVie", aperturaMin: 420, cierreMin: 1020, activo: true },
];

const BANDAS: BandaRecargo[] = [
  { tipoDia: "LunVie", desdeMin: 0, hastaMin: 300, porcentaje: 75 },
  { tipoDia: "LunVie", desdeMin: 300, hastaMin: 420, porcentaje: 25 },
  { tipoDia: "LunVie", desdeMin: 420, hastaMin: 900, porcentaje: 0 },
  { tipoDia: "LunVie", desdeMin: 900, hastaMin: 1140, porcentaje: 25 },
  { tipoDia: "LunVie", desdeMin: 1140, hastaMin: 1320, porcentaje: 50 },
  { tipoDia: "LunVie", desdeMin: 1320, hastaMin: 1440, porcentaje: 75 },
  { tipoDia: "Domingo", desdeMin: 0, hastaMin: 1440, porcentaje: 100 },
];

// 2026-08-18 martes · 22 sábado · 23 domingo.
const en = (dia: number, h: number, m = 0) => new Date(2026, 7, dia, h, m, 0, 0);

describe("horario normal de la planta", () => {
  it("una salida dentro de la ventana es normal y una fuera es extraordinaria", () => {
    const h = horarioDe(1, en(18, 10), HORARIOS);
    expect(esExtraordinario(en(18, 10), h)).toBe(false); // 10:00, en jornada
    expect(esExtraordinario(en(18, 16, 30), h)).toBe(true); // 16:30, ya cerró
    expect(esExtraordinario(en(18, 6, 30), h)).toBe(true); // antes de abrir
  });

  it("la hora de cierre ya es extraordinaria (la jornada terminó)", () => {
    const h = horarioDe(1, en(18, 15), HORARIOS);
    expect(esExtraordinario(en(18, 14, 59), h)).toBe(false);
    expect(esExtraordinario(en(18, 15), h)).toBe(true);
    // La apertura sí es normal (el minuto en que abre ya está dentro).
    expect(esExtraordinario(en(18, 7), h)).toBe(false);
  });

  it("el horario es POR PLANTA: el mismo viaje de las 16:30 cambia de clasificación", () => {
    const salida = en(18, 16, 30);
    expect(esExtraordinario(salida, horarioDe(1, salida, HORARIOS))).toBe(true); // cierra 15:00
    expect(esExtraordinario(salida, horarioDe(2, salida, HORARIOS))).toBe(false); // cierra 17:00
  });

  it("el sábado usa su propia ventana", () => {
    const h = horarioDe(1, en(22, 12), HORARIOS);
    expect(esExtraordinario(en(22, 10), h)).toBe(false); // 10:00 sábado, normal
    expect(esExtraordinario(en(22, 12), h)).toBe(true); // 12:00, ya cerró (11:00)
  });

  it("sin franja configurada (domingo) TODO el día es extraordinario", () => {
    for (const hora of [0, 7, 10, 14, 23]) {
      const h = horarioDe(1, en(23, hora), HORARIOS);
      expect(h).toBeNull();
      expect(esExtraordinario(en(23, hora), h)).toBe(true);
    }
  });

  it("una franja desactivada equivale a no tener horario normal", () => {
    const apagada: HorarioPlanta[] = [
      { plantaId: 9, tipoDia: "LunVie", aperturaMin: 420, cierreMin: 900, activo: false },
    ];
    const h = horarioDe(9, en(18, 10), apagada);
    expect(h).toBeNull();
    expect(esExtraordinario(en(18, 10), h)).toBe(true);
  });

  it("el texto del horario dice con qué se clasificó", () => {
    expect(textoHorario(horarioDe(1, en(18, 10), HORARIOS))).toBe("07:00 a 15:00");
    expect(textoHorario(null)).toBe("sin horario normal");
  });
});

describe("banda de recargo de la salida", () => {
  it("cada salida cae en la banda de su instante", () => {
    expect(porcentajeDeRecargo(en(18, 10), BANDAS)).toBe(0); // jornada normal
    expect(porcentajeDeRecargo(en(18, 16, 30), BANDAS)).toBe(25);
    expect(porcentajeDeRecargo(en(18, 20), BANDAS)).toBe(50);
    expect(porcentajeDeRecargo(en(18, 23), BANDAS)).toBe(75);
    expect(porcentajeDeRecargo(en(18, 3), BANDAS)).toBe(75);
  });

  it("el domingo todo cae al 100 %", () => {
    expect(porcentajeDeRecargo(en(23, 8), BANDAS)).toBe(100);
    expect(porcentajeDeRecargo(en(23, 19), BANDAS)).toBe(100);
  });

  it("son criterios INDEPENDIENTES: normal por planta pero con recargo de ley", () => {
    // La planta 2 cierra a las 17:00, así que un viaje de las 16:00 es NORMAL para la
    // operación; la ley, en cambio, ya paga esa hora al 25 %. El reporte usa el
    // horario de planta para clasificar y las bandas solo para desglosar el extra.
    const salida = en(18, 16);
    expect(esExtraordinario(salida, horarioDe(2, salida, HORARIOS))).toBe(false);
    expect(porcentajeDeRecargo(salida, BANDAS)).toBe(25);
  });

  it("sin banda configurada para ese instante devuelve 0 (se trata como normal)", () => {
    expect(porcentajeDeRecargo(en(22, 10), BANDAS)).toBe(0); // no hay bandas de sábado
  });
});
