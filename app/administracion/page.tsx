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
  { key: "mixers", label: "Mixers" },
  { key: "bombas", label: "Bombas" },
  { key: "operadores", label: "Operadores" },
  { key: "asesores", label: "Asesores" },
  { key: "disenos", label: "Diseños de mezcla" },
  { key: "usuarios", label: "Usuarios y roles" },
];

const opc = (arr: { value: string; label: string }[]) => arr;
const zonaOpc = ZONAS.map((z) => ({ value: z, label: z }));
const estadoUnidad = ["Disponible", "En mantenimiento", "Fuera de servicio"].map(
  (e) => ({ value: e, label: e }),
);

export default async function AdministracionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requerirAcceso("/administracion");
  const tab = (await searchParams).tab ?? "planteles";

  // Listas de opciones (tablas pequeñas).
  const [planteles, operadores, asesores, usuarios] = await Promise.all([
    prisma.planteles.findMany({ orderBy: { nombre: "asc" } }),
    prisma.operadores.findMany({ orderBy: { nombre: "asc" } }),
    prisma.asesores.findMany({ orderBy: { nombre: "asc" } }),
    prisma.user.findMany({ orderBy: { creado_en: "asc" }, include: { roles: true } }),
  ]);
  const opcPlanteles = opc(planteles.map((p) => ({ value: String(p.id), label: `${p.nombre} (${p.zona})` })));
  const opcOperadores = opc(operadores.map((o) => ({ value: String(o.id), label: o.nombre })));
  const opcUsuarios = opc(usuarios.map((u) => ({ value: u.id, label: `${u.name ?? "?"} (${u.email ?? ""})` })));

  const contenido = await renderTab(tab, {
    planteles,
    operadores,
    asesores,
    usuarios,
    opcPlanteles,
    opcOperadores,
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
  operadores: { id: number; nombre: string; estado: string }[];
  asesores: { id: number; nombre: string }[];
  usuarios: {
    id: string;
    name: string | null;
    email: string | null;
    zona: string | null;
    activo: boolean;
    roles: { rol: string }[];
  }[];
  opcPlanteles: { value: string; label: string }[];
  opcOperadores: { value: string; label: string }[];
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
      const filasFull: FilaCatalogo[] = detalle.map((p) => ({
        id: p.id,
        celdas: {
          nombre: p.nombre,
          zona: p.zona,
          cap: `${p.capacidad_dosificacion_m3h} m³/h`,
          hub: nombrePlantel(p.hub_id),
        },
        valores: {
          nombre: p.nombre,
          zona: p.zona,
          capacidad_dosificacion_m3h: String(p.capacidad_dosificacion_m3h),
          hub_id: p.hub_id ? String(p.hub_id) : "",
        },
      }));
      return bloque(
        "planteles",
        "plantel",
        "Los 7 planteles y su zona. El hub define de dónde se presta flota.",
        [
          { key: "nombre", label: "Nombre" },
          { key: "zona", label: "Zona" },
          { key: "cap", label: "Cap. m³/h" },
          { key: "hub", label: "Hub" },
        ],
        [
          { name: "nombre", label: "Nombre", tipo: "text", requerido: true },
          { name: "zona", label: "Zona", tipo: "select", opciones: zonaOpc, requerido: true },
          { name: "capacidad_dosificacion_m3h", label: "Capacidad m³/h", tipo: "number", requerido: true },
          { name: "hub_id", label: "Hub (plantel)", tipo: "select", opciones: ctx.opcPlanteles },
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
    case "mixers": {
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
          plantel: nombrePlantel(m.plantel_base_id),
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
      return bloque(
        "mixers",
        "mixer",
        "Flota de mixers. El identificador y la placa son opcionales; la capacidad (7/9/11) y el plantel base alimentan el motor.",
        [
          { key: "id", label: "ID" },
          { key: "identificador", label: "Identificador" },
          { key: "placa", label: "Placa" },
          { key: "marca", label: "Marca" },
          { key: "cap", label: "Cap." },
          { key: "plantel", label: "Plantel base" },
          { key: "estado", label: "Estado" },
          { key: "operador", label: "Motorista" },
        ],
        [
          { name: "identificador", label: "Identificador (opcional)", tipo: "text", placeholder: "Ej. M-01" },
          { name: "placa", label: "Placa (opcional)", tipo: "text", placeholder: "Ej. HAB-1234" },
          { name: "marca", label: "Marca", tipo: "text", requerido: true },
          { name: "capacidad_m3", label: "Capacidad m³ (7/9/11)", tipo: "number", requerido: true },
          { name: "plantel_base_id", label: "Plantel base", tipo: "select", opciones: ctx.opcPlanteles, requerido: true },
          { name: "estado", label: "Estado", tipo: "select", opciones: estadoUnidad, requerido: true },
          { name: "operador_asignado_id", label: "Motorista", tipo: "select", opciones: ctx.opcOperadores },
        ],
        filas,
      );
    }
    case "bombas": {
      const bombas = await prisma.bombas.findMany({ orderBy: { id: "asc" } });
      const filas: FilaCatalogo[] = bombas.map((b) => ({
        id: b.id,
        celdas: {
          identificador: b.identificador,
          estado: b.estado,
          plantel: nombrePlantel(b.plantel_base_id),
        },
        valores: {
          identificador: b.identificador,
          estado: b.estado,
          plantel_base_id: String(b.plantel_base_id),
        },
      }));
      return bloque(
        "bombas",
        "bomba",
        "Bombas de concreto por plantel base.",
        [
          { key: "identificador", label: "Identificador" },
          { key: "estado", label: "Estado" },
          { key: "plantel", label: "Plantel base" },
        ],
        [
          { name: "identificador", label: "Identificador", tipo: "text", requerido: true },
          { name: "estado", label: "Estado", tipo: "select", opciones: estadoUnidad, requerido: true },
          { name: "plantel_base_id", label: "Plantel base", tipo: "select", opciones: ctx.opcPlanteles, requerido: true },
        ],
        filas,
      );
    }
    case "operadores": {
      const filas: FilaCatalogo[] = ctx.operadores.map((o) => ({
        id: o.id,
        celdas: { nombre: o.nombre, estado: o.estado },
        valores: { nombre: o.nombre, estado: o.estado },
      }));
      return bloque(
        "operadores",
        "operador",
        "Motoristas. El estado indica su disponibilidad.",
        [
          { key: "nombre", label: "Nombre" },
          { key: "estado", label: "Estado" },
        ],
        [
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
        },
        valores: {
          nombre: a.nombre,
          correo: a.correo ?? "",
          usuario_auth_id: a.usuario_auth_id ?? "",
        },
      }));
      return bloque(
        "asesores",
        "asesor",
        "Vendedores. Vincula un usuario para que (con rol Asesor) vea solo sus clientes.",
        [
          { key: "nombre", label: "Nombre" },
          { key: "correo", label: "Correo" },
          { key: "usuario", label: "Usuario vinculado" },
        ],
        [
          { name: "nombre", label: "Nombre", tipo: "text", requerido: true },
          { name: "correo", label: "Correo", tipo: "text" },
          { name: "usuario_auth_id", label: "Usuario vinculado", tipo: "select", opciones: ctx.opcUsuarios },
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
        roles: u.roles.map((r) => r.rol),
        activo: u.activo,
      }));
      return (
        <>
          <p className="mb-3 text-sm text-muted">
            Los usuarios pueden crearse aquí o al iniciar sesión. La zona aplica a
            Programador/Despachador; un usuario puede tener varios roles.
          </p>
          <UsuariosTabla usuarios={filas} />
        </>
      );
    }
    default:
      return <p className="text-sm text-muted">Pestaña no encontrada.</p>;
  }
}
