import { prisma } from "@/lib/prisma";
import {
  CatalogoAdmin,
  type FilaCatalogo,
  type MixerOpc,
} from "../administracion/catalogo-admin";

/**
 * Catálogo de operadores (motoristas), en Flota. Reutiliza el framework de catálogos.
 * Cada operador tiene:
 *  · Plantel asignado (operadores.plantel_asignado_id) — dónde trabaja normalmente.
 *  · Mixer asignado (habitual) — desplegable inline que escribe en la FUENTE ÚNICA
 *    `mixers.operador_asignado_id` (no se duplica un mixer_id en operadores). El motor
 *    luego pre-llena el motorista del viaje desde ese campo (editable en despacho).
 * Autorizadas para Admin + Programador + Despachador + Dosificador + Jefe de Planta
 * (ver autorizarCatalogo en catalogos-actions.ts; la asignación de mixer usa el guard
 * de gestión de flota, que excluye al Dosificador).
 */
export async function OperadoresCatalogo() {
  const [operadores, planteles, mixersRaw] = await Promise.all([
    prisma.operadores.findMany({ orderBy: { nombre: "asc" } }),
    prisma.planteles.findMany({ orderBy: { nombre: "asc" } }),
    prisma.mixers.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        identificador: true,
        capacidad_m3: true,
        plantel_base_id: true,
        operador_asignado_id: true,
      },
    }),
  ]);

  const nombrePlantel = (id: number | null) =>
    id == null ? "—" : planteles.find((p) => p.id === id)?.nombre ?? "—";
  const opcPlanteles = planteles.map((p) => ({
    value: String(p.id),
    label: `${p.nombre} (${p.zona})`,
  }));
  const mixers: MixerOpc[] = mixersRaw.map((m) => ({
    id: m.id,
    identificador: m.identificador ?? `#${m.id}`,
    capacidad: m.capacidad_m3,
    plantelBaseId: m.plantel_base_id,
    operadorAsignadoId: m.operador_asignado_id,
  }));
  const mixerDe = (operadorId: number) =>
    mixers.find((m) => m.operadorAsignadoId === operadorId) ?? null;

  const filas: FilaCatalogo[] = operadores.map((o) => {
    const mx = mixerDe(o.id);
    return {
      id: o.id,
      celdas: {
        nombre: o.nombre,
        estado: o.estado,
        plantel: nombrePlantel(o.plantel_asignado_id),
        // La celda "mixer" la renderiza MixerAsignadoCelda (desplegable inline); este
        // texto es solo el respaldo si no se pasara `mixerAsignado`.
        mixer: mx ? `${mx.identificador} (${mx.capacidad} m³)` : "—",
      },
      valores: {
        nombre: o.nombre,
        estado: o.estado,
        plantel_asignado_id: o.plantel_asignado_id ? String(o.plantel_asignado_id) : "",
      },
    };
  });

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Motoristas. El estado indica su disponibilidad. El <strong>plantel asignado</strong> es
        donde trabaja normalmente; el <strong>mixer asignado</strong> es su unidad habitual (al
        programarlo, el motor pre-llena a este motorista, editable en despacho).
      </p>
      <CatalogoAdmin
        catalogo="operadores"
        singular="operador"
        columnas={[
          { key: "nombre", label: "Nombre" },
          { key: "estado", label: "Estado" },
          { key: "plantel", label: "Plantel asignado" },
          { key: "mixer", label: "Mixer asignado" },
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
          {
            name: "plantel_asignado_id",
            label: "Plantel asignado (dónde trabaja normalmente)",
            tipo: "select",
            opciones: opcPlanteles,
          },
        ]}
        filas={filas}
        mixerAsignado={{ mixers }}
      />
    </div>
  );
}
