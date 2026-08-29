// Sello de versión que muestra "Acerca de DURACRETO Logistics" (puro).
//
// Lo que se protege: que la versión IDENTIFIQUE el despliegue. Cuando alguien reporta
// "no me guarda el salario", lo primero que hay que saber es qué código está viendo; si
// este sello miente o se queda pegado, la pregunta no tiene respuesta.
import { describe, expect, it } from "vitest";
import { DESARROLLADOR, infoVersion } from "@/lib/version";

const ENV = {
  APP_BUILD_ISO: "2026-08-28T15:30:00.000Z",
  APP_COMMIT: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
  APP_RAMA: "main",
  APP_VERSION_PAQUETE: "0.1.0",
};

describe("infoVersion", () => {
  it("la versión es de calendario y sale de la fecha del build", () => {
    // Se actualiza sola con cada compilación: nadie tiene que acordarse de subir un
    // número a mano, que es justo lo que se pidió.
    expect(infoVersion(ENV).version).toBe("2026.08.28");
  });

  it("el build es el commit corto, que hace única cada compilación", () => {
    expect(infoVersion(ENV).build).toBe("a1b2c3d");
    expect(infoVersion(ENV).commit).toBe(ENV.APP_COMMIT);
  });

  it("dos builds del mismo día se distinguen por el commit", () => {
    // La fecha sola no alcanza: en un día se despliega varias veces.
    const a = infoVersion({ ...ENV, APP_COMMIT: "1111111aaa" });
    const b = infoVersion({ ...ENV, APP_COMMIT: "2222222bbb" });
    expect(a.version).toBe(b.version);
    expect(a.build).not.toBe(b.build);
  });

  it("distingue producción de desarrollo", () => {
    expect(infoVersion(ENV, true).entorno).toBe("Producción");
    expect(infoVersion(ENV, false).entorno).toBe("Desarrollo");
  });

  it("la fecha del build se muestra legible y conserva el ISO para el <time>", () => {
    const i = infoVersion(ENV);
    expect(i.compiladoIso).toBe(ENV.APP_BUILD_ISO);
    expect(i.compiladoEn).toContain("2026");
    expect(i.compiladoEn).not.toBe("desconocido");
  });

  it("sin sello (build sin git, o variables ausentes) NO revienta: dice 'desconocido'", () => {
    // Un despliegue no puede fallar porque no se pudo leer el commit; en el peor caso la
    // pantalla lo admite.
    const vacio = infoVersion({});
    expect(vacio.version).toBe("desconocido");
    expect(vacio.build).toBe("desconocido");
    expect(vacio.commit).toBe("desconocido");
    expect(vacio.rama).toBe("desconocido");
    expect(vacio.compiladoEn).toBe("desconocido");
  });

  it("una fecha inválida tampoco revienta", () => {
    const malo = infoVersion({ ...ENV, APP_BUILD_ISO: "no-es-una-fecha" });
    expect(malo.version).toBe("desconocido");
    expect(malo.compiladoEn).toBe("desconocido");
    // Pero el commit sigue sirviendo para identificar el build.
    expect(malo.build).toBe("a1b2c3d");
  });

  it("recorta los espacios que puede dejar la salida de git", () => {
    const i = infoVersion({ ...ENV, APP_COMMIT: "  a1b2c3d4  ", APP_RAMA: " main\n" });
    expect(i.build).toBe("a1b2c3d");
    expect(i.rama).toBe("main");
  });
});

describe("créditos", () => {
  it("el desarrollador es el que va en el panel", () => {
    expect(DESARROLLADOR).toBe("Ing. Arturo Caballero");
  });
});
