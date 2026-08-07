// Pruebas PURAS de las reglas de acceso (rol + zona + fecha).
import { describe, expect, it } from "vitest";
import {
  calcularAlcance,
  filtroPedidoPorZona,
  filtroPlantelPorZona,
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

  it("JefeLaboratorio ahora SÍ se limita por zona (Tanda 3, punto 12)", () => {
    const a = calcularAlcance(["JefeLaboratorio"], "Norte");
    expect(a.esJefeLaboratorio).toBe(true);
    expect(a.zonasPermitidas).toEqual(["Norte"]);
  });

  it("GerenteControlCalidad ve ambas zonas (JefeLab sin límite de zona)", () => {
    const a = calcularAlcance(["GerenteControlCalidad"], null);
    expect(a.esGerenteControlCalidad).toBe(true);
    expect(a.zonasPermitidas.length).toBe(2);
  });

  it("Almacen no queda con zona vacía (consulta ambas zonas)", () => {
    const a = calcularAlcance(["Almacen"], null);
    expect(a.esAlmacen).toBe(true);
    expect(a.zonasPermitidas.length).toBe(2);
  });
});

describe("filtros por alcance (Tanda 3)", () => {
  it("Jefe de Planta filtra por el CONJUNTO de sus planteles (M2M)", () => {
    const a = calcularAlcance(["JefePlanta"], "Norte", null, null, [3, 5]);
    expect(filtroPlantelPorZona(a)).toEqual({ id: { in: [3, 5] } });
    expect(filtroPedidoPorZona(a)).toEqual({ plantel_id: { in: [3, 5] } });
  });

  it("Jefe de Planta sin planteles asignados no ve nada", () => {
    const a = calcularAlcance(["JefePlanta"], "Norte", null, null, []);
    expect(filtroPlantelPorZona(a)).toEqual({ id: { in: [-1] } });
  });

  it("JefeLaboratorio filtra pedidos por su zona (no ve ambas)", () => {
    const a = calcularAlcance(["JefeLaboratorio"], "Centro Sur");
    expect(filtroPedidoPorZona(a)).toEqual({ plantel: { zona: { in: ["Centro Sur"] } } });
  });

  it("GerenteControlCalidad no tiene filtro de zona (ve todo)", () => {
    const a = calcularAlcance(["GerenteControlCalidad"], null);
    expect(filtroPedidoPorZona(a)).toEqual({});
    expect(filtroPlantelPorZona(a)).toEqual({});
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

  it("GerenteControlCalidad accede a Laboratorio, Programación y Despacho (como JefeLab)", () => {
    expect(puedeAccederRuta(["GerenteControlCalidad"], "/laboratorio")).toBe(true);
    expect(puedeAccederRuta(["GerenteControlCalidad"], "/programacion")).toBe(true);
    expect(puedeAccederRuta(["GerenteControlCalidad"], "/despacho")).toBe(true);
    expect(puedeAccederRuta(["GerenteControlCalidad"], "/programa")).toBe(true);
    // No entra a Administración.
    expect(puedeAccederRuta(["GerenteControlCalidad"], "/administracion")).toBe(false);
  });

  it("Almacen: SOLO Programa Semana y Programa DPCR-08 (nada más)", () => {
    expect(puedeAccederRuta(["Almacen"], "/clientes/semana")).toBe(true);
    expect(puedeAccederRuta(["Almacen"], "/programa")).toBe(true);
    expect(puedeAccederRuta(["Almacen"], "/despacho")).toBe(false);
    expect(puedeAccederRuta(["Almacen"], "/programacion")).toBe(false);
    expect(puedeAccederRuta(["Almacen"], "/comercial")).toBe(false);
    expect(puedeAccederRuta(["Almacen"], "/flota")).toBe(false);
    expect(puedeAccederRuta(["Almacen"], "/administracion")).toBe(false);
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
