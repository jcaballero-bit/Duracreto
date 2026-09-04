// Calificación del desempeño de un laboratorista (puras, sin base).
import { describe, expect, it } from "vitest";
import {
  calificar,
  mediana,
  ordenarCalificaciones,
  PESOS,
  resumirEquipo,
  tonoPct,
  type ConteosLaboratorista,
} from "@/lib/calidad/desempeno";

function conteos(p: Partial<ConteosLaboratorista> = {}): ConteosLaboratorista {
  return {
    laboratoristaId: "u1",
    nombre: "Ana Lab",
    correo: "ana@test.com",
    zona: "Norte",
    programasAsignados: 0,
    programasFinalizables: 0,
    programasFinalizados: 0,
    viajesEnObra: 0,
    revenimientoObra: 0,
    temperaturaObra: 0,
    turnosPlanta: 0,
    viajesEnPlanta: 0,
    revenimientoPlanta: 0,
    temperaturaPlanta: 0,
    muestras: 0,
    demorasMin: [],
    ...p,
  };
}

describe("llenado de la información", () => {
  it("se cuenta por LECTURA, no por viaje: un viaje a medias vale medio", () => {
    // 2 viajes en obra = 4 lecturas esperadas. Se capturaron 3 (uno completo y uno
    // con revenimiento pero sin temperatura) = 75 %.
    const c = calificar(
      conteos({ programasAsignados: 1, viajesEnObra: 2, revenimientoObra: 2, temperaturaObra: 1 }),
    );
    expect(c.camposEsperados).toBe(4);
    expect(c.camposCapturados).toBe(3);
    expect(c.llenadoPct).toBe(75);
    expect(c.lecturasCompletas).toBe(1);
    expect(c.lecturasParciales).toBe(1);
    expect(c.lecturasFaltantes).toBe(0);
  });

  it("todo capturado da 100 %", () => {
    const c = calificar(
      conteos({ programasAsignados: 1, viajesEnObra: 5, revenimientoObra: 5, temperaturaObra: 5 }),
    );
    expect(c.llenadoPct).toBe(100);
    expect(c.lecturasCompletas).toBe(5);
    expect(c.lecturasFaltantes).toBe(0);
  });

  it("nada capturado da 0 % y cuenta los viajes sin ninguna lectura", () => {
    const c = calificar(conteos({ programasAsignados: 1, viajesEnObra: 4 }));
    expect(c.llenadoPct).toBe(0);
    expect(c.lecturasFaltantes).toBe(4);
    expect(c.lecturasCompletas).toBe(0);
    expect(c.lecturasParciales).toBe(0);
  });

  it("suma los dos papeles: obra y salida de planta", () => {
    // 2 viajes en obra (4 lecturas, 4 capturadas) + 3 en planta (6 lecturas, 3
    // capturadas) = 7 de 10.
    const c = calificar(
      conteos({
        programasAsignados: 1,
        viajesEnObra: 2,
        revenimientoObra: 2,
        temperaturaObra: 2,
        turnosPlanta: 1,
        viajesEnPlanta: 3,
        revenimientoPlanta: 3,
        temperaturaPlanta: 0,
      }),
    );
    expect(c.camposEsperados).toBe(10);
    expect(c.camposCapturados).toBe(7);
    expect(c.llenadoPct).toBe(70);
    // Los completos son los de obra; los 3 de planta quedaron a medias.
    expect(c.lecturasCompletas).toBe(2);
    expect(c.lecturasParciales).toBe(3);
  });

  it("sin viajes medibles el llenado es null, no 0 %", () => {
    // No es que lo haya hecho mal: es que no habia nada que medir.
    const c = calificar(conteos({ programasAsignados: 2, programasFinalizables: 0 }));
    expect(c.llenadoPct).toBeNull();
  });
});

describe("finalización del control de calidad", () => {
  it("mide los programas cerrados sobre los que se PODÍAN cerrar", () => {
    const c = calificar(
      conteos({ programasAsignados: 5, programasFinalizables: 4, programasFinalizados: 3 }),
    );
    expect(c.finalizacionPct).toBe(75);
    expect(c.sinFinalizar).toBe(1);
  });

  it("un programa sin despacho no cuenta en contra", () => {
    // 3 asignados pero solo 1 despacho algo: la nota se mide sobre ese.
    const c = calificar(
      conteos({ programasAsignados: 3, programasFinalizables: 1, programasFinalizados: 1 }),
    );
    expect(c.finalizacionPct).toBe(100);
    expect(c.sinFinalizar).toBe(0);
  });

  it("sin programas finalizables la finalización es null", () => {
    const c = calificar(conteos({ turnosPlanta: 2, viajesEnPlanta: 1, revenimientoPlanta: 1, temperaturaPlanta: 1 }));
    expect(c.finalizacionPct).toBeNull();
  });
});

describe("calificación combinada", () => {
  it("pondera llenado y finalización con los pesos declarados", () => {
    // Llenado 100 %, finalizacion 50 % -> 100*0.6 + 50*0.4 = 80.
    const c = calificar(
      conteos({
        programasAsignados: 2,
        programasFinalizables: 2,
        programasFinalizados: 1,
        viajesEnObra: 3,
        revenimientoObra: 3,
        temperaturaObra: 3,
      }),
    );
    expect(PESOS.llenado + PESOS.finalizacion).toBe(1);
    expect(c.llenadoPct).toBe(100);
    expect(c.finalizacionPct).toBe(50);
    expect(c.calificacion).toBe(80);
  });

  it("si solo tuvo trabajo de PLANTA, el llenado vale por el total", () => {
    // Nunca le asignaron un programa, asi que no se le puede bajar la nota por una
    // finalizacion que no le tocaba.
    const c = calificar(
      conteos({
        turnosPlanta: 3,
        viajesEnPlanta: 4,
        revenimientoPlanta: 3,
        temperaturaPlanta: 3,
      }),
    );
    expect(c.finalizacionPct).toBeNull();
    expect(c.llenadoPct).toBe(75);
    expect(c.calificacion).toBe(75); // no 45 (= 75 * 0.6)
  });

  it("si solo tuvo programas SIN viajes medibles, la finalización vale por el total", () => {
    const c = calificar(
      conteos({ programasAsignados: 2, programasFinalizables: 2, programasFinalizados: 2 }),
    );
    expect(c.llenadoPct).toBeNull();
    expect(c.calificacion).toBe(100);
  });

  it("sin asignaciones NO saca 0: se marca como sin asignaciones", () => {
    const c = calificar(conteos());
    expect(c.sinAsignaciones).toBe(true);
    expect(c.calificacion).toBeNull();
  });

  it("con asignaciones pero sin nada medible, no está 'sin asignaciones'", () => {
    const c = calificar(conteos({ programasAsignados: 1 }));
    expect(c.sinAsignaciones).toBe(false);
    expect(c.calificacion).toBeNull(); // no habia nada que calificar todavia
  });
});

describe("semáforo", () => {
  it("verde desde 90, ámbar desde 70, rojo debajo", () => {
    expect(tonoPct(100)).toBe("ok");
    expect(tonoPct(90)).toBe("ok");
    expect(tonoPct(89.9)).toBe("warn");
    expect(tonoPct(70)).toBe("warn");
    expect(tonoPct(69.9)).toBe("danger");
    expect(tonoPct(0)).toBe("danger");
  });

  it("sin dato es NEUTRO, no rojo", () => {
    // Quien no tuvo trabajo asignado no debe pintarse como incumplimiento.
    expect(tonoPct(null)).toBe("neutro");
  });
});

describe("oportunidad de la captura", () => {
  it("usa la MEDIANA, así una captura olvidada no mueve el indicador", () => {
    // Cuatro lecturas puntuales y una que se registro 8 h despues.
    expect(mediana([2, 3, 4, 5, 480])).toBe(4);
    // El promedio seria 98.8, que no describe a nadie.
  });

  it("con un número par de lecturas promedia las dos del centro", () => {
    expect(mediana([2, 4, 6, 8])).toBe(5);
  });

  it("sin lecturas medidas no hay demora que reportar", () => {
    expect(mediana([])).toBeNull();
    expect(calificar(conteos()).demoraMedianaMin).toBeNull();
  });
});

describe("orden de la tabla", () => {
  const fila = (nombre: string, p: Partial<ConteosLaboratorista>) =>
    calificar(conteos({ nombre, ...p }));

  it("de PEOR a mejor calificación: lo accionable queda arriba", () => {
    const buena = fila("Buena", {
      programasAsignados: 1, programasFinalizables: 1, programasFinalizados: 1,
      viajesEnObra: 1, revenimientoObra: 1, temperaturaObra: 1,
    });
    const mala = fila("Mala", { programasAsignados: 1, programasFinalizables: 1, viajesEnObra: 2 });
    expect(ordenarCalificaciones([buena, mala]).map((x) => x.nombre)).toEqual(["Mala", "Buena"]);
  });

  it("los que no tuvieron asignaciones van AL FINAL", () => {
    const conNota = fila("Con nota", {
      programasAsignados: 1, programasFinalizables: 1, viajesEnObra: 1,
    });
    const sinNada = fila("Sin nada", {});
    expect(ordenarCalificaciones([sinNada, conNota]).map((x) => x.nombre)).toEqual([
      "Con nota",
      "Sin nada",
    ]);
  });

  it("no muta el arreglo recibido", () => {
    const xs = [fila("B", { programasAsignados: 1 }), fila("A", { programasAsignados: 1 })];
    const antes = xs.map((x) => x.nombre);
    ordenarCalificaciones(xs);
    expect(xs.map((x) => x.nombre)).toEqual(antes);
  });
});

describe("resumen del equipo", () => {
  it("pondera por VOLUMEN de trabajo, no promedia porcentajes", () => {
    // Quien midio 20 viajes al 100 % y quien midio 1 al 0 %: el equipo no esta al
    // 50 %, esta al 97.6 % (40 de 41 lecturas... 40/42).
    const mucho = calificar(
      conteos({ programasAsignados: 1, viajesEnObra: 20, revenimientoObra: 20, temperaturaObra: 20 }),
    );
    const poco = calificar(conteos({ nombre: "Poco", programasAsignados: 1, viajesEnObra: 1 }));
    const r = resumirEquipo([mucho, poco]);
    expect(r.llenadoPct).toBe(95.2); // 40 de 42
    expect(r.lecturasFaltantes).toBe(1);
  });

  it("cuenta cuántos tuvieron trabajo asignado", () => {
    const activo = calificar(conteos({ programasAsignados: 1, programasFinalizables: 1 }));
    const sin = calificar(conteos({ nombre: "Sin" }));
    const r = resumirEquipo([activo, sin]);
    expect(r.laboratoristas).toBe(2);
    expect(r.evaluados).toBe(1);
    expect(r.sinFinalizar).toBe(1);
  });

  it("un equipo vacío no revienta ni inventa porcentajes", () => {
    const r = resumirEquipo([]);
    expect(r.laboratoristas).toBe(0);
    expect(r.llenadoPct).toBeNull();
    expect(r.finalizacionPct).toBeNull();
    expect(r.demoraMedianaMin).toBeNull();
  });
});
