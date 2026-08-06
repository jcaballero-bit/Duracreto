import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  CatalogoAdmin,
  type CampoDef,
  type ColumnaDef,
  type FilaCatalogo,
} from "../administracion/catalogo-admin";
import type { Catalogo } from "../administracion/catalogos-actions";

const ESTADO_UNIDAD = ["Disponible", "En mantenimiento", "Fuera de servicio"].map(
  (e) => ({ value: e, label: e }),
);

const SUBTABS: { key: string; label: string }[] = [
  { key: "mixers", label: "Mixers" },
  { key: "bombas", label: "Bombas" },
  { key: "camiones", label: "Camiones" },
  { key: "pickups", label: "Pickups" },
];

/** Sección "Equipo" de /flota: CRUD de mixers, bombas, camiones y pickups
 *  (movido desde Administración). Reutiliza el framework de catálogos. */
export async function EquipoCatalogos({ equipo }: { equipo: string }) {
  const sub = SUBTABS.some((s) => s.key === equipo) ? equipo : "mixers";

  const [planteles, operadores] = await Promise.all([
    prisma.planteles.findMany({ orderBy: { nombre: "asc" } }),
    prisma.operadores.findMany({ orderBy: { nombre: "asc" } }),
  ]);
  const opcPlanteles = planteles.map((p) => ({ value: String(p.id), label: `${p.nombre} (${p.zona})` }));
  const opcOperadores = operadores.map((o) => ({ value: String(o.id), label: o.nombre }));
  const nombrePlantel = (id: number) => planteles.find((p) => p.id === id)?.nombre ?? "—";

  const bloque = await construir(sub, { opcPlanteles, opcOperadores, nombrePlantel });

  return (
    <div>
      {/* Sub-selector del tipo de equipo */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {SUBTABS.map((s) => {
          const activo = s.key === sub;
          return (
            <Link
              key={s.key}
              href={`/flota?tab=equipo&equipo=${s.key}`}
              className={
                "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors " +
                (activo ? "border-b-2 border-accent text-accent" : "text-muted hover:text-ink")
              }
            >
              {s.label}
            </Link>
          );
        })}
      </div>
      <p className="mb-3 text-sm text-muted">{bloque.subtitulo}</p>
      <CatalogoAdmin
        catalogo={bloque.catalogo}
        singular={bloque.singular}
        columnas={bloque.columnas}
        campos={bloque.campos}
        filas={bloque.filas}
      />
    </div>
  );
}

interface Ctx {
  opcPlanteles: { value: string; label: string }[];
  opcOperadores: { value: string; label: string }[];
  nombrePlantel: (id: number) => string;
}

async function construir(
  sub: string,
  ctx: Ctx,
): Promise<{
  catalogo: Catalogo;
  singular: string;
  subtitulo: string;
  columnas: ColumnaDef[];
  campos: CampoDef[];
  filas: FilaCatalogo[];
}> {
  if (sub === "mixers") {
    const mixers = await prisma.mixers.findMany({
      orderBy: { id: "asc" },
      include: { operador_asignado: true },
    });
    const filas: FilaCatalogo[] = mixers.map((m) => ({
      id: m.id,
      celdas: {
        id: `#${m.id}`,
        identificador: m.identificador ?? "—",
        placa: m.placa ?? "—",
        marca: m.marca,
        cap: `${m.capacidad_m3} m³`,
        plantel: ctx.nombrePlantel(m.plantel_base_id),
        estado: m.estado,
        operador: m.operador_asignado?.nombre ?? "—",
      },
      valores: {
        identificador: m.identificador ?? "",
        placa: m.placa ?? "",
        marca: m.marca,
        capacidad_m3: String(m.capacidad_m3),
        plantel_base_id: String(m.plantel_base_id),
        estado: m.estado,
        operador_asignado_id: m.operador_asignado_id ? String(m.operador_asignado_id) : "",
      },
    }));
    return {
      catalogo: "mixers",
      singular: "mixer",
      subtitulo:
        "Flota de mixers. El identificador y la placa son opcionales; la capacidad (máxima de la unidad, p. ej. 8/10/12 m³) y el plantel base alimentan el motor. La programación automática carga 1 m³ menos por seguridad; en despacho se puede cargar hasta el máximo en emergencia.",
      columnas: [
        { key: "id", label: "ID" },
        { key: "identificador", label: "Identificador" },
        { key: "placa", label: "Placa" },
        { key: "marca", label: "Marca" },
        { key: "cap", label: "Cap." },
        { key: "plantel", label: "Plantel base" },
        { key: "estado", label: "Estado" },
        { key: "operador", label: "Motorista" },
      ],
      campos: [
        { name: "identificador", label: "Identificador (opcional)", tipo: "text", placeholder: "Ej. M-01" },
        { name: "placa", label: "Placa (opcional)", tipo: "text", placeholder: "Ej. HAB-1234" },
        { name: "marca", label: "Marca", tipo: "text", requerido: true },
        { name: "capacidad_m3", label: "Capacidad máxima m³ (p. ej. 8/10/12)", tipo: "number", requerido: true },
        { name: "plantel_base_id", label: "Plantel base", tipo: "select", opciones: ctx.opcPlanteles, requerido: true },
        { name: "estado", label: "Estado", tipo: "select", opciones: ESTADO_UNIDAD, requerido: true },
        { name: "operador_asignado_id", label: "Motorista", tipo: "select", opciones: ctx.opcOperadores },
      ],
      filas,
    };
  }

  if (sub === "bombas") {
    const bombas = await prisma.bombas.findMany({ orderBy: { id: "asc" } });
    const filas: FilaCatalogo[] = bombas.map((b) => ({
      id: b.id,
      celdas: { identificador: b.identificador, estado: b.estado, plantel: ctx.nombrePlantel(b.plantel_base_id) },
      valores: { identificador: b.identificador, estado: b.estado, plantel_base_id: String(b.plantel_base_id) },
    }));
    return {
      catalogo: "bombas",
      singular: "bomba",
      subtitulo: "Bombas de concreto por plantel base (pluma o estacionaria).",
      columnas: [
        { key: "identificador", label: "Identificador" },
        { key: "estado", label: "Estado" },
        { key: "plantel", label: "Plantel base" },
      ],
      campos: [
        { name: "identificador", label: "Identificador", tipo: "text", requerido: true },
        { name: "estado", label: "Estado", tipo: "select", opciones: ESTADO_UNIDAD, requerido: true },
        { name: "plantel_base_id", label: "Plantel base", tipo: "select", opciones: ctx.opcPlanteles, requerido: true },
      ],
      filas,
    };
  }

  // camiones | pickups
  const esCamion = sub === "camiones";
  const registros = esCamion
    ? await prisma.camiones.findMany({ orderBy: { id: "asc" } })
    : await prisma.pickups.findMany({ orderBy: { id: "asc" } });
  const filas: FilaCatalogo[] = registros.map((u) => ({
    id: u.id,
    celdas: {
      identificador: u.identificador,
      placa: u.placa ?? "—",
      estado: u.estado,
      plantel: ctx.nombrePlantel(u.plantel_base_id),
    },
    valores: {
      identificador: u.identificador,
      placa: u.placa ?? "",
      estado: u.estado,
      plantel_base_id: String(u.plantel_base_id),
    },
  }));
  return {
    catalogo: esCamion ? "camiones" : "pickups",
    singular: esCamion ? "camión" : "pickup",
    subtitulo: esCamion
      ? "Camiones para mover/remolcar las bombas estacionarias."
      : "Pickups de apoyo (supervisión, traslado de personal).",
    columnas: [
      { key: "identificador", label: "Identificador" },
      { key: "placa", label: "Placa" },
      { key: "estado", label: "Estado" },
      { key: "plantel", label: "Plantel base" },
    ],
    campos: [
      { name: "identificador", label: "Identificador", tipo: "text", requerido: true },
      { name: "placa", label: "Placa", tipo: "text" },
      { name: "estado", label: "Estado", tipo: "select", opciones: ESTADO_UNIDAD, requerido: true },
      { name: "plantel_base_id", label: "Plantel base", tipo: "select", opciones: ctx.opcPlanteles, requerido: true },
    ],
    filas,
  };
}
