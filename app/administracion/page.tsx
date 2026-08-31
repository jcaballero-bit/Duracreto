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
import { ProduccionHistorica } from "./produccion-historica";
import { AjusteApertura, AjusteBloqueoEdicion, AjustesMotor } from "./ajustes-motor";
import { leerMargenHueco } from "@/lib/motor/config-runtime";
import { leerAperturaDefault, textoHoraMin } from "@/lib/motor/apertura";
import { leerConfigBloqueo } from "@/lib/programacion/bloqueo";
import { ETIQUETA_TIPO_DIA, TIPOS_DIA, textoMin } from "@/lib/planilla/recargos";
import {
  ETIQUETA_PUESTO_SINGULAR,
  ORDEN_PUESTOS,
  PUESTOS,
  etiquetaPuesto,
  type Puesto,
} from "@/lib/planilla/puestos";
import { PUESTOS_SIN_MEDICION } from "@/lib/asistencia/gantt-datos";
import { HorariosPlanta, type FilaPlantaHorario } from "./horarios-planta";
import { leerCostoFicha, leerUmbralExtra } from "@/lib/extraordinario/metricas";

export const dynamic = "force-dynamic";

const TABS: { key: string; label: string }[] = [
  { key: "planteles", label: "Planteles" },
  { key: "plantas", label: "Plantas" },
  { key: "asesores", label: "Asesores" },
  { key: "disenos", label: "Diseños de mezcla" },
  { key: "elementos", label: "Elementos" },
  { key: "historica", label: "Producción histórica" },
  { key: "capacidades", label: "Capacidades reducidas" },
  { key: "recargos", label: "Recargos de ley" },
  { key: "horarios", label: "Horario de planta" },
  { key: "umbrales", label: "Tiempo sin viaje" },
  { key: "ajustes", label: "Ajustes del motor" },
  { key: "usuarios", label: "Usuarios y roles" },
];

const opc = (arr: { value: string; label: string }[]) => arr;
const zonaOpc = ZONAS.map((z) => ({ value: z, label: z }));

export default async function AdministracionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; anioHist?: string }>;
}) {
  await requerirAcceso("/administracion");
  const sp = await searchParams;
  const tab = sp.tab ?? "planteles";

  // Listas de opciones (tablas pequeñas).
  const [planteles, plantas, asesores, usuarios] = await Promise.all([
    prisma.planteles.findMany({ orderBy: { nombre: "asc" } }),
    prisma.plantas.findMany({ orderBy: { nombre: "asc" }, include: { plantel: { select: { nombre: true } } } }),
    prisma.asesores.findMany({ orderBy: { nombre: "asc" } }),
    prisma.user.findMany({
      orderBy: { creado_en: "asc" },
      include: { roles: true, jefe_planteles: { select: { plantel_id: true } } },
    }),
  ]);
  const opcPlanteles = opc(planteles.map((p) => ({ value: String(p.id), label: `${p.nombre} (${p.zona})` })));
  // Solo tiene sentido asignar planta específica en planteles con 2+ plantas.
  const opcPlantas = opc(plantas.map((p) => ({ value: String(p.id), label: `${p.plantel.nombre} · ${p.nombre}` })));
  const opcUsuarios = opc(usuarios.map((u) => ({ value: u.id, label: `${u.name ?? "?"} (${u.email ?? ""})` })));

  const contenido = await renderTab(tab, sp, {
    planteles,
    asesores,
    usuarios,
    opcPlanteles,
    opcPlantas,
    opcUsuarios,
    margenHueco: await leerMargenHueco(),
    horaApertura: textoHoraMin(await leerAperturaDefault()),
    bloqueo: await leerConfigBloqueo(),
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
    planta_predeterminada_id: number | null;
    activo: boolean;
    roles: { rol: string }[];
    jefe_planteles: { plantel_id: number }[];
  }[];
  opcPlanteles: { value: string; label: string }[];
  opcPlantas: { value: string; label: string }[];
  opcUsuarios: { value: string; label: string }[];
  margenHueco: number;
  /** Hora de apertura de planta por defecto, "HH:MM". */
  horaApertura: string;
  bloqueo: { activo: boolean; horaCorteMin: number };
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

async function renderTab(tab: string, sp: { anioHist?: string }, ctx: Ctx) {
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
    case "historica": {
      // Solo el Administrador llega aquí (la página entera lo exige), y las acciones lo
      // vuelven a validar en el servidor: ocultar la pestaña no sería una restricción.
      const anioFiltro = Number(sp?.anioHist);
      const anio = Number.isInteger(anioFiltro) && anioFiltro > 1990 ? anioFiltro : null;
      const cargas = await prisma.produccion_historica.findMany({
        where: anio
          ? { fecha: { gte: new Date(anio, 0, 1), lt: new Date(anio + 1, 0, 1) } }
          : {},
        include: {
          plantel: { select: { nombre: true } },
          planta: { select: { nombre: true } },
        },
        orderBy: [{ fecha: "desc" }, { plantel_id: "asc" }, { planta_id: "asc" }],
        take: 500,
      });
      const todas = await prisma.produccion_historica.findMany({ select: { fecha: true } });
      const anios = [...new Set(todas.map((f) => f.fecha.getFullYear()))].sort((a, b) => b - a);
      const plantelesHist = await prisma.planteles.findMany({
        // Sus plantas dosificadoras: la carga historica se puede hacer por plantel
        // completo o por planta, y el selector se acota al plantel elegido.
        select: {
          id: true,
          nombre: true,
          plantas: { select: { id: true, nombre: true }, orderBy: { nombre: "asc" } },
        },
        orderBy: { nombre: "asc" },
      });
      // Las URLs se arman AQUI y viajan como datos. Un componente servidor no puede
      // pasarle una funcion a uno cliente (revienta en runtime con "Functions cannot be
      // passed directly to Client Components", y ni `tsc` ni el build lo detectan): es la
      // misma trampa que ya habia costado en el calendario de produccion.
      const filtrosAnio = [
        { etiqueta: "Todos", valor: null as number | null, href: "/administracion?tab=historica" },
        ...anios.map((a) => ({
          etiqueta: String(a),
          valor: a as number | null,
          href: `/administracion?tab=historica&anioHist=${a}`,
        })),
      ];
      return (
        <ProduccionHistorica
          planteles={plantelesHist}
          filtrosAnio={filtrosAnio}
          anioActivo={anio}
          filas={cargas.map((f) => ({
            id: f.id,
            fechaTxt:
              f.granularidad === "Mensual"
                ? f.fecha.toLocaleDateString("es-HN", { month: "long", year: "numeric" })
                : f.fecha.toLocaleDateString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric" }),
            plantel: f.plantel.nombre,
            planta: f.planta?.nombre ?? null,
            volumen: f.volumen_m3,
            granularidad: f.granularidad,
            observaciones: f.observaciones,
            cargadoPor: f.cargado_por,
          }))}
        />
      );
    }
    case "elementos": {
      const filas0 = await prisma.elementos.findMany({
        // Activos primero (son los que se ofrecen), alfabetico dentro de cada grupo.
        orderBy: [{ activo: "desc" }, { nombre: "asc" }],
      });
      const filas: FilaCatalogo[] = filas0.map((e) => ({
        id: e.id,
        celdas: { nombre: e.nombre, activo: e.activo ? "Sí" : "No" },
        valores: { nombre: e.nombre, activo: String(e.activo) },
      }));
      return bloque(
        "elementos",
        "elemento",
        "Los elementos que ofrece el desplegable de 'Elemento' en el Programa Semana y en Nuevo pedido. Es un catálogo de SUGERENCIAS: el campo sigue aceptando texto libre, así que en obra se puede escribir uno que no esté aquí. Poner un elemento en 'Activo: No' lo saca del desplegable sin borrar el historial de lo ya programado.",
        [
          { key: "nombre", label: "Elemento" },
          { key: "activo", label: "Activo" },
        ],
        [
          { name: "nombre", label: "Nombre del elemento", tipo: "text", requerido: true },
          {
            name: "activo",
            label: "Activo (se ofrece en el desplegable)",
            tipo: "select",
            opciones: [
              { value: "true", label: "Sí" },
              { value: "false", label: "No" },
            ],
          },
        ],
        filas,
      );
    }
    case "capacidades": {
      const filas0 = await prisma.capacidades_reducidas.findMany({
        orderBy: { capacidad_nominal_m3: "asc" },
      });
      const filas: FilaCatalogo[] = filas0.map((c) => ({
        id: c.id,
        celdas: {
          nominal: `${c.capacidad_nominal_m3} m³`,
          efectiva: `${c.capacidad_efectiva_m3} m³`,
        },
        valores: {
          capacidad_nominal_m3: String(c.capacidad_nominal_m3),
          capacidad_efectiva_m3: String(c.capacidad_efectiva_m3),
        },
      }));
      return bloque(
        "capacidades_reducidas",
        "capacidad reducida",
        "Carga efectiva por acceso difícil/pendiente. Un pedido marcado con 'carga reducida' usa la capacidad EFECTIVA (no la nominal) al planear los viajes. Editable por si aparecen otras capacidades de mixer.",
        [
          { key: "nominal", label: "Capacidad nominal" },
          { key: "efectiva", label: "Capacidad efectiva (acceso difícil)" },
        ],
        [
          { name: "capacidad_nominal_m3", label: "Capacidad nominal (m³)", tipo: "number", requerido: true },
          { name: "capacidad_efectiva_m3", label: "Capacidad efectiva (m³)", tipo: "number", requerido: true },
        ],
        filas,
        true, // sin importación CSV
      );
    }
    case "recargos": {
      const filas0 = await prisma.configuracion_recargos.findMany({
        orderBy: [{ tipo_dia: "asc" }, { hora_desde_min: "asc" }],
      });
      // Se listan por tipo de dia en el orden del negocio (LunVie, Sabado, Domingo).
      const rank = (t: string) => TIPOS_DIA.indexOf(t as (typeof TIPOS_DIA)[number]);
      const ordenadas = [...filas0].sort(
        (a, b) => rank(a.tipo_dia) - rank(b.tipo_dia) || a.hora_desde_min - b.hora_desde_min,
      );
      const filas: FilaCatalogo[] = ordenadas.map((r) => ({
        id: r.id,
        celdas: {
          dia: ETIQUETA_TIPO_DIA[r.tipo_dia as (typeof TIPOS_DIA)[number]] ?? r.tipo_dia,
          franja: `${textoMin(r.hora_desde_min)} a ${textoMin(r.hora_hasta_min)}`,
          recargo: r.porcentaje_recargo === 0 ? "Hora normal" : `${r.porcentaje_recargo} %`,
        },
        valores: {
          tipo_dia: r.tipo_dia,
          hora_desde_min: textoMin(r.hora_desde_min),
          hora_hasta_min: textoMin(r.hora_hasta_min),
          porcentaje_recargo: String(r.porcentaje_recargo),
        },
      }));
      return bloque(
        "configuracion_recargos",
        "banda de recargo",
        "Franjas horarias y su recargo, por tipo de dia. Es la tabla que usa la planilla para clasificar las horas de cada turno (0 % = hora normal). Editable: los porcentajes NO estan escritos en el codigo. Las horas se capturan como HH:MM y 24:00 es el final del dia.",
        [
          { key: "dia", label: "Tipo de dia" },
          { key: "franja", label: "Franja" },
          { key: "recargo", label: "Recargo" },
        ],
        [
          {
            name: "tipo_dia",
            label: "Tipo de dia",
            tipo: "select",
            opciones: TIPOS_DIA.map((t) => ({ value: t, label: ETIQUETA_TIPO_DIA[t] })),
            requerido: true,
          },
          { name: "hora_desde_min", label: "Desde (HH:MM)", tipo: "text", requerido: true, placeholder: "07:00" },
          { name: "hora_hasta_min", label: "Hasta (HH:MM)", tipo: "text", requerido: true, placeholder: "15:00" },
          { name: "porcentaje_recargo", label: "Recargo (%)", tipo: "number", requerido: true, placeholder: "25" },
        ],
        filas,
        true, // sin importacion CSV
      );
    }
    case "horarios": {
      const [plantasFull, costoFicha, umbralPct] = await Promise.all([
        prisma.plantas.findMany({
          orderBy: { id: "asc" },
          include: {
            plantel: { select: { nombre: true } },
            horarios_normales: true,
          },
        }),
        leerCostoFicha(),
        leerUmbralExtra(),
      ]);
      const filasHorario: FilaPlantaHorario[] = plantasFull.map((p) => ({
        plantaId: p.id,
        planta: p.nombre,
        plantel: p.plantel.nombre,
        celdas: p.horarios_normales.map((h) => ({
          tipoDia: h.tipo_dia,
          apertura: textoMin(h.hora_apertura_min),
          cierre: textoMin(h.hora_cierre_min),
          activo: h.activo,
        })),
      }));
      return (
        <HorariosPlanta filas={filasHorario} costoFicha={costoFicha} umbralPct={umbralPct} />
      );
    }
    case "umbrales": {
      const filas0 = await prisma.umbrales_ocio_puesto.findMany();
      const rank = (p: string) => ORDEN_PUESTOS.indexOf(p as Puesto);
      const filas: FilaCatalogo[] = [...filas0]
        .sort((a, b) => rank(a.puesto) - rank(b.puesto) || a.puesto.localeCompare(b.puesto))
        .map((u) => ({
          id: u.id,
          celdas: {
            puesto: etiquetaPuesto(u.puesto),
            hueco: `${u.minutos_hueco} min`,
            semaforo: `verde < ${u.verde_pct} % · amarillo hasta ${u.amarillo_pct} % · rojo arriba`,
          },
          valores: {
            puesto: u.puesto,
            minutos_hueco: String(u.minutos_hueco),
            verde_pct: String(u.verde_pct),
            amarillo_pct: String(u.amarillo_pct),
          },
        }));
      return bloque(
        "umbrales_ocio_puesto",
        "umbral por puesto",
        "Cuando se DIBUJA un tramo sin viaje en la linea de tiempo de Asistencia, y los cortes del semaforo del porcentaje. Cada puesto lleva su propia escala: un motorista ocupa ~90 min por ciclo completo y un dosificador ~15-20 min por carga, asi que con el mismo ritmo de trabajo el dosificador marca un porcentaje sin viaje mucho mayor. El total de tiempo sin viaje suma TODOS los tramos, tambien los mas cortos que el umbral (el umbral es solo para el dibujo).",
        [
          { key: "puesto", label: "Puesto" },
          { key: "hueco", label: "Se dibuja desde" },
          { key: "semaforo", label: "Semaforo del % sin viaje" },
        ],
        [
          {
            name: "puesto",
            label: "Puesto",
            tipo: "select",
            opciones: PUESTOS.filter((p) => !PUESTOS_SIN_MEDICION.includes(p)).map((p) => ({
              value: p,
              label: ETIQUETA_PUESTO_SINGULAR[p],
            })),
            requerido: true,
          },
          { name: "minutos_hueco", label: "Dibujar el tramo desde (min)", tipo: "number", requerido: true },
          { name: "verde_pct", label: "Verde por debajo de (%)", tipo: "number", requerido: true },
          { name: "amarillo_pct", label: "Amarillo hasta (%)", tipo: "number", requerido: true },
        ],
        filas,
        true, // sin importacion CSV
      );
    }
    case "ajustes": {
      return (
        <>
          <p className="mb-3 text-sm text-muted">
            Ajustes del motor de programación. El <strong>margen mínimo de hueco</strong> es
            el tiempo libre mínimo que debe quedar entre dos entregas para que el sistema
            ofrezca ese espacio al organizar el día automáticamente (evita dejar la
            programación tan apretada que un solo retraso genere una cascada de problemas).
          </p>
          <AjustesMotor margenHueco={ctx.margenHueco} />

          <hr className="my-6 border-border" />
          <p className="mb-3 text-sm text-muted">
            <strong>Hora de apertura de planta</strong>: a partir de qué hora se puede empezar a
            cargar. Rige todos los días; para un vaciado que arranca antes, el Programador puede
            adelantar la apertura de un día y una planta concretos desde la programación.
          </p>
          <AjusteApertura horaApertura={ctx.horaApertura} />

          <hr className="my-6 border-border" />
          <p className="mb-3 text-sm text-muted">
            <strong>Bloqueo horario de edición del programa</strong>: a partir de la hora de corte,
            el Jefe de Planta y el Programador ya no pueden mover la programación (para que el
            programa del día siguiente no se siga cambiando).
          </p>
          <AjusteBloqueoEdicion
            activo={ctx.bloqueo.activo}
            horaCorte={textoHoraMin(ctx.bloqueo.horaCorteMin)}
          />
        </>
      );
    }
    case "usuarios": {
      const filas: UsuarioAdmin[] = ctx.usuarios.map((u) => ({
        id: u.id,
        nombre: u.name ?? "(sin nombre)",
        correo: u.email ?? "—",
        zona: u.zona,
        plantelAsignadoId: u.plantel_asignado_id,
        plantaPredeterminadaId: u.planta_predeterminada_id,
        plantelesJefe: u.jefe_planteles.map((j) => j.plantel_id),
        roles: u.roles.map((r) => r.rol),
        activo: u.activo,
      }));
      return (
        <>
          <p className="mb-3 text-sm text-muted">
            Los usuarios pueden crearse aquí o al iniciar sesión. La zona aplica a
            Programador/Despachador/Laboratorista; el plantel a Jefe de Planta; el
            Dosificador se asigna a una PLANTA específica (en planteles de 2 plantas,
            cada planta necesita su propio usuario Dosificador). Varios roles posibles.
          </p>
          <UsuariosTabla
            usuarios={filas}
            planteles={ctx.planteles.map((p) => ({ id: p.id, nombre: p.nombre }))}
            plantas={ctx.opcPlantas}
          />
        </>
      );
    }
    default:
      return <p className="text-sm text-muted">Pestaña no encontrada.</p>;
  }
}
