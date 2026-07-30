// Genera los iconos PWA a partir del logo (public/logo-duracreto.png).
// Iconos cuadrados con fondo blanco (el logo está diseñado para fondo claro) y
// un margen de seguridad para el recorte "maskable". Sin dependencias nuevas:
// usa `sharp` (ya presente por Next.js).
//
// Ejecutar: npx tsx scripts/gen-icons.ts
import path from "node:path";
import sharp from "sharp";

const PUBLIC = path.join(process.cwd(), "public");
const LOGO = path.join(PUBLIC, "logo-duracreto.png");
const BLANCO = { r: 255, g: 255, b: 255, alpha: 1 };

/** Compone el logo centrado sobre un lienzo cuadrado con `padding` (0-1). */
async function icono(size: number, padding: number, salida: string) {
  const inner = Math.round(size * (1 - padding));
  const logo = await sharp(LOGO)
    .resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BLANCO } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(PUBLIC, salida));
  console.log(`  ${salida}  (${size}x${size})`);
}

async function main() {
  console.log("Generando iconos PWA...");
  // Estándar: poco margen (el logo ocupa casi todo).
  await icono(192, 0.12, "icon-192.png");
  await icono(512, 0.12, "icon-512.png");
  // Apple touch icon (iOS): 180x180, sin esquinas (iOS las redondea).
  await icono(180, 0.12, "apple-touch-icon.png");
  // Maskable: margen mayor (~20%) para la zona segura del recorte circular.
  await icono(512, 0.2, "icon-maskable.png");
  console.log("Listo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
