// Pruebas PURAS de la plantilla/parseo CSV (Excel-friendly + round-trip).
import { describe, expect, it } from "vitest";
import { generarPlantilla, parseCSV } from "@/lib/csv";

describe("plantilla CSV para Excel", () => {
  it("incluye BOM y la directiva sep=; para abrir en columnas", () => {
    const p = generarPlantilla(["nombre", "estado"]);
    expect(p.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(p).toContain("sep=;");
    expect(p).toContain("nombre;estado");
  });

  it("round-trip: la MISMA plantilla + datos se vuelve a subir bien", () => {
    const plantilla = generarPlantilla(["nombre", "estado"]);
    const archivo = plantilla + "Motorista 09;Disponible\r\nAna;No disponible\r\n";
    const filas = parseCSV(archivo);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toEqual({ nombre: "Motorista 09", estado: "Disponible" });
    expect(filas[1].estado).toBe("No disponible");
  });

  it("autodetecta separador coma cuando no hay directiva", () => {
    const filas = parseCSV("empresa,proyecto\nACME,Obra\n");
    expect(filas[0]).toEqual({ empresa: "ACME", proyecto: "Obra" });
  });

  it("soporta comillas dobles con separador dentro", () => {
    const filas = parseCSV('nombre;correo\n"Uno; y dos";a@b.com\n');
    expect(filas[0].nombre).toBe("Uno; y dos");
  });
});
