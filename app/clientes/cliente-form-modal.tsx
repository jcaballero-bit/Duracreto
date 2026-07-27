"use client";

import { useState, useTransition, type FormEvent } from "react";
import { MapPin, X } from "lucide-react";
import {
  actualizarClienteAction,
  crearClienteAction,
  resolverEnlaceMapsAction,
} from "./actions";

export interface Opcion {
  value: string;
  label: string;
}
export interface ValoresCliente {
  id: number;
  valores: Record<string, string>;
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

interface CampoDef {
  name: string;
  label: string;
  tipo: "text" | "number";
  requerido?: boolean;
  placeholder?: string;
}

// Campos de texto/número simples (lat/long y el enlace de Maps se manejan aparte
// porque son controlados y se autocompletan desde el enlace de Google Maps).
export const CAMPOS_CLIENTE: CampoDef[] = [
  { name: "empresa", label: "Cliente", tipo: "text", requerido: true },
  { name: "proyecto", label: "Proyecto (opcional)", tipo: "text" },
  { name: "ubicacion", label: "Ubicación", tipo: "text", requerido: true },
  { name: "contacto", label: "Contacto", tipo: "text" },
  { name: "telefono", label: "Teléfono", tipo: "text" },
  // Tiempo de transporte SOLO IDA hacia la obra; el regreso se asume igual. Se
  // guarda en tiempo_viaje_referencia_min (y se espeja a regreso en el servidor).
  { name: "tiempo_viaje_referencia_min", label: "Tiempo de transporte (min)", tipo: "number", placeholder: "30" },
];

/**
 * Modal reutilizable de alta/edición de cliente. El Asesor NO ve el campo Asesor
 * (el servidor lo autoasigna); el Admin sí, para reasignar.
 */
export function ClienteFormModal({
  editando,
  esAdmin,
  asesores,
  onClose,
  onExito,
}: {
  editando: ValoresCliente | null;
  esAdmin: boolean;
  asesores: Opcion[];
  onClose: () => void;
  onExito: (nuevoId?: number) => void;
}) {
  const [pendiente, startTransition] = useTransition();

  // Ubicación: el enlace de Maps + lat/long son controlados para poder
  // autocompletarlos al procesar el enlace pegado por el asesor.
  const [googleUrl, setGoogleUrl] = useState(editando?.valores.google_maps_url ?? "");
  const [lat, setLat] = useState(editando?.valores.latitud ?? "");
  const [lng, setLng] = useState(editando?.valores.longitud ?? "");
  const [procesando, setProcesando] = useState(false);
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);
  const [avisoEnlace, setAvisoEnlace] = useState<string | null>(null);

  // Lee el enlace pegado y autocompleta lat/long (enlace largo = regex directo;
  // enlace corto = el servidor resuelve la redirección). NO bloquea el guardado.
  const procesarEnlace = async () => {
    const url = googleUrl.trim();
    setErrorEnlace(null);
    setAvisoEnlace(null);
    if (!url) {
      setErrorEnlace("Pega un enlace de Google Maps primero.");
      return;
    }
    setProcesando(true);
    try {
      const res = await resolverEnlaceMapsAction(url);
      if (!res.ok || res.lat == null || res.lng == null) {
        setErrorEnlace(res.mensaje ?? "No se pudo leer la ubicación de ese enlace.");
        return;
      }
      // Si ya había coordenadas guardadas, confirmar antes de reemplazarlas.
      const habiaCoords = lat.trim() !== "" || lng.trim() !== "";
      if (
        habiaCoords &&
        !confirm(
          "Este cliente ya tiene una ubicación guardada. ¿Reemplazarla con la del enlace pegado?",
        )
      ) {
        return;
      }
      setLat(String(res.lat));
      setLng(String(res.lng));
      setAvisoEnlace(`Ubicación leída: ${res.lat}, ${res.lng}`);
    } finally {
      setProcesando(false);
    }
  };

  const guardar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const datos: Record<string, string> = {};
    for (const c of CAMPOS_CLIENTE) datos[c.name] = String(fd.get(c.name) ?? "");
    // Ubicación desde el estado controlado.
    datos.google_maps_url = googleUrl.trim();
    datos.latitud = lat.trim();
    datos.longitud = lng.trim();
    if (esAdmin) datos.asesor_id = String(fd.get("asesor_id") ?? "");
    startTransition(async () => {
      const res = editando
        ? await actualizarClienteAction(editando.id, datos)
        : await crearClienteAction(datos);
      if (res.ok) onExito(res.id);
      else alert(res.mensaje ?? "No se pudo guardar.");
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-ink">
            {editando ? "Editar cliente" : "Nuevo cliente"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-content hover:text-ink"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={guardar} className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          {CAMPOS_CLIENTE.map((campo) => (
            <label key={campo.name} className="block text-sm">
              <span className="mb-1 block font-medium text-ink">{campo.label}</span>
              <input
                type={campo.tipo}
                name={campo.name}
                required={campo.requerido}
                step={campo.tipo === "number" ? "any" : undefined}
                placeholder={campo.placeholder}
                defaultValue={editando?.valores[campo.name] ?? ""}
                className={inputCls}
              />
            </label>
          ))}

          {/* Ubicación por enlace de Google Maps */}
          <div className="sm:col-span-2 rounded-lg border border-border bg-content/40 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
              <MapPin size={15} className="text-accent" />
              Ubicación del proyecto
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-ink">Enlace de Google Maps</span>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={googleUrl}
                  onChange={(e) => setGoogleUrl(e.target.value)}
                  placeholder="https://maps.app.goo.gl/…"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={procesarEnlace}
                  disabled={procesando}
                  className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {procesando ? "Leyendo…" : "Procesar"}
                </button>
              </div>
            </label>
            <p className="mt-1 text-xs text-muted">
              Abre Google Maps en tu celular, deja caer un pin en el sitio del
              proyecto, toca Compartir y pega aquí el enlace.
            </p>
            {errorEnlace && (
              <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                {errorEnlace}
              </p>
            )}
            {avisoEnlace && (
              <p className="mt-2 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
                {avisoEnlace}
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-ink">Latitud</span>
                <input
                  type="number"
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="15.5041"
                  className={inputCls}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-ink">Longitud</span>
                <input
                  type="number"
                  step="any"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="-88.0250"
                  className={inputCls}
                />
              </label>
            </div>
          </div>

          {esAdmin && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Asesor</span>
              <select
                name="asesor_id"
                defaultValue={editando?.valores.asesor_id ?? ""}
                className={inputCls}
              >
                <option value="">Sin asesor</option>
                {asesores.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-1 sm:col-span-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pendiente}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {pendiente ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
