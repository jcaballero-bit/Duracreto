import Link from "next/link";
import { CalendarClock, Container, Layers, Truck } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanceActual } from "@/lib/auth/guard";
import { Card } from "./components/ui";
import { Saludo } from "./saludo";

export const dynamic = "force-dynamic";

async function resumen(incluirFlota: boolean) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  // La disponibilidad de flota NO se consulta cuando no debe mostrarse (Asesor):
  // no se le envían al cliente datos de flota, no solo se ocultan con CSS.
  const [planteles, mixersDisp, mixersTotal, prox] = await Promise.all([
    prisma.planteles.count(),
    incluirFlota ? prisma.mixers.count({ where: { estado: "Disponible" } }) : Promise.resolve(null),
    incluirFlota ? prisma.mixers.count() : Promise.resolve(null),
    prisma.pedidos.findMany({
      where: { hora_solicitada: { gte: hoy } },
      orderBy: { hora_solicitada: "asc" },
      select: { hora_solicitada: true, volumen_total_m3: true },
    }),
  ]);

  // Volumen del próximo día con pedidos.
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

export default async function Panel() {
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
      alcance.esJefeLaboratorio);
  const ocultarFlota = !!alcance && alcance.esAsesor && !puedeVerFlota;

  const r = await resumen(!ocultarFlota);
  const sesion = await auth();
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
