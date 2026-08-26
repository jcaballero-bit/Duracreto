// Alcance de la pantalla de Asistencia (módulo PURO) + la regla estricta de que la
// pantalla NO muestra dinero.
//
// El alcance se prueba aparte de `filtroPlantelPorZona` porque esta pantalla se abre a
// un conjunto propio de roles: Admin todo, Jefe de Planta sus planteles, Programador su
// zona. Un rol sin alcance no debe "ver todo" por descarte.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calcularAlcance } from "@/lib/auth/acceso";
import {
  alcanceAsistencia,
  filtroPersonalPorAlcance,
  puedeEditarPersona,
} from "@/lib/asistencia/acceso";

const PLANTELES_NORTE = [1, 2, 3];
const deZona = (zonas: string[]) => (zonas.includes("Norte") ? PLANTELES_NORTE : [9]);

describe("alcance por rol", () => {
  it("el Administrador ve todo, incluida la gente sin plantel asignado", () => {
    const a = alcanceAsistencia(calcularAlcance(["Administrador"], null), deZona);
    expect(a.todos).toBe(true);
    expect(a.puedeEditar).toBe(true);
    expect(filtroPersonalPorAlcance(a)).toEqual({});
    expect(puedeEditarPersona(a, null)).toBe(true);
    expect(puedeEditarPersona(a, 7)).toBe(true);
  });

  it("el Jefe de Planta solo ve y edita SUS planteles asignados", () => {
    const a = alcanceAsistencia(
      calcularAlcance(["JefePlanta"], null, null, null, [5, 6]),
      deZona,
    );
    expect(a.todos).toBe(false);
    expect(a.plantelIds).toEqual([5, 6]);
    expect(filtroPersonalPorAlcance(a)).toEqual({ plantel_asignado_id: { in: [5, 6] } });
    expect(puedeEditarPersona(a, 5)).toBe(true);
    expect(puedeEditarPersona(a, 7)).toBe(false);
    // Sin plantel asignado, solo el Administrador lo maneja.
    expect(puedeEditarPersona(a, null)).toBe(false);
  });

  it("un Jefe de Planta SIN planteles no ve nada (no lo ve todo)", () => {
    const a = alcanceAsistencia(calcularAlcance(["JefePlanta"], null, null, null, []), deZona);
    expect(a.todos).toBe(false);
    expect(a.plantelIds).toEqual([-1]);
    expect(puedeEditarPersona(a, 1)).toBe(false);
  });

  it("el Programador ve los planteles de su zona", () => {
    const a = alcanceAsistencia(calcularAlcance(["Programador"], "Norte"), deZona);
    expect(a.plantelIds).toEqual(PLANTELES_NORTE);
    expect(a.etiqueta).toBe("Zona Norte");
    expect(puedeEditarPersona(a, 2)).toBe(true);
    expect(puedeEditarPersona(a, 9)).toBe(false);
  });

  it("un rol sin alcance definido no ve nada y no puede editar", () => {
    const a = alcanceAsistencia(calcularAlcance(["Asesor"], "Norte"), deZona);
    expect(a.todos).toBe(false);
    expect(a.plantelIds).toEqual([-1]);
    expect(a.puedeEditar).toBe(false);
    expect(puedeEditarPersona(a, 1)).toBe(false);
  });
});

describe("la pantalla de Asistencia no muestra dinero", () => {
  it("no importa los módulos de dinero ni nombra salarios o tarifas", () => {
    // Regla estricta del requerimiento: aquí solo se ven horas. Se comprueba sobre las
    // FUENTES de la pantalla, que es lo que no se puede garantizar con una prueba de
    // datos: si alguien agrega una columna de salario, importa el formateador de
    // lempiras o lee el costo de la ausencia, esta prueba falla.
    const dir = join(process.cwd(), "app", "asistencia");
    const prohibido = [
      "@/lib/planilla/salario", // salarioHora, salarioDiario, textoLempiras
      "@/lib/planilla/costo", // costoHoras, costoPeriodo
      "salario",
      "tarifa",
      "lempira",
      "costo_ausencia",
      "costoTotal",
    ];
    const hallazgos: string[] = [];

    for (const archivo of readdirSync(dir)) {
      if (!archivo.endsWith(".ts") && !archivo.endsWith(".tsx")) continue;
      const texto = readFileSync(join(dir, archivo), "utf8");
      for (const aguja of prohibido) {
        // Se ignoran los comentarios (ahí sí se explica por qué el dinero NO va aquí).
        const lineas = texto
          .split("\n")
          .filter((l) => l.toLowerCase().includes(aguja.toLowerCase()))
          .filter((l) => {
            const t = l.trimStart();
            return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
          });
        if (lineas.length > 0) hallazgos.push(`${archivo}: ${aguja} -> ${lineas[0].trim()}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });
});
