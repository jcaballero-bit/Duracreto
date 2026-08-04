import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { filtroPedidoPorAsesor } from "@/lib/auth/acceso";
import { requerirAcceso } from "@/lib/auth/guard";
import { especDiseno } from "@/lib/formato";
import { compararPlanteles } from "@/lib/planteles-orden";
import { Card, PageHeader } from "../components/ui";
import { AutoRefresh } from "../components/auto-refresh";
import { VentasTabs } from "../components/ventas-tabs";
import { ListaConfirmaciones, type PedidoConfirm } from "./lista";

export const dynamic = "force-dynamic";

export default async function ConfirmacionesPage() {
  const alcance = await requerirAcceso("/confirmaciones");
  const sesion = await auth();
  const userId = sesion?.user?.id ?? "";
  // GerenteComercial: CONSULTA de todos los pedidos (solo lectura, no confirma).
  const esSupervisor = alcance.esGerenteComercial;

  // Asesor: solo pedidos de SUS clientes. Admin y Gerencia Comercial: todos.
  const where = alcance.esAdmin || esSupervisor ? {} : filtroPedidoPorAsesor(userId);

  // Se confirma el programa del DÍA SIGUIENTE. Excepción: el SÁBADO se confirma
  // el domingo (si hubiera pedidos) Y el lunes, porque el domingo casi no hay
  // programa y el asesor deja listo el arranque de semana.
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const esSabado = hoy.getDay() === 6; // 0=Dom … 6=Sáb
  const ini = new Date(hoy);
  ini.setDate(hoy.getDate() + 1); // mañana (00:00)
  const fin = new Date(ini);
  fin.setDate(ini.getDate() + (esSabado ? 2 : 1)); // sábado: domingo+lunes; resto: solo mañana

  // Días cubiertos (para el subtítulo): sábado → [domingo, lunes]; resto → [mañana].
  const diasCubiertos: Date[] = esSabado
    ? [new Date(ini), new Date(new Date(ini).setDate(ini.getDate() + 1))]
    : [new Date(ini)];
  const fmtDia = (d: Date) =>
    d.toLocaleDateString("es-HN", { weekday: "long", day: "2-digit", month: "long" });
  const etiquetaDias = diasCubiertos.map(fmtDia).join(" y ");

  const pedidos = await prisma.pedidos.findMany({
    where: { ...where, estado_pedido: "Activo", hora_solicitada: { gte: ini, lt: fin } },
    include: {
      cliente: true,
      diseno: true,
      plantel: { select: { nombre: true } },
      bomba: { select: { identificador: true } },
      viajes: {
        select: { estado_confirmacion: true, hora_llegada_proyecto: true },
      },
    },
    orderBy: { hora_solicitada: "asc" },
  });

  const fmtLlegada = (d: Date) =>
    d.toLocaleString("es-HN", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const minOpc = (n: number | null) => (n != null ? `${n} min` : "—");

  const filas: PedidoConfirm[] = pedidos.map((p) => {
    // Llegada al proyecto: la más temprana calculada por el motor; si aún no hay
    // horario, la hora solicitada (que ya representa la llegada deseada).
    const llegadas = p.viajes
      .map((v) => v.hora_llegada_proyecto?.getTime())
      .filter((t): t is number => t != null);
    const llegada = llegadas.length ? new Date(Math.min(...llegadas)) : p.hora_solicitada;
    // Descarga: con bomba → código de la bomba; canal directo → texto tal cual.
    const descarga =
      p.tipo_descarga !== "Canal directo" && p.bomba
        ? p.bomba.identificador ?? p.tipo_descarga
        : p.tipo_descarga;
    // Transporte efectivo: override del pedido o el del cliente (ida = regreso).
    const transporte = p.tiempo_transporte_min ?? p.cliente.tiempo_viaje_referencia_min;
    return {
      id: p.id,
      plantelNombre: p.plantel.nombre,
      fecha: fmtLlegada(llegada),
      empresa: p.cliente.empresa,
      proyecto: p.cliente.proyecto ?? "",
      diseno: `${p.diseno.codigo} · ${especDiseno(p.diseno)}`,
      volumen: p.volumen_total_m3,
      hielo: p.sacos_hielo_por_m3 && p.sacos_hielo_por_m3 > 0 ? String(p.sacos_hielo_por_m3) : "—",
      descarga: descarga ?? "—",
      frecuencia: minOpc(p.frecuencia_entre_camiones_min),
      transporte: minOpc(transporte ?? null),
      elemento: p.elemento ?? "—",
      confirmado:
        p.viajes.length > 0 &&
        p.viajes.every((v) => v.estado_confirmacion === "Confirmado"),
    };
  });

  // Ordenar por plantel (orden de negocio). El orden cronológico dentro de cada
  // plantel se conserva del query (hora_solicitada asc) por ser sort estable.
  filas.sort((a, b) => compararPlanteles(a.plantelNombre, b.plantelNombre));

  return (
    <>
      <AutoRefresh />
      <PageHeader
        titulo={esSupervisor ? "Confirmaciones" : "Mis confirmaciones"}
        descripcion={
          esSupervisor
            ? `Estado de confirmación del programa de ${etiquetaDias} (consulta).`
            : `Confirma los pedidos del programa de ${etiquetaDias}.`
        }
      />
      <VentasTabs activo="/confirmaciones" roles={alcance.roles} />
      <Card className="p-5">
        <ListaConfirmaciones pedidos={filas} soloLectura={esSupervisor} />
      </Card>
    </>
  );
}
