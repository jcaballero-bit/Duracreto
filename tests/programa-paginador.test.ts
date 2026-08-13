// Pruebas PURAS del paginador del Programa DPCR-08. Aquí vive la garantía de que el
// documento sale bien paginado sin depender del navegador: ninguna hoja se desborda,
// el bloque de un cliente que no cabe se parte con su etiqueta de continuación, la
// numeración de viaje sigue corrida y el total del cliente aparece una sola vez.
import { describe, expect, it } from "vitest";
import {
  ANCHO_UTIL,
  COLUMNAS,
  GEOMETRIA,
  altoCeldaCliente,
  altoCeldaTipo,
  altoDeBloque,
  altoDeFila,
  lineasDeTexto,
  paginarPrograma,
  type BloqueCliente,
} from "@/lib/programa/paginador";
import { DOC, type FilaSnap, type PedidoSnap, type SnapshotPrograma } from "@/lib/programa/snapshot";

const CORTO = "Ana Paz"; // 1 línea
const LARGO = "Jose Antonio Hernandez Martinez"; // 31 chars → 2 líneas (18 por línea)

function viaje(num: number, motorista = CORTO): FilaSnap {
  return {
    tipo: "viaje",
    num,
    motorista,
    mixer: "M-01",
    carga: "7:00 a.m.",
    llegada: "7:30 a.m.",
    finaliza: "8:30 a.m.",
    regreso: "9:00 a.m.",
    volumen: "9.00 m³",
  };
}

function pedido(cliente: string, filas: FilaSnap[], extra: Partial<PedidoSnap> = {}): PedidoSnap {
  return {
    id: 1,
    cliente,
    proyecto: "Proyecto",
    elemento: "Losa",
    planta: "STALO",
    mostrarPlanta: false,
    asesor: "Ana Asesora",
    resistencia: "4,000 3/4 C/B",
    hielo: "Sin control temp.",
    revenimiento: '5"',
    totalM3: filas.filter((f) => f.tipo === "viaje").length * 9,
    bombaCodigo: null,
    bombaColor: null,
    filas,
    ...extra,
  };
}

function snapshot(planteles: SnapshotPrograma["planteles"]): SnapshotPrograma {
  return {
    formato: 1,
    fecha: "2026-08-14",
    fechaLarga: "Viernes 14 de agosto de 2026",
    zona: "Norte",
    doc: DOC,
    bombas: [],
    planteles,
    totalZona: planteles.reduce((s, p) => s + p.totalM3, 0),
  };
}

/** Todos los sub-bloques de un cliente, en orden de hoja. */
function bloquesDe(paginas: ReturnType<typeof paginarPrograma>, cliente: string): BloqueCliente[] {
  return paginas.flatMap((p) =>
    p.items.filter((it): it is BloqueCliente => it.tipo === "bloqueCliente" && it.pedido.cliente === cliente),
  );
}

describe("geometría de la hoja", () => {
  it("las columnas suman exactamente el ancho útil de la hoja", () => {
    // Si alguien recalibra un ancho, esta prueba avisa que hay que compensar otro:
    // de lo contrario la tabla se sale del margen o queda corta.
    const suma = Object.values(COLUMNAS).reduce((s, w) => s + w, 0);
    expect(suma).toBe(ANCHO_UTIL);
  });
});

describe("altos de fila y de celda", () => {
  it("lineasDeTexto cuenta líneas y trata el vacío como cero", () => {
    expect(lineasDeTexto("", 18)).toBe(0);
    expect(lineasDeTexto(CORTO, 18)).toBe(1);
    expect(lineasDeTexto(LARGO, 18)).toBe(2);
  });

  it("una fila con nombre largo de motorista es más alta que una con nombre corto", () => {
    const corta = altoDeFila(viaje(1, CORTO));
    const larga = altoDeFila(viaje(2, LARGO));
    expect(larga).toBeGreaterThan(corta);
    expect(corta).toBe(GEOMETRIA.altoLinea + GEOMETRIA.padCelda);
    expect(larga).toBe(2 * GEOMETRIA.altoLinea + GEOMETRIA.padCelda);
  });

  it("la banda de planta usa su propio alto", () => {
    expect(altoDeFila({ tipo: "planta", nombre: "SANY" })).toBe(GEOMETRIA.altoBanda);
  });

  it("la celda de continuación es más baja que la primera aparición del cliente", () => {
    const p = pedido("CELAQUE", [viaje(1)], { mostrarPlanta: true });
    expect(altoCeldaCliente(p, true)).toBeLessThan(altoCeldaCliente(p, false));
  });

  it("el Total suma una línea a la celda de tipo de concreto", () => {
    const p = pedido("CELAQUE", [viaje(1)]);
    expect(altoCeldaTipo(p, true)).toBe(altoCeldaTipo(p, false) + GEOMETRIA.altoLinea);
  });

  it("un cliente de UN viaje ocupa el alto de su celda de datos, no el de una fila", () => {
    // Es el caso que descuadraba el cálculo: la celda combinada manda cuando es más alta.
    const p = pedido("SERPIC", [viaje(1)], { mostrarPlanta: true });
    const alto = altoDeBloque(p, [altoDeFila(viaje(1))], false, true);
    expect(alto).toBe(Math.max(altoCeldaCliente(p, false), altoCeldaTipo(p, true)));
    expect(alto).toBeGreaterThan(altoDeFila(viaje(1)));
  });
});

describe("paginarPrograma", () => {
  it("ninguna hoja se desborda del alto útil", () => {
    const filas = Array.from({ length: 120 }, (_, i) => viaje(i + 1, i % 2 ? LARGO : CORTO));
    const paginas = paginarPrograma(
      snapshot([{ id: 1, nombre: "Santa Marta", totalM3: 1080, pedidos: [pedido("CELAQUE", filas)] }]),
    );
    expect(paginas.length).toBeGreaterThan(1);
    for (const p of paginas) expect(p.altoUsado).toBeLessThanOrEqual(GEOMETRIA.altoUtil);
  });

  it("parte el bloque de un cliente grande: continuación, total una sola vez y numeración corrida", () => {
    const filas = Array.from({ length: 80 }, (_, i) => viaje(i + 1, LARGO));
    const paginas = paginarPrograma(
      snapshot([{ id: 1, nombre: "Santa Marta", totalM3: 720, pedidos: [pedido("CELAQUE", filas)] }]),
    );
    const bloques = bloquesDe(paginas, "CELAQUE");
    expect(bloques.length).toBeGreaterThan(1);

    // La etiqueta "(continuación)" va del 2º sub-bloque en adelante.
    expect(bloques[0].continuacion).toBe(false);
    expect(bloques.slice(1).every((b) => b.continuacion)).toBe(true);

    // El Total del cliente aparece SOLO al cerrar el último sub-bloque.
    expect(bloques.filter((b) => b.conTotal)).toHaveLength(1);
    expect(bloques[bloques.length - 1].conTotal).toBe(true);

    // Numeración de viaje continua y sin repetir: 1..80 en orden.
    const nums = bloques.flatMap((b) =>
      b.filas.filter((f) => f.tipo === "viaje").map((f) => (f as { num: number }).num),
    );
    expect(nums).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
  });

  it("cada sub-bloque lleva un alto por fila (el PDF los dibuja tal cual)", () => {
    const filas = Array.from({ length: 60 }, (_, i) => viaje(i + 1, LARGO));
    const paginas = paginarPrograma(
      snapshot([{ id: 1, nombre: "Santa Marta", totalM3: 540, pedidos: [pedido("CELAQUE", filas)] }]),
    );
    for (const b of bloquesDe(paginas, "CELAQUE")) {
      expect(b.altosFila).toHaveLength(b.filas.length);
      expect(b.alto).toBeGreaterThanOrEqual(b.altosFila.reduce((s, h) => s + h, 0));
    }
  });

  it("un plantel sin pedidos aparece igual, con su fila de aviso y su total", () => {
    const paginas = paginarPrograma(
      snapshot([
        { id: 1, nombre: "Villanueva", totalM3: 0, pedidos: [] },
        { id: 2, nombre: "La Ceiba", totalM3: 27, pedidos: [pedido("CARIBE", [viaje(1), viaje(2), viaje(3)])] },
      ]),
    );
    const items = paginas.flatMap((p) => p.items);
    expect(items.some((it) => it.tipo === "sinPedidos")).toBe(true);
    const totalVillanueva = items.find(
      (it) => it.tipo === "totalPlantel" && it.nombre === "Villanueva",
    );
    expect(totalVillanueva).toBeDefined();
    expect((totalVillanueva as { totalM3: number }).totalM3).toBe(0);
  });

  it("el título de un plantel nunca queda huérfano al pie de la hoja", () => {
    // Muchos clientes chicos: fuerza varios cortes y encabezados de plantel.
    const chico = (n: number) => pedido(`CLIENTE ${n}`, [viaje(1), viaje(2)]);
    const paginas = paginarPrograma(
      snapshot([
        { id: 1, nombre: "Santa Marta", totalM3: 100, pedidos: Array.from({ length: 14 }, (_, i) => chico(i)) },
        { id: 2, nombre: "Choloma", totalM3: 100, pedidos: Array.from({ length: 14 }, (_, i) => chico(100 + i)) },
        { id: 3, nombre: "La Ceiba", totalM3: 100, pedidos: Array.from({ length: 14 }, (_, i) => chico(200 + i)) },
      ]),
    );
    for (const p of paginas) {
      const ultimo = p.items[p.items.length - 1];
      expect(ultimo?.tipo).not.toBe("tituloPlantel");
    }
  });

  it("una banda de planta no queda sola al pie: baja con sus viajes", () => {
    // Pedido repartido en 2 plantas, con relleno previo para provocar cortes.
    const filas: FilaSnap[] = [
      { tipo: "planta", nombre: "SANY" },
      ...Array.from({ length: 30 }, (_, i) => viaje(i + 1, LARGO)),
      { tipo: "planta", nombre: "STALO" },
      ...Array.from({ length: 30 }, (_, i) => viaje(31 + i, LARGO)),
    ];
    const paginas = paginarPrograma(
      snapshot([{ id: 1, nombre: "Santa Marta", totalM3: 540, pedidos: [pedido("VALLE", filas, { mostrarPlanta: true })] }]),
    );
    for (const b of bloquesDe(paginas, "VALLE")) {
      const ultima = b.filas[b.filas.length - 1];
      if (!b.conTotal) expect(ultima.tipo).not.toBe("planta");
    }
  });

  it("el total de la zona cierra el documento", () => {
    const paginas = paginarPrograma(
      snapshot([{ id: 1, nombre: "Santa Marta", totalM3: 27, pedidos: [pedido("CELAQUE", [viaje(1), viaje(2), viaje(3)])] }]),
    );
    const ultimaHoja = paginas[paginas.length - 1];
    expect(ultimaHoja.items[ultimaHoja.items.length - 1].tipo).toBe("totalZona");
  });
});
