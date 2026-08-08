"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { calcularAlcance } from "@/lib/auth/acceso";
import { esEnlaceCorto, extraerCoordsDeUrl } from "@/lib/geo/maps-link";
import { duracionRutaMin, distanciaKm } from "@/lib/geo/ors";

export type Datos = Record<string, string>;
type Res = { ok: boolean; mensaje?: string; id?: number };

// Helpers de parseo.
const s = (v?: string) => (v ?? "").trim();
const sNull = (v?: string) => (s(v) === "" ? null : s(v));
const intNull = (v?: string) => {
  if (s(v) === "") return null;
  const n = Number.parseInt(s(v), 10);
  return Number.isNaN(n) ? null : n;
};
const floatNull = (v?: string) => {
  if (s(v) === "") return null;
  const n = Number.parseFloat(s(v).replace(",", "."));
  return Number.isNaN(n) ? null : n;
};

interface Contexto {
  userId: string;
  quien: string;
  esAdmin: boolean;
  esAsesor: boolean;
  asesorId: number | null; // asesor del propio usuario (rol Asesor)
}

/** Sesión + alcance + asesor propio. Solo Admin o Asesor pueden gestionar. */
async function contexto(): Promise<Contexto | { error: string }> {
  const sesion = await auth();
  if (!sesion?.user) return { error: "Sesión no válida." };
  const alcance = calcularAlcance(sesion.user.roles ?? [], sesion.user.zona ?? null);
  if (!alcance.esAdmin && !alcance.esAsesor) {
    return { error: "No tienes permiso para gestionar clientes." };
  }
  // Equivalente a get_asesor_id_for_user(): el asesor ligado a este usuario.
  const asesor = await prisma.asesores.findFirst({
    where: { usuario_auth_id: sesion.user.id },
    select: { id: true },
  });
  return {
    userId: sesion.user.id,
    quien: sesion.user.name ?? sesion.user.email ?? "usuario",
    esAdmin: alcance.esAdmin,
    esAsesor: alcance.esAsesor,
    asesorId: asesor?.id ?? null,
  };
}

/** Construye los campos escribibles de un cliente desde el formulario. */
function construir(d: Datos): Record<string, unknown> {
  // El cliente captura UN solo tiempo de transporte (ida). El regreso se asume
  // igual, así que se espeja en ambas columnas para el motor.
  const transporte = intNull(d.tiempo_viaje_referencia_min);
  const data: Record<string, unknown> = {
    empresa: s(d.empresa),
    proyecto: sNull(d.proyecto),
    ubicacion: s(d.ubicacion),
    latitud: floatNull(d.latitud),
    longitud: floatNull(d.longitud),
    contacto: sNull(d.contacto),
    telefono: sNull(d.telefono),
    google_maps_url: sNull(d.google_maps_url),
    tiempo_viaje_referencia_min: transporte,
    tiempo_regreso_referencia_min: transporte,
  };
  // Si en este guardado se (re)capturó la ubicación (GPS en sitio / enlace /
  // manual), se registra el origen, la precisión y la fecha. Si no viene el
  // origen, no se tocan esos campos (en edición se conservan los existentes).
  const origen = s(d.ubicacion_origen);
  if (origen) {
    data.ubicacion_origen = origen;
    data.ubicacion_precision_m = floatNull(d.ubicacion_precision_m);
    data.ubicacion_capturada_en = new Date();
  }
  return data;
}

/** ¿El usuario puede operar sobre este cliente? (Asesor: solo los suyos.) */
async function autorizarCliente(
  ctx: Contexto,
  clienteId: number,
): Promise<Res & { clienteAsesorId?: number | null }> {
  const cliente = await prisma.clientes.findUnique({
    where: { id: clienteId },
    include: { asesor: { select: { usuario_auth_id: true } } },
  });
  if (!cliente) return { ok: false, mensaje: "Cliente no encontrado." };
  if (ctx.esAdmin) return { ok: true, clienteAsesorId: cliente.asesor_id };
  // Asesor: SOLO sus propios clientes (validado en el servidor, no en la UI).
  if (cliente.asesor?.usuario_auth_id !== ctx.userId) {
    return { ok: false, mensaje: "Ese cliente no es tuyo." };
  }
  return { ok: true, clienteAsesorId: cliente.asesor_id };
}

async function auditar(
  registroId: number,
  quien: string,
  campo: string,
  anterior: string | null,
  nuevo: string | null,
  motivo: string,
) {
  await prisma.bitacora_auditoria.create({
    data: {
      tabla_afectada: "clientes",
      registro_id: registroId,
      usuario: quien,
      campo_modificado: campo,
      valor_anterior: anterior,
      valor_nuevo: nuevo,
      motivo,
    },
  });
}

/** Si en este guardado se capturó/actualizó la ubicación, deja un REGISTRO en la
 *  bitácora indicando el método (GPS en sitio / Enlace de Maps / Manual). */
async function registrarUbicacion(id: number, quien: string, d: Datos) {
  const origen = s(d.ubicacion_origen);
  if (!origen) return;
  const lat = s(d.latitud);
  const lng = s(d.longitud);
  const prec = s(d.ubicacion_precision_m);
  const detalle =
    `${lat},${lng}` + (origen === "GPS en sitio" && prec ? ` (±${prec} m)` : "");
  await auditar(id, quien, "ubicacion", null, detalle, `Ubicación capturada: ${origen}`);
}

function traducirError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "P2003")
    return "No se puede eliminar: el cliente tiene pedidos asociados.";
  if (code === "P2002") return "Ya existe un registro con ese valor único.";
  return e instanceof Error ? e.message : "Error inesperado.";
}

/** Crea un cliente. El Asesor NO elige asesor: se autoasigna a sí mismo. */
export async function crearClienteAction(datos: Datos): Promise<Res> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, mensaje: ctx.error };
  if (!s(datos.empresa)) return { ok: false, mensaje: "El nombre del cliente es obligatorio." };
  if (!s(datos.ubicacion)) return { ok: false, mensaje: "La ubicación es obligatoria." };
  // Cliente NUEVO: ubicación (lat/long) y tiempo de transporte son OBLIGATORIOS.
  // (En edición NO se fuerza, para no obligar a completar clientes antiguos.)
  if (!s(datos.latitud) || !s(datos.longitud)) {
    return {
      ok: false,
      mensaje:
        "La ubicación del proyecto es obligatoria para un cliente nuevo. Tómala con GPS en sitio o pega el enlace de Google Maps.",
    };
  }
  if (!s(datos.tiempo_viaje_referencia_min)) {
    return {
      ok: false,
      mensaje:
        "El tiempo de transporte es obligatorio. Se calcula automáticamente al capturar la ubicación; si no fue posible, confírmalo o ingrésalo manualmente antes de guardar.",
    };
  }

  const data = construir(datos);
  // Asesor: se autoasigna (no puede regalar/robar clientes). Admin: elige.
  if (ctx.esAdmin) {
    data.asesor_id = intNull(datos.asesor_id);
  } else {
    if (ctx.asesorId == null) {
      return { ok: false, mensaje: "Tu usuario no está vinculado a un asesor." };
    }
    data.asesor_id = ctx.asesorId;
  }

  try {
    // @ts-expect-error data validada por whitelist
    const creado = await prisma.clientes.create({ data });
    await auditar(creado.id, ctx.quien, "alta", null, s(datos.empresa), "Alta de cliente");
    await registrarUbicacion(creado.id, ctx.quien, datos);
    revalidatePath("/clientes");
    revalidatePath("/clientes/semana");
    return { ok: true, id: creado.id };
  } catch (e) {
    return { ok: false, mensaje: traducirError(e) };
  }
}

/** Edita un cliente. El Asesor solo edita los suyos y no puede reasignarlo. */
export async function actualizarClienteAction(id: number, datos: Datos): Promise<Res> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, mensaje: ctx.error };
  const permiso = await autorizarCliente(ctx, id);
  if (!permiso.ok) return permiso;

  const data = construir(datos);
  // Solo el Admin puede reasignar el cliente a otro asesor.
  if (ctx.esAdmin) {
    data.asesor_id = intNull(datos.asesor_id);
  } // Asesor: se conserva el asesor_id actual (no se toca).

  try {
    await prisma.clientes.update({ where: { id }, data });
    await auditar(id, ctx.quien, "edición", null, s(datos.empresa), "Edición de cliente");
    await registrarUbicacion(id, ctx.quien, datos);
    revalidatePath("/clientes");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: traducirError(e) };
  }
}

/**
 * Estima el tiempo de transporte (min, ida) de un cliente desde el plantel MÁS
 * CERCANO con coordenadas, vía OpenRouteService. Se usa para autocompletar el campo
 * al capturar la ubicación en el alta de cliente. Devuelve `ok:false` si no se pudo
 * (sin clave ORS, sin planteles con coords, error de red) → el formulario cae a
 * captura MANUAL (nunca a un valor por defecto silencioso).
 */
export async function estimarTiempoTransporteAction(
  latStr: string,
  lngStr: string,
): Promise<{ ok: boolean; minutos?: number; plantel?: string; mensaje?: string }> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, mensaje: ctx.error };
  const lat = floatNull(latStr);
  const lng = floatNull(lngStr);
  if (lat == null || lng == null) {
    return { ok: false, mensaje: "Captura primero la ubicación (latitud/longitud)." };
  }
  const planteles = await prisma.planteles.findMany({
    where: { latitud: { not: null }, longitud: { not: null } },
    select: { nombre: true, latitud: true, longitud: true },
  });
  if (planteles.length === 0) {
    return {
      ok: false,
      mensaje: "Ningún plantel tiene ubicación registrada; ingresa el tiempo manualmente.",
    };
  }
  // Plantel más cercano (haversine) como origen del cálculo de ruta.
  let mejor = planteles[0];
  let mejorKm = Infinity;
  for (const p of planteles) {
    const d = distanciaKm(p.latitud!, p.longitud!, lat, lng);
    if (d < mejorKm) {
      mejorKm = d;
      mejor = p;
    }
  }
  const minutos = await duracionRutaMin(mejor.latitud!, mejor.longitud!, lat, lng);
  if (minutos == null) {
    return {
      ok: false,
      mensaje:
        "No se pudo calcular el tiempo automáticamente. Confírmalo o ingrésalo manualmente.",
    };
  }
  return { ok: true, minutos, plantel: mejor.nombre };
}

// User-Agent de navegador real: Google sirve a los bots una página distinta (a
// veces sin las coordenadas embebidas), así que nos identificamos como Chrome.
const UA_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Intenta extraer coordenadas de un texto crudo y de su versión URL-decodificada
 * (las páginas de consentimiento de Google traen la URL real en un `continue=`). */
function extraerDeTexto(texto: string | null | undefined) {
  if (!texto) return null;
  const directo = extraerCoordsDeUrl(texto);
  if (directo) return directo;
  try {
    return extraerCoordsDeUrl(decodeURIComponent(texto));
  } catch {
    return null;
  }
}

/** Anti-SSRF: solo se hace fetch a hosts de Google/Maps. Impide que un redirect (o
 *  un enlace manipulado) lleve al servidor a pedir un host interno/arbitrario. */
function hostPermitidoMaps(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return (
      h === "goo.gl" ||
      h === "maps.app.goo.gl" ||
      h === "google.com" ||
      h.endsWith(".google.com")
    );
  } catch {
    return false;
  }
}

/** Lee el cuerpo con un tope de tamaño (evita respuestas gigantes = mini-DoS). */
async function textoAcotado(res: Response, maxBytes = 2_000_000): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len && len > maxBytes) return "";
  const t = await res.text();
  return t.length > maxBytes ? t.slice(0, maxBytes) : t;
}

/**
 * Resuelve un enlace CORTO (maps.app.goo.gl / goo.gl/maps) a coordenadas. Sigue
 * las redirecciones (solo dentro de hosts de Google, anti-SSRF) y prueba en cada
 * URL; si la respuesta final NO redirige (llega una página HTML), extrae las
 * coordenadas del CUERPO. Devuelve null si nada funciona.
 */
async function resolverEnlaceCorto(url: string, maxSaltos = 6) {
  if (!hostPermitidoMaps(url)) return null;
  let actual = url;
  for (let i = 0; i < maxSaltos; i++) {
    if (!hostPermitidoMaps(actual)) return null; // no seguir fuera de Google
    let res: Response;
    try {
      res = await fetch(actual, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": UA_NAVEGADOR, "Accept-Language": "es,en" },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return null;
    }
    const loc = res.headers.get("location");
    if (loc) {
      actual = new URL(loc, actual).toString();
      const c = extraerDeTexto(actual);
      if (c) return c;
      continue;
    }
    // Sin más redirecciones: probar con la URL final y con el cuerpo HTML.
    const enUrl = extraerDeTexto(res.url) ?? extraerDeTexto(actual);
    if (enUrl) return enUrl;
    try {
      const enHtml = extraerCoordsDeUrl(await textoAcotado(res));
      if (enHtml) return enHtml;
    } catch {
      /* ignorar: caemos al fallback de abajo */
    }
    break;
  }

  // Fallback: seguir redirecciones automáticamente (el host inicial ya está en la
  // allowlist; Google no redirige a hosts internos) y leer el cuerpo acotado.
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA_NAVEGADOR, "Accept-Language": "es,en" },
      signal: AbortSignal.timeout(8000),
    });
    const enUrl = extraerDeTexto(res.url);
    if (enUrl) return enUrl;
    return extraerCoordsDeUrl(await textoAcotado(res));
  } catch {
    return null;
  }
}

const MENSAJE_ENLACE_INVALIDO =
  "No se pudo leer la ubicación de ese enlace — verifica que sea un enlace de Google Maps válido, o intenta copiar el enlace largo desde el navegador en vez de la app.";

/**
 * Resuelve un enlace de Google Maps a coordenadas. Enlace largo → regex directo;
 * enlace corto → resuelve la redirección y luego regex. NO bloquea nada: si no
 * se puede extraer, devuelve `{ ok: false, mensaje }` y el cliente igual se puede
 * guardar con la ubicación en blanco (robustez ante cambios de formato de Google).
 */
export async function resolverEnlaceMapsAction(
  url: string,
): Promise<{ ok: boolean; lat?: number; lng?: number; mensaje?: string }> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, mensaje: "Sesión no válida." };

  const limpio = (url ?? "").trim();
  if (!limpio) return { ok: false, mensaje: "Pega un enlace de Google Maps." };

  // 1. Intento directo (enlace largo con coordenadas en el texto).
  const directo = extraerCoordsDeUrl(limpio);
  if (directo) return { ok: true, lat: directo.lat, lng: directo.lng };

  // 2. Enlace corto → resolver la redirección / leer el cuerpo y reintentar.
  if (esEnlaceCorto(limpio)) {
    const coords = await resolverEnlaceCorto(limpio);
    if (coords) return { ok: true, lat: coords.lat, lng: coords.lng };
  }

  return { ok: false, mensaje: MENSAJE_ENLACE_INVALIDO };
}

/** Activa/desactiva un cliente (Asesor: solo los suyos). El asesor decide si el
 * cliente sigue fundiendo; los inactivos conservan su historial pero se ocultan
 * de las listas de selección operativas. */
export async function alternarActivoClienteAction(
  id: number,
  activo: boolean,
): Promise<Res> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, mensaje: ctx.error };
  const permiso = await autorizarCliente(ctx, id);
  if (!permiso.ok) return permiso;

  try {
    const antes = await prisma.clientes.findUnique({
      where: { id },
      select: { activo: true },
    });
    await prisma.clientes.update({ where: { id }, data: { activo } });
    await auditar(
      id,
      ctx.quien,
      "activo",
      antes?.activo ? "Activo" : "Inactivo",
      activo ? "Activo" : "Inactivo",
      activo ? "Reactivación de cliente" : "Inactivación de cliente",
    );
    revalidatePath("/clientes");
    revalidatePath("/clientes/semana");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: traducirError(e) };
  }
}

/** Elimina un cliente (Asesor: solo los suyos). */
export async function eliminarClienteAction(id: number): Promise<Res> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, mensaje: ctx.error };
  const permiso = await autorizarCliente(ctx, id);
  if (!permiso.ok) return permiso;

  try {
    const cliente = await prisma.clientes.findUnique({ where: { id }, select: { empresa: true } });
    await prisma.clientes.delete({ where: { id } });
    await auditar(id, ctx.quien, "baja", cliente?.empresa ?? null, null, "Baja de cliente");
    revalidatePath("/clientes");
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: traducirError(e) };
  }
}
