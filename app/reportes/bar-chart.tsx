// Gráfico de barras simple (una sola serie, color de acento). Server component:
// barras ancladas a la línea base, punta redondeada, etiqueta selectiva, valor en
// el tooltip (title). Sin dependencias de gráficos.

export interface Barra {
  label: string;
  valor: number;
}

export function BarChart({
  datos,
  unidad = "m³",
  alto = 180,
}: {
  datos: Barra[];
  unidad?: string;
  alto?: number;
}) {
  if (datos.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Sin datos en el periodo.</p>;
  }
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const n = datos.length;
  // Mostrar etiquetas cada `paso` barras para no saturar (meses ~30 días).
  const paso = n <= 14 ? 1 : Math.ceil(n / 12);

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-end gap-1" style={{ height: alto, minWidth: n > 20 ? n * 22 : undefined }}>
        {datos.map((d, i) => {
          const hPct = max > 0 ? (d.valor / max) * 100 : 0;
          return (
            <div key={i} className="flex min-w-[14px] flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
              <div
                title={`${d.label}: ${d.valor} ${unidad}`}
                className="w-full rounded-t bg-accent transition-[height]"
                style={{ height: `${Math.max(hPct, d.valor > 0 ? 2 : 0)}%` }}
              />
            </div>
          );
        })}
      </div>
      {/* Eje X (etiquetas selectivas) */}
      <div className="mt-1 flex gap-1" style={{ minWidth: n > 20 ? n * 22 : undefined }}>
        {datos.map((d, i) => (
          <div key={i} className="min-w-[14px] flex-1 text-center text-[10px] text-muted">
            {i % paso === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
