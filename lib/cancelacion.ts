// Motivos de cancelación de un pedido (lista fija del negocio). Módulo PURO
// (sin imports de servidor) para poder usarlo tanto en el motor/acciones como en
// componentes cliente (el modal de cancelación). "Otro" exige un detalle libre.
export const MOTIVOS_CANCELACION = [
  "Clima o Lluvia",
  "Cliente no está listo",
  "Se fue con la competencia",
  "Cancelado por el cliente",
  "Otro",
] as const;

export type MotivoCancelacion = (typeof MOTIVOS_CANCELACION)[number];
