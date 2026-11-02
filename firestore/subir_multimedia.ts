/**
 * Sube a Storage los ficheros multimedia (fotos) del JSON, sin tocar nada
 * más: ni Firestore, ni el registro, ni la instantánea. Sustituye los que
 * ya estén y no borra ninguno. Sirve para recuperarlos si Storage se ha
 * quedado vacío (por ejemplo, si los emuladores no lo guardaron al
 * cerrarse); la carga (cargar.ts) usa la misma función. Solo, hace también
 * las copias pequeñas que falten (miniaturas.ts).
 *
 * Uso: node firestore/subir_multimedia.ts datos/salida/arbol.json
 */
import { existsSync } from "node:fs";
import { CARPETA_MULTIMEDIA, conReintentos, conectar, enParalelo, leerArbol, rutaMultimedia } from "./comun.ts";
import { mostrarMiniaturas } from "./miniaturas.ts";

type Cubo = ReturnType<typeof conectar>["cubo"];

export async function subirMultimedia(cubo: Cubo, arbol: ReturnType<typeof leerArbol>) {
  console.log("Subiendo multimedia…");
  const faltan: string[] = [];
  let subidos = 0;
  await enParalelo(arbol.objetos.Media ?? [], 8, async (media) => {
    const local = rutaMultimedia(media, arbol.base_multimedia);
    if (local === null) return;
    if (!existsSync(local)) {
      faltan.push(String(media.path));
      return;
    }
    await conReintentos(() => cubo.upload(local, {
      destination: CARPETA_MULTIMEDIA + media.handle,
      contentType: (media.mime as string) || undefined,
      metadata: { metadata: { ruta_gramps: String(media.path) } },
    }));
    subidos++;
  });
  console.log(`  Ficheros subidos: ${subidos}`);
  if (faltan.length) {
    console.log(`  AVISO: ${faltan.length} ficheros no encontrados en ${arbol.base_multimedia}`);
    for (const r of faltan.slice(0, 10)) console.log(`    - ${r}`);
  }
}

if (import.meta.main) {
  const [ruta] = process.argv.slice(2);
  if (!ruta) {
    console.error("Uso: node firestore/subir_multimedia.ts <arbol.json>");
    process.exit(2);
  }
  const { cubo } = conectar();
  await subirMultimedia(cubo, leerArbol(ruta));
  await mostrarMiniaturas(cubo);
}
