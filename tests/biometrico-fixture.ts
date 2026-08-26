// Constructor de un archivo IGUAL al que exporta el reloj biométrico, para las pruebas.
//
// Se genera con la misma estructura del archivo real analizado: flujo BIFF crudo (sin
// contenedor OLE2), BOF con opcode 0x0809 y largo 6, y TODAS las celdas como registros
// LABEL de BIFF2 (0x0004) — incluidas fechas y horas, que el reloj escribe como texto.
//
// El archivo real NO se guarda en el repositorio: trae nombres de empleados reales y el
// repositorio es público. Estas pruebas reproducen su estructura; la verificación contra
// el archivo real se hace aparte.

/** Los 29 encabezados, en el orden exacto del archivo del reloj. */
export const ENCABEZADOS_RELOJ = [
  "Cód Interno",
  "Código",
  "Referencia",
  "Nombre",
  "Auto-Asignar",
  "Fecha",
  "Periodo",
  "Dentro",
  "Fuera",
  "Marca/Ent.",
  "Marca/Sal.",
  "Normal",
  "Tiempo Real",
  "Tarde",
  "Temprano",
  "Ausente",
  "Tiempo HE",
  "Jornada Trabajada",
  "Excepción",
  "Marca Ent.",
  "Marca Sal.",
  "Departamento",
  "Feriado",
  "HE FinSem",
  "HE Horas",
  "Tiempo Asist",
  "HE Feriado",
  "SSpeDayWeekendOT",
  "HE_Feriado",
];

export interface FilaReloj {
  codigo: string;
  nombre: string;
  fecha: string; // "d/M/yyyy"
  entrada?: string; // "HH:mm"
  salida?: string;
  ausente?: boolean;
  departamento?: string;
  /** El "Tiempo HE" que calcula el reloj: se incluye a propósito, para comprobar que NO se usa. */
  tiempoHE?: string;
}

/** Arma la matriz de texto (encabezados + filas) tal como saldría del reloj. */
export function matrizReloj(filas: FilaReloj[]): string[][] {
  const salida: string[][] = [ENCABEZADOS_RELOJ.slice()];
  for (const f of filas) {
    const fila = new Array(ENCABEZADOS_RELOJ.length).fill("");
    fila[0] = "8356";
    fila[1] = f.codigo;
    fila[3] = f.nombre;
    fila[5] = f.fecha;
    fila[6] = "xxxxcatorcenal";
    fila[7] = "07:00";
    fila[8] = "16:00";
    fila[9] = f.entrada ?? "";
    fila[10] = f.salida ?? "";
    fila[15] = f.ausente ? "True" : "";
    fila[16] = f.tiempoHE ?? "";
    fila[21] = f.departamento ?? "Produccion SPS";
    salida.push(fila);
  }
  return salida;
}

/** Serializa una matriz de texto como el flujo BIFF que escribe el reloj. */
export function construirArchivoReloj(matriz: string[][]): Uint8Array {
  const bytes: number[] = [];
  const push16 = (v: number) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };

  // BOF idéntico al del archivo real: opcode BIFF5, cuerpo de 6 bytes.
  push16(0x0809);
  push16(6);
  bytes.push(0x00, 0x00, 0x10, 0x00, 0x00, 0x00);

  matriz.forEach((fila, f) => {
    fila.forEach((valor, c) => {
      if (valor === "") return; // el reloj no escribe celdas vacías
      const texto: number[] = [];
      for (const ch of valor) texto.push(ch.charCodeAt(0) & 0xff);
      push16(0x0004); // LABEL (BIFF2)
      push16(2 + 2 + 3 + 1 + texto.length);
      push16(f); // fila
      push16(c); // columna
      bytes.push(0x00, 0x00, 0x00); // atributos de celda
      bytes.push(texto.length); // largo del texto (1 byte en BIFF2)
      bytes.push(...texto);
    });
  });

  push16(0x000a); // EOF
  push16(0);
  return new Uint8Array(bytes);
}

/** Atajo: filas → bytes del archivo. */
export function archivoDePruebas(filas: FilaReloj[]): Uint8Array {
  return construirArchivoReloj(matrizReloj(filas));
}
