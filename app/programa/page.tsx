// Programa DPCR-08 — VISTA PREVIA en pantalla.
//
// El documento oficial ya NO se produce con la impresión del navegador: se genera
// como PDF en el servidor (`/programa/pdf`, ver `lib/programa/`), con paginación
// exacta y archivado por versiones. Esta pantalla es solo la vista previa: muestra el
// mismo contenido del snapshot en una tabla continua, sin cortes de página ni CSS de
// impresión (por eso aquí sí se puede usar un `rowSpan` grande por cliente).

import { auth } from "@/auth";
import { requerirAcceso } from "@/lib/auth/guard";
import { filtroPorRol, zonasParaPrograma } from "@/lib/programa/acceso";
import {
  construirSnapshot,
  ymd,
  type PedidoSnap,
  type SnapshotPrograma,
} from "@/lib/programa/snapshot";
import { ProgramaControles } from "./programa-controles";

export const dynamic = "force-dynamic";

const th =
  "border border-slate-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700";
const td = "border border-slate-300 px-2 py-1 align-middle text-[11px] text-slate-800";

export default async function ProgramaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; zona?: string }>;
}) {
  const alcance = await requerirAcceso("/programa");
  const sesion = await auth();
  const userId = sesion?.user?.id ?? null;
  const sp = await searchParams;

  // Zonas que el usuario puede ver (server-side, no solo la UI). Las mismas reglas
  // las aplica la ruta que genera el PDF.
  const zonasPermitidas = await zonasParaPrograma(alcance, userId);
  const fecha = sp.fecha ?? ymd(new Date());

  if (zonasPermitidas.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-muted">
          No tienes una zona asignada para ver el Programa DPCR-08. Pide al
          administrador que te asigne una zona (o un plantel, si eres Dosificador).
        </p>
      </div>
    );
  }

  const zona = sp.zona && zonasPermitidas.includes(sp.zona) ? sp.zona : zonasPermitidas[0];

  // Restricción por rol: el Laboratorista ve solo sus proyectos asignados y el
  // AsesorRestringido solo los pedidos de sus clientes.
  const { filtro, soloLabAsignado, soloAsesorPropio } = filtroPorRol(alcance, userId);
  const snap = await construirSnapshot({ fecha, zona, filtroExtra: filtro });
  const sinPedidos = snap.planteles.every((p) => p.pedidos.length === 0);

  // Laboratorista / AsesorRestringido sin nada asignado ese día: mensaje claro en vez
  // de un documento vacío.
  if ((soloLabAsignado || soloAsesorPropio) && sinPedidos) {
    return (
      <>
        <ProgramaControles fecha={fecha} zona={zona} zonas={zonasPermitidas} />
        <div className="mx-auto mt-4 max-w-lg rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">
            {soloLabAsignado
              ? "No tienes proyectos asignados para esta fecha."
              : "No tienes pedidos de tus clientes para esta fecha."}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <ProgramaControles fecha={fecha} zona={zona} zonas={zonasPermitidas} />
      <Preview snap={snap} />
    </>
  );
}

/** Vista previa: el mismo contenido del documento, en una tabla continua. */
function Preview({ snap }: { snap: SnapshotPrograma }) {
  return (
    <div className="mx-auto max-w-[1120px] bg-white p-4 text-slate-900">
      {/* Encabezado ISO (en el PDF se repite en cada hoja) */}
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <td className="w-[220px] border border-slate-400 p-2 align-middle" rowSpan={2}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-duracreto.png" alt="DURACRETO" className="mx-auto h-16 w-auto" />
            </td>
            <td className="border border-slate-400 p-2 text-center align-middle">
              <div className="text-lg font-bold tracking-wide text-slate-900">{snap.doc.titulo}</div>
            </td>
            <td className="w-[150px] border border-slate-400 p-2 text-center align-middle">
              <div className="text-[11px] text-slate-600">Código:</div>
              <div className="text-base font-bold text-slate-900">{snap.doc.codigo}</div>
            </td>
          </tr>
          <tr>
            <td className="border border-slate-400 p-2 text-[11px] text-slate-700">
              <div>
                <span className="font-semibold">Elaborado por:</span> {snap.doc.elaboradoPor}
              </div>
              <div>
                <span className="font-semibold">Aprobado por:</span> {snap.doc.aprobadoPor}
              </div>
            </td>
            <td className="border border-slate-400 p-2 text-right text-[11px] text-slate-700">
              <div>Edición: {snap.doc.edicion}</div>
              <div>Fecha: {snap.doc.fechaEdicion}</div>
              <div className="mt-1 italic text-slate-500">
                La numeración de páginas va en el PDF
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Franja de fecha + zona */}
      <div className="mt-3 flex items-center justify-between rounded-sm bg-slate-800 px-3 py-1.5 text-white">
        <span className="text-sm font-semibold">{snap.fechaLarga}</span>
        <span className="text-sm font-semibold uppercase tracking-wide">Zona {snap.zona}</span>
        <span className="text-xs">Probabilidad de lluvia: ______ %</span>
      </div>

      {/* Bombas del día */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-700">
        <span className="font-semibold">Bombas:</span>
        {snap.bombas.length === 0 ? (
          <span className="text-slate-500">ninguna programada</span>
        ) : (
          snap.bombas.map((b) => (
            <span key={b.codigo} className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: b.color }} />
              {b.codigo}
            </span>
          ))
        )}
        <span className="text-slate-400">· descarga directa sin marca</span>
      </div>

      {/* Tabla continua (el corte en hojas lo decide el paginador del PDF) */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse">
          <thead>
            <tr className="bg-slate-50">
              <th className={`${th} text-left`}>Cliente</th>
              <th className={th}>Viaje</th>
              <th className={`${th} text-left`}>Motorista</th>
              <th className={th}>Mixer</th>
              <th className={th}>Carga</th>
              <th className={th}>Llegada</th>
              <th className={th}>Finaliza</th>
              <th className={th}>Regreso</th>
              <th className={`${th} text-left`}>Tipo de concreto</th>
              <th className={th}>Vol. m³</th>
            </tr>
          </thead>
          <tbody>
            {snap.planteles.map((pl) => (
              <FilasPlantel key={pl.id} plantel={pl} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-end">
        <div className="rounded-sm bg-slate-800 px-4 py-2 text-sm font-bold text-white">
          Total Zona {snap.zona}: {snap.totalZona.toFixed(2)} m³
        </div>
      </div>
    </div>
  );
}

function FilasPlantel({ plantel }: { plantel: SnapshotPrograma["planteles"][number] }) {
  return (
    <>
      <tr className="bg-slate-100">
        <td colSpan={10} className="border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-800">
          {plantel.nombre}
        </td>
      </tr>

      {plantel.pedidos.length === 0 ? (
        <tr>
          <td className={`${td} text-center text-slate-400`} colSpan={10}>
            Sin pedidos programados.
          </td>
        </tr>
      ) : (
        plantel.pedidos.map((p, i) => <FilasPedido key={`${p.id}-${i}`} pedido={p} />)
      )}

      <tr className="bg-slate-100 font-bold text-slate-800">
        <td className="border border-slate-400 px-2 py-1 text-right text-[11px]" colSpan={9}>
          Total {plantel.nombre}
        </td>
        <td className="border border-slate-400 px-2 py-1 text-center text-[11px]">
          {plantel.totalM3.toFixed(2)} m³
        </td>
      </tr>
      <tr>
        <td colSpan={10} className="h-4" />
      </tr>
    </>
  );
}

/** Un pedido: celdas de Cliente y Tipo combinadas sobre todas sus filas. En pantalla
 *  no hay cortes de página, así que el rowSpan puede ser tan grande como haga falta. */
function FilasPedido({ pedido: p }: { pedido: PedidoSnap }) {
  const franja = p.bombaColor ? { borderLeft: `4px solid ${p.bombaColor}` } : undefined;
  return (
    <>
      {p.filas.map((f, i) => (
        <tr key={i}>
          {i === 0 && (
            /* Igual que en el PDF: a la izquierda y centrado verticalmente (`align-middle`
               ya viene en `td`), para que la vista previa muestre lo que se imprime. */
            <td className={`${td} text-left`} rowSpan={p.filas.length} style={franja}>
              <div className="font-semibold">{p.cliente}</div>
              {!!p.proyecto && <div className="text-slate-600">{p.proyecto}</div>}
              {!!p.elemento && <div className="text-[10px] text-slate-600">Elemento: {p.elemento}</div>}
              {p.mostrarPlanta && (
                <div className="mt-1 inline-block rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                  Planta: {p.planta}
                </div>
              )}
              {!!p.asesor && <div className="mt-0.5 text-[10px] text-slate-500">{p.asesor}</div>}
            </td>
          )}

          {f.tipo === "planta" ? (
            <td
              className="border border-slate-300 bg-slate-50 px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wide text-slate-700"
              colSpan={7}
            >
              Planta: {f.nombre}
            </td>
          ) : (
            <>
              <td className={`${td} text-center`}>{f.num ?? "—"}</td>
              <td className={td}>{f.motorista}</td>
              <td className={`${td} text-center`}>{f.mixer}</td>
              <td className={`${td} whitespace-nowrap text-center`}>{f.carga}</td>
              <td className={`${td} whitespace-nowrap text-center font-semibold`}>{f.llegada}</td>
              <td className={`${td} whitespace-nowrap text-center`}>{f.finaliza}</td>
              <td className={`${td} whitespace-nowrap text-center`}>{f.regreso}</td>
            </>
          )}

          {i === 0 && (
            <td className={`${td} text-center`} rowSpan={p.filas.length}>
              <div className="font-bold">{p.resistencia}</div>
              <div>{p.hielo}</div>
              {!!p.revenimiento && <div>Rev: {p.revenimiento}</div>}
              <div className="font-semibold">Total: {p.totalM3.toFixed(2)} m³</div>
              {!!p.bombaCodigo && (
                <span
                  className="mt-1 inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-white"
                  style={{ background: p.bombaColor ?? "#334155" }}
                >
                  Bomba {p.bombaCodigo}
                </span>
              )}
            </td>
          )}

          <td className={`${td} whitespace-nowrap text-center`}>
            {f.tipo === "viaje" ? f.volumen : ""}
          </td>
        </tr>
      ))}
    </>
  );
}
