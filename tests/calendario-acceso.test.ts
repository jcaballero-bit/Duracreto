// Quién ve el calendario de producción y con qué alcance (pruebas PURAS).
//
// La regla no coincide con `filtroPedidoPorZona` para todos los roles (Almacén no
// tiene límite de zona en el resto del sistema, pero aquí sí), así que se prueba rol
// por rol: si alguien cambia la tabla de acceso, esto lo detecta.
import { describe, expect, it } from "vitest";
import { calcularAlcance } from "@/lib/auth/acceso";
import { accesoCalendario } from "@/lib/produccion/acceso";

const USER = "u-1";
/** Alcance de un usuario con esos roles (zona y planteles opcionales). */
const alc = (roles: string[], zona: string | null = null, planteles: number[] = []) =>
  calcularAlcance(roles, zona, null, null, planteles);

describe("accesoCalendario — acceso completo", () => {
  it.each([["Administrador"], ["GerenteComercial"], ["GerenteControlCalidad"]])(
    "%s ve todo y puede elegir zona",
    (rol) => {
      const a = accesoCalendario(alc([rol]), USER);
      expect(a.visible).toBe(true);
      expect(a.filtro).toEqual({});
      expect(a.zonas).toEqual(["Norte", "Centro Sur"]);
    },
  );
});

describe("accesoCalendario — por plantel y por zona", () => {
  it("el Jefe de Planta ve SOLO sus planteles asignados", () => {
    const a = accesoCalendario(alc(["JefePlanta"], "Norte", [3, 7]), USER);
    expect(a.visible).toBe(true);
    expect(a.filtro).toEqual({ plantel_id: { in: [3, 7] } });
    expect(a.zonas).toEqual([]); // sin selector: su alcance ya lo fija
    expect(a.etiqueta).toBe("Tus planteles");
  });

  it("un Jefe de Planta sin planteles asignados no ve volumen de nadie", () => {
    const a = accesoCalendario(alc(["JefePlanta"], "Norte", []), USER);
    expect(a.filtro).toEqual({ plantel_id: { in: [-1] } });
  });

  it.each([["Programador"], ["Despachador"], ["JefeLaboratorio"], ["Almacen"]])(
    "%s queda acotado a su zona asignada",
    (rol) => {
      const a = accesoCalendario(alc([rol], "Centro Sur"), USER);
      expect(a.visible).toBe(true);
      expect(a.filtro).toEqual({ plantel: { zona: "Centro Sur" } });
      expect(a.zonas).toEqual([]);
      expect(a.etiqueta).toBe("Zona Centro Sur");
    },
  );

  it("Almacén se limita por zona AQUÍ, aunque en el resto del sistema no tenga límite", () => {
    const alcance = alc(["Almacen"], "Norte");
    // En el sistema sus zonas permitidas son ambas…
    expect(alcance.zonasPermitidas).toEqual(["Norte", "Centro Sur"]);
    // …pero el calendario usa SU zona.
    expect(accesoCalendario(alcance, USER).filtro).toEqual({ plantel: { zona: "Norte" } });
  });

  it("un rol por zona sin zona asignada no ve datos y se avisa", () => {
    const a = accesoCalendario(alc(["Programador"], null), USER);
    expect(a).toMatchObject({ visible: true, faltaZona: true, filtro: { plantel_id: -1 } });
  });
});

describe("accesoCalendario — asesor", () => {
  it("el Asesor ve solo el volumen despachado a SUS clientes", () => {
    const a = accesoCalendario(alc(["Asesor"]), USER);
    expect(a.visible).toBe(true);
    expect(a.filtro).toEqual({ cliente: { asesor: { usuario_auth_id: USER } } });
    expect(a.etiqueta).toBe("Tus clientes");
  });

  it("el AsesorRestringido hereda el mismo alcance", () => {
    const a = accesoCalendario(alc(["AsesorRestringido"]), USER);
    expect(a.filtro).toEqual({ cliente: { asesor: { usuario_auth_id: USER } } });
  });

  it("sin usuario en sesión no se muestra nada (mejor de menos que de más)", () => {
    expect(accesoCalendario(alc(["Asesor"]), null).visible).toBe(false);
  });
});

describe("accesoCalendario — roles que NO lo ven", () => {
  it.each([["Laboratorista"], ["Dosificador"]])("%s no ve el calendario", (rol) => {
    const a = accesoCalendario(alc([rol], "Norte"), USER);
    expect(a.visible).toBe(false);
    expect(a.filtro).toEqual({});
  });

  it("sin sesión tampoco se muestra", () => {
    expect(accesoCalendario(null, USER).visible).toBe(false);
  });

  it("un rol desconocido no gana acceso por descarte", () => {
    expect(accesoCalendario(alc(["RolNuevo"]), USER).visible).toBe(false);
  });
});

describe("accesoCalendario — usuarios con varios roles", () => {
  it("gana el alcance más amplio: Laboratorista + Programador ve su zona", () => {
    const a = accesoCalendario(alc(["Laboratorista", "Programador"], "Norte"), USER);
    expect(a.visible).toBe(true);
    expect(a.filtro).toEqual({ plantel: { zona: "Norte" } });
  });

  it("Administrador + Dosificador sigue viendo todo", () => {
    const a = accesoCalendario(alc(["Dosificador", "Administrador"], "Norte"), USER);
    expect(a.filtro).toEqual({});
    expect(a.zonas).toHaveLength(2);
  });

  it("Jefe de Planta + Asesor manda el plantel (alcance operativo)", () => {
    const a = accesoCalendario(alc(["Asesor", "JefePlanta"], "Norte", [5]), USER);
    expect(a.filtro).toEqual({ plantel_id: { in: [5] } });
    expect(a.etiqueta).toBe("Tu plantel");
  });
});
