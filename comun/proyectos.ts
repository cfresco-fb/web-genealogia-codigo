/**
 * Los dos proyectos de Firebase (docs/puesta-en-marcha.md):
 *
 * - pruebas: `demo-arbol-familiar`, que solo existe en los emuladores (los
 *   proyectos «demo-…» no pueden tocar la nube);
 * - producción: `arbol-freswer`, el real (29/10/2026).
 *
 * Lo comparten la web (app/vite.config.ts, app/src/firebase.ts) y los
 * programas de firestore/ (firestore/comun.ts).
 */

export const PROYECTO_PRUEBAS = "demo-arbol-familiar";
export const PROYECTO_PRODUCCION = "arbol-freswer";

/** Depósito de Storage de cada proyecto. El real tiene la forma nueva de
 * nombre (`….firebasestorage.app`), no `….appspot.com`. */
export const DEPOSITO_PRUEBAS = `${PROYECTO_PRUEBAS}.appspot.com`;
export const DEPOSITO_PRODUCCION = `${PROYECTO_PRODUCCION}.firebasestorage.app`;
