import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { filtroClientePorAsesor } from "@/lib/auth/acceso";
import { requerirAcceso } from "@/lib/auth/guard";
import { Card, PageHeader } from "../components/ui";
import { VentasTabs } from "../components/ventas-tabs";
import { ClientesTabla, type FilaCliente } from "./clientes-tabla";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const alcance = await requerirAcceso("/clientes");
  const sesion = await auth();
  const userId = sesion?.user?.id ?? "";
  const esAdmin = alcance.esAdmin;

  // Asesor: SOLO sus propios clientes (filtro server-side, no visual). Admin: todos.
  const where = esAdmin ? {} : filtroClientePorAsesor(userId);

  const [clientes, asesores] = await Promise.all([
    prisma.clientes.findMany({
      where,
      // Activos arriba, inactivos agrupados al final; dentro de cada grupo A→Z.
      orderBy: [{ activo: "desc" }, { empresa: "asc" }],
      include: { asesor: { select: { nombre: true } } },
    }),
    esAdmin
      ? prisma.asesores.findMany({ orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
  ]);

  const tiempoTxt = (v: number | null) => (v == null ? "—" : `${v} min`);

  const filas: FilaCliente[] = clientes.map((c) => ({
    id: c.id,
    celdas: {
      empresa: c.empresa,
      proyecto: c.proyecto ?? "—",
      ubicacion: c.ubicacion,
      asesor: c.asesor?.nombre ?? "—",
      telefono: c.telefono ?? "—",
      tiempos: tiempoTxt(c.tiempo_viaje_referencia_min),
      estado: c.activo ? "Activo" : "Inactivo",
    },
    valores: {
      empresa: c.empresa,
      proyecto: c.proyecto ?? "",
      ubicacion: c.ubicacion,
      latitud: c.latitud != null ? String(c.latitud) : "",
      longitud: c.longitud != null ? String(c.longitud) : "",
      google_maps_url: c.google_maps_url ?? "",
      ubicacion_origen: c.ubicacion_origen ?? "",
      ubicacion_precision_m: c.ubicacion_precision_m != null ? String(c.ubicacion_precision_m) : "",
      contacto: c.contacto ?? "",
      telefono: c.telefono ?? "",
      activo: c.activo ? "true" : "false",
      tiempo_viaje_referencia_min:
        c.tiempo_viaje_referencia_min != null ? String(c.tiempo_viaje_referencia_min) : "",
      asesor_id: c.asesor_id != null ? String(c.asesor_id) : "",
    },
  }));

  // La columna Asesor solo tiene sentido para el Admin (el Asesor ya sabe que
  // todos son suyos).
  const columnas = [
    { key: "empresa", label: "Cliente" },
    { key: "proyecto", label: "Proyecto" },
    { key: "ubicacion", label: "Ubicación" },
    ...(esAdmin ? [{ key: "asesor", label: "Asesor" }] : []),
    { key: "telefono", label: "Teléfono" },
    { key: "tiempos", label: "Transporte" },
    { key: "estado", label: "Activo" },
  ];

  return (
    <>
      <PageHeader
        titulo="Clientes"
        descripcion={
          esAdmin
            ? "Clientes de todos los asesores. Incluye ubicación, coordenadas y tiempos de ruta de referencia."
            : "Tus clientes. Incluye ubicación, coordenadas y tiempos de ruta de referencia."
        }
      />

      <VentasTabs activo="/clientes" roles={alcance.roles} />

      <Card className="p-5">
        <ClientesTabla
          filas={filas}
          columnas={columnas}
          esAdmin={esAdmin}
          asesores={asesores.map((a) => ({ value: String(a.id), label: a.nombre }))}
        />
      </Card>
    </>
  );
}
