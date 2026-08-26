import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { Card, PageHeader } from "../components/ui";
import { leerBandas } from "@/lib/planilla/consulta";
import { ORDEN_PUESTOS, etiquetaPuesto, type Puesto } from "@/lib/planilla/puestos";
import {
  alcanceAsistencia,
  filtroPersonalPorAlcance,
  puedeEditarPersona,
} from "@/lib/asistencia/acceso";
import { PersonalTabs } from "../components/personal-tabs";
import { TablaAsistencia, type PersonaAsistencia } from "./tabla-asistencia";
import { ControlesAsistencia } from "./controles";
import { GanttJornada } from "./gantt-view";
import { VistaToggleAsistencia } from "./vista-toggle";
import { datosGantt, leerUmbrales, personasParaGantt } from "@/lib/asistencia/gantt-datos";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (f: Date | null) => (f ? `${pad(f.getHours())}:${pad(f.getMinutes())}` : "");

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function diaDesdeISO(texto: string | undefined): Date | null {
  const m = (texto ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/**
 * Asistencia: dónde se ven y se capturan las horas de entrada y salida del personal
 * operativo. Administrador (todo), Jefe de Planta (sus planteles) y Programador (su
 * zona) — el alcance se resuelve en el servidor y se vuelve a validar al guardar.
 *
 * REGLA: esta pantalla NO muestra salarios, tarifas ni costos. Solo horas.
 */
export default async function AsistenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; plantel?: string; vista?: string }>;
}) {
  const alcance = await requerirAcceso("/asistencia");
  const sp = await searchParams;

  // Dos vistas de la MISMA información: la tabla de captura y la línea de tiempo que
  // la cruza con los viajes. No es una ruta nueva.
  const timeline = sp.vista === "timeline";

  const hoy = new Date();
  const dia = diaDesdeISO(sp.fecha) ?? new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const diaSiguiente = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1);

  // Planteles de la zona (para el Programador) y alcance efectivo.
  const zonas = alcance.zonasPermitidas ?? [];
  const plantelesDeZona = zonas.length
    ? (await prisma.planteles.findMany({ where: { zona: { in: zonas } }, select: { id: true } })).map(
        (p) => p.id,
      )
    : [];
  const ambito = alcanceAsistencia(alcance, () => plantelesDeZona);

  const plantelesVisibles = await prisma.planteles.findMany({
    where: ambito.todos ? {} : { id: { in: ambito.plantelIds } },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, zona: true },
  });

  // Filtro de plantel de la pantalla: NUNCA amplía el alcance del rol.
  const plantelParam = Number(sp.plantel);
  const plantelFiltro =
    Number.isInteger(plantelParam) && plantelesVisibles.some((p) => p.id === plantelParam)
      ? plantelParam
      : null;

  const personas = await prisma.operadores.findMany({
    where: {
      activo: true,
      ...(plantelFiltro != null
        ? { plantel_asignado_id: plantelFiltro }
        : filtroPersonalPorAlcance(ambito)),
    },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      puesto: true,
      plantel_asignado_id: true,
      plantel_asignado: { select: { nombre: true } },
      asistencias: {
        where: { fecha: { gte: dia, lt: diaSiguiente } },
        select: {
          hora_entrada: true,
          hora_salida: true,
          horas_normales: true,
          horas_extra_25: true,
          horas_extra_50: true,
          horas_extra_75: true,
          horas_extra_100: true,
          tipo_ausencia: true,
          observaciones: true,
          origen: true,
        },
      },
    },
  });

  // ── Datos de la línea de tiempo (solo si es la vista activa) ─────────────
  let gantt: Awaited<ReturnType<typeof datosGantt>> | null = null;
  if (timeline) {
    // El alcance del rol ya está resuelto arriba: null = todos (Administrador).
    const plantelIds =
      plantelFiltro != null ? [plantelFiltro] : ambito.todos ? null : ambito.plantelIds;
    gantt = await datosGantt(dia, await personasParaGantt(plantelIds), await leerUmbrales());
  }

  const filas: PersonaAsistencia[] = personas.map((p) => {
    const a = p.asistencias[0];
    const salida = a?.hora_salida ?? null;
    const entrada = a?.hora_entrada ?? null;
    return {
      id: p.id,
      nombre: p.nombre,
      puesto: p.puesto,
      plantel: p.plantel_asignado?.nombre ?? "Sin plantel",
      entrada: hhmm(entrada),
      salida: hhmm(salida),
      // El turno cruzó la medianoche si la salida quedó en otro día.
      cruzaMedianoche: !!(entrada && salida && iso(salida) !== iso(entrada)),
      normales: a?.horas_normales ?? 0,
      extra25: a?.horas_extra_25 ?? 0,
      extra50: a?.horas_extra_50 ?? 0,
      extra75: a?.horas_extra_75 ?? 0,
      extra100: a?.horas_extra_100 ?? 0,
      tipoAusencia: a?.tipo_ausencia ?? "",
      observaciones: a?.observaciones ?? "",
      origen: a?.origen ?? null,
      registrado: !!a,
      puedeEditar: puedeEditarPersona(ambito, p.plantel_asignado_id),
    };
  });

  // Avance del día: quién ya tiene asistencia registrada y quién falta.
  const registrados = filas.filter((f) => f.registrado).length;
  const faltantes = filas.length - registrados;

  const grupos = ORDEN_PUESTOS.map((puesto) => ({
    puesto: puesto as string,
    etiqueta: etiquetaPuesto(puesto),
    gente: filas.filter((f) => f.puesto === puesto),
  }))
    .concat(
      [...new Set(filas.map((f) => f.puesto))]
        .filter((p) => !ORDEN_PUESTOS.includes(p as Puesto))
        .map((puesto) => ({
          puesto,
          etiqueta: etiquetaPuesto(puesto),
          gente: filas.filter((f) => f.puesto === puesto),
        })),
    )
    .filter((g) => g.gente.length > 0);

  // Las bandas de recargo se leen una sola vez y viajan al cliente: la pantalla usa la
  // MISMA función de cálculo que el servidor para actualizar los totales al escribir.
  const bandas = await leerBandas();

  const anterior = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() - 1);
  const siguiente = diaSiguiente;
  const href = (d: Date, plantel: number | null) =>
    `/asistencia?fecha=${iso(d)}${plantel != null ? `&plantel=${plantel}` : ""}` +
    (timeline ? "&vista=timeline" : "");
  const hrefVista = (d: Date, plantel: number | null, vista: "tabla" | "timeline") =>
    `/asistencia?fecha=${iso(d)}${plantel != null ? `&plantel=${plantel}` : ""}` +
    (vista === "timeline" ? "&vista=timeline" : "");

  return (
    <>
      <PageHeader
        titulo="Asistencia"
        descripcion="Horas de entrada y salida del personal operativo. Los valores calculados se actualizan al escribir, para detectar de inmediato una hora mal digitada."
      />

      <PersonalTabs activo="/asistencia" roles={alcance.roles} />

      <VistaToggleAsistencia
        hrefTabla={hrefVista(dia, plantelFiltro, "tabla")}
        hrefTimeline={hrefVista(dia, plantelFiltro, "timeline")}
        activa={timeline ? "timeline" : "tabla"}
      />

      <Card className="mb-4 p-4">
        <ControlesAsistencia
          fechaISO={iso(dia)}
          etiquetaFecha={`${DIAS[dia.getDay()]} ${dia.getDate()} de ${MESES[dia.getMonth()]} de ${dia.getFullYear()}`}
          hrefAnterior={href(anterior, plantelFiltro)}
          hrefSiguiente={href(siguiente, plantelFiltro)}
          planteles={plantelesVisibles}
          plantelActual={plantelFiltro != null ? String(plantelFiltro) : ""}
          etiquetaAlcance={ambito.etiqueta}
          registrados={registrados}
          faltantes={faltantes}
          total={filas.length}
        />
      </Card>

      {timeline ? (
        <GanttJornada datos={gantt!} fechaTexto={`${dia.getDate()} de ${MESES[dia.getMonth()]}`} />
      ) : filas.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          No hay personal activo en tu alcance
          {plantelFiltro != null ? " para el plantel elegido" : ""}. El personal se da de alta en
          Flota › Operadores, y ahí mismo se le asigna el plantel donde trabaja.
        </Card>
      ) : (
        grupos.map((g) => (
          <Card key={g.puesto} className="mb-4 p-0">
            <div className="flex items-center justify-between border-b border-border bg-content px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">{g.etiqueta}</h2>
              <span className="text-xs text-muted">
                {g.gente.filter((p) => p.registrado).length} de {g.gente.length} con asistencia
              </span>
            </div>
            <TablaAsistencia
              personas={g.gente}
              fechaISO={iso(dia)}
              bandas={bandas}
              mostrarPlantel={plantelFiltro == null && plantelesVisibles.length > 1}
            />
          </Card>
        ))
      )}

      <Card className="p-4 text-xs leading-relaxed text-muted">
        <p className="mb-1">
          Si la hora de salida es anterior a la de entrada, se entiende que el turno{" "}
          <strong>cruzó la medianoche</strong> y la salida es del día siguiente (se marca con{" "}
          <em>+1 día</em>). Las horas se cuentan al minuto: 90 min son 1.5 h, nunca se redondean a
          la hora completa.
        </p>
        <p>
          Las bandas que definen qué horario paga 25/50/75/100 % se configuran en Administración ›
          Recargos de ley. Esta pantalla muestra <strong>solo horas</strong>: los costos viven en
          Planilla.
        </p>
      </Card>
    </>
  );
}
