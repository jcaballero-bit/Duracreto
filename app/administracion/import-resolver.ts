// Resolución PURA de una fila de CSV a datos Prisma (validación + relaciones por
// nombre). Sin BD ni "use server": se prueba en aislamiento. La acción de
// importación le pasa los mapas nombre→id ya cargados.
import { ZONAS } from "@/lib/auth/roles";
import type { Catalogo } from "./catalogos-actions";

export type Fila = Record<string, string>;
export type Resuelto = { data: Record<string, unknown> } | { error: string };
export interface Mapas {
  plantel: Map<string, number>;
  operador: Map<string, number>;
  asesor: Map<string, number>;
}

export function resolverFila(catalogo: Catalogo, r: Fila, m: Mapas): Resuelto {
  const nlc = (v?: string) => (v ?? "").trim().toLowerCase();
  const req = (v?: string) => (v ?? "").trim();
  const opc = (v?: string) => (req(v) === "" ? null : req(v));
  const entero = (v?: string) => {
    const n = Number.parseInt(req(v), 10);
    return Number.isNaN(n) ? null : n;
  };
  const buscarPlantel = (v?: string): number | null | string => {
    if (req(v) === "") return null;
    return m.plantel.get(nlc(v)) ?? `plantel "${req(v)}" no existe`;
  };

  switch (catalogo) {
    case "planteles": {
      if (!req(r.nombre)) return { error: "nombre vacío" };
      if (!ZONAS.includes(req(r.zona) as (typeof ZONAS)[number]))
        return { error: `zona "${req(r.zona)}" no es válida` };
      const cap = entero(r.capacidad_dosificacion_m3h);
      if (cap === null) return { error: "capacidad_dosificacion_m3h inválida" };
      const hub = buscarPlantel(r.hub);
      if (typeof hub === "string") return { error: hub };
      return {
        data: { nombre: req(r.nombre), zona: req(r.zona), capacidad_dosificacion_m3h: cap, hub_id: hub },
      };
    }
    case "plantas": {
      if (!req(r.nombre)) return { error: "nombre vacío" };
      const p = buscarPlantel(r.plantel);
      if (p === null) return { error: "plantel vacío" };
      if (typeof p === "string") return { error: p };
      const cap = entero(r.capacidad_m3h);
      if (cap === null) return { error: "capacidad_m3h inválida" };
      return { data: { nombre: req(r.nombre), plantel_id: p, capacidad_m3h: cap } };
    }
    case "mixers": {
      const cap = entero(r.capacidad_m3);
      if (cap === null) return { error: "capacidad_m3 inválida" };
      const p = buscarPlantel(r.plantel_base);
      if (p === null) return { error: "plantel_base vacío" };
      if (typeof p === "string") return { error: p };
      let opId: number | null = null;
      if (req(r.operador)) {
        const id = m.operador.get(nlc(r.operador));
        if (!id) return { error: `operador "${req(r.operador)}" no existe` };
        opId = id;
      }
      return {
        data: {
          identificador: opc(r.identificador),
          placa: opc(r.placa),
          marca: req(r.marca) || "—",
          capacidad_m3: cap,
          plantel_base_id: p,
          estado: req(r.estado) || "Disponible",
          operador_asignado_id: opId,
        },
      };
    }
    case "bombas": {
      if (!req(r.identificador)) return { error: "identificador vacío" };
      const p = buscarPlantel(r.plantel_base);
      if (p === null) return { error: "plantel_base vacío" };
      if (typeof p === "string") return { error: p };
      return {
        data: { identificador: req(r.identificador), estado: req(r.estado) || "Disponible", plantel_base_id: p },
      };
    }
    case "camiones":
    case "pickups": {
      if (!req(r.identificador)) return { error: "identificador vacío" };
      const p = buscarPlantel(r.plantel_base);
      if (p === null) return { error: "plantel_base vacío" };
      if (typeof p === "string") return { error: p };
      return {
        data: {
          identificador: req(r.identificador),
          placa: opc(r.placa),
          estado: req(r.estado) || "Disponible",
          plantel_base_id: p,
        },
      };
    }
    case "operadores": {
      if (!req(r.nombre)) return { error: "nombre vacío" };
      return { data: { nombre: req(r.nombre), estado: req(r.estado) || "Disponible" } };
    }
    case "asesores": {
      if (!req(r.nombre)) return { error: "nombre vacío" };
      return { data: { nombre: req(r.nombre), correo: opc(r.correo) } };
    }
    case "disenos": {
      if (!req(r.revenimiento)) return { error: "revenimiento vacío" };
      return {
        data: {
          codigo: req(r.codigo), // vacío → autogenera en la acción
          resistencia_psi: null,
          etiqueta_resistencia: opc(r.resistencia),
          tamano_agregado: opc(r.tamano_agregado),
          revenimiento: req(r.revenimiento),
          aditivo_especial: opc(r.aditivo),
        },
      };
    }
  }
}
