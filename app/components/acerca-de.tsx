"use client";

// Panel "Acerca de DURACRETO Logistics", al estilo del cuadro de Firefox: logo grande,
// nombre, versión, y debajo los datos que sirven cuando alguien reporta un problema.
//
// Por qué importa el sello de versión: cuando un usuario dice "no me guarda el salario",
// lo primero que hay que saber es QUÉ código está viendo. El commit corto lo identifica
// sin ambigüedad, y la fecha del build dice si ya tiene el arreglo o todavía no.

import { X } from "lucide-react";
import type { InfoVersion } from "@/lib/version";
import { DESARROLLADOR, DESCRIPCION_SISTEMA } from "@/lib/version";

export function AcercaDe({ info, onCerrar }: { info: InfoVersion; onCerrar: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Acerca de DURACRETO Logistics"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado oscuro con el logo y la versión, como el cuadro de Firefox. */}
        <div className="relative bg-sidebar px-6 pb-6 pt-7 text-center">
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>

          <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-2xl bg-white p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-duracreto.png"
              alt="DURACRETO"
              className="h-full w-full object-contain"
            />
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-white">
            DURACRETO Logistics
          </h2>
          <p className="mt-0.5 text-[11px] uppercase tracking-widest text-slate-400">
            Concreto premezclado
          </p>

          <p className="mt-3 text-sm font-semibold text-white tabular-nums">
            Versión {info.version}
            <span className="ml-1.5 font-normal text-slate-400">({info.build})</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Compilado el <time dateTime={info.compiladoIso}>{info.compiladoEn}</time>
          </p>
        </div>

        {/* Cuerpo: qué es, quién lo hizo, y el detalle técnico del despliegue. */}
        <div className="px-6 py-5">
          <p className="text-sm leading-relaxed text-muted">{DESCRIPCION_SISTEMA}</p>

          <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <Fila etiqueta="Desarrollado por">
              <span className="font-semibold text-ink">{DESARROLLADOR}</span>
            </Fila>
            <Fila etiqueta="Entorno">{info.entorno}</Fila>
            <Fila etiqueta="Rama">{info.rama}</Fila>
            <Fila etiqueta="Commit">
              <span className="font-mono text-xs">{info.commit.slice(0, 12)}</span>
            </Fila>
            <Fila etiqueta="Versión base">{info.versionPaquete}</Fila>
          </dl>

          <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted">
            Sistema de uso interno de DURACRETO. La versión se actualiza sola con cada
            cambio publicado: si reportas un problema, incluye el número de versión y el
            código entre paréntesis.
          </p>
        </div>
      </div>
    </div>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted">{etiqueta}</dt>
      <dd className="min-w-0 truncate text-right text-ink">{children}</dd>
    </div>
  );
}
