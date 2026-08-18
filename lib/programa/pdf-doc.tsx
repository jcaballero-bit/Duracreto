// Documento PDF del Programa DPCR-08 (se renderiza EN EL SERVIDOR).
//
// Reemplaza la impresión del navegador: el corte de página lo decide
// `paginador.ts` y aquí se DIBUJA con esos altos exactos, así que el resultado es
// idéntico en cualquier máquina y archivable como documento controlado.
//
// Dos mecanismos de la librería sostienen el formato ISO:
//  · `fixed`: el encabezado (logo, título, código, elaborado/aprobado, edición,
//    franja de fecha/zona, fila de bombas y los títulos de columna) se repite en
//    TODAS las hojas sin duplicarlo a mano.
//  · `render={({pageNumber, totalPages})}`: la numeración "Página X de Y" real.
//
// No hay `rowSpan` en PDF: la celda combinada de Cliente y la de Tipo de concreto se
// emulan con columnas paralelas de alto conocido (ver `BloqueClienteView`).

import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import {
  ALTO_ENCABEZADO_FIJO,
  ANCHO_UTIL,
  COLUMNAS,
  MARGEN,
  type BloqueCliente,
  type ItemPagina,
  type PaginaPrograma,
} from "./paginador";
import type { SnapshotPrograma } from "./snapshot";

// Los nombres propios no se parten con guion (la partición automática se ve mal en
// un documento operativo y descuadraría el alto que calculó el paginador).
Font.registerHyphenationCallback((palabra) => [palabra]);

const TINTA = "#0f172a";
const GRIS_LINEA = "#94a3b8";
const GRIS_SUAVE = "#cbd5e1";
const FONDO_TITULO = "#e2e8f0";
const FONDO_BARRA = "#1e293b";

/** Ancho del bloque central (las 7 columnas de viaje) — entre Cliente y Tipo. */
const ANCHO_CENTRO = COLUMNAS.viaje + COLUMNAS.motorista + COLUMNAS.mixer +
  COLUMNAS.carga + COLUMNAS.llegada + COLUMNAS.finaliza + COLUMNAS.regreso;

const s = StyleSheet.create({
  page: {
    paddingTop: MARGEN,
    paddingBottom: MARGEN,
    paddingHorizontal: MARGEN,
    fontFamily: "Helvetica",
    fontSize: 8,
    color: TINTA,
  },
  // ── Encabezado fijo ──
  encabezado: { height: ALTO_ENCABEZADO_FIJO, width: ANCHO_UTIL },
  isoFila: { flexDirection: "row", borderTopWidth: 0.7, borderLeftWidth: 0.7, borderColor: GRIS_LINEA },
  isoLogo: {
    width: 130,
    height: 70,
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: GRIS_LINEA,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  isoCentro: { flex: 1, borderRightWidth: 0.7, borderColor: GRIS_LINEA },
  isoTituloCaja: {
    height: 44,
    borderBottomWidth: 0.7,
    borderColor: GRIS_LINEA,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  isoTitulo: { fontFamily: "Helvetica-Bold", fontSize: 12, letterSpacing: 0.4 },
  isoFirmas: { height: 26, borderBottomWidth: 0.7, borderColor: GRIS_LINEA, justifyContent: "center", paddingHorizontal: 4 },
  isoDer: { width: 118, borderRightWidth: 0.7, borderColor: GRIS_LINEA },
  isoCodigoCaja: { height: 44, borderBottomWidth: 0.7, borderColor: GRIS_LINEA, alignItems: "center", justifyContent: "center" },
  isoControlCaja: { height: 26, borderBottomWidth: 0.7, borderColor: GRIS_LINEA, justifyContent: "center", paddingHorizontal: 4 },
  etiqueta: { fontSize: 6.5, color: "#475569" },
  negrita: { fontFamily: "Helvetica-Bold" },
  barra: {
    marginTop: 4,
    height: 18,
    backgroundColor: FONDO_BARRA,
    color: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
  },
  bombasFila: { marginTop: 3, height: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  chipBomba: { flexDirection: "row", alignItems: "center", gap: 2 },
  cuadroColor: { width: 6, height: 6 },
  // ── Títulos de columna ──
  titulosFila: {
    marginTop: 3,
    height: 16,
    flexDirection: "row",
    backgroundColor: FONDO_TITULO,
    borderTopWidth: 0.7,
    borderLeftWidth: 0.7,
    borderColor: GRIS_LINEA,
  },
  th: {
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: GRIS_LINEA,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  thTexto: { fontFamily: "Helvetica-Bold", fontSize: 6, textTransform: "uppercase", letterSpacing: 0.2 },
  // ── Cuerpo ──
  tablaBorde: { borderLeftWidth: 0.7, borderColor: GRIS_LINEA },
  celda: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: GRIS_SUAVE, paddingHorizontal: 2, paddingVertical: 1.5 },
  tituloPlantel: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: FONDO_TITULO,
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: GRIS_LINEA,
    paddingHorizontal: 6,
  },
  tituloPlantelTexto: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  // Nota operativa del plantel, a la DERECHA de su nombre ("Enviar 5 mixer a Choloma").
  notaPlantelTexto: { flexGrow: 1, textAlign: "right", fontSize: 7.5, color: "#92400e" },
  // Fila de observaciones del cliente: va pegada al pie de su bloque.
  observacionFila: {
    backgroundColor: "#fffbeb",
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: GRIS_SUAVE,
    paddingHorizontal: 4,
    paddingVertical: 2,
    justifyContent: "center",
  },
  observacionTexto: { fontSize: 7.5, color: "#78350f", lineHeight: 1.25 },
  banda: {
    backgroundColor: "#f1f5f9",
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: GRIS_SUAVE,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  bandaTexto: { fontFamily: "Helvetica-Bold", fontSize: 6.5, textTransform: "uppercase", letterSpacing: 0.3 },
  /** Celda combinada de CLIENTE: texto a la izquierda, centrado verticalmente. */
  celdaCliente: { justifyContent: "center" },
  /** Celda combinada de TIPO DE CONCRETO: centrada en ambos ejes. */
  celdaTipo: { alignItems: "center", justifyContent: "center" },
  textoCentrado: { textAlign: "center" },
  /** Etiqueta de la bomba: chip relleno con el color de la bomba (igual que en
   *  pantalla), para que resalte y no se lea como un texto más. */
  chipBombaCelda: { marginTop: 2, paddingHorizontal: 3, paddingVertical: 1.2, borderRadius: 2 },
  chipBombaTexto: { fontFamily: "Helvetica-Bold", fontSize: 6.5, color: "#ffffff" },
  totalPlantel: {
    flexDirection: "row",
    backgroundColor: FONDO_TITULO,
    borderBottomWidth: 0.7,
    borderColor: GRIS_LINEA,
  },
  totalZona: {
    marginTop: 6,
    height: 16,
    alignSelf: "flex-end",
    backgroundColor: FONDO_BARRA,
    color: "#ffffff",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
});

/** Datos del logo listos para `<Image>` (se leen del disco en la ruta del servidor). */
export interface LogoPdf {
  data: Buffer;
  format: "png" | "jpg";
}

// ── Encabezado ISO (se repite en todas las hojas con `fixed`) ────────────────

function Encabezado({ snap }: { snap: SnapshotConLogo }): ReactElement {
  const { doc } = snap;
  return (
    <View style={s.encabezado} fixed>
      <View style={s.isoFila}>
        {/* Logo de la empresa */}
        <View style={s.isoLogo}>
          {snap.logo ? (
            // `Image` aquí es la primitiva de react-pdf (dibuja en el PDF), no un <img>
            // del DOM: no existe atributo alt en un documento PDF.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={{ data: snap.logo.data, format: snap.logo.format }} style={{ height: 54, objectFit: "contain" }} />
          ) : (
            <Text style={[s.negrita, { fontSize: 13 }]}>DURACRETO</Text>
          )}
        </View>

        {/* Título + firmas por cargo (etiquetas ISO fijas, NO el usuario) */}
        <View style={s.isoCentro}>
          <View style={s.isoTituloCaja}>
            <Text style={s.isoTitulo}>{doc.titulo}</Text>
          </View>
          <View style={s.isoFirmas}>
            <Text style={{ fontSize: 7 }}>
              <Text style={s.negrita}>Elaborado por: </Text>
              {doc.elaboradoPor}
            </Text>
            <Text style={{ fontSize: 7 }}>
              <Text style={s.negrita}>Aprobado por: </Text>
              {doc.aprobadoPor}
            </Text>
          </View>
        </View>

        {/* Código + datos de control de edición + número de página real */}
        <View style={s.isoDer}>
          <View style={s.isoCodigoCaja}>
            <Text style={s.etiqueta}>Código:</Text>
            <Text style={[s.negrita, { fontSize: 11 }]}>{doc.codigo}</Text>
          </View>
          <View style={s.isoControlCaja}>
            <Text style={{ fontSize: 6.5 }}>
              Edición: {doc.edicion} · Fecha: {doc.fechaEdicion}
            </Text>
            <Text
              style={{ fontSize: 6.5, fontStyle: "italic" }}
              render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
            />
          </View>
        </View>
      </View>

      {/* Franja de fecha larga + zona + probabilidad de lluvia */}
      <View style={s.barra}>
        <Text style={[s.negrita, { fontSize: 8.5 }]}>{snap.fechaLarga}</Text>
        <Text style={[s.negrita, { fontSize: 8.5, textTransform: "uppercase" }]}>Zona {snap.zona}</Text>
        <Text style={{ fontSize: 7 }}>Probabilidad de lluvia: ______ %</Text>
      </View>

      {/* Bombas disponibles en el programa del día (código + color de su franja) */}
      <View style={s.bombasFila}>
        <Text style={[s.negrita, { fontSize: 6.5 }]}>Bombas:</Text>
        {snap.bombas.length === 0 ? (
          <Text style={{ fontSize: 6.5, color: "#64748b" }}>ninguna programada</Text>
        ) : (
          snap.bombas.map((b) => (
            <View key={b.codigo} style={s.chipBomba}>
              <View style={[s.cuadroColor, { backgroundColor: b.color }]} />
              <Text style={{ fontSize: 6.5 }}>{b.codigo}</Text>
            </View>
          ))
        )}
        <Text style={{ fontSize: 6.5, color: "#94a3b8" }}>· descarga directa sin marca</Text>
      </View>

      {/* Títulos de columna (también repetidos en cada hoja) */}
      <View style={s.titulosFila}>
        <Th w={COLUMNAS.cliente} align="left">Cliente</Th>
        <Th w={COLUMNAS.viaje}>Viaje</Th>
        <Th w={COLUMNAS.motorista} align="left">Motorista</Th>
        <Th w={COLUMNAS.mixer}>Mixer</Th>
        <Th w={COLUMNAS.carga}>Carga</Th>
        <Th w={COLUMNAS.llegada}>Llegada</Th>
        <Th w={COLUMNAS.finaliza}>Finaliza</Th>
        <Th w={COLUMNAS.regreso}>Regreso</Th>
        <Th w={COLUMNAS.tipo} align="left">Tipo de concreto</Th>
        <Th w={COLUMNAS.vol}>Vol. m³</Th>
      </View>
    </View>
  );
}

function Th({
  w,
  align = "center",
  children,
}: {
  w: number;
  align?: "left" | "center";
  children: string;
}): ReactElement {
  return (
    <View style={[s.th, { width: w }]}>
      <Text style={[s.thTexto, { textAlign: align }]}>{children}</Text>
    </View>
  );
}

// ── Bloque de un cliente (celdas combinadas emuladas) ───────────────────────

/**
 * Un sub-bloque de cliente.
 *
 * En PDF no existe `rowSpan`, así que las celdas combinadas de CLIENTE y TIPO DE
 * CONCRETO se dibujan como CAPAS absolutas que cubren todo el alto del bloque, y cada
 * viaje es UNA fila completa (con su volumen incluido) que deja un hueco donde van
 * esas capas. Se hizo así —y no con columnas paralelas— porque una fila real mantiene
 * el volumen pegado a su viaje por construcción: no depende de que dos pilas de celdas
 * queden sincronizadas.
 */
function BloqueClienteView({ bloque }: { bloque: BloqueCliente }): ReactElement {
  const p = bloque.pedido;
  const franja = p.bombaColor ? { borderLeftWidth: 3, borderLeftColor: p.bombaColor } : {};
  // Dónde empieza la capa del Tipo de concreto (después de Cliente + las 7 columnas).
  const izqTipo = COLUMNAS.cliente + ANCHO_CENTRO;

  return (
    <View style={[s.tablaBorde, { height: bloque.alto }]} wrap={false}>
      {/* Filas de viaje (o bandas de planta), cada una completa de izquierda a derecha */}
      {bloque.filas.map((f, i) => (
        <View key={i} style={{ flexDirection: "row", height: bloque.altosFila[i] }}>
          {/* Hueco de la celda combinada de Cliente (la capa lo cubre) */}
          <View style={{ width: COLUMNAS.cliente }} />
          {f.tipo === "planta" ? (
            <View style={[s.banda, { width: ANCHO_CENTRO }]}>
              <Text style={s.bandaTexto}>Planta: {f.nombre}</Text>
            </View>
          ) : (
            <>
              <Celda w={COLUMNAS.viaje} center>{f.num != null ? String(f.num) : "-"}</Celda>
              <Celda w={COLUMNAS.motorista}>{f.motorista}</Celda>
              <Celda w={COLUMNAS.mixer} center>{f.mixer}</Celda>
              <Celda w={COLUMNAS.carga} center>{f.carga}</Celda>
              <Celda w={COLUMNAS.llegada} center negrita>{f.llegada}</Celda>
              <Celda w={COLUMNAS.finaliza} center>{f.finaliza}</Celda>
              <Celda w={COLUMNAS.regreso} center>{f.regreso}</Celda>
            </>
          )}
          {/* Hueco de la celda combinada de Tipo de concreto */}
          <View style={{ width: COLUMNAS.tipo }} />
          {/* Volumen: va en la MISMA fila que su viaje */}
          <View
            style={[
              s.celda,
              { width: COLUMNAS.vol, justifyContent: "center" },
              f.tipo === "planta" ? { backgroundColor: "#f1f5f9" } : {},
            ]}
          >
            {f.tipo === "viaje" && <Text style={{ textAlign: "center" }}>{f.volumen}</Text>}
          </View>
        </View>
      ))}

      {/* Relleno: si una celda combinada es más alta que la suma de las filas, la tabla
          se cierra igual hasta el pie del bloque. */}
      <View style={{ flexGrow: 1, flexDirection: "row" }}>
        <View style={{ width: COLUMNAS.cliente }} />
        <View style={[s.celda, { width: ANCHO_CENTRO }]} />
        <View style={{ width: COLUMNAS.tipo }} />
        <View style={[s.celda, { width: COLUMNAS.vol }]} />
      </View>

      {/* ── Capas de las celdas combinadas (encima de los huecos) ────────────── */}
      <View
        style={[
          s.celda,
          s.celdaCliente,
          franja,
          { position: "absolute", left: 0, top: 0, width: COLUMNAS.cliente, height: bloque.alto },
        ]}
      >
        {bloque.continuacion ? (
          <Text>
            <Text style={s.negrita}>{p.cliente} </Text>
            <Text style={{ fontStyle: "italic", color: "#64748b" }}>(continuación)</Text>
          </Text>
        ) : (
          <>
            <Text style={s.negrita}>{p.cliente}</Text>
            {!!p.proyecto && <Text style={{ color: "#475569" }}>{p.proyecto}</Text>}
            {!!p.elemento && (
              <Text style={{ fontSize: 6.5, color: "#475569" }}>Elemento: {p.elemento}</Text>
            )}
            {p.mostrarPlanta && (
              <Text style={[s.negrita, { fontSize: 6.5 }]}>Planta: {p.planta}</Text>
            )}
            {!!p.asesor && <Text style={{ fontSize: 6.5, color: "#64748b" }}>{p.asesor}</Text>}
          </>
        )}
      </View>

      <View
        style={[
          s.celda,
          s.celdaTipo,
          { position: "absolute", left: izqTipo, top: 0, width: COLUMNAS.tipo, height: bloque.alto },
        ]}
      >
        <Text style={[s.negrita, s.textoCentrado]}>{p.resistencia}</Text>
        <Text style={s.textoCentrado}>{p.hielo}</Text>
        {!!p.revenimiento && <Text style={s.textoCentrado}>Rev: {p.revenimiento}</Text>}
        {/* El Total del cliente va SOLO al cerrar su último sub-bloque. */}
        {bloque.conTotal && (
          <Text style={[s.negrita, s.textoCentrado]}>Total: {p.totalM3.toFixed(2)} m³</Text>
        )}
        {!!p.bombaCodigo && (
          <View style={[s.chipBombaCelda, { backgroundColor: p.bombaColor ?? TINTA }]}>
            <Text style={s.chipBombaTexto}>Bomba {p.bombaCodigo}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Celda({
  w,
  center = false,
  negrita = false,
  children,
}: {
  w: number;
  center?: boolean;
  negrita?: boolean;
  children: string;
}): ReactElement {
  return (
    <View style={[s.celda, { width: w, justifyContent: "center" }]}>
      <Text
        style={[
          center ? { textAlign: "center" } : {},
          negrita ? s.negrita : {},
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

// ── Documento completo ───────────────────────────────────────────────────────

function renderItem(item: ItemPagina, i: number): ReactElement | null {
  switch (item.tipo) {
    case "tituloPlantel":
      return (
        <View key={i} style={[s.tablaBorde, s.tituloPlantel, { height: item.alto, width: ANCHO_UTIL }]}>
          <Text style={s.tituloPlantelTexto}>{item.nombre}</Text>
          {!!item.observaciones && (
            <Text style={s.notaPlantelTexto}>{item.observaciones}</Text>
          )}
        </View>
      );
    case "sinPedidos":
      return (
        <View key={i} style={[s.tablaBorde, s.celda, { height: item.alto, width: ANCHO_UTIL, justifyContent: "center" }]}>
          <Text style={{ textAlign: "center", color: "#94a3b8" }}>Sin pedidos programados.</Text>
        </View>
      );
    case "observacionCliente":
      return (
        <View
          key={i}
          style={[s.tablaBorde, s.observacionFila, { height: item.alto, width: ANCHO_UTIL }]}
        >
          <Text style={s.observacionTexto}>
            <Text style={s.negrita}>Observaciones: </Text>
            {item.texto}
          </Text>
        </View>
      );
    case "bloqueCliente":
      return <BloqueClienteView key={i} bloque={item} />;
    case "totalPlantel":
      return (
        <View key={i} style={[s.tablaBorde, s.totalPlantel, { height: item.alto, width: ANCHO_UTIL }]}>
          <View style={[s.celda, { width: ANCHO_UTIL - COLUMNAS.vol, justifyContent: "center" }]}>
            <Text style={[s.negrita, { textAlign: "right" }]}>Total {item.nombre}</Text>
          </View>
          <View style={[s.celda, { width: COLUMNAS.vol, justifyContent: "center" }]}>
            {/* Un poco más pequeño: un total de 4 dígitos ("1250.00 m³") debe caber
                en la columna de volumen sin cortarse. */}
            <Text style={[s.negrita, { fontSize: 7, textAlign: "center" }]}>
              {item.totalM3.toFixed(2)} m³
            </Text>
          </View>
        </View>
      );
    case "separador":
      return <View key={i} style={{ height: item.alto }} />;
    case "totalZona":
      return (
        <View key={i} style={s.totalZona}>
          <Text style={[s.negrita, { fontSize: 9, color: "#ffffff" }]}>
            Total Zona {item.zona}: {item.totalM3.toFixed(2)} m³
          </Text>
        </View>
      );
  }
}

/** Snapshot + el logo ya leído del disco (el snapshot archivado no guarda binarios). */
export type SnapshotConLogo = SnapshotPrograma & { logo?: LogoPdf };

/**
 * Documento del Programa DPCR-08: UNA `<Page>` por cada hoja que decidió el
 * paginador, con el encabezado ISO (declarado una sola vez, en `Encabezado`) al
 * inicio de cada una y marcado `fixed` para que la librería lo repita si alguna hoja
 * llegara a fluir.
 *
 * Se emite una Page por hoja —en vez de una Page larga con marcas de salto— para que
 * la paginación automática de la librería NO pueda intervenir: el corte lo decide
 * únicamente `paginador.ts`. Con una sola Page envolvente, react-pdf reevaluaba el
 * espacio y podía dejar filas fuera del documento; así cada hoja es independiente y
 * lo calculado es exactamente lo impreso. "Página X de Y" sigue siendo la numeración
 * real (la librería numera sobre el total de páginas del documento).
 */
export function ProgramaPdf({
  snap,
  paginas,
}: {
  snap: SnapshotConLogo;
  paginas: PaginaPrograma[];
}) {
  return (
    <Document
      title={`Programa DPCR-08 ${snap.fecha} Zona ${snap.zona}`}
      author="DURACRETO"
      subject="Programa de entrega de concreto"
    >
      {paginas.map((pg, idx) => (
        <Page key={idx} size="LETTER" orientation="portrait" style={s.page}>
          <Encabezado snap={snap} />
          {pg.items.map((item, i) => renderItem(item, i))}
        </Page>
      ))}
    </Document>
  );
}
