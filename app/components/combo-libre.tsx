"use client";

// Desplegable con buscador que TAMBIÉN acepta un valor que no está en la lista.
//
// Por qué no un `<select>` ni un `<input list>`:
//  · Un `<select>` obliga a que el valor exista, y en obra aparecen elementos que nadie
//    dio de alta. El asesor no puede quedarse sin poder escribirlo.
//  · `<datalist>` sí permite texto libre, pero su desplegable no se puede filtrar ni
//    estilar, no se abre al hacer foco en varios navegadores y en móvil se comporta de
//    forma distinta en cada uno. Para un campo que se usa varias veces por celda no
//    alcanza.
//
// El campo es UNO solo: el mismo cuadro donde se escribe es el que filtra la lista. Lo
// que quede escrito es el valor, esté o no en el catálogo — por eso no hay un botón de
// "agregar": escribirlo ya es agregarlo al pedido. Al catálogo se agrega desde
// Administración, que es donde se decide qué se ofrece.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { esElementoNuevo, filtrarElementos, normalizarBusqueda } from "@/lib/elementos";

export function ComboLibre({
  valor,
  onChange,
  opciones,
  placeholder,
  className = "",
  disabled = false,
  /** Texto del aviso cuando lo escrito no está en la lista. */
  etiquetaNuevo = "se usará tal como lo escribiste",
  /**
   * `name` del input, para los formularios que se leen con FormData (Nuevo pedido). Sin
   * él el componente sirve igual, pero el valor solo vive en el estado del padre.
   */
  name,
}: {
  valor: string;
  onChange: (v: string) => void;
  opciones: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  etiquetaNuevo?: string;
  name?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // El componente es TOTALMENTE controlado: no guarda una copia del texto. El valor vive
  // en el padre y se propaga en cada tecla, así que una copia interna solo obligaría a
  // sincronizarla con un efecto cada vez que el valor cambia desde afuera (al abrir otra
  // celda, al precargar un formulario) — justo el patrón que este proyecto evita.
  const texto = valor;

  // Clic fuera: se cierra la lista y se conserva lo escrito (no se descarta).
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const filtradas = useMemo(() => filtrarElementos(opciones, texto), [opciones, texto]);

  const esNuevo = esElementoNuevo(opciones, texto);

  const elegir = (v: string) => {
    onChange(v);
    setAbierto(false);
  };

  return (
    <div ref={caja} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          name={name}
          value={texto}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            // Se propaga al escribir: si el usuario guarda sin elegir de la lista, su
            // texto ya es el valor.
            onChange(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setAbierto(false);
              e.stopPropagation();
            }
            // Enter con la lista abierta y una sola coincidencia: la toma. Con más de
            // una, conserva lo escrito (no adivina por el usuario).
            if (e.key === "Enter" && abierto) {
              if (filtradas.length === 1) {
                elegir(filtradas[0]);
                e.preventDefault();
              } else setAbierto(false);
            }
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 pr-7 text-xs outline-none focus:border-accent"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => setAbierto((a) => !a)}
          title="Ver la lista"
          className="absolute inset-y-0 right-0 flex w-6 items-center justify-center text-muted hover:text-ink disabled:opacity-40"
        >
          <ChevronDown size={13} />
        </button>
      </div>

      {abierto && !disabled && (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {esNuevo && (
            <div className="flex items-start gap-1.5 border-b border-border px-2 py-1.5 text-[11px] text-muted">
              <Plus size={12} className="mt-0.5 shrink-0 text-accent" />
              <span>
                <strong className="font-semibold text-ink">{texto.trim()}</strong> no está en
                la lista: {etiquetaNuevo}.
              </span>
            </div>
          )}
          {filtradas.length === 0 && !esNuevo && (
            <p className="px-2 py-1.5 text-[11px] text-muted">Sin coincidencias.</p>
          )}
          {filtradas.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => elegir(o)}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-ink hover:bg-content"
            >
              <Check
                size={12}
                className={normalizarBusqueda(o) === normalizarBusqueda(texto) ? "text-accent" : "invisible"}
              />
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
