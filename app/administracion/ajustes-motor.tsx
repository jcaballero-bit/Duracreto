"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Save } from "lucide-react";
import {
  guardarBloqueoEdicionAction,
  guardarHoraAperturaAction,
  guardarUmbralesDescargaAction,
} from "./actions";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";
const botonCls =
  "inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50";

/**
 * Hora de APERTURA de planta por defecto: a partir de qué hora se puede empezar a
 * cargar cualquier día que no tenga una excepción propia. El Programador puede
 * adelantarla para un día y planta concretos desde la programación manual.
 */
export function AjusteApertura({ horaApertura }: { horaApertura: string }) {
  const router = useRouter();
  const [valor, setValor] = useState(horaApertura);
  const [pendiente, startTransition] = useTransition();

  const guardar = () => {
    startTransition(async () => {
      const res = await guardarHoraAperturaAction(valor);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo guardar.");
    });
  };

  return (
    <div className="max-w-sm">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Hora de apertura de planta</span>
        <div className="flex gap-2">
          <input
            type="time" value={valor}
            onChange={(e) => setValor(e.target.value)}
            className={inputCls}
          />
          <button type="button" onClick={guardar} disabled={pendiente} className={botonCls}>
            <Save size={16} /> {pendiente ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </label>
    </div>
  );
}

/**
 * BLOQUEO HORARIO de edición del programa. Pasada la hora de corte, el Programador y
 * el Jefe de Planta dejan de poder mover la programación (siguen consultándola). El
 * Administrador nunca queda bloqueado, y el Despacho en vivo NUNCA se detiene.
 */
export function AjusteBloqueoEdicion({
  activo: activoInicial,
  horaCorte: horaInicial,
}: {
  activo: boolean;
  horaCorte: string;
}) {
  const router = useRouter();
  const [activo, setActivo] = useState(activoInicial);
  const [hora, setHora] = useState(horaInicial);
  const [pendiente, startTransition] = useTransition();

  const guardar = (nuevoActivo: boolean, nuevaHora: string) => {
    startTransition(async () => {
      const res = await guardarBloqueoEdicionAction(nuevoActivo, nuevaHora);
      if (res.ok) router.refresh();
      else {
        alert(res.mensaje ?? "No se pudo guardar.");
        setActivo(activoInicial);
        setHora(horaInicial);
      }
    });
  };

  return (
    <div className="max-w-lg space-y-3">
      {/* Interruptor activar/desactivar */}
      <label className="flex items-center gap-3 text-sm">
        <button
          type="button"
          role="switch"
          aria-checked={activo}
          disabled={pendiente}
          onClick={() => {
            const nuevo = !activo;
            setActivo(nuevo);
            guardar(nuevo, hora);
          }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            activo ? "bg-accent" : "bg-slate-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              activo ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
        <span className="font-medium text-ink">
          {activo ? "Bloqueo activado" : "Bloqueo desactivado"}
        </span>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Hora de corte</span>
        <div className="flex gap-2">
          <input
            type="time"
            value={hora}
            disabled={pendiente}
            onChange={(e) => setHora(e.target.value)}
            className={`${inputCls} max-w-[10rem]`}
          />
          <button
            type="button"
            onClick={() => guardar(activo, hora)}
            disabled={pendiente}
            className={botonCls}
          >
            <Save size={16} /> {pendiente ? "Guardando…" : "Guardar hora"}
          </button>
        </div>
      </label>

      <p className="flex items-start gap-2 rounded-lg border border-border bg-content px-3 py-2 text-xs text-muted">
        <Lock size={14} className="mt-0.5 shrink-0" />
        <span>
          Afecta a <strong>Jefe de Planta</strong> y <strong>Programador</strong>: después de la
          hora de corte pueden seguir <strong>consultando</strong> el programa, pero no crearlo ni
          modificarlo. El Administrador nunca queda bloqueado. El{" "}
          <strong>Despacho en vivo no se detiene</strong> para nadie: la operación del día sigue
          registrándose con normalidad.
        </span>
      </p>
    </div>
  );
}

/**
 * Umbrales del reporte de **tiempos de descarga y esperas en obra**.
 *
 *  · **Espera en obra**: desde cuántos minutos parado en el proyecto se marca un viaje
 *    y se cuenta en la columna de esperas relevantes. Sugerido 15 min.
 *  · **Variabilidad del intervalo**: rango (máx−mín) entre llegadas consecutivas desde
 *    el que un pedido se marca como ritmo irregular.
 *  · **Tolerancia de descarga**: cuánto se puede pasar del tiempo pactado antes de
 *    pintar la desviación en ámbar; por encima del doble de eso, en rojo.
 */
export function AjusteUmbralesDescarga({
  esperaMin,
  variabilidadMin,
  toleranciaPct,
}: {
  esperaMin: number;
  variabilidadMin: number;
  toleranciaPct: number;
}) {
  const router = useRouter();
  const [espera, setEspera] = useState(String(esperaMin));
  const [variab, setVariab] = useState(String(variabilidadMin));
  const [tol, setTol] = useState(String(toleranciaPct));
  const [pendiente, startTransition] = useTransition();

  const guardar = () => {
    const e = Number(espera);
    const v = Number(variab);
    const t = Number(tol);
    if (![e, v].every((n) => Number.isInteger(n) && n > 0)) {
      alert("La espera y la variabilidad deben ser enteros de minutos mayores que 0.");
      return;
    }
    if (!Number.isInteger(t) || t < 0 || t > 200) {
      alert("La tolerancia debe ser un porcentaje entero entre 0 y 200.");
      return;
    }
    startTransition(async () => {
      const res = await guardarUmbralesDescargaAction(e, v, t);
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo guardar.");
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-ink">Espera en obra (min)</span>
        <input
          type="number" min="1" step="1" value={espera}
          onChange={(e) => setEspera(e.target.value)}
          className={`${inputCls} w-32`}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium text-ink">Variabilidad del intervalo (min)</span>
        <input
          type="number" min="1" step="1" value={variab}
          onChange={(e) => setVariab(e.target.value)}
          className={`${inputCls} w-32`}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium text-ink">Tolerancia de descarga (%)</span>
        <input
          type="number" min="0" max="200" step="1" value={tol}
          onChange={(e) => setTol(e.target.value)}
          className={`${inputCls} w-32`}
        />
      </label>
      <button type="button" onClick={guardar} disabled={pendiente} className={botonCls}>
        <Save size={16} /> {pendiente ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}
