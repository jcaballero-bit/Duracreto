// Pruebas PURAS de las reglas de acceso (rol + zona + fecha).
import { describe, expect, it } from "vitest";
import {
  calcularAlcance,
  puedeAccederRuta,
  puedeOperarEnFecha,
  rolesDeRuta,
} from "@/lib/auth/acceso";

describe("calcularAlcance", () => {
  it("Administrador ve ambas zonas", () => {
    const a = calcularAlcance(["Administrador"], null);
    expect(a.esAdmin).toBe(true);
    expect(a.zonasPermitidas.sort()).toEqual(["Centro Sur", "Norte"]);
  });

  it("Programador Norte se limita a su zona", () => {
    const a = calcularAlcance(["Programador"], "Norte");
    expect(a.esProgramador).toBe(true);
    expect(a.zonasPermitidas).toEqual(["Norte"]);
  });

  it("Despachador sin zona no ve ninguna", () => {
    const a = calcularAlcance(["Despachador"], null);
    expect(a.zonasPermitidas).toEqual([]);
  });

  it("Asesor no tiene límite de zona (se limita por cliente)", () => {
    const a = calcularAlcance(["Asesor"], null);
    expect(a.zonasPermitidas.length).toBe(2);
  });
});

describe("acceso a rutas por rol", () => {
  it("solo Administrador entra a /administracion", () => {
    expect(puedeAccederRuta(["Administrador"], "/administracion")).toBe(true);
    expect(puedeAccederRuta(["Programador"], "/administracion")).toBe(false);
    expect(puedeAccederRuta(["Despachador"], "/administracion")).toBe(false);
  });

  it("Programador entra a /programacion y a /despacho (solo lectura + agregar)", () => {
    expect(puedeAccederRuta(["Programador"], "/programacion")).toBe(true);
    // El Programador ve el despacho en solo lectura y puede agregar adiciones.
    expect(puedeAccederRuta(["Programador"], "/despacho")).toBe(true);
    // Pero sigue sin acceso a Administración.
    expect(puedeAccederRuta(["Programador"], "/administracion")).toBe(false);
  });

  it("Despachador entra a /despacho pero no a /programacion", () => {
    expect(puedeAccederRuta(["Despachador"], "/despacho")).toBe(true);
    expect(puedeAccederRuta(["Despachador"], "/programacion")).toBe(false);
  });

  it("match por prefijo en rutas anidadas", () => {
    expect(rolesDeRuta("/programacion/nuevo")).toContain("Programador");
  });
});

describe("reglas de fecha por rol", () => {
  const hoy = new Date("2026-07-15T10:00:00");
  const ayer = new Date("2026-07-14T10:00:00");
  const manana = new Date("2026-07-16T10:00:00");

  it("Programador: hoy en adelante, no el pasado", () => {
    const a = calcularAlcance(["Programador"], "Norte");
    expect(puedeOperarEnFecha(a, hoy, hoy)).toBe(true);
    expect(puedeOperarEnFecha(a, manana, hoy)).toBe(true);
    expect(puedeOperarEnFecha(a, ayer, hoy)).toBe(false);
  });

  it("Despachador: solo hoy", () => {
    const a = calcularAlcance(["Despachador"], "Norte");
    expect(puedeOperarEnFecha(a, hoy, hoy)).toBe(true);
    expect(puedeOperarEnFecha(a, manana, hoy)).toBe(false);
    expect(puedeOperarEnFecha(a, ayer, hoy)).toBe(false);
  });

  it("Administrador: cualquier fecha", () => {
    const a = calcularAlcance(["Administrador"], null);
    expect(puedeOperarEnFecha(a, ayer, hoy)).toBe(true);
    expect(puedeOperarEnFecha(a, manana, hoy)).toBe(true);
  });
});
