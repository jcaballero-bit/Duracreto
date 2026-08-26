import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requerirAcceso } from "@/lib/auth/guard";
import { Card, PageHeader } from "../../components/ui";
import { etiquetaPuesto } from "@/lib/planilla/puestos";
import { ImportarBiometrico } from "./importar-cliente";

export const dynamic = "force-dynamic";

/**
 * Importación del archivo del reloj biométrico. Vive bajo /planilla, así que hereda su
 * acceso: EXCLUSIVO del Administrador (la pantalla de planilla contiene salarios y
 * `ACCESO_RUTAS` resuelve "/planilla" como prefijo de esta ruta).
 */
export default async function ImportarPage() {
  await requerirAcceso("/planilla/importar");

  const [personas, planteles] = await Promise.all([
    prisma.operadores.findMany({
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, puesto: true, codigo_biometrico: true },
    }),
    prisma.planteles.findMany({ orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
  ]);

  return (
    <>
      <PageHeader
        titulo="Importar del reloj biométrico"
        descripcion="Sube el archivo que exporta el reloj. Las horas NO se toman de los cálculos del reloj: se recalculan con las bandas de recargo configuradas, igual que en la captura manual."
      />

      <div className="mb-4">
        <Link
          href="/planilla"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent"
        >
          <ArrowLeft size={15} /> Volver a la planilla
        </Link>
      </div>

      <Card className="p-5">
        <ImportarBiometrico
          personas={personas.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            puesto: etiquetaPuesto(p.puesto),
            codigo: p.codigo_biometrico,
          }))}
          planteles={planteles}
        />
      </Card>

      <Card className="mt-4 p-4 text-xs leading-relaxed text-muted">
        <p className="mb-2 font-semibold text-ink">Qué hace y qué no hace esta importación</p>
        <p className="mb-1">
          Del archivo se usan solo el <strong>código</strong>, la <strong>fecha</strong>, la{" "}
          <strong>marca de entrada</strong>, la <strong>marca de salida</strong> y la marca de{" "}
          <strong>ausente</strong>. Las columnas que el reloj calcula por su cuenta
          (<em>Tiempo HE</em>, <em>Tiempo Real</em>, <em>Jornada Trabajada</em>…) se ignoran:
          su lógica no aplica las bandas de recargo ni desglosa por porcentaje. Se guardan como
          referencia para poder rastrear qué traía el archivo.
        </p>
        <p className="mb-1">
          La vinculación es por <strong>código</strong>, no por nombre (los nombres del reloj
          vienen con mayúsculas inconsistentes y no son confiables como llave). El rango de fechas
          se detecta <strong>leyendo los datos</strong>, nunca del nombre del archivo.
        </p>
        <p className="mb-1">
          Una <strong>ausencia</strong> del reloj entra como ausencia <em>pendiente de
          clasificar</em> y sin horas — el reloj no sabe si fue vacaciones, incapacidad o permiso.
          No se guarda como una jornada de cero horas, que para la planilla no es lo mismo.
        </p>
        <p>
          Si una fila ya fue <strong>corregida a mano</strong>, la importación no la reemplaza en
          silencio: la reporta como conflicto y solo la sobrescribe si se confirma. La bitácora
          distingue qué entró por importación y qué se digitó o corrigió a mano.
        </p>
      </Card>
    </>
  );
}
