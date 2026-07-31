import { prisma } from "@/lib/prisma";
import { CatalogoAdmin, type FilaCatalogo } from "../administracion/catalogo-admin";

/**
 * Catálogo de operadores (motoristas), movido de Administración a Flota. Reutiliza
 * el framework de catálogos; las acciones (crear/editar/eliminar/importar) están
 * autorizadas para Admin + Programador + Despachador + Dosificador + Jefe de Planta
 * (ver autorizarCatalogo en catalogos-actions.ts).
 */
export async function OperadoresCatalogo() {
  const operadores = await prisma.operadores.findMany({ orderBy: { nombre: "asc" } });
  const filas: FilaCatalogo[] = operadores.map((o) => ({
    id: o.id,
    celdas: { nombre: o.nombre, estado: o.estado },
    valores: { nombre: o.nombre, estado: o.estado },
  }));

  return (
    <div>
      <p className="mb-3 text-sm text-muted">Motoristas. El estado indica su disponibilidad.</p>
      <CatalogoAdmin
        catalogo="operadores"
        singular="operador"
        columnas={[
          { key: "nombre", label: "Nombre" },
          { key: "estado", label: "Estado" },
        ]}
        campos={[
          { name: "nombre", label: "Nombre", tipo: "text", requerido: true },
          {
            name: "estado",
            label: "Estado",
            tipo: "select",
            opciones: [
              { value: "Disponible", label: "Disponible" },
              { value: "No disponible", label: "No disponible" },
            ],
            requerido: true,
          },
        ]}
        filas={filas}
      />
    </div>
  );
}
