"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { alcanceActual } from "@/lib/auth/guard";
import { normalizarEncabezado } from "./columnas";
import { resolverFila, type Fila } from "./import-resolver";

export type Catalogo =
  | "planteles"
  | "plantas"
  | "mixers"
  | "bombas"
  | "camiones"
  | "pickups"
  | "operadores"
  | "asesores"
  | "disenos";

type Datos = Record<string, string>;
type Res = { ok: boolean; mensaje?: string };

// Catálogos que viven en /flota (equipo + motoristas).
const CATALOGOS_FLOTA = new Set<Catalogo>([
  "mixers",
  "bombas",
  "camiones",
  "pickups",
  "operadores",
]);

/**
 * Autorización por catálogo. Administrador puede TODO. Los catálogos de /flota
 * (mixers, bombas, camiones, pickups, operadores) los gestionan también Jefe de
 * Planta, Despachador y Programador (ven y editan toda la flota). El Dosificador
 * solo `operadores`. El resto de catálogos (planteles, plantas, asesores, diseños)
 * sigue siendo solo del Administrador.
 */
async function autorizarCatalogo(catalogo: Catalogo): Promise<Res> {
  const a = await alcanceActual();
  if (!a) return { ok: false, mensaje: "Sesión no válida." };
  if (a.esAdmin) return { ok: true };
  if (
    CATALOGOS_FLOTA.has(catalogo) &&
    (a.esJefePlanta || a.esDespachador || a.esProgramador)
  ) {
    return { ok: true };
  }
  if (catalogo === "operadores" && a.esDosificador) return { ok: true };
  return { ok: false, mensaje: "No tienes permiso para modificar este catálogo." };
}

// Helpers de parseo.
const s = (v?: string) => (v ?? "").trim();
const sNull = (v?: string) => (s(v) === "" ? null : s(v));
const int = (v?: string) => Number.parseInt(s(v), 10);
const idNull = (v?: string) => (s(v) === "" ? null : Number.parseInt(s(v), 10));
const floatNull = (v?: string) => {
  if (s(v) === "") return null;
  const n = Number.parseFloat(s(v));
  return Number.isFinite(n) ? n : null;
};

/** Construye el objeto de datos Prisma (whitelist) para cada catálogo. */
function construir(catalogo: Catalogo, d: Datos): Record<string, unknown> {
  switch (catalogo) {
    case "planteles":
      return {
        nombre: s(d.nombre),
        zona: s(d.zona),
        capacidad_dosificacion_m3h: int(d.capacidad_dosificacion_m3h),
        hub_id: idNull(d.hub_id),
        latitud: floatNull(d.latitud),
        longitud: floatNull(d.longitud),
      };
    case "plantas":
      return {
        nombre: s(d.nombre),
        plantel_id: int(d.plantel_id),
        capacidad_m3h: int(d.capacidad_m3h),
        tiempo_alistamiento_min:
          s(d.tiempo_alistamiento_min) === "" ? 5 : int(d.tiempo_alistamiento_min),
      };
    case "mixers":
      return {
        identificador: sNull(d.identificador),
        placa: sNull(d.placa),
        marca: s(d.marca),
        capacidad_m3: int(d.capacidad_m3),
        plantel_base_id: int(d.plantel_base_id),
        estado: s(d.estado) || "Disponible",
        operador_asignado_id: idNull(d.operador_asignado_id),
      };
    case "bombas":
      return {
        identificador: s(d.identificador),
        estado: s(d.estado) || "Disponible",
        plantel_base_id: int(d.plantel_base_id),
      };
    case "camiones":
    case "pickups":
      return {
        identificador: s(d.identificador),
        placa: sNull(d.placa),
        estado: s(d.estado) || "Disponible",
        plantel_base_id: int(d.plantel_base_id),
      };
    case "operadores":
      return { nombre: s(d.nombre), estado: s(d.estado) || "Disponible" };
    case "asesores":
      return {
        nombre: s(d.nombre),
        correo: sNull(d.correo),
        usuario_auth_id: sNull(d.usuario_auth_id),
      };
    case "disenos":
      return {
        codigo: s(d.codigo),
        resistencia_psi: s(d.resistencia_psi) === "" ? null : int(d.resistencia_psi),
        etiqueta_resistencia: sNull(d.etiqueta_resistencia),
        tamano_agregado: sNull(d.tamano_agregado),
        revenimiento: s(d.revenimiento) || "-",
        aditivo_especial: sNull(d.aditivo_especial),
      };
  }
}

/** Delegado Prisma por catálogo (mismo id numérico en todos). */
function modelo(catalogo: Catalogo) {
  const mapa = {
    planteles: prisma.planteles,
    plantas: prisma.plantas,
    mixers: prisma.mixers,
    bombas: prisma.bombas,
    camiones: prisma.camiones,
    pickups: prisma.pickups,
    operadores: prisma.operadores,
    asesores: prisma.asesores,
    disenos: prisma.disenos_mezcla,
  } as const;
  return mapa[catalogo];
}

/** Autogenera el siguiente código DIS-#### si viene vacío. */
async function siguienteCodigoDiseno(): Promise<string> {
  const disenos = await prisma.disenos_mezcla.findMany({ select: { codigo: true } });
  let max = 0;
  for (const { codigo } of disenos) {
    const m = codigo.match(/DIS-(\d+)/);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return `DIS-${String(max + 1).padStart(4, "0")}`;
}

function traducirError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "P2002") return "Ya existe un registro con ese valor único.";
  if (code === "P2003")
    return "No se puede eliminar: tiene registros asociados (mueve o borra los dependientes primero).";
  return e instanceof Error ? e.message : "Error inesperado.";
}

/** Refresca las dos vistas donde viven los catálogos (Admin y Flota). */
function revalidarCatalogos() {
  revalidatePath("/administracion");
  revalidatePath("/flota");
}

export async function crearRegistro(catalogo: Catalogo, datos: Datos): Promise<Res> {
  const guard = await autorizarCatalogo(catalogo);
  if (!guard.ok) return guard;
  try {
    const data = construir(catalogo, datos);
    if (catalogo === "disenos" && !data.codigo) {
      data.codigo = await siguienteCodigoDiseno();
    }
    // @ts-expect-error delegado dinámico con data validada por whitelist
    await modelo(catalogo).create({ data });
    revalidarCatalogos();
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: traducirError(e) };
  }
}

export async function actualizarRegistro(
  catalogo: Catalogo,
  id: number,
  datos: Datos,
): Promise<Res> {
  const guard = await autorizarCatalogo(catalogo);
  if (!guard.ok) return guard;
  try {
    const data = construir(catalogo, datos);
    // @ts-expect-error delegado dinámico
    await modelo(catalogo).update({ where: { id }, data });
    revalidarCatalogos();
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: traducirError(e) };
  }
}

export async function eliminarRegistro(catalogo: Catalogo, id: number): Promise<Res> {
  const guard = await autorizarCatalogo(catalogo);
  if (!guard.ok) return guard;
  try {
    // @ts-expect-error delegado dinámico
    await modelo(catalogo).delete({ where: { id } });
    revalidarCatalogos();
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: traducirError(e) };
  }
}

// ── Importación CSV ──────────────────────────────────────────────────────────

export interface ResultadoImport {
  ok: boolean;
  mensaje?: string;
  creados: number;
  errores: { fila: number; motivo: string }[];
}

/** Importa filas (parseadas del CSV en el cliente) a un catálogo. */
export async function importarCatalogo(
  catalogo: Catalogo,
  filas: Fila[],
): Promise<ResultadoImport> {
  const guard = await autorizarCatalogo(catalogo);
  if (!guard.ok) return { ok: false, mensaje: guard.mensaje, creados: 0, errores: [] };

  // Mapas nombre→id para resolver relaciones.
  const [planteles, operadores, asesores] = await Promise.all([
    prisma.planteles.findMany({ select: { id: true, nombre: true } }),
    prisma.operadores.findMany({ select: { id: true, nombre: true } }),
    prisma.asesores.findMany({ select: { id: true, nombre: true } }),
  ]);
  const mapaPlantel = new Map(planteles.map((p) => [p.nombre.toLowerCase(), p.id]));
  const mapaOperador = new Map(operadores.map((o) => [o.nombre.toLowerCase(), o.id]));
  const mapaAsesor = new Map(asesores.map((a) => [a.nombre.toLowerCase(), a.id]));

  let creados = 0;
  const errores: { fila: number; motivo: string }[] = [];

  for (let i = 0; i < filas.length; i++) {
    // Normalizar encabezados de la fila.
    const r: Fila = {};
    for (const [k, v] of Object.entries(filas[i])) r[normalizarEncabezado(k)] = v;

    const res = resolverFila(catalogo, r, {
      plantel: mapaPlantel,
      operador: mapaOperador,
      asesor: mapaAsesor,
    });
    if ("error" in res) {
      errores.push({ fila: i + 1, motivo: res.error });
      continue;
    }
    try {
      const data = res.data;
      if (catalogo === "disenos" && !data.codigo) data.codigo = await siguienteCodigoDiseno();
      // @ts-expect-error delegado dinámico con data validada
      await modelo(catalogo).create({ data });
      creados++;
    } catch (e) {
      errores.push({ fila: i + 1, motivo: traducirError(e) });
    }
  }

  revalidarCatalogos();
  return { ok: true, creados, errores };
}
