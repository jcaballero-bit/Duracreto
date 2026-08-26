// Lectura e interpretación del archivo del reloj biométrico (módulos PUROS).
//
// El archivo NO es un .xlsx ni un .xls con contenedor OLE2: es un flujo BIFF crudo con
// celdas en formato BIFF2, todas de texto. Aquí se prueba que se lee, que los formatos
// ajenos se rechazan con un mensaje claro, y que la interpretación respeta las reglas
// que no se negocian: fecha d/M/yyyy, cruce de medianoche, ausencia sin horas y que los
// cálculos del propio reloj se ignoran.
import { describe, expect, it } from "vitest";
import { ArchivoNoSoportado, leerHojaBiff } from "@/lib/biometrico/biff";
import {
  interpretarArchivo,
  iso,
  parsearFechaDMY,
  parsearHoraHM,
} from "@/lib/biometrico/parseo";
import { archivoDePruebas, construirArchivoReloj, matrizReloj } from "./biometrico-fixture";

describe("lectura del archivo (BIFF crudo)", () => {
  it("lee las celdas de texto con su fila y columna", () => {
    const bytes = archivoDePruebas([
      { codigo: "2000002", nombre: "Basilio Sanchez", fecha: "17/8/2026", entrada: "06:42", salida: "15:10" },
    ]);
    const hoja = leerHojaBiff(bytes);
    expect(hoja.filas[0][1]).toBe("Código");
    expect(hoja.filas[0][9]).toBe("Marca/Ent.");
    expect(hoja.filas[1][1]).toBe("2000002");
    expect(hoja.filas[1][5]).toBe("17/8/2026");
    expect(hoja.filas[1][9]).toBe("06:42");
    expect(hoja.filas[1][10]).toBe("15:10");
    expect(hoja.celdas).toBeGreaterThan(29);
  });

  it("las 29 columnas se conservan aunque haya celdas vacías", () => {
    const bytes = archivoDePruebas([
      { codigo: "1", nombre: "A", fecha: "17/8/2026", ausente: true },
    ]);
    const hoja = leerHojaBiff(bytes);
    expect(hoja.filas[0]).toHaveLength(29);
    expect(hoja.filas[1]).toHaveLength(29);
    expect(hoja.filas[1][15]).toBe("True");
    expect(hoja.filas[1][9]).toBe(""); // sin marca de entrada
  });

  it("rechaza un .xlsx con un mensaje que dice qué hacer", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(() => leerHojaBiff(zip)).toThrow(ArchivoNoSoportado);
    expect(() => leerHojaBiff(zip)).toThrow(/\.xlsx/);
  });

  it("rechaza un .xls moderno (OLE2), que es lo que queda si se reabre en Excel", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => leerHojaBiff(ole)).toThrow(/OLE2|Excel/i);
  });

  it("rechaza HTML disfrazado de .xls", () => {
    const html = new TextEncoder().encode("<html><table><tr><td>1</td></tr></table></html>");
    expect(() => leerHojaBiff(html)).toThrow(/HTML/i);
  });

  it("un archivo sin celdas de texto no pasa como hoja vacía", () => {
    // Solo BOF + EOF.
    const bytes = construirArchivoReloj([]);
    expect(() => leerHojaBiff(bytes)).toThrow(/no trae celdas/i);
  });

  it("un registro truncado no rompe la lectura de lo anterior", () => {
    const completo = archivoDePruebas([
      { codigo: "2000002", nombre: "Basilio", fecha: "17/8/2026", entrada: "06:42", salida: "15:10" },
    ]);
    const cortado = completo.slice(0, completo.length - 12);
    const hoja = leerHojaBiff(cortado);
    expect(hoja.filas[1][1]).toBe("2000002");
  });
});

describe("parseo de fecha d/M/yyyy (día primero)", () => {
  it("17/8/2026 es el 17 de agosto", () => {
    const d = parsearFechaDMY("17/8/2026")!;
    expect(iso(d)).toBe("2026-08-17");
    expect(d.getDate()).toBe(17);
    expect(d.getMonth()).toBe(7); // agosto
  });

  it("8/9/2026 es el 8 de SEPTIEMBRE (dia primero), no el 9 de agosto", () => {
    // Este es el caso que se corrompería con un parser estadounidense (mes primero):
    // leería "8/9" como 9 de agosto y movería el registro de periodo.
    const d = parsearFechaDMY("8/9/2026")!;
    expect(iso(d)).toBe("2026-09-08");
    expect(d.getDate()).toBe(8);
    expect(d.getMonth()).toBe(8); // mes 9 = septiembre
  });

  it("día y mes ambiguos se resuelven SIEMPRE con el día primero", () => {
    expect(iso(parsearFechaDMY("3/4/2026")!)).toBe("2026-04-03"); // 3 de abril
    expect(iso(parsearFechaDMY("12/1/2026")!)).toBe("2026-01-12"); // 12 de enero
  });

  it("rechaza lo que no calza con el formato o no existe en el calendario", () => {
    expect(parsearFechaDMY("2026-08-17")).toBeNull();
    expect(parsearFechaDMY("17/13/2026")).toBeNull();
    expect(parsearFechaDMY("31/2/2026")).toBeNull(); // no rebota a marzo
    expect(parsearFechaDMY("")).toBeNull();
    expect(parsearFechaDMY("17/8/26")).toBeNull();
  });

  it("las horas se leen en minutos del día y se rechaza lo inválido", () => {
    expect(parsearHoraHM("06:42")).toBe(402);
    expect(parsearHoraHM("20:50")).toBe(1250);
    expect(parsearHoraHM("04:50:21")).toBe(290);
    expect(parsearHoraHM("25:00")).toBeNull();
    expect(parsearHoraHM("6.42")).toBeNull();
  });
});

describe("interpretación del contenido", () => {
  it("detecta el rango de fechas leyendo los DATOS, no el nombre del archivo", () => {
    // Igual que el archivo real: se llama "17-21" pero trae hasta el 25.
    const filas = ["17", "18", "19", "20", "21", "22", "23", "24", "25"].map((d) => ({
      codigo: "2000002",
      nombre: "Basilio Sanchez",
      fecha: `${d}/8/2026`,
      entrada: "06:42",
      salida: "15:10",
    }));
    const r = interpretarArchivo(matrizReloj(filas));
    expect(r.fechas).toHaveLength(9);
    expect(iso(r.desde!)).toBe("2026-08-17");
    expect(iso(r.hasta!)).toBe("2026-08-25");
  });

  it("cuenta personas distintas por CÓDIGO, no por nombre", () => {
    const r = interpretarArchivo(
      matrizReloj([
        { codigo: "2000002", nombre: "RONY RIOS", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
        { codigo: "2000002", nombre: "Rony Rios", fecha: "18/8/2026", entrada: "07:00", salida: "15:00" },
        { codigo: "2000003", nombre: "RONY RIOS", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
      ]),
    );
    // Dos códigos = dos personas, aunque el nombre venga escrito de tres formas.
    expect(r.personas).toHaveLength(2);
    expect(r.personas.find((p) => p.codigo === "2000002")!.registros).toBe(2);
  });

  it("el cruce de medianoche manda la salida al día siguiente", () => {
    const r = interpretarArchivo(
      matrizReloj([
        { codigo: "1", nombre: "Darlin Martinez", fecha: "20/8/2026", entrada: "06:28", salida: "01:00" },
      ]),
    );
    const reg = r.registros[0];
    expect(reg.cruzaMedianoche).toBe(true);
    expect(iso(reg.fecha)).toBe("2026-08-20");
    expect(iso(reg.salida!)).toBe("2026-08-21"); // día siguiente
    expect(reg.salida!.getTime() - reg.entrada!.getTime()).toBeGreaterThan(0);
    expect(r.crucesMedianoche).toBe(1);
  });

  it("una ausencia entra sin marcas y no como jornada de cero horas", () => {
    const r = interpretarArchivo(
      matrizReloj([{ codigo: "1", nombre: "A", fecha: "17/8/2026", ausente: true }]),
    );
    const reg = r.registros[0];
    expect(reg.ausente).toBe(true);
    expect(reg.entrada).toBeNull();
    expect(reg.salida).toBeNull();
    expect(r.ausencias).toBe(1);
    expect(r.conMarcas).toBe(0);
  });

  it("una fila con una sola marca se importa y queda señalada, sin inventar la otra", () => {
    const r = interpretarArchivo(
      matrizReloj([
        { codigo: "1", nombre: "A", fecha: "17/8/2026", entrada: "06:42" },
        { codigo: "2", nombre: "B", fecha: "17/8/2026", salida: "15:10" },
      ]),
    );
    expect(r.registros).toHaveLength(2);
    expect(r.registros[0].incompleta).toBe(true);
    expect(r.registros[0].salida).toBeNull();
    expect(r.registros[1].entrada).toBeNull();
    expect(r.incompletas).toBe(2);
    expect(r.problemas.filter((p) => p.motivo === "marca_incompleta")).toHaveLength(2);
  });

  it("guarda la fila cruda del reloj como referencia, incluido su Tiempo HE", () => {
    const r = interpretarArchivo(
      matrizReloj([
        {
          codigo: "2000002",
          nombre: "Basilio Sanchez",
          fecha: "18/8/2026",
          entrada: "06:43",
          salida: "20:50",
          tiempoHE: "04:50:21",
        },
      ]),
    );
    // El dato del reloj queda para trazabilidad, pero es solo referencia: las horas se
    // calculan aparte con las bandas de recargo.
    expect(r.registros[0].crudo["Tiempo HE"]).toBe("04:50:21");
    expect(r.registros[0].crudo["Departamento"]).toBe("Produccion SPS");
  });

  it("reporta las filas sin código y sin fecha válida, sin abortar el resto", () => {
    const matriz = matrizReloj([
      { codigo: "", nombre: "Sin codigo", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
      { codigo: "2", nombre: "Fecha mala", fecha: "17-08-2026", entrada: "07:00", salida: "15:00" },
      { codigo: "3", nombre: "Buena", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
    ]);
    const r = interpretarArchivo(matriz);
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0].codigo).toBe("3");
    expect(r.problemas.map((p) => p.motivo).sort()).toEqual(["fecha_invalida", "sin_codigo"]);
  });

  it("una segunda fila para el mismo código y día se reporta como duplicada", () => {
    const r = interpretarArchivo(
      matrizReloj([
        { codigo: "1", nombre: "A", fecha: "17/8/2026", entrada: "06:00", salida: "14:00" },
        { codigo: "1", nombre: "A", fecha: "17/8/2026", entrada: "15:00", salida: "18:00" },
      ]),
    );
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0].entrada!.getHours()).toBe(6); // se conserva la primera
    expect(r.problemas[0].motivo).toBe("duplicada");
  });

  it("avisa si los encabezados no calzan con el formato conocido", () => {
    const matriz = matrizReloj([
      { codigo: "1", nombre: "A", fecha: "17/8/2026", entrada: "07:00", salida: "15:00" },
    ]);
    matriz[0][5] = "Dia"; // el reloj cambió el encabezado de Fecha
    const r = interpretarArchivo(matriz);
    expect(r.encabezadosInesperados).toHaveLength(1);
    expect(r.encabezadosInesperados[0]).toContain("Fecha");
    // Aun así interpreta por posición, para no bloquear la importación.
    expect(r.registros).toHaveLength(1);
  });

  it("lista los departamentos que trae el archivo", () => {
    const r = interpretarArchivo(
      matrizReloj([
        { codigo: "1", nombre: "A", fecha: "17/8/2026", entrada: "07:00", salida: "15:00", departamento: "TALLER SPS" },
        { codigo: "2", nombre: "B", fecha: "17/8/2026", entrada: "07:00", salida: "15:00", departamento: "JUTOSA" },
        { codigo: "3", nombre: "C", fecha: "17/8/2026", entrada: "07:00", salida: "15:00", departamento: "TALLER SPS" },
      ]),
    );
    expect(r.departamentos).toEqual(["JUTOSA", "TALLER SPS"]);
  });
});
