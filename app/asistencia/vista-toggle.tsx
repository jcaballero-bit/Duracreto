import Link from "next/link";
import { LayoutList, GanttChartSquare } from "lucide-react";

/**
 * Dos vistas de la MISMA información: la tabla donde se capturan las horas y la línea de
 * tiempo que las cruza con los viajes. Va en la URL (`vista=timeline`) para que el enlace
 * se pueda compartir y para que la fecha y el plantel se conserven al cambiar de vista.
 */
export function VistaToggleAsistencia({
  hrefTabla,
  hrefTimeline,
  activa,
}: {
  hrefTabla: string;
  hrefTimeline: string;
  activa: "tabla" | "timeline";
}) {
  const cls = (esta: boolean) =>
    "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors " +
    (esta ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink");

  return (
    <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-border">
      <Link href={hrefTabla} className={cls(activa === "tabla")}>
        <LayoutList size={16} /> Tabla
      </Link>
      <Link href={hrefTimeline} className={cls(activa === "timeline")}>
        <GanttChartSquare size={16} /> Línea de tiempo
      </Link>
    </div>
  );
}
