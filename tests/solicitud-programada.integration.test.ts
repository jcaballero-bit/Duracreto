// Una proyección del Programa Semana ya PROGRAMADA es historial: nadie la edita ni la
// borra desde la cuadrícula, y menos un asesor.
//
// Importa que esto viva en el SERVIDOR y no solo en la interfaz: la celda ya se
// renderiza como texto (no como botón) y la papelera va deshabilitada, pero eso no es
// una restricción — cualquiera puede invocar la server action directamente.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearCliente, crearDiseno, crearPlantel, limpiarBD } from "./helpers";

type Rol = "Administrador" | "Programador" | "Asesor" | "AsesorRestringido" | "Despachador";
let rol: Rol = "Asesor";
let userId = "asesor-1";
let zona: string | null = "Norte";

vi.mock("@/auth", () => ({
  auth: async () => ({
    user: { id: userId, name: "Prueba", email: "p@test.com", roles: [rol], zona },
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { guardarSolicitudAction, eliminarSolicitudAction, descartarSolicitudAction } =
  await import("@/app/clientes/solicitudes-actions");

const FECHA_ISO = "2027-07-14";
const FECHA = new Date(2027, 6, 14);

/** Datos de celda con contenido (una celda vacía significa "borrar"). */
const datos = (volumen = "25") => ({
  tipo_concreto_estimado: "4000 3/4",
  revenimiento: '6" a 7"',
  tipo_servicio: "Normal",
  tipo_descarga_estimado: "Bomba",
  volumen_estimado_m3: volumen,
  sacos_hielo_por_m3: "1",
  elemento: "Losa",
  frecuencia_entre_camiones_min: "25",
  observaciones: "",
  plantel_id: "",
});

/**
 * Un cliente con asesor (vinculado al usuario de la sesión) y su proyección en el
 * estado indicado. Si es `Programado`, además tiene un pedido real vinculado, como
 * pasa al convertirla.
 */
async function escenario(estado: "Pendiente" | "Programado" | "Descartada") {
  const { plantelId, plantaId } = await crearPlantel({
    nombre: "SM Sol",
    zona: "Norte",
    esHub: true,
  });
  // `asesores.usuario_auth_id` es FK a User: el usuario tiene que existir primero.
  await prisma.user.create({
    data: { id: "asesor-1", name: "Asesor Prueba", email: "asesor@test.com", zona: "Norte" },
  });
  const asesor = await prisma.asesores.create({
    data: {
      nombre: "Asesor Prueba",
      correo: "asesor@test.com",
      usuario_auth_id: "asesor-1",
      zona_asignada: "Norte",
    },
  });
  const clienteId = await crearCliente(true);
  await prisma.clientes.update({ where: { id: clienteId }, data: { asesor_id: asesor.id } });

  let pedidoId: number | null = null;
  if (estado === "Programado") {
    const disenoId = await crearDiseno();
    const pedido = await prisma.pedidos.create({
      data: {
        cliente_id: clienteId,
        diseno_id: disenoId,
        volumen_total_m3: 25,
        volumen_programado: 25,
        hora_solicitada: new Date(2027, 6, 14, 8, 0),
        plantel_id: plantelId,
        planta_id: plantaId,
        tipo_descarga: "Bomba",
        creado_por: "test",
      },
    });
    pedidoId = pedido.id;
  }

  const sol = await prisma.solicitudes_anticipadas.create({
    data: {
      cliente_id: clienteId,
      asesor_id: asesor.id,
      fecha_requerida: FECHA,
      volumen_estimado_m3: 25,
      tipo_concreto_estimado: "4000 3/4",
      elemento: "Losa",
      estado,
      pedido_id: pedidoId,
      creado_por: "asesor",
    },
  });
  return { solicitudId: sol.id, clienteId, pedidoId, plantelId };
}

/** Estado completo de la proyección, para comparar antes/después. */
const foto = async (id: number) =>
  JSON.stringify(
    await prisma.solicitudes_anticipadas.findUniqueOrThrow({
      where: { id },
      select: {
        estado: true,
        pedido_id: true,
        volumen_estimado_m3: true,
        tipo_concreto_estimado: true,
        elemento: true,
        observaciones: true,
      },
    }),
  );

beforeEach(async () => {
  await limpiarBD();
  await prisma.asesores.deleteMany();
  await prisma.user.deleteMany();
  await prisma.bitacora_auditoria.deleteMany();
  rol = "Asesor";
  userId = "asesor-1";
  zona = "Norte";
});

describe("el ASESOR no puede tocar una proyección ya PROGRAMADA", () => {
  it("no la puede EDITAR: la acción se rechaza y no cambia ni un campo", async () => {
    const { solicitudId, clienteId } = await escenario("Programado");
    const antes = await foto(solicitudId);

    const r = await guardarSolicitudAction(clienteId, FECHA_ISO, datos("999"), solicitudId);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/programado/i);
    expect(r.mensaje).toMatch(/no se puede editar/i);
    expect(await foto(solicitudId)).toBe(antes);
  });

  it("no la puede ELIMINAR: la acción se rechaza y la fila sigue ahí", async () => {
    const { solicitudId } = await escenario("Programado");

    const r = await eliminarSolicitudAction(solicitudId);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Ya fue programado/i);
    expect(await prisma.solicitudes_anticipadas.count({ where: { id: solicitudId } })).toBe(1);
  });

  it("tampoco la BORRA vaciando la celda (el otro camino de la misma acción)", async () => {
    // Vaciar una celda es la forma normal de borrar una proyección: hay que
    // comprobar que ESE camino también respeta el estado.
    const { solicitudId, clienteId } = await escenario("Programado");
    const antes = await foto(solicitudId);
    const vacia = {
      ...datos(""),
      tipo_concreto_estimado: "",
      revenimiento: "",
      tipo_servicio: "",
      tipo_descarga_estimado: "",
      sacos_hielo_por_m3: "",
      elemento: "",
      frecuencia_entre_camiones_min: "",
    };

    const r = await guardarSolicitudAction(clienteId, FECHA_ISO, vacia, solicitudId);

    expect(r.ok).toBe(false);
    expect(await prisma.solicitudes_anticipadas.count({ where: { id: solicitudId } })).toBe(1);
    expect(await foto(solicitudId)).toBe(antes);
  });

  it("no la puede DESCARTAR (esa acción no es de asesores)", async () => {
    const { solicitudId } = await escenario("Programado");

    const r = await descartarSolicitudAction(solicitudId);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Solo Programador\/Administrador/i);
    expect(await foto(solicitudId)).toMatch(/"estado":"Programado"/);
  });

  it("el pedido real que generó tampoco se toca", async () => {
    const { solicitudId, clienteId, pedidoId } = await escenario("Programado");

    await guardarSolicitudAction(clienteId, FECHA_ISO, datos("999"), solicitudId);
    await eliminarSolicitudAction(solicitudId);

    const p = await prisma.pedidos.findUniqueOrThrow({ where: { id: pedidoId! } });
    expect(p.volumen_total_m3).toBe(25);
    expect(p.estado_pedido).toBe("Activo");
  });

  it("el AsesorRestringido tampoco puede", async () => {
    // Hereda todo lo del Asesor, asi que la regla tiene que valer igual.
    const { solicitudId, clienteId } = await escenario("Programado");
    rol = "AsesorRestringido";
    const antes = await foto(solicitudId);

    expect((await guardarSolicitudAction(clienteId, FECHA_ISO, datos("999"), solicitudId)).ok).toBe(false);
    expect((await eliminarSolicitudAction(solicitudId)).ok).toBe(false);
    expect(await foto(solicitudId)).toBe(antes);
  });
});

describe("lo que el asesor SÍ puede seguir haciendo", () => {
  it("editar una proyección PENDIENTE de su cliente", async () => {
    const { solicitudId, clienteId } = await escenario("Pendiente");

    const r = await guardarSolicitudAction(clienteId, FECHA_ISO, datos("40"), solicitudId);

    expect(r.ok, r.mensaje).toBe(true);
    const s = await prisma.solicitudes_anticipadas.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(s.volumen_estimado_m3).toBe(40);
  });

  it("eliminar una proyección PENDIENTE de su cliente", async () => {
    const { solicitudId } = await escenario("Pendiente");
    expect((await eliminarSolicitudAction(solicitudId)).ok).toBe(true);
    expect(await prisma.solicitudes_anticipadas.count({ where: { id: solicitudId } })).toBe(0);
  });

  it("AGREGAR otra proyección el mismo día, aunque ya haya una programada", async () => {
    // El cliente puede pedir un segundo vaciado ese dia: eso no es modificar la
    // proyeccion ya programada, es crear otra (el boton "+ Agregar" de la celda).
    const { solicitudId, clienteId } = await escenario("Programado");
    const antes = await foto(solicitudId);

    const r = await guardarSolicitudAction(clienteId, FECHA_ISO, datos("12"));

    expect(r.ok, r.mensaje).toBe(true);
    expect(await prisma.solicitudes_anticipadas.count({ where: { cliente_id: clienteId } })).toBe(2);
    // Y la programada quedo intacta.
    expect(await foto(solicitudId)).toBe(antes);
  });

  it("no puede tocar la proyección de un cliente que NO es suyo", async () => {
    const { solicitudId, clienteId } = await escenario("Pendiente");
    // Se le quita el asesor al cliente: ya no es "suyo".
    await prisma.clientes.update({ where: { id: clienteId }, data: { asesor_id: null } });

    const r = await guardarSolicitudAction(clienteId, FECHA_ISO, datos("40"), solicitudId);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/tus propios clientes/i);
  });
});

describe("la regla vale para TODOS los roles, no solo el asesor", () => {
  it("el Programador tampoco edita ni elimina una programada", async () => {
    const { solicitudId, clienteId } = await escenario("Programado");
    rol = "Programador";
    const antes = await foto(solicitudId);

    expect((await guardarSolicitudAction(clienteId, FECHA_ISO, datos("999"), solicitudId)).ok).toBe(false);
    expect((await eliminarSolicitudAction(solicitudId)).ok).toBe(false);
    expect(await foto(solicitudId)).toBe(antes);
  });

  it("el Administrador tampoco: es historial, no un tema de permisos", async () => {
    const { solicitudId, clienteId } = await escenario("Programado");
    rol = "Administrador";
    zona = null;
    const antes = await foto(solicitudId);

    expect((await guardarSolicitudAction(clienteId, FECHA_ISO, datos("999"), solicitudId)).ok).toBe(false);
    expect((await eliminarSolicitudAction(solicitudId)).ok).toBe(false);
    expect(await foto(solicitudId)).toBe(antes);
  });

  it("el Programador no puede DESCARTAR una ya programada", async () => {
    // Descartarla la dejaria "Descartada" CON un pedido_id vivo: la proyeccion diria
    // que no se atendio mientras el pedido sigue en el programa.
    const { solicitudId } = await escenario("Programado");
    rol = "Programador";

    const r = await descartarSolicitudAction(solicitudId);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Ya fue programado/i);
    const s = await prisma.solicitudes_anticipadas.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(s.estado).toBe("Programado");
    expect(s.pedido_id).not.toBeNull();
  });

  it("el Programador SÍ puede descartar una Pendiente", async () => {
    const { solicitudId } = await escenario("Pendiente");
    rol = "Programador";

    expect((await descartarSolicitudAction(solicitudId)).ok).toBe(true);
    const s = await prisma.solicitudes_anticipadas.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(s.estado).toBe("Descartada");
  });

  it("un rol ajeno al Programa Semana no entra a ninguna de las acciones", async () => {
    const { solicitudId, clienteId } = await escenario("Pendiente");
    rol = "Despachador";

    expect((await guardarSolicitudAction(clienteId, FECHA_ISO, datos(), solicitudId)).ok).toBe(false);
    expect((await eliminarSolicitudAction(solicitudId)).ok).toBe(false);
    expect((await descartarSolicitudAction(solicitudId)).ok).toBe(false);
  });
});

describe("una DESCARTADA sigue siendo historial editable-no", () => {
  it("no se puede editar, pero sí eliminar (nunca generó un pedido)", async () => {
    const { solicitudId, clienteId } = await escenario("Descartada");

    const edicion = await guardarSolicitudAction(clienteId, FECHA_ISO, datos("40"), solicitudId);
    expect(edicion.ok).toBe(false);
    expect(edicion.mensaje).toMatch(/descartada/i);

    // Borrarla sí: no hay pedido que quede huérfano, y limpia la cuadrícula.
    expect((await eliminarSolicitudAction(solicitudId)).ok).toBe(true);
  });
});
