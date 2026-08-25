// Clasificación de las horas de un turno por nivel de recargo (módulo PURO).
//
// Es la regla que decide cuánto se paga de cada turno, así que se prueba con los casos
// que dan problema en la práctica: la jornada que empieza antes de las 7:00 y termina
// después de las 15:00, el domingo completo, el turno que cruza la medianoche (y que
// además cambia de tipo de día al cruzarla) y la precisión al minuto.
import { describe, expect, it } from "vitest";
import { calcularHorasTurno } from "@/lib/planilla/horas";
import type { BandaRecargo } from "@/lib/planilla/recargos";

/**
 * Las MISMAS bandas que precarga la migración. Se declaran aquí para que la prueba sea
 * pura (sin BD); que la configuración real coincida con esto lo verifica la prueba de
 * integración de la planilla.
 */
const BANDAS: BandaRecargo[] = [
  { tipoDia: "LunVie", desdeMin: 0, hastaMin: 300, porcentaje: 75 },
  { tipoDia: "LunVie", desdeMin: 300, hastaMin: 420, porcentaje: 25 },
  { tipoDia: "LunVie", desdeMin: 420, hastaMin: 900, porcentaje: 0 },
  { tipoDia: "LunVie", desdeMin: 900, hastaMin: 1140, porcentaje: 25 },
  { tipoDia: "LunVie", desdeMin: 1140, hastaMin: 1320, porcentaje: 50 },
  { tipoDia: "LunVie", desdeMin: 1320, hastaMin: 1440, porcentaje: 75 },
  { tipoDia: "Sabado", desdeMin: 0, hastaMin: 300, porcentaje: 75 },
  { tipoDia: "Sabado", desdeMin: 300, hastaMin: 420, porcentaje: 25 },
  { tipoDia: "Sabado", desdeMin: 420, hastaMin: 660, porcentaje: 0 },
  { tipoDia: "Sabado", desdeMin: 660, hastaMin: 1140, porcentaje: 25 },
  { tipoDia: "Sabado", desdeMin: 1140, hastaMin: 1320, porcentaje: 50 },
  { tipoDia: "Sabado", desdeMin: 1320, hastaMin: 1440, porcentaje: 75 },
  { tipoDia: "Domingo", desdeMin: 0, hastaMin: 1440, porcentaje: 100 },
];

// Semana de referencia: 2026-08-19 es MIÉRCOLES; 22 sábado; 23 domingo.
const MIERCOLES = [2026, 7, 19] as const; // mes 0-based: 7 = agosto
const SABADO = [2026, 7, 22] as const;
const DOMINGO = [2026, 7, 23] as const;

function en(dia: readonly [number, number, number], h: number, m = 0): Date {
  return new Date(dia[0], dia[1], dia[2], h, m, 0, 0);
}

describe("calcularHorasTurno", () => {
  it("miércoles 06:00 a 17:30: 8 h normales y 3.5 h al 25 %", () => {
    // 06:00-07:00 = 1 h al 25 % · 07:00-15:00 = 8 h normales · 15:00-17:30 = 2.5 h al 25 %.
    const r = calcularHorasTurno(en(MIERCOLES, 6), en(MIERCOLES, 17, 30), BANDAS);
    expect(r.horas_normales).toBe(8);
    expect(r.horas_extra_25).toBe(3.5);
    expect(r.horas_extra_50).toBe(0);
    expect(r.horas_extra_75).toBe(0);
    expect(r.horas_extra_100).toBe(0);
    expect(r.minutosTotales).toBe(11.5 * 60);
    // Las horas del turno cuadran con su duración.
    const suma =
      r.horas_normales + r.horas_extra_25 + r.horas_extra_50 + r.horas_extra_75 + r.horas_extra_100;
    expect(suma).toBe(11.5);
  });

  it("los niveles NO se suman entre sí: 15:00 a 23:00 reparte 25/50/75", () => {
    const r = calcularHorasTurno(en(MIERCOLES, 15), en(MIERCOLES, 23), BANDAS);
    expect(r.horas_normales).toBe(0);
    expect(r.horas_extra_25).toBe(4); // 15:00-19:00
    expect(r.horas_extra_50).toBe(3); // 19:00-22:00
    expect(r.horas_extra_75).toBe(1); // 22:00-23:00
  });

  it("domingo: TODAS las horas van al 100 %", () => {
    const jornada = calcularHorasTurno(en(DOMINGO, 6), en(DOMINGO, 18), BANDAS);
    expect(jornada.horas_extra_100).toBe(12);
    expect(jornada.horas_normales).toBe(0);
    expect(jornada.horas_extra_25).toBe(0);
    expect(jornada.horas_extra_50).toBe(0);
    expect(jornada.horas_extra_75).toBe(0);

    // Domingo completo: 24 h al 100 %.
    const completo = calcularHorasTurno(en(DOMINGO, 0), en(DOMINGO, 24), BANDAS);
    expect(completo.horas_extra_100).toBe(24);
    expect(completo.minutosTotales).toBe(1440);
  });

  it("sábado 07:00 a 13:00: 4 h normales y 2 h al 25 % (el sábado normal cierra a las 11)", () => {
    const r = calcularHorasTurno(en(SABADO, 7), en(SABADO, 13), BANDAS);
    expect(r.horas_normales).toBe(4);
    expect(r.horas_extra_25).toBe(2);
  });

  it("turno que cruza la medianoche: se parte entre los dos días", () => {
    // Miércoles 22:00 a jueves 06:00 = 2 h al 75 % (22-24) + 5 h al 75 % (00-05) +
    // 1 h al 25 % (05-06).
    const r = calcularHorasTurno(en(MIERCOLES, 22), en([2026, 7, 20], 6), BANDAS);
    expect(r.horas_extra_75).toBe(7);
    expect(r.horas_extra_25).toBe(1);
    expect(r.horas_normales).toBe(0);
    expect(r.minutosTotales).toBe(8 * 60);
  });

  it("al cruzar la medianoche CAMBIA el tipo de día: sábado 22:00 a domingo 02:00", () => {
    const r = calcularHorasTurno(en(SABADO, 22), en(DOMINGO, 2), BANDAS);
    expect(r.horas_extra_75).toBe(2); // sábado 22:00-24:00
    expect(r.horas_extra_100).toBe(2); // domingo 00:00-02:00
  });

  it("precisión al minuto: nunca redondea a la hora completa", () => {
    const r = calcularHorasTurno(en(MIERCOLES, 6), en(MIERCOLES, 6, 45), BANDAS);
    expect(r.horas_extra_25).toBe(0.75); // 45 min

    const noventaMin = calcularHorasTurno(en(MIERCOLES, 7), en(MIERCOLES, 8, 30), BANDAS);
    expect(noventaMin.horas_normales).toBe(1.5); // 90 min
  });

  it("sin horas, o con salida antes que la entrada, devuelve todo en cero", () => {
    expect(calcularHorasTurno(null, null, BANDAS).minutosTotales).toBe(0);
    expect(calcularHorasTurno(en(MIERCOLES, 8), null, BANDAS).minutosTotales).toBe(0);
    const alReves = calcularHorasTurno(en(MIERCOLES, 10), en(MIERCOLES, 8), BANDAS);
    expect(alReves.minutosTotales).toBe(0);
    expect(alReves.horas_normales).toBe(0);
  });

  it("un porcentaje configurado fuera de 25/50/75/100 no se pierde: sale en porRecargo", () => {
    const bandas: BandaRecargo[] = [
      { tipoDia: "LunVie", desdeMin: 0, hastaMin: 420, porcentaje: 30 },
      { tipoDia: "LunVie", desdeMin: 420, hastaMin: 1440, porcentaje: 0 },
    ];
    const r = calcularHorasTurno(en(MIERCOLES, 5), en(MIERCOLES, 9), bandas);
    expect(r.porRecargo[30]).toBe(2); // 05:00-07:00
    expect(r.horas_normales).toBe(2); // 07:00-09:00
    expect(r.horas_extra_25).toBe(0);
  });

  it("un hueco en la configuración se cuenta como hora normal y se reporta", () => {
    // Sin banda entre 07:00 y 15:00.
    const bandas: BandaRecargo[] = [
      { tipoDia: "LunVie", desdeMin: 900, hastaMin: 1140, porcentaje: 25 },
    ];
    const r = calcularHorasTurno(en(MIERCOLES, 7), en(MIERCOLES, 16), bandas);
    expect(r.minutosSinBanda).toBe(8 * 60);
    expect(r.horas_normales).toBe(8);
    expect(r.horas_extra_25).toBe(1);
  });
});
