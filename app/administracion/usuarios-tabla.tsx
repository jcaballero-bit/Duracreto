"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { ROLES, ZONAS } from "@/lib/auth/roles";
import {
  actualizarUsuarioAction,
  alternarActivoAction,
  alternarRolAction,
  crearUsuarioAction,
  eliminarUsuarioAction,
  fijarPlantaAsignadaAction,
  fijarPlantelAsignadoAction,
  fijarZonaAction,
  forzarCambioPasswordAction,
} from "./actions";

export interface UsuarioAdmin {
  id: string;
  nombre: string;
  correo: string;
  zona: string | null;
  plantelAsignadoId: number | null;
  plantaAsignadaId: number | null;
  roles: string[];
  activo: boolean;
}
export interface PlantelOpc {
  id: number;
  nombre: string;
}
export interface OpcSelect {
  value: string;
  label: string;
}

export function UsuariosTabla({
  usuarios,
  planteles,
  plantas,
}: {
  usuarios: UsuarioAdmin[];
  planteles: PlantelOpc[];
  plantas: OpcSelect[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null);

  const accion = (fn: () => Promise<{ ok: boolean; mensaje?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else alert(res.mensaje ?? "No se pudo aplicar el cambio.");
    });

  const eliminar = (u: UsuarioAdmin) => {
    if (!confirm(`¿Eliminar al usuario ${u.nombre} (${u.correo})?`)) return;
    accion(() => eliminarUsuarioAction(u.id));
  };

  const forzarCambio = (u: UsuarioAdmin) => {
    if (!confirm(`¿Pedirle a ${u.nombre} que cambie su contraseña en el próximo ingreso?`)) return;
    accion(async () => {
      const res = await forzarCambioPasswordAction(u.id);
      if (res.ok) alert(`${u.nombre} deberá cambiar su contraseña la próxima vez que entre.`);
      return res;
    });
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => setNuevoAbierto(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={16} /> Nuevo usuario
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Correo</th>
              <th className="px-3 py-2">Zona</th>
              <th className="px-3 py-2">Plantel (Jefe)</th>
              <th className="px-3 py-2">Planta (Dosif.)</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2">Activo</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-b border-border/60 align-top">
                <td className="px-3 py-2 font-medium text-ink">{u.nombre}</td>
                <td className="px-3 py-2 text-muted">{u.correo}</td>
                <td className="px-3 py-2">
                  <select
                    value={u.zona ?? ""}
                    disabled={pendiente}
                    onChange={(e) => accion(() => fijarZonaAction(u.id, e.target.value))}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                  >
                    <option value="">Sin zona</option>
                    {ZONAS.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.plantelAsignadoId != null ? String(u.plantelAsignadoId) : ""}
                    disabled={pendiente}
                    onChange={(e) => accion(() => fijarPlantelAsignadoAction(u.id, e.target.value))}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                  >
                    <option value="">—</option>
                    {planteles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.plantaAsignadaId != null ? String(u.plantaAsignadaId) : ""}
                    disabled={pendiente}
                    onChange={(e) => accion(() => fijarPlantaAsignadaAction(u.id, e.target.value))}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                    title="Planta específica del Dosificador (sincroniza su plantel)"
                  >
                    <option value="">—</option>
                    {plantas.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {ROLES.map((rol) => {
                      const activo = u.roles.includes(rol);
                      return (
                        <button
                          key={rol}
                          disabled={pendiente}
                          onClick={() => accion(() => alternarRolAction(u.id, rol))}
                          className={
                            "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 " +
                            (activo
                              ? "bg-accent text-white"
                              : "border border-border bg-surface text-muted hover:border-accent")
                          }
                        >
                          {rol}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <button
                    disabled={pendiente}
                    onClick={() => accion(() => alternarActivoAction(u.id, !u.activo))}
                    className={
                      "relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 " +
                      (u.activo ? "bg-emerald-500" : "bg-slate-300")
                    }
                    title={u.activo ? "Activo" : "Inactivo"}
                  >
                    <span
                      className={
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all " +
                        (u.activo ? "left-4" : "left-0.5")
                      }
                    />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      disabled={pendiente}
                      onClick={() => setEditando(u)}
                      title="Editar usuario (nombre, correo, contraseña)"
                      className="rounded-md p-1.5 text-muted hover:bg-content hover:text-accent disabled:opacity-50"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      disabled={pendiente}
                      onClick={() => forzarCambio(u)}
                      title="Forzar cambio de contraseña en el próximo ingreso"
                      className="rounded-md p-1.5 text-muted hover:bg-content hover:text-accent disabled:opacity-50"
                    >
                      <KeyRound size={16} />
                    </button>
                    <button
                      disabled={pendiente}
                      onClick={() => eliminar(u)}
                      title="Eliminar usuario"
                      className="rounded-md p-1.5 text-danger hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nuevoAbierto && (
        <NuevoUsuarioModal
          planteles={planteles}
          onCerrar={() => setNuevoAbierto(false)}
          onExito={() => {
            setNuevoAbierto(false);
            router.refresh();
          }}
        />
      )}

      {editando && (
        <EditarUsuarioModal
          usuario={editando}
          onCerrar={() => setEditando(null)}
          onExito={() => {
            setEditando(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function EditarUsuarioModal({
  usuario,
  onCerrar,
  onExito,
}: {
  usuario: UsuarioAdmin;
  onCerrar: () => void;
  onExito: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

  const guardar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await actualizarUsuarioAction(
        usuario.id,
        String(fd.get("nombre") ?? ""),
        String(fd.get("correo") ?? ""),
        String(fd.get("password") ?? ""),
      );
      if (res.ok) onExito();
      else alert(res.mensaje ?? "No se pudo guardar.");
    });
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onCerrar}
    >
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Editar usuario</h2>
          <button onClick={onCerrar} className="rounded-md p-1 text-muted hover:bg-content hover:text-ink" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={guardar} className="space-y-3 p-5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Nombre</span>
            <input name="nombre" required defaultValue={usuario.nombre} className={inputCls} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Correo</span>
            <input type="email" name="correo" required defaultValue={usuario.correo} className={inputCls} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Nueva contraseña (opcional)</span>
            <input
              type="password"
              name="password"
              minLength={6}
              placeholder="Dejar en blanco para no cambiarla"
              autoComplete="new-password"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-muted">
              Si la cambias, el usuario deberá elegir una nueva en su próximo ingreso.
            </span>
          </label>
          <p className="rounded-md bg-content px-3 py-2 text-xs text-muted">
            Los roles, la zona, el plantel y el estado activo se editan directamente en la
            fila de la tabla.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCerrar} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content">
              Cancelar
            </button>
            <button type="submit" disabled={pendiente} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
              {pendiente ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NuevoUsuarioModal({
  planteles,
  onCerrar,
  onExito,
}: {
  planteles: PlantelOpc[];
  onCerrar: () => void;
  onExito: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [roles, setRoles] = useState<string[]>([]);
  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";

  const toggle = (rol: string) =>
    setRoles((prev) => (prev.includes(rol) ? prev.filter((r) => r !== rol) : [...prev, rol]));

  const guardar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await crearUsuarioAction(
        String(fd.get("nombre") ?? ""),
        String(fd.get("correo") ?? ""),
        String(fd.get("password") ?? ""),
        roles,
        String(fd.get("zona") ?? ""),
        String(fd.get("plantel_asignado") ?? ""),
      );
      if (res.ok) onExito();
      else alert(res.mensaje ?? "No se pudo crear el usuario.");
    });
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onCerrar}
    >
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Nuevo usuario</h2>
          <button onClick={onCerrar} className="rounded-md p-1 text-muted hover:bg-content hover:text-ink" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={guardar} className="space-y-3 p-5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Nombre</span>
            <input name="nombre" required className={inputCls} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Correo</span>
            <input type="email" name="correo" required className={inputCls} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Contraseña (mín. 6)</span>
            <input type="password" name="password" required minLength={6} className={inputCls} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Zona (Programador/Despachador/Laboratorista)</span>
            <select name="zona" defaultValue="" className={inputCls}>
              <option value="">Sin zona</option>
              {ZONAS.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Plantel asignado (Jefe de Planta / Dosificador)</span>
            <select name="plantel_asignado" defaultValue="" className={inputCls}>
              <option value="">— (no aplica)</option>
              {planteles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium text-ink">Roles</span>
            <div className="flex flex-wrap gap-1">
              {ROLES.map((rol) => {
                const activo = roles.includes(rol);
                return (
                  <button
                    type="button"
                    key={rol}
                    onClick={() => toggle(rol)}
                    className={
                      "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors " +
                      (activo
                        ? "bg-accent text-white"
                        : "border border-border bg-surface text-muted hover:border-accent")
                    }
                  >
                    {rol}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCerrar} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-content">
              Cancelar
            </button>
            <button type="submit" disabled={pendiente} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
              {pendiente ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
