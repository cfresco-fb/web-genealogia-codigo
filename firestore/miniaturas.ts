/**
 * Copias pequeñas de las fotos (`miniaturas/{handle}`, JPEG de
 * LADO_PEQUENA px como mucho; comun/fotos.ts): las que usa la web en las
 * fichas, las listas, el árbol y los PDF. Las fotos subidas desde la web ya
 * traen la suya (paso 11 b); las que vinieron de Gramps, se hacen aquí desde
 * `multimedia/{handle}`. La carga (cargar.ts) las hace todas; para un árbol
 * cargado antes, `npm run miniaturas` hace solo las que faltan.
 *
 * La copia pequeña va girada según la cámara (como la ve el navegador) y sin
 * metadatos (nada de ubicación); con transparencia, sobre blanco.
 *
 * Uso: node firestore/miniaturas.ts [--todas] [--produccion]
 */
import sharp from "sharp";
import { CARPETA_MINIATURAS, LADO_PEQUENA } from "../comun/fotos.ts";
import { CARPETA_MULTIMEDIA, conReintentos, conectar, elegirDestino, enParalelo } from "./comun.ts";
import { sinAvisoDeOyentes } from "../functions/src/oyentes.ts";

type Cubo = ReturnType<typeof conectar>["cubo"];

/** La copia pequeña de una imagen. */
export async function hacerMiniatura(datos: Buffer): Promise<Buffer> {
  return sharp(datos)
    .rotate()
    .resize(LADO_PEQUENA, LADO_PEQUENA, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** Hace las copias pequeñas de las imágenes de `multimedia/` que no la
 * tienen (o de todas, con `todas`). Lo que no es una imagen se salta. */
export async function generarMiniaturas(cubo: Cubo, { todas = false } = {}): Promise<{ hechas: number; fallos: string[] }> {
  const [ficheros] = await cubo.getFiles({ prefix: CARPETA_MULTIMEDIA });
  const [ya] = todas ? [[]] : await cubo.getFiles({ prefix: CARPETA_MINIATURAS });
  const tienen = new Set(ya.map((f) => f.name.slice(CARPETA_MINIATURAS.length)));
  const fallos: string[] = [];
  let hechas = 0;
  await sinAvisoDeOyentes(() =>
    enParalelo(ficheros, 4, async (f) => {
      const handle = f.name.slice(CARPETA_MULTIMEDIA.length);
      if (tienen.has(handle) || !String(f.metadata.contentType ?? "").startsWith("image/")) return;
      try {
        const [datos] = await conReintentos(() => f.download());
        const pequena = await hacerMiniatura(datos);
        await conReintentos(() => cubo.file(CARPETA_MINIATURAS + handle).save(pequena, { resumable: false, contentType: "image/jpeg" }));
        hechas++;
      } catch (e) {
        fallos.push(`${handle}: ${(e as Error).message}`);
      }
    }));
  return { hechas, fallos };
}

export async function mostrarMiniaturas(cubo: Cubo, opciones: { todas?: boolean } = {}) {
  console.log("Haciendo las copias pequeñas de las fotos…");
  const { hechas, fallos } = await generarMiniaturas(cubo, opciones);
  console.log(`  Copias pequeñas hechas: ${hechas}`);
  if (fallos.length) {
    console.log(`  AVISO: ${fallos.length} fotos sin copia pequeña (la web usará la grande):`);
    for (const f of fallos.slice(0, 10)) console.log(`    - ${f}`);
  }
}

if (import.meta.main) {
  const args = await elegirDestino();
  const { cubo } = conectar();
  await mostrarMiniaturas(cubo, { todas: args.includes("--todas") });
  process.exit(0);
}
