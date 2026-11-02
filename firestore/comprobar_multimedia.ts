/**
 * Comprueba que cada fichero multimedia del JSON está en Storage con el
 * mismo tamaño y la misma huella MD5 que el fichero local, y que no sobra
 * ninguno. Termina con código 0 si todo coincide y 1 si no.
 *
 * Uso: node firestore/comprobar_multimedia.ts datos/salida/arbol.json
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { CARPETA_MULTIMEDIA, conReintentos, conectar, leerArbol, rutaMultimedia } from "./comun.ts";

export async function comprobarMultimedia(rutaJson: string): Promise<boolean> {
  const { cubo } = conectar();
  const arbol = leerArbol(rutaJson);
  const [ficheros] = await conReintentos(() => cubo.getFiles({ prefix: CARPETA_MULTIMEDIA }));
  const enStorage = new Map(ficheros.map((f) => [f.name, f.metadata]));

  const errores: string[] = [];
  let correctos = 0, web = 0;
  for (const media of arbol.objetos.Media ?? []) {
    const local = rutaMultimedia(media, arbol.base_multimedia);
    if (local === null) {
      web++;
      continue;
    }
    const nombre = CARPETA_MULTIMEDIA + media.handle;
    const meta = enStorage.get(nombre);
    enStorage.delete(nombre);
    if (!existsSync(local)) {
      errores.push(`${media.gramps_id}: no existe el fichero local ${local}`);
      continue;
    }
    if (!meta) {
      errores.push(`${media.gramps_id}: no está en Storage`);
      continue;
    }
    const datos = readFileSync(local);
    const md5 = createHash("md5").update(datos).digest("base64");
    if (Number(meta.size) !== datos.length || meta.md5Hash !== md5) {
      errores.push(`${media.gramps_id}: local ${datos.length} B, Storage ${meta.size} B` +
        (meta.md5Hash !== md5 ? " (MD5 distinto)" : ""));
      continue;
    }
    correctos++;
  }
  for (const nombre of enStorage.keys()) errores.push(`Sobra en Storage: ${nombre}`);

  console.log(`Multimedia: ${correctos} correctos, ${errores.length} con problemas` +
    (web ? `, ${web} direcciones web (no se suben)` : ""));
  for (const e of errores.slice(0, 20)) console.log(`  - ${e}`);
  return errores.length === 0;
}

if (import.meta.main) {
  const [ruta] = process.argv.slice(2);
  if (!ruta) {
    console.error("Uso: node firestore/comprobar_multimedia.ts <arbol.json>");
    process.exit(2);
  }
  process.exit((await comprobarMultimedia(ruta)) ? 0 : 1);
}
