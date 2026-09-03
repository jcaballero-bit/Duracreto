// Reglas del reporte de tiempos de descarga y esperas en obra (puras, sin base).
import { describe, expect, it } from "vitest";
import {
  analizarIntervalos,
  analizarViaje,
  ordenarDetalle,
  resumirPeriodo,
  resumirPorCliente,
  tonoDesviacion,
  UMBRALES_DESCARGA_DEFAULT,
  type UmbralesDescarga,
  type ViajeEntrada,
} from "@/lib/reportes/descargas";

const U: UmbralesDescarga = UMBRALES_DESCARGA_DEFAULT; // espera 15 min, tolerancia 25 %
const DIA = new Date(2026, 8, 1).getTime();
const h = (hh: number, mm = 0) => new Date(2026, 8, 1, hh, mm).getTime();

function viaje(p: Partial<ViajeEntrada> = {}): ViajeEntrada {
  return {
    viajeId: 1,
    pedidoId: 10,
    clienteId: 100,
    cliente: "Constructora Uno",
    proyecto: "Torre A",
    plantelId: 1,
    plantel: "Santa Marta",
    diaMs: DIA,
    numero: 1,
    totalDelPedido: 1,
    mixer: "SM-07",
    volumen: 11,
    llegadaMs: h(10, 15),
    inicioDescargaMs: h(10, 20),
    finDescargaMs: h(10, 35),
    programadaMin: 15,
    ...p,
  };
}

describe("desviacion de la descarga", () => {
  it("el caso del requerimiento: 15 programados y 22 reales = +7 min (+47%) en rojo", () => {
    const v = analizarViaje(
      viaje({ inicioDescargaMs: h(10, 20), finDescargaMs: h(10, 42), programadaMin: 15 }),
      U,
    );
    expect(v.realMin).toBe(22);
    expect(v.desviacionMin).toBe(7);
    expect(v.desviacionPct).toBe(47);
    expect(v.tono).toBe("danger"); // 22 > 15 * 1.25 = 18.75
  });

  it("dentro de lo programado es verde", () => {
    const v = analizarViaje(
      viaje({ inicioDescargaMs: h(10, 20), finDescargaMs: h(10, 32), programadaMin: 15 }),
      U,
    );
    expect(v.realMin).toBe(12);
    expect(v.desviacionMin).toBe(-3);
    expect(v.tono).toBe("ok");
  });

  it("hasta la tolerancia (+25%) es ambar; justo en el borde todavia es ambar", () => {
    // 15 min programados: 18.75 es el limite. 18 -> ambar, 19 -> rojo.
    expect(tonoDesviacion(18, 15, 0.25)).toBe("warn");
    expect(tonoDesviacion(18.75, 15, 0.25)).toBe("warn");
    expect(tonoDesviacion(19, 15, 0.25)).toBe("danger");
    expect(tonoDesviacion(15, 15, 0.25)).toBe("ok");
  });

  it("sin descarga programada no hay semaforo ni desviacion", () => {
    const v = analizarViaje(viaje({ programadaMin: null }), U);
    expect(v.desviacionMin).toBeNull();
    expect(v.tono).toBe("neutro");
    expect(v.completo).toBe(false);
    expect(v.faltantes).toContain("descarga programada");
  });

  it("una frecuencia de 0 se trata como ausente, no como 0 minutos de descarga", () => {
    const v = analizarViaje(viaje({ programadaMin: 0 }), U);
    expect(v.desviacionMin).toBeNull();
    expect(v.tono).toBe("neutro");
  });
});

describe("espera en obra", () => {
  it("el caso del requerimiento: llego 10:15 e inicio 10:47 = 32 min", () => {
    const v = analizarViaje(
      viaje({ llegadaMs: h(10, 15), inicioDescargaMs: h(10, 47), finDescargaMs: h(11, 2) }),
      U,
    );
    expect(v.esperaMin).toBe(32);
    expect(v.esperaExcesiva).toBe(true); // 32 >= 15
  });

  it("por debajo del umbral no se marca", () => {
    const v = analizarViaje(viaje({ llegadaMs: h(10, 15), inicioDescargaMs: h(10, 20) }), U);
    expect(v.esperaMin).toBe(5);
    expect(v.esperaExcesiva).toBe(false);
  });

  it("el umbral es configurable: con 3 min, una espera de 5 ya se marca", () => {
    const v = analizarViaje(viaje({ llegadaMs: h(10, 15), inicioDescargaMs: h(10, 20) }), {
      ...U,
      esperaMin: 3,
    });
    expect(v.esperaExcesiva).toBe(true);
  });

  it("una espera NEGATIVA (error de captura) no se marca como espera excesiva", () => {
    // Inicio de descarga antes de la llegada: solo puede ser un error de registro.
    const v = analizarViaje(viaje({ llegadaMs: h(10, 30), inicioDescargaMs: h(10, 10) }), U);
    expect(v.esperaMin).toBe(-20);
    expect(v.esperaExcesiva).toBe(false);
  });
});

describe("datos incompletos (B6)", () => {
  it("un viaje sin fin de descarga igual aporta su espera en obra", () => {
    const v = analizarViaje(viaje({ finDescargaMs: null }), U);
    expect(v.realMin).toBeNull();
    expect(v.desviacionMin).toBeNull();
    expect(v.esperaMin).toBe(5); // la espera SI se puede medir
    expect(v.completo).toBe(false);
    expect(v.faltantes).toEqual(["fin de descarga"]);
  });

  it("un viaje sin ningun timestamp declara los tres faltantes", () => {
    const v = analizarViaje(
      viaje({ llegadaMs: null, inicioDescargaMs: null, finDescargaMs: null }),
      U,
    );
    expect(v.faltantes).toEqual(["llegada a obra", "inicio de descarga", "fin de descarga"]);
    expect(v.esperaMin).toBeNull();
  });

  it("los incompletos NO distorsionan los promedios ni se cuentan como cero", () => {
    const completos = [
      analizarViaje(viaje({ viajeId: 1, finDescargaMs: h(10, 40) }), U), // real 20
      analizarViaje(viaje({ viajeId: 2, finDescargaMs: h(10, 30) }), U), // real 10
    ];
    const incompleto = analizarViaje(viaje({ viajeId: 3, finDescargaMs: null }), U);
    const todos = [...completos, incompleto];

    const res = resumirPeriodo(todos, resumirPorCliente(todos), []);
    expect(res.viajes).toBe(3);
    expect(res.viajesMedidos).toBe(2);
    expect(res.viajesIncompletos).toBe(1);
    expect(res.coberturaPct).toBe(67);
    // Promedio de 20 y 10 = 15. Si el incompleto contara como 0 daria 10.
    expect(res.realProm).toBe(15);
  });

  it("sin ningun viaje medido los promedios son null, no cero", () => {
    const solos = [analizarViaje(viaje({ finDescargaMs: null, programadaMin: null }), U)];
    const res = resumirPeriodo(solos, resumirPorCliente(solos), []);
    expect(res.realProm).toBeNull();
    expect(res.programadaProm).toBeNull();
    expect(res.excedieronPct).toBeNull();
    expect(res.coberturaPct).toBe(0);
  });
});

describe("resumen por cliente", () => {
  const dosClientes = () => {
    // Cliente A: dos viajes, uno excede 7 min y otro 3 min = 10 excedidos.
    const a1 = analizarViaje(
      viaje({ viajeId: 1, clienteId: 100, cliente: "A", finDescargaMs: h(10, 42) }),
      U,
    ); // real 22, +7
    const a2 = analizarViaje(
      viaje({ viajeId: 2, clienteId: 100, cliente: "A", finDescargaMs: h(10, 38) }),
      U,
    ); // real 18, +3
    // Cliente B: un viaje que NO excede.
    const b1 = analizarViaje(
      viaje({ viajeId: 3, clienteId: 200, cliente: "B", finDescargaMs: h(10, 30) }),
      U,
    ); // real 10, -5
    return [a1, a2, b1];
  };

  it("suma los minutos excedidos y ordena por ellos, descendente", () => {
    const filas = resumirPorCliente(dosClientes());
    expect(filas[0].cliente).toBe("A");
    expect(filas[0].minutosExcedidos).toBe(10);
    expect(filas[0].fueraDeProgramado).toBe(2);
    expect(filas[1].cliente).toBe("B");
    expect(filas[1].minutosExcedidos).toBe(0);
    expect(filas[1].fueraDeProgramado).toBe(0);
  });

  it("los minutos excedidos NO restan los viajes que fueron mas rapido", () => {
    // Si se sumara la desviacion de todos, B (-5) restaria del total. Solo cuentan
    // los que se pasaron: el tiempo que se ganó no devuelve capacidad de flota.
    const filas = resumirPorCliente(dosClientes());
    const total = filas.reduce((a, f) => a + f.minutosExcedidos, 0);
    expect(total).toBe(10);
  });

  it("acumula la espera: promedio, maxima y total", () => {
    const vs = [
      analizarViaje(viaje({ viajeId: 1, llegadaMs: h(10, 0), inicioDescargaMs: h(10, 10) }), U),
      analizarViaje(viaje({ viajeId: 2, llegadaMs: h(11, 0), inicioDescargaMs: h(11, 30) }), U),
    ];
    const [f] = resumirPorCliente(vs);
    expect(f.esperaProm).toBe(20);
    expect(f.esperaMax).toBe(30);
    expect(f.esperaTotalMin).toBe(40);
    expect(f.esperasSobreUmbral).toBe(1); // solo la de 30
  });
});

describe("horas-mixer en espera y su equivalencia (B4)", () => {
  it("traduce las horas perdidas a viajes que no se pudieron hacer", () => {
    // 6 viajes con 30 min de espera cada uno = 180 min = 3 h. Con ciclo de 90 min,
    // equivalen a 2 viajes.
    const vs = Array.from({ length: 6 }, (_, i) =>
      analizarViaje(
        viaje({ viajeId: i + 1, llegadaMs: h(10, 0), inicioDescargaMs: h(10, 30) }),
        U,
      ),
    );
    const res = resumirPeriodo(vs, resumirPorCliente(vs), [90, 90, 90]);
    expect(res.esperaTotalMin).toBe(180);
    expect(res.horasMixerEspera).toBe(3);
    expect(res.cicloPromMin).toBe(90);
    expect(res.viajesEquivalentes).toBe(2);
  });

  it("sin ciclos medidos no inventa la equivalencia", () => {
    const vs = [analizarViaje(viaje({ llegadaMs: h(10, 0), inicioDescargaMs: h(10, 30) }), U)];
    const res = resumirPeriodo(vs, resumirPorCliente(vs), []);
    expect(res.cicloPromMin).toBeNull();
    expect(res.viajesEquivalentes).toBeNull();
  });

  it("nombra al cliente con mayor desviacion acumulada", () => {
    const vs = [
      analizarViaje(viaje({ viajeId: 1, clienteId: 1, cliente: "Poco", finDescargaMs: h(10, 37) }), U), // +2
      analizarViaje(viaje({ viajeId: 2, clienteId: 2, cliente: "Mucho", finDescargaMs: h(10, 55) }), U), // +20
    ];
    const res = resumirPeriodo(vs, resumirPorCliente(vs), []);
    expect(res.peorCliente).toEqual({ cliente: "Mucho", minutos: 20 });
  });

  it("si nadie excedio, no hay peor cliente", () => {
    const vs = [analizarViaje(viaje({ finDescargaMs: h(10, 30) }), U)]; // real 10, -5
    const res = resumirPeriodo(vs, resumirPorCliente(vs), []);
    expect(res.peorCliente).toBeNull();
  });
});

describe("cumplimiento del intervalo entre camiones (B5)", () => {
  const meta = {
    pedidoId: 1,
    cliente: "Constructora Uno",
    proyecto: "Torre A",
    diaMs: DIA,
    solicitadoMin: 15,
  };

  it("el caso del requerimiento: promedio 15 con intervalos 5/25/8/22 es irregular", () => {
    // Llegadas que producen huecos de 5, 25, 8 y 22 min.
    const llegadas = [h(8, 0), h(8, 5), h(8, 30), h(8, 38), h(9, 0)];
    const r = analizarIntervalos(meta, llegadas, U)!;
    expect(r.llegadas).toBe(5);
    expect(r.realPromMin).toBe(15);
    expect(r.minMin).toBe(5);
    expect(r.maxMin).toBe(25);
    expect(r.variabilidadMin).toBe(20);
    expect(r.irregular).toBe(true);
  });

  it("un ritmo parejo de 18 min NO es irregular, aunque el promedio se pase del pedido", () => {
    const llegadas = [h(8, 0), h(8, 18), h(8, 36), h(8, 54)];
    const r = analizarIntervalos(meta, llegadas, U)!;
    expect(r.realPromMin).toBe(18);
    expect(r.variabilidadMin).toBe(0);
    expect(r.irregular).toBe(false);
  });

  it("con una sola llegada no hay intervalo que medir", () => {
    expect(analizarIntervalos(meta, [h(8, 0)], U)).toBeNull();
    expect(analizarIntervalos(meta, [], U)).toBeNull();
  });

  it("las llegadas se ordenan antes de medir (no dependen del orden de consulta)", () => {
    const a = analizarIntervalos(meta, [h(8, 0), h(8, 20), h(8, 40)], U)!;
    const b = analizarIntervalos(meta, [h(8, 40), h(8, 0), h(8, 20)], U)!;
    expect(b.variabilidadMin).toBe(a.variabilidadMin);
    expect(b.realPromMin).toBe(a.realPromMin);
  });

  it("el umbral de variabilidad es configurable", () => {
    const llegadas = [h(8, 0), h(8, 15), h(8, 35)]; // huecos 15 y 20 -> rango 5
    expect(analizarIntervalos(meta, llegadas, U)!.irregular).toBe(false);
    expect(analizarIntervalos(meta, llegadas, { ...U, variabilidadMin: 5 })!.irregular).toBe(true);
  });

  it("tambien reporta la desviacion estandar, para quien la quiera", () => {
    const r = analizarIntervalos(meta, [h(8, 0), h(8, 10), h(8, 30)], U)!;
    // Huecos 10 y 20: media 15, sigma 5.
    expect(r.desviacionEstandarMin).toBe(5);
  });
});

describe("orden de la tabla de detalle", () => {
  const vs = [
    analizarViaje(viaje({ viajeId: 1, cliente: "B", finDescargaMs: h(10, 40) }), U), // real 20
    analizarViaje(viaje({ viajeId: 2, cliente: "A", finDescargaMs: h(10, 25) }), U), // real 5
    analizarViaje(viaje({ viajeId: 3, cliente: "C", finDescargaMs: null }), U), // sin dato
  ];

  it("ordena por una columna numerica en ambas direcciones", () => {
    expect(ordenarDetalle(vs, "real", false).map((v) => v.viajeId)).toEqual([2, 1, 3]);
    expect(ordenarDetalle(vs, "real", true).map((v) => v.viajeId)).toEqual([1, 2, 3]);
  });

  it("los viajes SIN dato van al final en las DOS direcciones", () => {
    // Un viaje sin dato no debe encabezar el reporte por tener null.
    expect(ordenarDetalle(vs, "real", false).at(-1)!.viajeId).toBe(3);
    expect(ordenarDetalle(vs, "real", true).at(-1)!.viajeId).toBe(3);
  });

  it("ordena por texto (cliente)", () => {
    expect(ordenarDetalle(vs, "cliente", false).map((v) => v.cliente)).toEqual(["A", "B", "C"]);
    expect(ordenarDetalle(vs, "cliente", true).map((v) => v.cliente)).toEqual(["C", "B", "A"]);
  });

  it("no muta el arreglo recibido", () => {
    const antes = vs.map((v) => v.viajeId);
    ordenarDetalle(vs, "real", true);
    expect(vs.map((v) => v.viajeId)).toEqual(antes);
  });
});
