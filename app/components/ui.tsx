// Componentes UI compartidos del sistema de diseño. Reutilizables en TODAS las
// pantallas para mantener consistencia (tarjetas, badges, botón primario,
// encabezado de página).
import Link from "next/link";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

/** Tarjeta blanca con esquinas redondeadas y sombra sutil. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** Encabezado de página: título grande + descripción + acción a la derecha. */
export function PageHeader({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-ink">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-muted">{descripcion}</p>}
      </div>
      {accion}
    </div>
  );
}

/** Botón de acción primaria: azul marino, texto blanco, ícono "+" opcional. */
export function PrimaryButton({
  children,
  onClick,
  href,
  conMas = false,
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  conMas?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const cls =
    "inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50";
  const contenido = (
    <>
      {conMas && <Plus size={16} />}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {contenido}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {contenido}
    </button>
  );
}

type TonoBadge = "neutro" | "ok" | "warn" | "danger" | "info";

const TONOS: Record<TonoBadge, string> = {
  neutro: "bg-slate-100 text-slate-700",
  ok: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
  info: "bg-sky-100 text-sky-700",
};

/** Etiqueta tipo pill para estados (Pendiente, Confirmado, alertas, orígenes). */
export function Badge({
  children,
  tono = "neutro",
}: {
  children: ReactNode;
  tono?: TonoBadge;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONOS[tono]}`}
    >
      {children}
    </span>
  );
}

/** Página en construcción — usada por las pantallas de fases futuras. */
export function Placeholder({
  titulo,
  descripcion,
  fase,
}: {
  titulo: string;
  descripcion: string;
  fase: string;
}) {
  return (
    <>
      <PageHeader titulo={titulo} descripcion={descripcion} />
      <Card className="p-10 text-center">
        <p className="text-sm text-muted">
          Esta pantalla usa el mismo lenguaje visual del sistema y se
          construirá en la <strong className="text-ink">{fase}</strong>.
        </p>
      </Card>
    </>
  );
}
