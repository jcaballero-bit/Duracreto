// Generación y descarga del PDF del Programa DPCR-08 (documento controlado ISO).
//
//  · POST { fecha, zona }  → arma el snapshot del día/zona, renderiza el PDF, GUARDA
//    una versión nueva en `programas_dpcr08` (con el snapshot congelado) y devuelve el
//    archivo.
//  · GET  ?version=<id>    → vuelve a generar el PDF EXACTO de una versión archivada
//    (desde su snapshot; no crea una versión nueva).
//
// Todo el permiso se valida aquí, en el servidor: no basta con ocultar la zona en la
// interfaz. Se reutilizan las mismas reglas que la pantalla (`lib/programa/acceso.ts`).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { puedeAccederRuta } from "@/lib/auth/acceso";
import { alcanceActual } from "@/lib/auth/guard";
import { filtroPorRol, zonasParaPrograma } from "@/lib/programa/acceso";
import { generarPdfPrograma, nombreArchivo } from "@/lib/programa/generar";
import { construirSnapshot, diaDesdeIso, type SnapshotPrograma } from "@/lib/programa/snapshot";

// react-pdf necesita el runtime Node (usa fontkit/zlib), no edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

type Contexto =
  | { ok: false; error: NextResponse }
  | {
      ok: true;
      alcance: Awaited<ReturnType<typeof alcanceActual>> & object;
      userId: string | null;
      zonas: string[];
      quien: string;
    };

/** Sesión + alcance + zonas permitidas, o el error HTTP correspondiente. */
async function contexto(): Promise<Contexto> {
  const noAutenticado = (mensaje: string, status: number): Contexto => ({
    ok: false,
    error: NextResponse.json({ mensaje }, { status }),
  });

  const sesion = await auth();
  if (!sesion?.user) return noAutenticado("Sesión no válida.", 401);
  if (!puedeAccederRuta(sesion.user.roles ?? [], "/programa")) {
    return noAutenticado("No tienes permiso para el Programa DPCR-08.", 403);
  }
  const alcance = await alcanceActual();
  if (!alcance) return noAutenticado("Sesión no válida.", 401);

  return {
    ok: true,
    alcance,
    userId: sesion.user.id ?? null,
    zonas: await zonasParaPrograma(alcance, sesion.user.id ?? null),
    quien: sesion.user.name ?? sesion.user.email ?? "sistema",
  };
}

/** Respuesta HTTP con el PDF como descarga. */
function respuestaPdf(bytes: Uint8Array, nombre: string): NextResponse {
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Content-Length": String(bytes.byteLength),
      // Documento generado a demanda: nunca se sirve de caché.
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx.error;
  const { alcance, userId, zonas, quien } = ctx;

  let cuerpo: { fecha?: string; zona?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ mensaje: "Petición inválida." }, { status: 400 });
  }
  const fecha = cuerpo.fecha ?? "";
  const zona = cuerpo.zona ?? "";
  if (!FECHA_ISO.test(fecha)) {
    return NextResponse.json({ mensaje: "Fecha inválida." }, { status: 400 });
  }
  // Enforcement de zona: un Programador/Despachador solo su zona; Admin cualquiera.
  if (!zonas.includes(zona)) {
    return NextResponse.json(
      { mensaje: "No puedes generar el Programa de esa zona." },
      { status: 403 },
    );
  }

  // Filtro por rol: el Laboratorista solo ve sus proyectos asignados y el
  // AsesorRestringido solo sus clientes. En esos casos el PDF es un EXTRACTO
  // personal, no el documento completo de la zona: se puede descargar, pero NO se
  // archiva como versión oficial (el historial guarda solo el documento completo).
  const { filtro, soloLabAsignado, soloAsesorPropio } = filtroPorRol(alcance, userId);
  const esExtracto = soloLabAsignado || soloAsesorPropio;

  const snap = await construirSnapshot({ fecha, zona, filtroExtra: filtro });

  let version: number | null = null;
  if (!esExtracto) {
    // Versión incremental por (día, zona).
    const ultima = await prisma.programas_dpcr08.findFirst({
      where: { fecha_programa: diaDesdeIso(fecha), zona },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    version = (ultima?.version ?? 0) + 1;
    await prisma.programas_dpcr08.create({
      data: {
        fecha_programa: diaDesdeIso(fecha),
        zona,
        // El snapshot congelado: con él se reproduce este mismo PDF después.
        snapshot_json: snap as unknown as object,
        generado_por: quien,
        version,
      },
    });
  }

  const bytes = await generarPdfPrograma(snap);
  return respuestaPdf(bytes, nombreArchivo(fecha, zona, version));
}

export async function GET(req: Request): Promise<NextResponse> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx.error;
  const { zonas } = ctx;

  const id = Number(new URL(req.url).searchParams.get("version"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ mensaje: "Versión inválida." }, { status: 400 });
  }

  const reg = await prisma.programas_dpcr08.findUnique({ where: { id } });
  if (!reg) {
    return NextResponse.json({ mensaje: "Versión no encontrada." }, { status: 404 });
  }
  if (!zonas.includes(reg.zona)) {
    return NextResponse.json(
      { mensaje: "No puedes descargar el Programa de esa zona." },
      { status: 403 },
    );
  }

  // Se re-renderiza desde el SNAPSHOT archivado: el documento sale idéntico al
  // original aunque la programación haya cambiado desde entonces.
  const snap = reg.snapshot_json as unknown as SnapshotPrograma;
  const bytes = await generarPdfPrograma(snap);
  return respuestaPdf(bytes, nombreArchivo(snap.fecha, reg.zona, reg.version));
}
