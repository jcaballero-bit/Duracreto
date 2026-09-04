// Reglas del préstamo de unidades a otro plantel (puras, sin base).
import { describe, expect, it } from "vitest";
import {
  avisosDePrestamo,
  esTipoPrestable,
  etiquetaTipo,
  indexarPrestamos,
  participaEnMotor,
  plantelEfectivo,
  unidadesDisponiblesEn,
  validarPrestamo,
} from "@/lib/flota/prestamos";

const SM = 1; // Santa Marta (hub del Norte)
const CHO = 2; // Choloma (sin flota propia)
const VIL = 3; // Villanueva (sin flota propia)
const PC = 4; // Puerto Cortés (con flota propia)

describe("tipos de unidad prestables", () => {
  it("acepta los cuatro tipos de la flota y rechaza cualquier otro", () => {
    for (const t of ["Mixer", "Bomba", "Camion", "Pickup"]) {
      expect(esTipoPrestable(t), t).toBe(true);
    }
    expect(esTipoPrestable("Planta")).toBe(false);
    expect(esTipoPrestable("")).toBe(false);
    expect(esTipoPrestable(null)).toBe(false);
  });

  it("distingue los que participan en el motor de los que solo se coordinan", () => {
    // Mixers y bombas cambian lo que el motor puede asignar; camiones y pickups no
    // los asigna el motor, asi que su prestamo es un registro de coordinacion.
    expect(participaEnMotor("Mixer")).toBe(true);
    expect(participaEnMotor("Bomba")).toBe(true);
    expect(participaEnMotor("Camion")).toBe(false);
    expect(participaEnMotor("Pickup")).toBe(false);
  });

  it("tiene una etiqueta legible para cada tipo", () => {
    expect(etiquetaTipo("Camion")).toBe("Camión");
    expect(etiquetaTipo("Pickup")).toBe("Pickup / vehículo");
    // Un tipo desconocido se muestra tal cual en vez de quedar vacio.
    expect(etiquetaTipo("Otro")).toBe("Otro");
  });
});

describe("validación del préstamo", () => {
  const base = { unidadTipo: "Mixer", unidadId: 7, origenId: SM };

  it("acepta un préstamo a otro plantel", () => {
    expect(validarPrestamo({ ...base, destinoId: CHO })).toBeNull();
  });

  it("rechaza prestar una unidad a su propio plantel", () => {
    expect(validarPrestamo({ ...base, destinoId: SM })).toMatch(/ya es de ese plantel/i);
  });

  it("rechaza un tipo, una unidad o un destino inválidos", () => {
    expect(validarPrestamo({ ...base, unidadTipo: "Planta", destinoId: CHO })).toMatch(/tipo/i);
    expect(validarPrestamo({ ...base, unidadId: 0, destinoId: CHO })).toMatch(/unidad/i);
    expect(validarPrestamo({ ...base, destinoId: 0 })).toMatch(/plantel/i);
  });
});

describe("dónde está efectivamente una unidad", () => {
  it("en su plantel base si no está prestada", () => {
    expect(plantelEfectivo(SM, null)).toBe(SM);
  });

  it("en el plantel destino si está prestada", () => {
    expect(plantelEfectivo(SM, { destinoId: CHO })).toBe(CHO);
  });
});

describe("unidades disponibles en un plantel, aplicando los préstamos", () => {
  // Flota: 3 mixers de Santa Marta y 1 de Puerto Cortés.
  const mixers = [
    { id: 10, plantel_base_id: SM },
    { id: 11, plantel_base_id: SM },
    { id: 12, plantel_base_id: SM },
    { id: 20, plantel_base_id: PC },
  ];
  const ids = (xs: { id: number }[]) => xs.map((x) => x.id).sort((a, b) => a - b);

  it("sin préstamos se comporta EXACTAMENTE como antes (plantel + hub)", () => {
    const vacio = indexarPrestamos([]);
    // Choloma con hub Santa Marta: los 3 de SM.
    expect(ids(unidadesDisponiblesEn(mixers, [CHO, SM], "Mixer", vacio))).toEqual([10, 11, 12]);
    // Santa Marta sola: los suyos.
    expect(ids(unidadesDisponiblesEn(mixers, [SM], "Mixer", vacio))).toEqual([10, 11, 12]);
    // Puerto Cortés con su hub: el propio + los del hub.
    expect(ids(unidadesDisponiblesEn(mixers, [PC, SM], "Mixer", vacio))).toEqual([10, 11, 12, 20]);
  });

  it("una unidad prestada SALE de su plantel base", () => {
    const p = indexarPrestamos([{ unidadTipo: "Mixer", unidadId: 10, destinoId: CHO }]);
    // Santa Marta ya no puede usar el 10: fisicamente esta en Choloma.
    expect(ids(unidadesDisponiblesEn(mixers, [SM], "Mixer", p))).toEqual([11, 12]);
  });

  it("y ENTRA en el plantel destino", () => {
    const p = indexarPrestamos([{ unidadTipo: "Mixer", unidadId: 20, destinoId: CHO }]);
    // Choloma (hub SM) suma el mixer de Puerto Cortes, que su hub no le daria.
    expect(ids(unidadesDisponiblesEn(mixers, [CHO, SM], "Mixer", p))).toEqual([10, 11, 12, 20]);
  });

  it("sale también del RESTO de la zona, no solo de su base", () => {
    // Esta es la diferencia con el pool del hub: prestar a Choloma COMPROMETE la
    // unidad, asi que Villanueva (otro dependiente del mismo hub) ya no la ve.
    const p = indexarPrestamos([{ unidadTipo: "Mixer", unidadId: 10, destinoId: CHO }]);
    expect(ids(unidadesDisponiblesEn(mixers, [VIL, SM], "Mixer", p))).toEqual([11, 12]);
    expect(ids(unidadesDisponiblesEn(mixers, [CHO, SM], "Mixer", p))).toEqual([10, 11, 12]);
  });

  it("el préstamo es por TIPO: un mixer y una bomba con el mismo id no se confunden", () => {
    const p = indexarPrestamos([{ unidadTipo: "Bomba", unidadId: 10, destinoId: CHO }]);
    // El prestamo es de la BOMBA 10, asi que el MIXER 10 sigue en Santa Marta.
    expect(ids(unidadesDisponiblesEn(mixers, [SM], "Mixer", p))).toEqual([10, 11, 12]);
  });

  it("no muta el arreglo de unidades que recibe", () => {
    const p = indexarPrestamos([{ unidadTipo: "Mixer", unidadId: 10, destinoId: CHO }]);
    const antes = ids(mixers);
    unidadesDisponiblesEn(mixers, [SM], "Mixer", p);
    expect(ids(mixers)).toEqual(antes);
  });
});

describe("avisos antes de prestar", () => {
  const ok = {
    enMantenimiento: false,
    estadoUnidad: "Disponible",
    viajesComprometidos: 0,
    participaEnMotor: true,
  };

  it("una unidad disponible y sin compromisos no tiene nada que avisar", () => {
    const a = avisosDePrestamo(ok);
    expect(a.bloqueante).toBeNull();
    expect(a.advertencias).toEqual([]);
  });

  it("BLOQUEA una unidad con mantenimiento ese día, y dice el rango", () => {
    const a = avisosDePrestamo({
      ...ok,
      enMantenimiento: true,
      rangoMantenimiento: "10/09/2026 al 12/09/2026",
    });
    expect(a.bloqueante).toMatch(/10\/09\/2026 al 12\/09\/2026/);
  });

  it("BLOQUEA una unidad que no está Disponible, y dice en qué estado está", () => {
    const a = avisosDePrestamo({ ...ok, estadoUnidad: "Dañado" });
    expect(a.bloqueante).toMatch(/Dañado/);
  });

  it("ADVIERTE (sin bloquear) si la unidad ya tiene viajes ese día", () => {
    const a = avisosDePrestamo({ ...ok, viajesComprometidos: 3 });
    expect(a.bloqueante).toBeNull();
    expect(a.advertencias[0]).toMatch(/3 viajes programados/);
    expect(a.advertencias[0]).toMatch(/se quedan sin unidad/);
  });

  it("la advertencia concuerda en singular", () => {
    const a = avisosDePrestamo({ ...ok, viajesComprometidos: 1 });
    expect(a.advertencias[0]).toMatch(/1 viaje programado ese/);
  });

  it("ADVIERTE que un camión o pickup no lo asigna el motor", () => {
    const a = avisosDePrestamo({ ...ok, participaEnMotor: false });
    expect(a.bloqueante).toBeNull();
    expect(a.advertencias.join(" ")).toMatch(/no los asigna el motor/i);
  });

  it("el mantenimiento manda sobre las demás advertencias", () => {
    // Si esta de baja no se presta, y no tiene sentido enumerar consecuencias de algo
    // que no va a pasar.
    const a = avisosDePrestamo({ ...ok, enMantenimiento: true, viajesComprometidos: 5 });
    expect(a.bloqueante).not.toBeNull();
    expect(a.advertencias).toEqual([]);
  });
});
