"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { exigirAdmin } from "@/lib/auth/guard";
import { ArchivoNoSoportado, leerHojaBiff } from "@/lib/biometrico/biff";
import { interpretarArchivo, type ResumenArchivo } from "@/lib/biometrico/parseo";
import {
  aplicarImportacion,
  ignorarCodigo,
  mapearDepartamento,
  previsualizar,
  vincularCodigo,
  type PreviaImportacion,
  type ReporteImportacion,
} from "@/lib/biometrico/importar";

type Res = { ok: boolean; mensaje?: string };

async function usuario(): Promise<string> {
  const s = await auth();
  return s?.user?.name ?? s?.user?.email ?? "sistema";
}

type Leido =
  | { error: string }
  | { error?: undefined; resumen: ResumenArchivo; nombre: string; celdas: number };

/** Lee el archivo del FormData y lo interpreta. Devuelve un mensaje claro si no se puede. */
async function leerArchivo(formData: FormData): Promise<Leido> {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "No se recibió el archivo." };
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  try {
    const hoja = leerHojaBiff(bytes);
    return { resumen: interpretarArchivo(hoja.filas), nombre: archivo.name, celdas: hoja.celdas };
  } catch (e) {
    if (e instanceof ArchivoNoSoportado) return { error: e.message };
    return { error: e instanceof Error ? e.message : "No se pudo leer el archivo." };
  }
}

/**
 * Previsualización de la importación: qué trae el archivo, qué falta vincular y qué
 * chocaría con datos capturados a mano. NO escribe nada.
 */
export async function previsualizarArchivoAction(
  formData: FormData,
): Promise<{ ok: false; mensaje: string } | { ok: true; previa: PreviaImportacion; nombre: string }> {
  const admin = await exigirAdmin();
  if (!admin.ok) return { ok: false, mensaje: admin.mensaje ?? "Sin permiso." };

  const leido = await leerArchivo(formData);
  if (leido.error != null) return { ok: false, mensaje: leido.error };

  return { ok: true, previa: await previsualizar(leido.resumen), nombre: leido.nombre };
}

/**
 * Aplica la importación. `sobrescribirManuales` solo debe venir en true cuando la
 * persona lo confirmó viendo la lista de conflictos.
 */
export async function importarArchivoAction(
  formData: FormData,
  sobrescribirManuales: boolean,
): Promise<{ ok: false; mensaje: string } | { ok: true; reporte: ReporteImportacion }> {
  const admin = await exigirAdmin();
  if (!admin.ok) return { ok: false, mensaje: admin.mensaje ?? "Sin permiso." };

  const leido = await leerArchivo(formData);
  if (leido.error != null) return { ok: false, mensaje: leido.error };

  const reporte = await aplicarImportacion(leido.resumen, {
    usuario: await usuario(),
    sobrescribirManuales,
  });
  revalidatePath("/planilla");
  return { ok: true, reporte };
}

/** Vincula un código del reloj a una persona del personal operativo. */
export async function vincularCodigoAction(
  codigo: string,
  personaId: number | null,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;
  const r = await vincularCodigo(codigo, personaId, await usuario());
  if (r.ok) revalidatePath("/planilla/importar");
  return r;
}

/** Marca (o desmarca) un código como ajeno al personal operativo. */
export async function ignorarCodigoAction(
  codigo: string,
  nombreReloj: string,
  ignorar: boolean,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;
  const r = await ignorarCodigo(codigo, nombreReloj, ignorar, await usuario());
  if (r.ok) revalidatePath("/planilla/importar");
  return r;
}

/** Correspondencia entre un departamento del reloj y un plantel del sistema. */
export async function mapearDepartamentoAction(
  departamento: string,
  plantelId: number | null,
): Promise<Res> {
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;
  const r = await mapearDepartamento(departamento, plantelId, await usuario());
  if (r.ok) revalidatePath("/planilla/importar");
  return r;
}
