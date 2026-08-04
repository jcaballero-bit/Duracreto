import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { ZONAS } from "@/lib/auth/roles";
import { Card, PageHeader } from "../components/ui";
import {
  CatalogoAdmin,
  type CampoDef,
  type ColumnaDef,
  type FilaCatalogo,
} from "./catalogo-admin";
import type { Catalogo } from "./catalogos-actions";
import { UsuariosTabla, type UsuarioAdmin } from "./usuarios-tabla";

export const dynamic = "force-dynamic";

const TABS: { key: string; label: string }[] = [
  { key: "planteles", label: "Planteles" },
  { key: "plantas", label: "Plantas" },
  { key: "asesores", label: "Asesores" },
  { key: "disenos", label: "Diseños de mezcla" },
  { key: "usuarios", label: "Usuarios y roles" },
];

const opc = (arr: { value: string; label: string }[]) => arr;
const zonaOpc = ZONAS.map((z) => ({ value: z, label: z }));

export default async function AdministracionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requerirAcceso("/administracion");
  const tab = (await searchParams).tab ?? "planteles";

  // Listas de opciones (tablas pequeñas).
  const [planteles, asesores, usuarios] = await Promise.all([
    prisma.planteles.findMany({ orderBy: { nombre: "asc" } }),
    prisma.asesores.findMany({ orderBy: { nombre: "asc" } }),
    prisma.user.findMany({ orderBy: { creado_en: "asc" }, include: { roles: true } }),
  ]);
  const opcPlanteles = opc(planteles.map((p) => ({ value: String(p.id), label: `${p.nombre} (${p.zona})` })));
  const opcUsuarios = opc(usuarios.map((u) => ({ value: u.id, label: `${u.name ?? "?"} (${u.email ?? ""})` })));

  const contenido = await renderTab(tab, {
    planteles,
    asesores,
    usuarios,
    opcPlanteles,
    opcUsuarios,
  });

  return (
    <>
      <PageHeader
        titulo="Administración"
        descripcion="Catálogos base del sistema. Todo lo que se crea/edita aquí es una operación de datos, sin cambios de código."
      />

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const activo = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/administracion?tab=${t.key}`}
              className={
                "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors " +
                (activo
                  ? "border-b-2 border-accent text-accent"
                  : "text-muted hover:text-ink")
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <Card className="p-5">{contenido}</Card>
    </>
  );
}

interface Ctx {
  planteles: { id: number; nombre: string; zona: string }[];
  asesores: { id: number; nombre: string }[];
  usuarios: {
    id: string;
    name: string | null;
    email: string | null;
    zona: string | null;
    plantel_asignado_id: number | null;
    activo: boolean;
    roles: { rol: string }[];
  }[];
  opcPlanteles: { value: string; label: string }[];
  opcUsuarios: { value: string; label: string }[];
}

function bloque(
  catalogo: Catalogo,
  singular: string,
  subtitulo: string,
  columnas: ColumnaDef[],
  campos: CampoDef[],
  filas: FilaCatalogo[],
  sinImport = false,
) {
  return (
    <>
      <p className="mb-3 text-sm text-muted">{subtitulo}</p>
      <CatalogoAdmin
        catalogo={catalogo}
        singular={singular}
        columnas={columnas}
        campos={campos}
        filas={filas}
        sinImport={sinImport}
      />
    </>
  );
}

async function renderTab(tab: string, ctx: Ctx) {
  const nombrePlantel = (id: number | null) =>
    ctx.planteles.find((p) => p.id === id)?.nombre ?? "—";

  switch (tab) {
    case "planteles": {
      const detalle = await prisma.planteles.findMany({ orderBy: { nombre: "asc" } });
      const coord = (v: number | null) => (v == null ? "—" : v.toFixed(5));
      const filasFull: FilaCatalogo[] = detalle.map((p) => ({
        id: p.id,
        celdas: {
          nombre: p.nombre,
          zona: p.zona,
          cap: `${p.capacidad_dosificacion_m3h} m³/h`,
          hub: nombrePlantel(p.hub_id),
          ubicacion: p.latitud != null && p.longitud != null ? `${coord(p.latitud)}, ${coord(p.longitud)}` : "—",
        },
        valores: {
          nombre: p.nombre,
          zona: p.zona,
          capacidad_dosificacion_m3h: String(p.capacidad_dosificacion_m3h),
          hub_id: p.hub_id ? String(p.hub_id) : "",
          latitud: p.latitud != null ? String(p.latitud) : "",
          longitud: p.longitud != null ? String(p.longitud) : "",
        },
      }));
      return bloque(
        "planteles",
        "plantel",
        "Los 7 planteles y su zona. El hub define de dónde se presta flota. La ubicación (latitud/longitud) se muestra en el mapa de cobertura comercial.",
        [
          { key: "nombre", label: "Nombre" },
          { key: "zona", label: "Zona" },
          { key: "cap", label: "Cap. m³/h" },
          { key: "hub", label: "Hub" },
          { key: "ubicacion", label: "Ubicación" },
        ],
        [
          { name: "nombre", label: "Nombre", tipo: "text", requerido: true },
          { name: "zona", label: "Zona", tipo: "select", opciones: zonaOpc, requerido: true },
          { name: "capacidad_dosificacion_m3h", label: "Capacidad m³/h", tipo: "number", requerido: true },
          { name: "hub_id", label: "Hub (plantel)", tipo: "select", opciones: ctx.opcPlanteles },
          { name: "latitud", label: "Latitud", tipo: "number", placeholder: "15.50410" },
          { name: "longitud", label: "Longitud", tipo: "number", placeholder: "-88.02500" },
        ],
        filasFull,
      );
    }
    case "plantas": {
      const plantas = await prisma.plantas.findMany({ orderBy: { id: "asc" } });
      const filas: FilaCatalogo[] = plantas.map((p) => ({
        id: p.id,
        celdas: {
          nombre: p.nombre,
          plantel: nombrePlantel(p.plantel_id),
          cap: `${p.capacidad_m3h} m³/h`,
          alistamiento: `${p.tiempo_alistamiento_min} min`,
        },
        valores: {
          nombre: p.nombre,
          plantel_id: String(p.plantel_id),
          capacidad_m3h: String(p.capacidad_m3h),
          tiempo_alistamiento_min: String(p.tiempo_alistamiento_min),
        },
      }));
      return bloque(
        "plantas",
        "planta",
        "Plantas dosificadoras (1 o 2 por plantel). La cap. m³/h y el alistamiento determinan el tiempo de carga (alistamiento + volumen/cap.).",
        [
          { key: "nombre", label: "Nombre" },
          { key: "plantel", label: "Plantel" },
          { key: "cap", label: "Cap. m³/h" },
          { key: "alistamiento", label: "Alistamiento" },
        ],
        [
          { name: "nombre", label: "Nombre", tipo: "text", requerido: true },
          { name: "plantel_id", label: "Plantel", tipo: "select", opciones: ctx.opcPlanteles, requerido: true },
          { name: "capacidad_m3h", label: "Capacidad m³/h", tipo: "number", requerido: true },
          {
            name: "tiempo_alistamiento_min",
            label: "Tiempo de alistamiento (min)",
            tipo: "number",
            placeholder: "5",
          },
        ],
        filas,
      );
    }
    case "asesores": {
      const asesores = await prisma.asesores.findMany({ orderBy: { id: "asc" } });
      const nombreUsuario = (id: string | null) =>
        ctx.usuarios.find((u) => u.id === id)?.name ?? "Sin vincular";
      const filas: FilaCatalogo[] = asesores.map((a) => ({
        id: a.id,
        celdas: {
          nombre: a.nombre,
          correo: a.correo ?? "—",
          usuario: nombreUsuario(a.usuario_auth_id),
          zona: a.zona_asignada ?? "Todas",
        },
        valores: {
          nombre: a.nombre,
          correo: a.correo ?? "",
          usuario_auth_id: a.usuario_auth_id ?? "",
          zona_asignada: a.zona_asignada ?? "",
        },
      }));
      return bloque(
        "asesores",
        "asesor",
        "Vendedores. Vincula un usuario para que (con rol Asesor) vea solo sus clientes. La zona limita qué ve en Programa Semana (solo su misma zona).",
        [
          { key: "nombre", label: "Nombre" },
          { key: "correo", label: "Correo" },
          { key: "usuario", label: "Usuario vinculado" },
          { key: "zona", label: "Zona" },
        ],
        [
          { name: "nombre", label: "Nombre", tipo: "text", requerido: true },
          { name: "correo", label: "Correo", tipo: "text" },
          { name: "usuario_auth_id", label: "Usuario vinculado", tipo: "select", opciones: ctx.opcUsuarios },
          {
            name: "zona_asignada",
            label: "Zona (Programa Semana)",
            tipo: "select",
            opciones: [{ value: "", label: "Todas (sin zona)" }, ...zonaOpc],
          },
        ],
        filas,
      );
    }
    case "disenos": {
      const disenos = await prisma.disenos_mezcla.findMany({ orderBy: { codigo: "asc" } });
      const filas: FilaCatalogo[] = disenos.map((d) => ({
        id: d.id,
        celdas: {
          codigo: d.codigo,
          resistencia: d.etiqueta_resistencia ?? (d.resistencia_psi ? String(d.resistencia_psi) : "—"),
          agregado: d.tamano_agregado ?? "—",
          revenimiento: d.revenimiento,
        },
        valores: {
          codigo: d.codigo,
          resistencia_psi: d.resistencia_psi ? String(d.resistencia_psi) : "",
          etiqueta_resistencia: d.etiqueta_resistencia ?? "",
          tamano_agregado: d.tamano_agregado ?? "",
          revenimiento: d.revenimiento,
          aditivo_especial: d.aditivo_especial ?? "",
        },
      }));
      return bloque(
        "disenos",
        "diseño",
        "Diseños de mezcla. Deja el código vacío para autogenerar (DIS-####).",
        [
          { key: "codigo", label: "Código" },
          { key: "resistencia", label: "Resistencia" },
          { key: "agregado", label: "Agregado" },
          { key: "revenimiento", label: "Revenimiento" },
        ],
        [
          { name: "codigo", label: "Código (vacío = auto)", tipo: "text" },
          { name: "etiqueta_resistencia", label: "Resistencia (etiqueta, p.ej. 4,000 o MR-600)", tipo: "text" },
          { name: "resistencia_psi", label: "Resistencia psi (número, opcional)", tipo: "number" },
          { name: "tamano_agregado", label: "Tamaño de agregado", tipo: "text", placeholder: '3/4"' },
          { name: "revenimiento", label: "Revenimiento", tipo: "text", requerido: true },
          { name: "aditivo_especial", label: "Aditivo especial", tipo: "text" },
        ],
        filas,
      );
    }
    case "usuarios": {
      const filas: UsuarioAdmin[] = ctx.usuarios.map((u) => ({
        id: u.id,
        nombre: u.name ?? "(sin nombre)",
        correo: u.email ?? "—",
        zona: u.zona,
        plantelAsignadoId: u.plantel_asignado_id,
        roles: u.roles.map((r) => r.rol),
        activo: u.activo,
      }));
      return (
        <>
          <p className="mb-3 text-sm text-muted">
            Los usuarios pueden crearse aquí o al iniciar sesión. La zona aplica a
            Programador/Despachador/Laboratorista; el plantel asignado a Jefe de
            Planta/Dosificador; un usuario puede tener varios roles.
          </p>
          <UsuariosTabla
            usuarios={filas}
            planteles={ctx.planteles.map((p) => ({ id: p.id, nombre: p.nombre }))}
          />
        </>
      );
    }
    default:
      return <p className="text-sm text-muted">Pestaña no encontrada.</p>;
  }
}
