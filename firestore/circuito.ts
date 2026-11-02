/**
 * Prueba de fidelidad del circuito Gramps → Firestore → Gramps (fase 0):
 *   1. carga el JSON en Firestore y Storage;
 *   2. lo reconstruye desde Firestore;
 *   3. compara objeto a objeto el original con el reconstruido (Python);
 *   4. comprueba los ficheros multimedia de Storage y que no queda ninguna
 *      ruta del PC (comprobar_rutas.ts);
 *   5. genera el .gramps final con migracion/importar_json.py, con la
 *      carpeta base de multimedia del JSON original (la descargada no la
 *      trae: no se guarda en Firestore).
 * Termina con código 0 si todo coincide y 1 si no.
 *
 * Uso (con los emuladores en marcha, o mejor con «npm run circuito»):
 *   node firestore/circuito.ts [arbol.json] [carpeta de salida]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { cargar } from "./cargar.ts";
import { descargar } from "./descargar.ts";
import { comprobarMultimedia } from "./comprobar_multimedia.ts";
import { comprobarRutas } from "./comprobar_rutas.ts";
import { leerArbol } from "./comun.ts";

const MIGRACION = path.resolve(import.meta.dirname, "..", "migracion");
const PYTHON = path.join(MIGRACION, ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

function python(programa: string, ...args: string[]): boolean {
  const r = spawnSync(PYTHON, [programa, ...args], { cwd: MIGRACION, stdio: "inherit" });
  if (r.error) throw r.error;
  return r.status === 0;
}

const [origen = "datos/salida/arbol.json", carpeta = path.dirname(origen)] = process.argv.slice(2);
const original = path.resolve(origen);
const copia = path.resolve(carpeta, "arbol-firestore.json");
const gramps = path.resolve(carpeta, "arbol-firestore.gramps");
if (!existsSync(original)) {
  console.error(`No existe ${original}. Genéralo antes con migracion/exportar_json.py.`);
  process.exit(2);
}

console.log(`1/5 Cargando ${original} en Firestore y Storage…`);
await cargar(original);
console.log("\n2/5 Reconstruyendo el JSON desde Firestore…");
await descargar(copia);
console.log("\n3/5 Comparando objeto a objeto…");
const objetosOk = python("comparar_json.py", original, copia);
console.log("\n4/5 Comprobando multimedia en Storage…");
const multimediaOk = await comprobarMultimedia(original) && await comprobarRutas();
console.log("\n5/5 Generando el .gramps final…");
const base = leerArbol(original).base_multimedia;
const grampsOk = python("importar_json.py", copia, gramps, ...(base ? ["--carpeta-multimedia", base] : []));

const ok = objetosOk && multimediaOk && grampsOk;
console.log("\nRESULTADO DEL CIRCUITO:", ok
  ? `Gramps → Firestore → Gramps SIN pérdidas. Fichero final: ${gramps}`
  : "HAY PROBLEMAS (ver arriba)");
process.exit(ok ? 0 : 1);
