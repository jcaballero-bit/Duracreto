# Fase 8 — Revisión de métricas y decisión sobre el motor de optimización

**Objetivo de la fase:** decidir, con datos, si vale la pena una "Fase 2" del motor
(optimización global) más allá del esquema actual de **reglas + heurística**.

> Estado: no hay aún operación real acumulada. Este documento define QUÉ medir, CÓMO
> decidir y da una **recomendación preliminar**. La decisión final se toma tras
> acumular varias semanas de datos (ver §6).

---

## 1. Qué hace hoy el motor

Dos subproblemas, con dos naturalezas distintas:

1. **Selección de capacidades — ÓPTIMA (no heurística).**
   `lib/motor/planificador.ts → planificarCombinacion` enumera TODAS las
   combinaciones factibles de tamaños (11/9/7) y elige por: (1) menos viajes,
   (2) menor capacidad ociosa, (3) menos mixers grandes. Para ese subproblema el
   resultado es exacto/óptimo — no hay margen de mejora por "optimizar más".

2. **Secuenciación y asignación temporal — HEURÍSTICA (greedy).**
   `lib/motor/asignacion.ts → recalcularCascadaPlanta` corre por planta: ordena la
   cola por `orden_dia`, ancla el primer viaje al inicio de jornada y encadena el
   resto por disponibilidad de planta + mixer, con **reparto de desgaste** (elige el
   mixer más ocioso), preferencia propio→hub, y respetando hora fija
   (`hora_bloqueada`), frecuencia entre camiones y viajes ya ejecutados
   (`ts_*_real`). Es un greedy secuencial: bueno, explicable y barato de recalcular,
   pero **no busca el óptimo global del día/zona**.

**Conclusión:** lo "difícil de optimizar" (mezcla de capacidades) ya es óptimo; lo
que un optimizador global podría mejorar es la **secuenciación/asignación temporal**.

## 2. Qué sería la "Fase 2 del motor"

Un optimizador que resuelva de forma simultánea, para todo el día y por zona:
asignación mixer↔viaje + orden + horarios, minimizando una función objetivo
(p. ej. tardanza total vs. hora deseada de llegada + tiempo ocioso de flota +
desbalance de desgaste + préstamos entre planteles), sujeto a las restricciones
reales (capacidad de dosificación de cada planta, ventanas, frecuencia entre
camiones, disponibilidad de mixers/bombas, restricción de flota por zona).

Técnicas candidatas:
- **MILP / CP-SAT** (OR-Tools): óptimo o casi óptimo; mayor complejidad y tiempo de
  cómputo; requiere modelar bien la función objetivo.
- **Metaheurística** (búsqueda local / recocido simulado) partiendo de la solución
  greedy actual: mejora incremental sin rehacer el paradigma; más simple de adoptar.

## 3. Señales a acumular (todas salen de datos que YA capturamos)

| Señal | De dónde | Qué indica |
|---|---|---|
| **Desvío real vs programado** | `viajes.ts_*_real` vs `hora_*` | Si el plan se cumple ±pocos min, "planear mejor" rinde poco; si el desvío es grande y sistemático, el cuello está en la ejecución/datos, no en el algoritmo. |
| **Intervención manual** | bitácora (`orden_dia`), `pedidos.hora_bloqueada`, `viajes.ajustado_manualmente`, refuerzos confirmados | Alta intervención ⇒ el plan automático no se usa tal cual → o las reglas están mal, o hace falta optimizar. |
| **Utilización de flota** | `/flota` (mixers en uso/disponibles, horas ocupado) | Baja utilización ⇒ hay holgura, optimizar aporta poco. Cerca de saturación ⇒ optimizar puede desbloquear capacidad. |
| **Alertas de margen** | `detectarAlertasMargen` | Frecuencia de márgenes apretados/traslapes = presión de recursos. |
| **Balance de desgaste** | dispersión de viajes/horas por mixer (reporte `/flota`) | ¿El reparto actual quedó parejo o hay mixers sobrecargados? |
| **"Sin cubrir"** | viajes `motivo = "Sin cubrir"` | Hoy solo ocurre con CERO flota (el greedy serializa todo lo demás) ⇒ casi nunca es señal útil. |

## 4. Criterios de decisión

**Vale la pena la Fase 2** si, sostenido durante varias semanas:
- Utilización alta (p. ej. >85% de mixers disponibles en días pico), **y**
- Intervención manual frecuente (reordenamientos / hora fija / reasignaciones por
  encima de ~20–30% de los pedidos), **y**
- Pérdidas medibles atribuibles a la secuenciación (llegadas tarde vs. deseada,
  camiones ociosos evitables, préstamos entre planteles que se pudieron evitar).

**NO vale la pena (mantener reglas + heurística)** si la utilización es media/baja,
la intervención manual es esporádica, y el desvío principal viene de la ejecución
(tráfico, cliente, obra) y no del plan.

## 5. Recomendación preliminar (con lo que sabemos hoy)

- La operación es **pequeña** (Zona Norte ~24 mixers asignables, Centro Sur ~9;
  decenas de pedidos/día) y la parte combinatoriamente difícil (mezcla de
  capacidades) **ya es óptima**. El greedy de secuenciación respeta las
  restricciones reales y el override manual es barato (reordenar, hora fija).
- **Recomendación: NO iniciar la Fase 2 todavía.** Primero **operar y medir**
  ~4–8 semanas con las señales de §3, y reevaluar con datos.
- Si aparece dolor puntual antes de eso, hay mejoras incrementales de bajo costo que
  NO cambian el paradigma:
  1. Ventanas duras por cliente (además de la hora fija actual) en la cascada.
  2. Una **búsqueda local post-greedy**: tras la cascada, intentar intercambios de
     mixer/orden que reduzcan ociosidad o desbalance, aceptando solo mejoras. Da
     parte del beneficio de un optimizador con una fracción de la complejidad.

## 6. Próximo paso sugerido

Construir un **"Diagnóstico del motor"** (vista Admin) que agregue las señales de §3
por rango de fechas, para que la decisión sea *data-driven* y no de opinión. Con eso,
al cabo de unas semanas, se aplican los criterios de §4 y se decide.
