// Prueba de integración del PDF del Programa DPCR-08: RENDERIZA el documento y
// verifica que lo impreso coincida con lo que decidió el paginador.
//
// Es la red de seguridad de la calibración del encabezado (`ALTO_ENCABEZADO_FIJO`):
// si ese alto queda corto, la librería descarta el último bloque de cada hoja y se
// pierde información del programa —pasó durante el desarrollo—; si queda largo, sobra
// espacio al pie. Aquí se detecta comparando hojas calculadas contra hojas impresas y
// contando que todos los viajes aparezcan.
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import zlib from "node:zlib";
import { paginarPrograma } from "@/lib/programa/paginador";
import { ProgramaPdf } from "@/lib/programa/pdf-doc";
import { DOC, type FilaSnap, type PedidoSnap, type SnapshotPrograma } from "@/lib/programa/snapshot";

/** Texto dibujado en el PDF (react-pdf lo emite como arrays TJ de hex por carácter). */
function textoDelPdf(buf: Buffer): string {
  const partes: string[] = [];
  let pos = 0;
  for (;;) {
    const i = buf.indexOf("stream", pos);
    if (i < 0) break;
    let ini = i + "stream".length;
    if (buf[ini] === 0x0d) ini++;
    if (buf[ini] === 0x0a) ini++;
    const fin = buf.indexOf("endstream", ini);
    if (fin < 0) break;
    pos = fin + "endstream".length;
    let txt: string;
    try {
      txt = zlib.inflateSync(buf.subarray(ini, fin)).toString("latin1");
    } catch {
      continue;
    }
    for (const m of txt.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      let linea = "";
      for (const g of m[1].matchAll(/<([0-9A-Fa-f]+)>/g)) {
        for (let k = 0; k < g[1].length; k += 2) {
          linea += String.fromCharCode(parseInt(g[1].slice(k, k + 2), 16));
        }
      }
      partes.push(linea);
    }
  }
  return partes.join("\n");
}

const hojasDelPdf = (buf: Buffer) =>
  (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

function viaje(n: number, motorista = "Jose Antonio Hernandez Martinez"): FilaSnap {
  return {
    tipo: "viaje",
    num: n,
    motorista,
    mixer: "23MI50-54",
    carga: "10:59 a.m.",
    llegada: "11:29 a.m.",
    finaliza: "12:11 p.m.",
    regreso: "12:51 p.m.",
    volumen: "11.75 m³",
  };
}

function pedido(cliente: string, filas: FilaSnap[]): PedidoSnap {
  return {
    id: 1,
    cliente,
    proyecto: "Proyecto grande",
    elemento: "Pavimento rigido",
    planta: "SANY",
    mostrarPlanta: true,
    asesor: "Ana Asesora",
    resistencia: '4,000 3/4" C/B',
    hielo: "Sin control temp.",
    revenimiento: '6" a 7"',
    totalM3: filas.filter((f) => f.tipo === "viaje").length * 11,
    bombaCodigo: "SM-B2",
    bombaColor: "#1F4E79",
    filas,
  };
}

/** Un día realista de la Zona Norte: cliente grande que se parte, pedido repartido en
 *  2 plantas, clientes chicos y planteles sin pedidos. */
function snapshotDePrueba(): SnapshotPrograma {
  return {
    formato: 1,
    fecha: "2026-08-14",
    fechaLarga: "Viernes 14 de agosto de 2026",
    zona: "Norte",
    doc: DOC,
    bombas: [{ codigo: "SM-B2", color: "#1F4E79" }],
    planteles: [
      {
        id: 1,
        nombre: "Santa Marta",
        totalM3: 1000,
        pedidos: [
          pedido("PAVIMENTOS DEL CARIBE", Array.from({ length: 60 }, (_, i) => viaje(i + 1))),
          pedido("CONSTRUCTORA DEL VALLE", [
            { tipo: "planta", nombre: "SANY" },
            ...Array.from({ length: 6 }, (_, i) => viaje(i + 1)),
            { tipo: "planta", nombre: "STALO" },
            ...Array.from({ length: 6 }, (_, i) => viaje(i + 7)),
          ]),
          pedido("W&M INGENIEROS", [viaje(1), viaje(2), viaje(3)]),
          pedido("SERPIC", [viaje(1)]),
        ],
      },
      { id: 2, nombre: "Choloma", totalM3: 80, pedidos: [pedido("CARGO EXPRESO", Array.from({ length: 9 }, (_, i) => viaje(i + 1)))] },
      { id: 3, nombre: "Villanueva", totalM3: 0, pedidos: [] },
      { id: 4, nombre: "La Ceiba", totalM3: 0, pedidos: [] },
    ],
    totalZona: 1080,
  };
}

describe("PDF del Programa DPCR-08", () => {
  it("imprime exactamente las hojas que calculó el paginador", async () => {
    const snap = snapshotDePrueba();
    const paginas = paginarPrograma(snap);
    const buf = Buffer.from(await renderToBuffer(ProgramaPdf({ snap, paginas })));

    expect(paginas.length).toBeGreaterThan(1); // el caso de prueba ocupa varias hojas
    // Si esto falla, `ALTO_ENCABEZADO_FIJO` quedó desalineado del encabezado real:
    // la librería estaría partiendo (o descartando) contenido por su cuenta.
    expect(hojasDelPdf(buf)).toBe(paginas.length);
  }, 60_000);

  it("no pierde ningún viaje ni el total de la zona al paginar", async () => {
    const snap = snapshotDePrueba();
    const paginas = paginarPrograma(snap);
    const buf = Buffer.from(await renderToBuffer(ProgramaPdf({ snap, paginas })));
    const texto = textoDelPdf(buf);

    // Tantos volúmenes dibujados como viajes hay en el programa.
    const viajesEsperados = snap.planteles
      .flatMap((pl) => pl.pedidos)
      .flatMap((p) => p.filas)
      .filter((f) => f.tipo === "viaje").length;
    const volumenesDibujados = texto.split("\n").filter((t) => t.includes("11.75")).length;
    expect(volumenesDibujados).toBe(viajesEsperados);

    // El encabezado ISO y los títulos de columna se repiten en TODAS las hojas.
    const veces = (s: string) => texto.split(s).length - 1;
    expect(veces("PROGRAMA DE ENTREGA DE CONCRETO")).toBe(paginas.length);
    expect(veces("MOTORISTA")).toBe(paginas.length);
    // Etiquetas ISO por cargo (no el usuario que generó el PDF).
    expect(veces(DOC.aprobadoPor)).toBe(paginas.length);
    // Numeración real "Página X de Y" en cada hoja.
    for (let n = 1; n <= paginas.length; n++) {
      expect(texto).toContain(`Página ${n} de ${paginas.length}`);
    }
    // Cierre del documento y planteles sin pedidos. Se busca sobre el texto
    // CONCATENADO porque la libreria puede emitir una misma linea en varias piezas.
    const plano = texto.split(String.fromCharCode(10)).join("");
    expect(plano).toContain("Total Zona Norte");
    expect(plano.split("Sin pedidos programados.").length - 1).toBe(2);
    // Nada quedo truncado por falta de ancho de columna: la libreria marca el
    // recorte con puntos suspensivos (0x85 en WinAnsi, o el caracter Unicode).
    const ELIPSIS = new RegExp(String.fromCharCode(0x85) + "|" + String.fromCharCode(0x2026));
    expect(texto).not.toMatch(ELIPSIS);
  }, 60_000);
});
