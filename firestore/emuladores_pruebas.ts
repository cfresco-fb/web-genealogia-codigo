/**
 * Lanza los emuladores de las pruebas (firebase.pruebas.json) sin estorbar
 * a los de npm run emuladores, abiertos a la vez (26/10/2026):
 *
 * - desde emuladores-pruebas/: al terminar bien, Firebase borra el
 *   firebase-debug.log de la carpeta desde la que se lanzó;
 * - con su propia carpeta temporal (emuladores-pruebas/tmp): el emulador de
 *   Storage guarda los ficheros en %TEMP%\firebase\storage\blobs y, al
 *   pararse, borra esa carpeta entera, también los ficheros de los otros
 *   emuladores, que se caen al leerlos («ENOENT … An unexpected error has
 *   occurred.») y no los pueden guardar al cerrar. Se vacía al arrancar
 *   (Carlos, 02/11/2026; revisión del 02/11/2026): ahí se acumulaban
 *   ficheros de las pruebas anteriores. Por eso, dos tandas de pruebas a la
 *   vez se estorban (ya lo hacían: comparten los puertos).
 *
 * Uso: node firestore/emuladores_pruebas.ts <emuladores> "<orden>"
 *   (la orden se ejecuta desde emuladores-pruebas/: las rutas, con ../)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const [emuladores, orden] = process.argv.slice(2);
if (!emuladores || !orden) {
  console.error('Uso: node firestore/emuladores_pruebas.ts <emuladores> "<orden>"');
  process.exit(2);
}
const raiz = path.resolve(import.meta.dirname, "..");
const carpeta = path.join(raiz, "emuladores-pruebas");
const temporal = path.join(carpeta, "tmp");
rmSync(temporal, { recursive: true, force: true });
mkdirSync(temporal, { recursive: true });

const firebase = path.join(raiz, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const r = spawnSync(
  process.execPath,
  [firebase, "--config", "../firebase.pruebas.json", "emulators:exec", "--only", emuladores, orden],
  { cwd: carpeta, stdio: "inherit", env: { ...process.env, TEMP: temporal, TMP: temporal, TMPDIR: temporal } },
);
process.exit(r.status ?? 1);
