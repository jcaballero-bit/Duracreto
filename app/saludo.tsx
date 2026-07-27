/** Saludo del Panel principal con el nombre del usuario y la fecha. */
export function Saludo({ nombre, fecha }: { nombre: string; fecha: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-ink">Bienvenido, {nombre}</h1>
      <p className="mt-1 text-sm text-muted">{fecha}</p>
    </div>
  );
}
