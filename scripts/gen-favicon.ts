// Genera el favicon (icono de la pestaña del navegador) a partir de la MARCA
// (el "ala" amarilla/naranja) del logo DURACRETO. A tamaño de favicon el texto
// es ilegible, así que se usa solo la marca, que es lo reconocible.
//
// Salidas: app/icon.png (512, alta resolución) y app/favicon.ico (48, PNG-in-ICO).
// Ejecutar: npx tsx scripts/gen-favicon.ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "public", "logo-duracreto.png");
const TRANSP = { r: 0, g: 0, b: 0, alpha: 0 };

/** Envuelve un PNG en un contenedor .ico de una sola imagen (PNG embebido). */
function armarIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: icono
  header.writeUInt16LE(1, 4); // 1 imagen
  const dir = Buffer.alloc(16);
  dir.writeUInt8(size >= 256 ? 0 : size, 0); // ancho
  dir.writeUInt8(size >= 256 ? 0 : size, 1); // alto
  dir.writeUInt8(0, 2); // paleta
  dir.writeUInt8(0, 3); // reservado
  dir.writeUInt16LE(1, 4); // planos
  dir.writeUInt16LE(32, 6); // bits por pixel
  dir.writeUInt32LE(png.length, 8); // tamaño de la imagen
  dir.writeUInt32LE(6 + 16, 12); // offset a los datos
  return Buffer.concat([header, dir, png]);
}

/** La marca (ala) cuadrada, centrada y con margen, sobre fondo transparente. */
async function marcaCuadrada(wing: Buffer, size: number, padding: number): Promise<Buffer> {
  const inner = Math.round(size * (1 - padding));
  const logo = await sharp(wing)
    .resize(inner, inner, { fit: "contain", background: TRANSP })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: TRANSP } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
}

async function main() {
  console.log("Generando favicon desde la marca DURACRETO...");
  // 1) Recortar los márgenes del logo completo.
  const base = await sharp(SRC).trim().toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  // 2) Quedarse con la franja superior (el "ala"), sin el texto DURACRETO/tagline.
  const wingH = Math.round(height * 0.56);
  const wing = await sharp(base.data)
    .extract({ left: 0, top: 0, width, height: wingH })
    .trim()
    .png()
    .toBuffer();

  // 3) icon.png (alta resolución) + favicon.ico (48px).
  const icon512 = await marcaCuadrada(wing, 512, 0.06);
  fs.writeFileSync(path.join(ROOT, "app", "icon.png"), icon512);
  console.log("  app/icon.png (512x512)");

  const png48 = await marcaCuadrada(wing, 48, 0.06);
  fs.writeFileSync(path.join(ROOT, "app", "favicon.ico"), armarIco(png48, 48));
  console.log("  app/favicon.ico (48x48)");
  console.log("Listo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
