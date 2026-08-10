import { describe, expect, it } from "vitest";
import { parsePortapapeles } from "@/lib/portapapeles";

describe("parsePortapapeles (pegar desde Excel / Google Sheets)", () => {
  it("separa celdas por tabulación y filas por salto de línea", () => {
    const texto = "10\t07:00\n12\t07:15\n9\t07:30";
    expect(parsePortapapeles(texto)).toEqual([
      ["10", "07:00"],
      ["12", "07:15"],
      ["9", "07:30"],
    ]);
  });

  it("acepta CRLF de Windows y quita el salto final que agrega Excel", () => {
    const texto = "10\t07:00\r\n12\t07:15\r\n";
    expect(parsePortapapeles(texto)).toEqual([
      ["10", "07:00"],
      ["12", "07:15"],
    ]);
  });

  it("una sola celda pegada", () => {
    expect(parsePortapapeles("07:45")).toEqual([["07:45"]]);
  });

  it("texto vacío → matriz vacía", () => {
    expect(parsePortapapeles("")).toEqual([]);
  });
});
