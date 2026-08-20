import Link from "next/link";
import { CalendarClock, Container, Layers, Truck } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanceActual, requerirPasswordAlDia } from "@/lib/auth/guard";
import { filtroPedidoPorZona, type Alcance } from "@/lib/auth/acceso";
import { Card } from "./components/ui";
import { Saludo } from "./saludo";
import { CalendarioProduccion, type DesgloseDia } from "./calendario-produccion";
import {
  armarSemanas,
  cortesEscala,
  mesDesplazado,
  nivelDeVolumen,
  parsearMes,
  resumenMes,
  ymdLocal,
} from "@/lib/produccion/calendario";
import { produccionDelMes, type ProduccionMes } from "@/lib/produccion/consulta";
import { accesoCalendario } from "@/lib/produccion/acceso";

export const dynamic = "force-dynamic";

async function resumen(incluirFlota: boolean, alcance: Alcance | null) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  // "Próximo día programado" = el siguiente día CON pedidos, a partir de MAÑANA. El
  // día de hoy no cuenta: ese ya se está despachando y se ve en Despacho en vivo; lo
  // que la tarjeta debe anticipar es lo que viene.
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);

  // El volumen del próximo día se acota a la zona/plantel del usuario (un
  // Programador/Despachador/JefePlanta no ve el volumen de la otra zona).
  const scope = alcance ? filtroPedidoPorZona(alcance) : {};

  // La disponibilidad de flota NO se consulta cuando no debe mostrarse (Asesor):
  // no se le envían al cliente datos de flota, no solo se ocultan con CSS.
  const [planteles, mixersDisp, mixersTotal, prox] = await Promise.all([
    prisma.planteles.count(),
    incluirFlota ? prisma.mixers.count({ where: { estado: "Disponible" } }) : Promise.resolve(null),
    incluirFlota ? prisma.mixers.count() : Promise.resolve(null),
    prisma.pedidos.findMany({
      where: { hora_solicitada: { gte: manana }, estado_pedido: "Activo", ...scope },
      orderBy: { hora_solicitada: "asc" },
      select: { hora_solicitada: true, volumen_total_m3: true },
    }),
  ]);

  // Volumen del próximo día con pedidos (el primero de la lista ya es >= mañana).
  let volProx = 0;
  let fechaProx: Date | null = null;
  if (prox.length > 0) {
    const primerDia = prox[0].hora_solicitada;
    fechaProx = primerDia;
    const mismo = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    volProx = prox
      .filter((p) => mismo(p.hora_solicitada, primerDia))
      .reduce((s, p) => s + p.volumen_total_m3, 0);
  }

  return { planteles, mixersDisp, mixersTotal, volProx, fechaProx };
}

export default async function Panel({
  searchParams,
}: {
  // Mes visible del calendario ("YYYY-MM") y filtro de zona: van en la URL para que el
  // estado sea compartible y los datos los siga resolviendo el servidor.
  searchParams?: Promise<{ mesProd?: string; zonaProd?: string }>;
}) {
  // Primer ingreso: si debe cambiar contraseña, al panel tampoco entra.
  await requerirPasswordAlDia();
  const alcance = await alcanceActual();
  // El Asesor NO ve disponibilidad de flota. Un usuario con algún rol operativo
  // (aunque también sea Asesor) sí la ve.
  const puedeVerFlota =
    !!alcance &&
    (alcance.esAdmin ||
      alcance.esProgramador ||
      alcance.esDespachador ||
      alcance.esJefePlanta ||
      alcance.esDosificador ||
      alcance.esLaboratorista ||
      alcance.esJefeLaboratorio ||
      alcance.esGerenteControlCalidad);
  // Asesor y Almacen NO ven disponibilidad de flota (roles no operativos).
  const ocultarFlota =
    !!alcance && (alcance.esAsesor || alcance.esAlmacen) && !puedeVerFlota;

  const r = await resumen(!ocultarFlota, alcance);
  const sesion = await auth();

  // ── Calendario de producción ejecutada ────────────────────────────────────
  // El acceso lo decide `accesoCalendario` (regla por rol, probada aparte). Si el rol
  // no lo ve, NO se consulta la producción: el dato ni sale del servidor.
  const acceso = accesoCalendario(alcance, sesion?.user?.id);
  const sp = (await searchParams) ?? {};
  const { anio, mes } = parsearMes(sp.mesProd);
  const zonaProd = acceso.zonas.includes(sp.zonaProd ?? "") ? sp.zonaProd : undefined;
  const produccion: ProduccionMes =
    acceso.visible && !acceso.faltaZona
      ? await produccionDelMes({ anio, mes, filtroPedido: acceso.filtro, zona: zonaProd })
      : { porDia: new Map(), porDiaPlantel: new Map() };
  const semanas = armarSemanas(anio, mes, produccion.porDia);
  const resumenProd = resumenMes(semanas);
  // Cortes de la escala sobre el rango REAL del mes visible (no umbrales fijos).
  const cortes = cortesEscala(
    semanas.flatMap((sem) => sem.dias.filter((d) => d.delMes).map((d) => d.m3)),
  );
  const niveles: Record<string, number> = {};
  for (const sem of semanas) {
    for (const d of sem.dias) {
      if (d.delMes && d.m3 > 0) niveles[d.iso] = nivelDeVolumen(d.m3, cortes);
    }
  }
  const desglose: Record<string, DesgloseDia[]> = {};
  for (const [iso, planteles] of produccion.porDiaPlantel) {
    desglose[iso] = planteles.map((x) => ({
      etiqueta: x.nombre,
      m3: x.m3,
      viajes: x.viajes,
      // Segundo nivel: las plantas dosificadoras del plantel (se abren al hacer clic).
      hijos: x.plantas.map((pa) => ({ etiqueta: pa.nombre, m3: pa.m3, viajes: pa.viajes })),
    }));
  }
  const mesIso = `${anio}-${String(mes).padStart(2, "0")}`;
  const enlaceProd = (mesIso: string, zona: string | undefined) => {
    const q = new URLSearchParams();
    q.set("mesProd", mesIso);
    if (zona) q.set("zonaProd", zona);
    return `/?${q.toString()}`;
  };
  // Primer nombre del usuario logueado (el saludo cambia según quién ve la página).
  const nombre = (sesion?.user?.name ?? "").trim().split(/\s+/)[0] || "usuario";
  const fechaHoy = new Date()
    .toLocaleDateString("es-HN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .replace(",", "");
  const fechaTxt = r.fechaProx
    ? r.fechaProx.toLocaleDateString("es-HN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "sin pedidos próximos";

  return (
    <>
      <Saludo nombre={nombre} fecha={fechaHoy} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Container size={20} />} label="Planteles" valor={r.planteles} />
        {!ocultarFlota && (
          <Stat
            icon={<Truck size={20} />}
            label="Mixers disponibles"
            valor={`${r.mixersDisp} / ${r.mixersTotal}`}
          />
        )}
        <Stat
          icon={<Layers size={20} />}
          label="Volumen próximo día"
          valor={`${r.volProx.toFixed(1)} m³`}
        />
        <Stat
          icon={<CalendarClock size={20} />}
          label="Próximo programa"
          valor={fechaTxt}
          pequeno
        />
      </div>

      {acceso.visible && (
        /* La mitad del ancho en pantallas grandes; completo en tablet/celular. */
        <Card className="mt-6 p-4 lg:w-1/2">
          {acceso.faltaZona ? (
            <p className="text-sm text-muted">
              Tu usuario no tiene una zona asignada, así que no se puede mostrar la
              producción. Pídele a un administrador que te asigne una zona.
            </p>
          ) : (
            <CalendarioProduccion
              semanas={semanas}
              niveles={niveles}
              desglose={desglose}
              anio={anio}
              mes={mes}
              hrefMesAnterior={enlaceProd(mesDesplazado(anio, mes, -1), zonaProd)}
              hrefMesSiguiente={enlaceProd(mesDesplazado(anio, mes, 1), zonaProd)}
              totalMes={resumenProd.totalM3}
              promedioPorDia={resumenProd.promedioPorDia}
              diasConProduccion={resumenProd.diasConProduccion}
              alcanceTxt={acceso.etiqueta}
              zona={zonaProd ?? ""}
              zonas={
                acceso.zonas.length
                  ? [
                      { valor: "", etiqueta: "Todas", href: enlaceProd(mesIso, undefined) },
                      ...acceso.zonas.map((z) => ({
                        valor: z,
                        etiqueta: z,
                        href: enlaceProd(mesIso, z),
                      })),
                    ]
                  : []
              }
              hoyIso={ymdLocal(new Date())}
            />
          )}
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AccesoRapido
          href="/programacion"
          titulo="Programación de pedidos"
          texto="Crea y organiza los pedidos del día por plantel; el motor asigna mixers y calcula horarios."
        />
        <AccesoRapido
          href="/despacho"
          titulo="Despacho en vivo"
          texto="Línea de tiempo por mixer para verificar que no haya traslapes de flota."
        />
      </div>
    </>
  );
}

function Stat({
  icon,
  label,
  valor,
  pequeno = false,
}: {
  icon: React.ReactNode;
  label: string;
  valor: React.ReactNode;
  pequeno?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted">
        <span className="text-accent">{icon}</span>
        <span className="text-sm">{label}</span>
      </div>
      <div className={`mt-2 font-bold text-ink ${pequeno ? "text-lg capitalize" : "text-3xl"}`}>
        {valor}
      </div>
    </Card>
  );
}

function AccesoRapido({
  href,
  titulo,
  texto,
}: {
  href: string;
  titulo: string;
  texto: string;
}) {
  return (
    <Link href={href}>
      <Card className="p-5 transition-colors hover:border-accent">
        <h3 className="font-semibold text-ink">{titulo}</h3>
        <p className="mt-1 text-sm text-muted">{texto}</p>
      </Card>
    </Link>
  );
}
