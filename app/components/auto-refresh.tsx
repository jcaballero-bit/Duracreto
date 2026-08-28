"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mantiene la vista al día sin recargar la página.
 *
 * Cómo funciona: en cada tick pregunta al LATIDO (`/api/latido`) si algo cambió en el
 * rango de fechas de la pantalla — una respuesta de ~100 bytes, UNA sola consulta a la
 * base — y solo cuando la firma cambia hace el `router.refresh()` (refresco SUAVE:
 * re-obtiene los datos del servidor sin recargar ni perder el estado de la UI, como un
 * modal abierto).
 *
 * Por qué existe: antes cada tick releía TODA la pantalla (61-78 KB) aunque no hubiera
 * pasado nada. Con la operación normal eso superaba los 14 GB de transferencia al mes,
 * casi el triple del límite del plan gratuito de la base — que al agotarse suspende el
 * servicio hasta el mes siguiente.
 *
 * ── Las tres reglas que ahorran, y por qué cada una ──────────────────────────────────
 *
 * 1. PAUSA POR INACTIVIDAD. Si nadie toca la máquina en `INACTIVIDAD_MS`, se deja de
 *    preguntar hasta la próxima señal de vida. Esto no es solo ahorro de transferencia:
 *    la base gratuita se AUTOSUSPENDE a los ~5 min sin consultas, y un sondeo cada 30 s
 *    la mantenía despierta las 24 h — que es lo que consume las horas de cómputo del
 *    plan. Cuenta como señal de vida hasta MOVER EL MOUSE, así que a alguien sentado
 *    frente al tablero no se le pausa; se pausa la pantalla que quedó encendida sola.
 *    Al volver, se comprueba de INMEDIATO (no se espera al siguiente tick).
 *
 * 2. ESPACIADO PROGRESIVO. Mientras la firma no cambia, el intervalo se va alargando
 *    hasta `MAX_ESPERA_MS` (9 min, a propósito por encima de la ventana de autosuspensión
 *    de la base). Una tarde tranquila deja de costar un latido por minuto. En cuanto algo
 *    cambia —o el usuario interactúa— vuelve al intervalo base.
 *
 * 3. SOLO CON LA PESTAÑA VISIBLE. Una pestaña en segundo plano no consulta nada.
 *
 * Además: NUNCA refresca mientras el usuario está escribiendo en un campo. Un refresco
 * en medio de una edición reemplaza los datos y descarta lo tecleado (en la tabla del
 * modo manual se veía como que el valor "se volvía a poner solo"). Se reintenta en
 * cuanto el campo pierde el foco.
 *
 * Sin `desdeISO` cae al comportamiento anterior (refrescar en cada tick), para que
 * cualquier pantalla que se monte sin rango siga funcionando.
 */

/** Sin señales de vida durante este tiempo, se deja de preguntar. */
const INACTIVIDAD_MS = 4 * 60_000;
/**
 * Tope del espaciado progresivo cuando no pasa nada.
 *
 * Está DELIBERADAMENTE por encima de los 5 min que la base gratuita tarda en
 * autosuspenderse. Con un tope de 4 min pasaba algo que no se ve pero se paga: una
 * pestaña abierta con alguien sentado al lado, sin que cambiara nada, preguntaba cada
 * 4 min y con eso la base NUNCA llegaba a dormirse — y las horas de cómputo del plan se
 * consumen por tiempo despierto, no por consultas. Con 9 min hay una ventana real de
 * silencio entre latidos y la base alcanza a suspenderse.
 *
 * No degrada la operación: el espaciado solo crece tras varios latidos seguidos sin
 * novedad, y CUALQUIER interacción del usuario lo devuelve al intervalo base.
 */
const MAX_ESPERA_MS = 9 * 60_000;

function editandoUnCampo(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function AutoRefresh({
  intervalMs = 60000,
  desdeISO,
  hastaISO,
  plantel,
}: {
  intervalMs?: number;
  /** Día que muestra la pantalla ("YYYY-MM-DD"). Sin él se refresca en cada tick. */
  desdeISO?: string;
  /** Fin EXCLUSIVO del rango, si la pantalla cubre más de un día (Confirmaciones). */
  hastaISO?: string;
  /**
   * Plantel elegido en el filtro de la pantalla, si hay uno. Acota aún más el latido:
   * mirando solo Choloma no hace falta recargar porque cambió algo en Santa Marta. El
   * servidor lo intersecta con el alcance del rol, así que nunca puede ampliarlo.
   */
  plantel?: string;
}) {
  const router = useRouter();
  const [pausado, setPausado] = useState(false);
  // Última firma conocida. Arranca en null: el primer latido solo toma la referencia,
  // sin refrescar (la página acaba de renderizarse con esos datos).
  const firma = useRef<string | null>(null);
  // Momento de la última señal de vida. Se siembra al montar el efecto (no en el
  // render: leer el reloj ahí no es puro).
  const ultimaSenal = useRef<number>(0);
  // La VERDAD de si está pausado vive en el ref: los manejadores de eventos se crean una
  // sola vez dentro del efecto y no deben re-crearse en cada cambio de estado (eso
  // reiniciaría los temporizadores). El `useState` de arriba existe solo para dibujar el
  // aviso, y se cambia siempre junto al ref, nunca durante el render.
  const pausadoRef = useRef(false);

  const marcarActividad = useCallback(() => {
    ultimaSenal.current = Date.now();
  }, []);

  useEffect(() => {
    // Si cambia el día que se está viendo, la referencia anterior ya no aplica.
    firma.current = null;
    ultimaSenal.current = Date.now();
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let espera = intervalMs;

    const programar = (ms: number) => {
      if (timer) clearTimeout(timer);
      if (!vivo) return;
      timer = setTimeout(tick, ms);
    };

    /** Vuelve al ritmo normal: lo llama tanto un cambio real como la actividad. */
    const reanudar = () => {
      marcarActividad();
      espera = intervalMs;
      if (pausadoRef.current) {
        pausadoRef.current = false;
        setPausado(false);
      }
      void revisar();
      programar(espera);
    };

    const revisar = async (): Promise<void> => {
      if (!vivo) return;
      if (document.visibilityState !== "visible") return;
      if (editandoUnCampo()) return; // no pisar una edición en curso

      if (!desdeISO) {
        router.refresh();
        return;
      }
      try {
        const params = new URLSearchParams({ desde: desdeISO });
        if (hastaISO) params.set("hasta", hastaISO);
        if (plantel && plantel !== "todos") params.set("plantel", plantel);
        const res = await fetch(`/api/latido?${params.toString()}`, { cache: "no-store" });
        if (!res.ok || !vivo) return;
        const { v } = (await res.json()) as { v: string };
        if (firma.current === null) {
          firma.current = v; // primera lectura: solo referencia
          return;
        }
        if (v !== firma.current) {
          firma.current = v;
          espera = intervalMs; // pasó algo: volver al ritmo base
          // Se vuelve a comprobar el foco: el latido tardó un momento en responder y
          // el usuario pudo empezar a escribir en ese intervalo.
          if (!editandoUnCampo()) router.refresh();
        } else {
          // Nada nuevo: preguntar un poco menos seguido, hasta el tope.
          espera = Math.min(espera * 2, MAX_ESPERA_MS);
        }
      } catch {
        // Sin red o servidor caído: no se hace nada y se intenta en el siguiente tick.
      }
    };

    const tick = async () => {
      if (!vivo) return;
      // Pantalla abandonada: se corta el sondeo para que la base pueda suspenderse.
      if (Date.now() - ultimaSenal.current > INACTIVIDAD_MS) {
        if (!pausadoRef.current) {
          pausadoRef.current = true;
          setPausado(true);
        }
        return; // sin reprogramar: lo despierta la próxima señal de vida
      }
      await revisar();
      programar(espera);
    };

    // ── Señales de vida ──────────────────────────────────────────────────────
    // `mousemove` cuenta a propósito: alguien parado frente al tablero, aunque no haga
    // clic, sigue siendo alguien mirando. Se registra la marca en cada evento (barato)
    // y solo se despierta si estaba pausado.
    const senal = () => {
      const estaba = pausadoRef.current;
      marcarActividad();
      if (estaba) reanudar();
    };
    const eventos = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
    for (const e of eventos) window.addEventListener(e, senal, { passive: true });
    window.addEventListener("focus", senal);
    document.addEventListener("visibilitychange", senal);

    programar(espera);

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      for (const e of eventos) window.removeEventListener(e, senal);
      window.removeEventListener("focus", senal);
      document.removeEventListener("visibilitychange", senal);
    };
  }, [router, intervalMs, desdeISO, hastaISO, plantel, marcarActividad]);

  if (!pausado) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-40 rounded-md border border-border bg-content/95 px-2.5 py-1.5 text-[11px] text-muted shadow-sm"
      role="status"
    >
      Actualización en pausa · mové el mouse para reanudar
    </div>
  );
}
