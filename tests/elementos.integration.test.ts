// Catálogo de ELEMENTOS contra Postgres.
//
// La promesa que hay que sostener es que el catálogo es de SUGERENCIAS y nada más:
//
//  · Un elemento que NO está en el catálogo se guarda igual (en obra aparecen elementos
//    que nadie dio de alta; si el asesor no puede escribirlo, el sistema le estorba).
//  · Desactivar o borrar un elemento del catálogo NO toca lo ya programado: `elemento` es
//    texto en `pedidos` y en `solicitudes_anticipadas`, no una llave foránea.
//  · El desplegable solo ofrece los ACTIVOS.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";
import { filtrarElementos } from "@/lib/elementos";

let esAdmin = true;

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", name: "Admin Prueba", email: "a@test.com" } }),
}));
vi.mock("@/lib/auth/guard", () => ({
  exigirAdmin: async () =>
    esAdmin ? { ok: true, userId: "u1" } : { ok: false, mensaje: "Solo un Administrador." },
  requerirAcceso: async () => ({}),
  alcanceActual: async () => ({ esAdmin }),
  requerirPasswordAlDia: async () => {},
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { crearRegistro, actualizarRegistro, eliminarRegistro } = await import(
  "@/app/administracion/catalogos-actions"
);

/** Lo que el desplegable ofrece: solo activos, alfabético. */
async function ofrecidos(): Promise<string[]> {
  const filas = await prisma.elementos.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { nombre: true },
  });
  return filas.map((f) => f.nombre);
}

/**
 * Las acciones del framework de catálogos reciben un OBJETO plano
 * (`Datos = Record<string, string>`), no un `FormData`: el formulario lo convierte antes
 * de llamarlas.
 */
const fd = (datos: Record<string, string>) => datos;

/** Una proyección del Programa Semana con el elemento indicado. */
async function proyectar(elemento: string) {
  const { plantelId } = await crearPlantel({ nombre: `P${Date.now()}${Math.random()}`, zona: "Norte" });
  const clienteId = await crearCliente(true);
  return prisma.solicitudes_anticipadas.create({
    data: {
      cliente_id: clienteId,
      fecha_requerida: new Date(2026, 7, 31),
      plantel_id: plantelId,
      elemento,
      estado: "Pendiente",
      creado_por: "prueba",
    },
  });
}

beforeEach(async () => {
  await limpiarBD();
  await prisma.elementos.deleteMany();
  await prisma.bitacora_auditoria.deleteMany();
  esAdmin = true;
});

describe("administración del catálogo", () => {
  it("el Administrador agrega elementos y el desplegable los ofrece", async () => {
    expect(await crearRegistro("elementos", fd({ nombre: "Losa de entrepiso" }))).toMatchObject({
      ok: true,
    });
    expect(await crearRegistro("elementos", fd({ nombre: "Pavimento" }))).toMatchObject({ ok: true });
    expect(await ofrecidos()).toEqual(["Losa de entrepiso", "Pavimento"]);
  });

  it("un elemento nace ACTIVO si no se dice lo contrario", async () => {
    await crearRegistro("elementos", fd({ nombre: "Zapata" }));
    const e = await prisma.elementos.findFirstOrThrow();
    expect(e.activo).toBe(true);
  });

  it("no deja dos elementos con el mismo nombre", async () => {
    await crearRegistro("elementos", fd({ nombre: "Losa" }));
    const r = await crearRegistro("elementos", fd({ nombre: "Losa" }));
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("único");
    expect(await prisma.elementos.count()).toBe(1);
  });

  it("desactivar lo saca del desplegable pero no lo borra", async () => {
    await crearRegistro("elementos", fd({ nombre: "Acera" }));
    await crearRegistro("elementos", fd({ nombre: "Losa" }));
    const acera = await prisma.elementos.findFirstOrThrow({ where: { nombre: "Acera" } });

    expect(
      await actualizarRegistro("elementos", acera.id, fd({ nombre: "Acera", activo: "false" })),
    ).toMatchObject({ ok: true });

    expect(await ofrecidos()).toEqual(["Losa"]); // ya no se ofrece
    expect(await prisma.elementos.count()).toBe(2); // pero sigue existiendo
  });

  it("un rol que no es Administrador no puede tocar el catálogo", async () => {
    esAdmin = false;
    const r = await crearRegistro("elementos", fd({ nombre: "Losa" }));
    expect(r.ok).toBe(false);
    expect(await prisma.elementos.count()).toBe(0);
  });
});

describe("el catálogo es de SUGERENCIAS: el campo sigue siendo texto libre", () => {
  it("se puede programar un elemento que NO está en el catálogo", async () => {
    await crearRegistro("elementos", fd({ nombre: "Losa" }));
    // El asesor escribe uno que nadie dio de alta.
    const s = await proyectar("Rampa vehicular de acceso");
    expect(s.elemento).toBe("Rampa vehicular de acceso");
    // Y el catálogo no cambió: agregarlo a la lista es decisión del Admin.
    expect(await ofrecidos()).toEqual(["Losa"]);
  });

  it("desactivar un elemento NO toca las proyecciones que ya lo usan", async () => {
    await crearRegistro("elementos", fd({ nombre: "Muro de contención" }));
    const s = await proyectar("Muro de contención");
    const e = await prisma.elementos.findFirstOrThrow();

    await actualizarRegistro("elementos", e.id, fd({ nombre: "Muro de contención", activo: "false" }));

    const despues = await prisma.solicitudes_anticipadas.findUniqueOrThrow({ where: { id: s.id } });
    expect(despues.elemento).toBe("Muro de contención");
  });

  it("BORRAR un elemento del catálogo tampoco toca lo ya programado", async () => {
    // Es la garantía de que no hay llave foránea: si la hubiera, esto fallaría o
    // arrastraría el historial.
    await crearRegistro("elementos", fd({ nombre: "Piso industrial" }));
    const s = await proyectar("Piso industrial");
    const e = await prisma.elementos.findFirstOrThrow();

    expect(await eliminarRegistro("elementos", e.id)).toMatchObject({ ok: true });

    const despues = await prisma.solicitudes_anticipadas.findUniqueOrThrow({ where: { id: s.id } });
    expect(despues.elemento).toBe("Piso industrial");
    expect(await prisma.elementos.count()).toBe(0);
  });

  it("un pedido guarda el elemento como texto, venga o no del catálogo", async () => {
    const { plantelId, plantaId } = await crearPlantel({ nombre: "SM Elem", zona: "Norte", esHub: true });
    const clienteId = await crearCliente(true);
    const disenoId = await crearDiseno();
    const p = await prisma.pedidos.create({
      data: {
        cliente_id: clienteId,
        diseno_id: disenoId,
        volumen_total_m3: 9,
        hora_solicitada: new Date(2026, 7, 31, 8, 0),
        plantel_id: plantelId,
        planta_id: plantaId,
        tipo_descarga: "Canal directo",
        elemento: "Cabezal de puente",
        creado_por: "prueba",
      },
    });
    expect(p.elemento).toBe("Cabezal de puente");
    expect(await prisma.elementos.count()).toBe(0); // el catálogo ni se tocó
  });
});

describe("la búsqueda del desplegable trabaja sobre lo que ofrece el catálogo", () => {
  it("encuentra sin acentos lo que el Admin dio de alta", async () => {
    for (const n of ["Cimentación", "Columnas", "Losa"]) {
      await crearRegistro("elementos", fd({ nombre: n }));
    }
    const lista = await ofrecidos();
    expect(filtrarElementos(lista, "cimentacion")).toEqual(["Cimentación"]);
    expect(filtrarElementos(lista, "co")).toEqual(["Columnas"]);
  });
});
