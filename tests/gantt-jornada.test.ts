// Cruce de jornada y viajes (módulo PURO).
//
// El invariante que sostiene todo el reporte: minutos con viaje DENTRO de la jornada más
// minutos sin viaje = duración de la jornada, exacto. Si eso no se cumple, cualquier
// porcentaje que se muestre es mentira.
import { describe, expect, it } from "vitest";
import {
  cruzarJornada,
  fusionarTramos,
  rangoEje,
  textoDuracion,
  tonoOcio,
  type TramoTrabajo,
} from "@/lib/asistencia/gantt";

// 2026-08-19, miércoles.
const en = (h: number, m = 0) => new Date(2026, 7, 19, h, m, 0, 0).getTime();
const enDia20 = (h: number, m = 0) => new Date(2026, 7, 20, h, m, 0, 0).getTime();
const viaje = (id: number, ini: number, fin: number, estimado = false): TramoTrabajo => ({
  viajeId: id,
  inicioMs: ini,
  finMs: fin,
  estimado,
});

describe("el invariante: con viaje + sin viaje = jornada", () => {
  it("motorista 05:45-19:02 con 4 viajes: la suma cuadra exacta", () => {
    const jornada = { inicioMs: en(5, 45), finMs: en(19, 2) };
    const tramos = [
      viaje(1, en(6, 10), en(7, 40)),
      viaje(2, en(8, 0), en(9, 30)),
      viaje(3, en(9, 50), en(11, 20)),
      // El hueco grande del caso real: de 11:20 a 15:40 no hay viaje.
      viaje(4, en(15, 40), en(17, 10)),
    ];
    const r = cruzarJornada(jornada, tramos, 45);

    expect(r.minutosJornada).toBe(797); // 13 h 17 min
    expect(r.minutosProductivos).toBe(360); // 4 viajes x 90 min
    expect(r.minutosSinViaje).toBe(437);
    expect(r.minutosProductivos + r.minutosSinViaje).toBe(r.minutosJornada);
    // El hueco de 4 h 20 min que hoy es invisible.
    const grande = r.huecos.find((h) => h.minutos === 260);
    expect(grande).toBeDefined();
    expect(grande!.marcado).toBe(true);
    expect(grande!.viajeAntes).toBe(3);
    expect(grande!.viajeDespues).toBe(4);
    // Los huecos suman exactamente el tiempo sin viaje.
    expect(r.huecos.reduce((s, h) => s + h.minutos, 0)).toBe(r.minutosSinViaje);
  });

  it("un hueco de 20 min NO se dibuja pero SÍ cuenta en el total", () => {
    const jornada = { inicioMs: en(7, 0), finMs: en(12, 0) };
    const r = cruzarJornada(
      jornada,
      [viaje(1, en(7, 0), en(9, 0)), viaje(2, en(9, 20), en(12, 0))],
      45,
    );
    expect(r.huecos).toHaveLength(1);
    expect(r.huecos[0].minutos).toBe(20);
    expect(r.huecos[0].marcado).toBe(false); // no se dibuja: es una espera normal
    expect(r.minutosSinViaje).toBe(20); // pero cuesta igual
    expect(r.minutosProductivos + r.minutosSinViaje).toBe(r.minutosJornada);
  });

  it("sin viajes, toda la jornada es tiempo sin viaje", () => {
    const r = cruzarJornada({ inicioMs: en(7), finMs: en(15) }, [], 45);
    expect(r.minutosProductivos).toBe(0);
    expect(r.minutosSinViaje).toBe(480);
    expect(r.pctSinViaje).toBe(100);
    expect(r.huecos).toHaveLength(1);
  });

  it("con viajes de punta a punta no hay tiempo sin viaje", () => {
    const r = cruzarJornada(
      { inicioMs: en(7), finMs: en(15) },
      [viaje(1, en(7), en(11)), viaje(2, en(11), en(15))],
      45,
    );
    expect(r.minutosSinViaje).toBe(0);
    expect(r.pctSinViaje).toBe(0);
    expect(r.huecos).toHaveLength(0);
  });
});

describe("solapes y tramos fuera de la jornada", () => {
  it("dos viajes que se traslapan no cuentan el mismo minuto dos veces", () => {
    const r = cruzarJornada(
      { inicioMs: en(7), finMs: en(11) },
      [viaje(1, en(7), en(9)), viaje(2, en(8), en(10))],
      45,
    );
    // 07:00-10:00 son 3 h, no 4 (2 + 2 contando el solape dos veces).
    expect(r.minutosProductivos).toBe(180);
    expect(r.tramos).toHaveLength(1);
    expect(r.minutosSinViaje).toBe(60);
  });

  it("un viaje que empieza antes de la entrada se recorta y se reporta aparte", () => {
    const r = cruzarJornada(
      { inicioMs: en(7), finMs: en(15) },
      [viaje(1, en(6), en(9))], // arrancó una hora antes de marcar entrada
      45,
    );
    expect(r.minutosProductivos).toBe(120); // solo 07:00-09:00 cuenta dentro
    expect(r.fueraDeJornada).toHaveLength(1);
    expect(r.fueraDeJornada[0].inicioMs).toBe(en(6));
    expect(r.fueraDeJornada[0].finMs).toBe(en(7));
    // El invariante se mantiene: lo de fuera no infla la jornada.
    expect(r.minutosProductivos + r.minutosSinViaje).toBe(r.minutosJornada);
  });

  it("un viaje que termina después de la salida también se reporta", () => {
    const r = cruzarJornada({ inicioMs: en(7), finMs: en(15) }, [viaje(1, en(14), en(16))], 45);
    expect(r.minutosProductivos).toBe(60);
    expect(r.fueraDeJornada).toHaveLength(1);
    expect(r.fueraDeJornada[0].finMs).toBe(en(16));
  });

  it("fusionarTramos marca el grupo como estimado si alguna parte lo era", () => {
    const f = fusionarTramos([viaje(1, en(7), en(9)), viaje(2, en(9), en(11), true)]);
    expect(f).toHaveLength(1);
    expect(f[0].estimado).toBe(true);
  });

  it("descarta tramos invertidos o de duración cero", () => {
    const f = fusionarTramos([viaje(1, en(9), en(7)), viaje(2, en(8), en(8))]);
    expect(f).toHaveLength(0);
  });
});

describe("turno que cruza la medianoche", () => {
  it("se mide como un solo bloque continuo, sin barras invertidas", () => {
    // 18:00 a 02:00 del día siguiente, con un viaje a cada lado de la medianoche.
    const jornada = { inicioMs: en(18), finMs: enDia20(2) };
    const r = cruzarJornada(
      jornada,
      [viaje(1, en(19), en(21)), viaje(2, en(23, 30), enDia20(1))],
      45,
    );
    expect(r.minutosJornada).toBe(480); // 8 h, positivas
    expect(r.minutosProductivos).toBe(210); // 2 h + 1 h 30
    expect(r.minutosSinViaje).toBe(270);
    expect(r.minutosProductivos + r.minutosSinViaje).toBe(r.minutosJornada);
    // Todos los tramos avanzan hacia adelante.
    for (const t of r.tramos) expect(t.finMs).toBeGreaterThan(t.inicioMs);
    for (const h of r.huecos) expect(h.finMs).toBeGreaterThan(h.inicioMs);
  });

  it("el eje abarca de la primera entrada a la última salida, con margen y en horas exactas", () => {
    const eje = rangoEje([
      { inicioMs: en(5, 45), finMs: en(19, 2) },
      { inicioMs: en(6, 10), finMs: en(20, 30) },
    ])!;
    expect(new Date(eje.desdeMs).getHours()).toBe(5); // 05:45 - 30 min -> 05:00
    expect(new Date(eje.desdeMs).getMinutes()).toBe(0);
    expect(new Date(eje.hastaMs).getHours()).toBe(21); // 20:30 + 30 min -> 21:00
    expect(eje.hastaMs).toBeGreaterThan(eje.desdeMs);
  });

  it("sin nada que dibujar, el eje es nulo (no un rango inventado)", () => {
    expect(rangoEje([])).toBeNull();
  });
});

describe("sin jornada registrada", () => {
  it("los viajes se conservan pero no se calcula porcentaje", () => {
    const r = cruzarJornada(null, [viaje(1, en(7), en(9))], 45);
    expect(r.tramos).toHaveLength(1); // se dibujan igual
    expect(r.minutosJornada).toBe(0);
    expect(r.minutosSinViaje).toBe(0);
    expect(r.pctSinViaje).toBe(0); // no se inventa un 0 % ni un 100 %
    expect(r.huecos).toHaveLength(0);
  });
});

describe("semáforo y formato", () => {
  it("el semáforo usa los umbrales DEL PUESTO", () => {
    const motorista = { verde_pct: 20, amarillo_pct: 40 };
    const dosificador = { verde_pct: 50, amarillo_pct: 70 };
    // El mismo 45 % es rojo para un motorista y verde para un dosificador.
    expect(tonoOcio(45, motorista)).toBe("danger");
    expect(tonoOcio(45, dosificador)).toBe("ok");
    expect(tonoOcio(30, motorista)).toBe("warn");
    expect(tonoOcio(60, dosificador)).toBe("warn");
    expect(tonoOcio(80, dosificador)).toBe("danger");
  });

  it("las duraciones se leen en horas y minutos", () => {
    expect(textoDuracion(260)).toBe("4h 20m");
    expect(textoDuracion(45)).toBe("45m");
    expect(textoDuracion(120)).toBe("2h");
    expect(textoDuracion(0)).toBe("—");
  });
});
