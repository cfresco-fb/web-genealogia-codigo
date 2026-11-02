// Iconos de la web (Carlos, 31/10/2026; docs/decisiones-web-familiar.md,
// «Diseño visual»), generados desde los dibujos originales de docs/iconos/:
//
// - icono-pestana.svg (dos generaciones), para la pestaña del navegador:
//   favicon.svg tal cual, favicon-32.png y favicon.ico (16 y 32 px), para
//   los navegadores que no usan SVG;
// - icono.svg (tres generaciones), para el móvil: apple-touch-icon.png
//   (180 px, pantalla de inicio del iPhone; sobre el fondo papel, porque iOS
//   pinta de negro lo transparente de las esquinas) e icono-192.png e
//   icono-512.png (Android).
//
// Salida: app/public/ (Vite la copia a la raíz de la web). Los enlaces, en
// app/index.html. Uso, si cambian los dibujos:
//     npm run iconos

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEN = path.join(RAIZ, "docs", "iconos");
const SALIDA = path.join(RAIZ, "app", "public");
/** El fondo papel de los dibujos (el del rectángulo redondeado). */
const PAPEL = "#f7f4ee";

const leer = (nombre: string) => fs.readFileSync(path.join(ORIGEN, nombre));

/** PNG cuadrado de `lado` px: se dibuja a 4 veces el tamaño y se reduce,
 * para que las líneas finas salgan suaves también a 16 px. */
async function png(svg: Buffer, lado: number, fondo?: string): Promise<Buffer> {
  const ancho = Number(/viewBox="0 0 (\d+(?:\.\d+)?)/.exec(svg.toString("utf8"))?.[1] ?? 64);
  let imagen = sharp(svg, { density: (72 * lado * 4) / ancho }).resize(lado, lado, { kernel: "lanczos3" });
  if (fondo) imagen = imagen.flatten({ background: fondo });
  return imagen.png({ compressionLevel: 9 }).toBuffer();
}

/** favicon.ico con PNG dentro (lo admiten todos los navegadores actuales). */
function ico(imagenes: { lado: number; png: Buffer }[]): Buffer {
  const cabecera = Buffer.alloc(6 + 16 * imagenes.length);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(imagenes.length, 4);
  let posicion = cabecera.length;
  imagenes.forEach(({ lado, png: datos }, i) => {
    const e = 6 + 16 * i;
    cabecera.writeUInt8(lado >= 256 ? 0 : lado, e);
    cabecera.writeUInt8(lado >= 256 ? 0 : lado, e + 1);
    cabecera.writeUInt16LE(1, e + 4);
    cabecera.writeUInt16LE(32, e + 6);
    cabecera.writeUInt32LE(datos.length, e + 8);
    cabecera.writeUInt32LE(posicion, e + 12);
    posicion += datos.length;
  });
  return Buffer.concat([cabecera, ...imagenes.map((x) => x.png)]);
}

const pestana = leer("icono-pestana.svg");
const movil = leer("icono.svg");
fs.mkdirSync(SALIDA, { recursive: true });
const ficheros: Record<string, Buffer> = {
  "favicon.svg": pestana,
  "favicon-32.png": await png(pestana, 32),
  "favicon.ico": ico([{ lado: 16, png: await png(pestana, 16) }, { lado: 32, png: await png(pestana, 32) }]),
  "apple-touch-icon.png": await png(movil, 180, PAPEL),
  "icono-192.png": await png(movil, 192),
  "icono-512.png": await png(movil, 512),
};
for (const [nombre, datos] of Object.entries(ficheros)) {
  fs.writeFileSync(path.join(SALIDA, nombre), datos);
  console.log(`${path.relative(RAIZ, path.join(SALIDA, nombre))}: ${datos.length} bytes`);
}
