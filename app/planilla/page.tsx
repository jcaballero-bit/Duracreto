import { requerirAcceso } from "@/lib/auth/guard";
import { Card, PageHeader } from "../components/ui";
import { planillaDelPeriodo, periodoEfectivo } from "@/lib/planilla/consulta";
import { etiquetaPeriodo, fechaLarga, indicePorFecha } from "@/lib/planilla/periodos";
import { ORDEN_PUESTOS, etiquetaPuesto, type Puesto } from "@/lib/planilla/puestos";
import { textoLempiras } from "@/lib/planilla/salario";
import { PlanillaTabla } from "./planilla-tabla";
import { PeriodoControles } from "./periodo-controles";

export const dynamic = "force-dynamic";

/**
 * Planilla del personal operativo. Acceso EXCLUSIVO del Administrador (contiene
 * salarios): la ruta está en ACCESO_RUTAS solo para él y `requerirAcceso` lo valida en
 * el servidor, así que entrar por URL directa con otro rol redirige.
 *
 * Muestra costo BRUTO de horas y ausencias — no deducciones ni neto a pagar.
 */
export default async function PlanillaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  await requerirAcceso("/planilla");
  const sp = await searchParams;

  // Periodo por índice respecto al ancla; por defecto, el que contiene hoy.
  const indice = sp.periodo != null && sp.periodo !== "" ? Number(sp.periodo) : indicePorFecha(new Date());
  const idx = Number.isFinite(indice) ? Math.trunc(indice) : indicePorFecha(new Date());

  const periodo = await periodoEfectivo(idx);
  const personas = await planillaDelPeriodo(periodo);

  const totalGeneral = personas.reduce((s, p) => s + p.costoTotal, 0);
  const totalHoras = personas.reduce((s, p) => s + p.costoHoras, 0);
  const totalAusencias = personas.reduce((s, p) => s + p.costoAusencias, 0);
  const sinSalario = personas.filter((p) => !p.salarioMensual).length;

  // Grupos por puesto, en el orden de presentación.
  const grupos = ORDEN_PUESTOS.map((puesto) => ({
    puesto,
    etiqueta: etiquetaPuesto(puesto),
    gente: personas.filter((p) => p.puesto === puesto),
  }))
    .concat(
      // Puestos que estuvieran en la BD y no en la lista (no se pierde nadie).
      [...new Set(personas.map((p) => p.puesto))]
        .filter((p) => !ORDEN_PUESTOS.includes(p as Puesto))
        .map((puesto) => ({
          puesto: puesto as Puesto,
          etiqueta: etiquetaPuesto(puesto),
          gente: personas.filter((p) => p.puesto === puesto),
        })),
    )
    .filter((g) => g.gente.length > 0);

  const fmtISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <>
      <PageHeader
        titulo="Planilla"
        descripcion="Horas y ausencias del personal operativo por periodo de pago catorcenal. Costo bruto: no incluye deducciones ni neto a pagar."
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <PeriodoControles
            indice={idx}
            etiqueta={etiquetaPeriodo(periodo)}
            fechaPago={fechaLarga(periodo.pago)}
            estado={periodo.estado}
            finISO={fmtISO(periodo.fin)}
            pagoISO={fmtISO(periodo.pago)}
          />

          <div className="text-right">
            <div className="text-xs text-muted">Costo de planilla del periodo</div>
            <div className="text-2xl font-semibold tabular-nums text-ink">
              {textoLempiras(totalGeneral)}
            </div>
            <div className="text-xs text-muted">
              Horas {textoLempiras(totalHoras)} · Ausencias {textoLempiras(totalAusencias)}
            </div>
          </div>
        </div>

        {sinSalario > 0 && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {sinSalario === 1
              ? "1 persona no tiene salario mensual capturado, así que su costo sale en 0."
              : `${sinSalario} personas no tienen salario mensual capturado, así que su costo sale en 0.`}{" "}
            Se captura en la columna <strong>Salario mensual</strong> de esta misma tabla.
          </p>
        )}
      </Card>

      {grupos.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          No hay personal operativo registrado. Se da de alta en Flota › Operadores.
        </Card>
      ) : (
        grupos.map((g) => (
          <Card key={g.puesto} className="mb-4 p-0">
            <div className="flex items-center justify-between border-b border-border bg-content px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">{g.etiqueta}</h2>
              <span className="text-xs text-muted">
                {g.gente.length} {g.gente.length === 1 ? "persona" : "personas"} ·{" "}
                {textoLempiras(g.gente.reduce((s, p) => s + p.costoTotal, 0))}
              </span>
            </div>
            <PlanillaTabla personas={g.gente} periodoCerrado={periodo.estado !== "Abierto"} />
          </Card>
        ))
      )}

      <Card className="p-4 text-xs leading-relaxed text-muted">
        <p className="mb-2 font-semibold text-ink">Cómo se calcula</p>
        <p className="mb-1">
          <strong>Salario por hora</strong> = salario mensual ÷ 30 días ÷ 8 horas (el salario
          diario es el mensual ÷ 30).
        </p>
        <p className="mb-1">
          <strong>Costo</strong> = horas normales × salario hora + horas al 25 % × 1.25 + horas al
          50 % × 1.50 + horas al 75 % × 1.75 + horas al 100 % × 2.00 + costo de las ausencias del
          periodo. Las horas se cuentan al minuto (90 min = 1.5 h), nunca redondeadas a la hora.
        </p>
        <p className="mb-1">
          Las <strong>bandas de recargo</strong> (qué horario paga 25/50/75/100 %) se configuran en
          Administración › Recargos de ley, por tipo de día. No están escritas en el código.
        </p>
        <p>
          <strong>Alcance:</strong> este es el costo BRUTO de horas y ausencias. No calcula
          deducciones (IHSS, RAP, INFOP, impuesto sobre la renta) ni el neto a pagar. Antes de pagar
          con estos números, nómina debe validar los multiplicadores contra el Código de Trabajo de
          Honduras y la política interna de la empresa.
        </p>
      </Card>
    </>
  );
}
