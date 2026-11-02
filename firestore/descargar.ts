/**
 * Reconstruye desde Firestore el JSON de la web, con el mismo formato que
 * genera migracion/exportar_json.py (version_formato 1). El resultado se
 * puede pasar por migracion/importar_json.py para obtener un .gramps.
 *
 * Con una carpeta de fotos, baja además los ficheros de las fotos subidas
 * desde la web (paso 11 b), en su ruta de Gramps (`web/O0012.jpg`) dentro de
 * esa carpeta: es la que hay que poner como carpeta base de multimedia en
 * Gramps, junto a las fotos que ya había. Las demás fotos no se bajan: son
 * las que se subieron desde Gramps y siguen allí.
 *
 * Uso: node firestore/descargar.ts datos/salida/arbol-firestore.json [carpeta de fotos]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { subidaDesdeLaWeb } from "../comun/fotos.ts";
import { leerArbolFirestore } from "../functions/src/arbol.ts";
import { conectar, conReintentos, elegirDestino } from "./comun.ts";
import { sinAvisoDeOyentes } from "../functions/src/oyentes.ts";

export { leerArbolFirestore };

export async function descargar(salida: string, carpetaFotos?: string) {
  const { db, cubo } = conectar();
  const arbol = await leerArbolFirestore(db, console.log);
  writeFileSync(salida, JSON.stringify(arbol, null, 1), "utf8");
  console.log(`Guardado ${salida}`);
  if (!carpetaFotos) return;
  const fotos = (arbol.objetos.Media ?? []).filter((m) => subidaDesdeLaWeb(m.path));
  for (const m of fotos) {
    const destino = path.join(carpetaFotos, String(m.path));
    mkdirSync(path.dirname(destino), { recursive: true });
    const [bytes] = await sinAvisoDeOyentes(() => conReintentos(() => cubo.file(`multimedia/${m.handle}`).download()));
    writeFileSync(destino, bytes);
  }
  console.log(`Fotos subidas desde la web: ${fotos.length}, en ${carpetaFotos}`);
}

if (import.meta.main) {
  const [salida, carpetaFotos] = await elegirDestino();
  if (!salida) {
    console.error("Uso: node firestore/descargar.ts <salida.json> [carpeta de fotos] [--produccion]");
    process.exit(2);
  }
  await descargar(salida, carpetaFotos);
}
