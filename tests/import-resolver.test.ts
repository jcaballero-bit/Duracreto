// Pruebas PURAS del resolutor de importación CSV.
import { describe, expect, it } from "vitest";
import { resolverFila, type Mapas } from "@/app/administracion/import-resolver";
import { normalizarEncabezado } from "@/app/administracion/columnas";

const mapas: Mapas = {
  plantel: new Map([["santa marta", 1], ["choloma", 2]]),
  operador: new Map([["motorista 01", 10]]),
  asesor: new Map([["ana asesora", 20]]),
};

describe("normalizarEncabezado", () => {
  it("minúsculas, sin tildes, espacios/símbolos → _", () => {
    expect(normalizarEncabezado("  Plantel Base ")).toBe("plantel_base");
    expect(normalizarEncabezado("Teléfono")).toBe("telefono");
    expect(normalizarEncabezado("Capacidad-m3/h")).toBe("capacidad_m3_h");
  });
});

describe("resolverFila", () => {
  it("planteles: válido", () => {
    const r = resolverFila("planteles", {
      nombre: "Nuevo", zona: "Norte", capacidad_dosificacion_m3h: "28", hub: "Santa Marta",
    }, mapas);
    expect("data" in r).toBe(true);
    if ("data" in r) {
      expect(r.data.zona).toBe("Norte");
      expect(r.data.hub_id).toBe(1);
    }
  });

  it("planteles: zona inválida da error", () => {
    const r = resolverFila("planteles", {
      nombre: "X", zona: "Occidente", capacidad_dosificacion_m3h: "28", hub: "",
    }, mapas);
    expect("error" in r && /zona/.test(r.error)).toBe(true);
  });

  it("plantas: plantel inexistente da error", () => {
    const r = resolverFila("plantas", { nombre: "P1", plantel: "Inexistente", capacidad_m3h: "45" }, mapas);
    expect("error" in r && /no existe/.test(r.error)).toBe(true);
  });

  it("mixers: resuelve plantel_base y operador por nombre", () => {
    const r = resolverFila("mixers", {
      marca: "Mack", capacidad_m3: "11", plantel_base: "Choloma", estado: "", operador: "Motorista 01",
    }, mapas);
    expect("data" in r).toBe(true);
    if ("data" in r) {
      expect(r.data.plantel_base_id).toBe(2);
      expect(r.data.operador_asignado_id).toBe(10);
      expect(r.data.estado).toBe("Disponible"); // default
    }
  });

  it("disenos: revenimiento requerido", () => {
    const r = resolverFila("disenos", { codigo: "", resistencia: "4,000", tamano_agregado: '3/4"', revenimiento: "", aditivo: "" }, mapas);
    expect("error" in r).toBe(true);
  });
});
