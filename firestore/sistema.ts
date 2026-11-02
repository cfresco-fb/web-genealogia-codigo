/**
 * Genera el índice de relaciones y los contadores (sistema/indice,
 * sistema/contadores; docs/edicion.md) desde el árbol que ya está en
 * Firestore, y regenera la instantánea (versión 2). Para un árbol cargado
 * antes de la fase 3, sin volver a cargarlo.
 *
 * Si ya hay cambios en el registro, el índice y los contadores los mantiene
 * la función del servidor y no se tocan (los contadores perderían la
 * secuencia): solo se añaden a sistema/contadores los tipos propios del
 * árbol (comun/tipos.ts), que faltan en los árboles cargados antes del
 * 25/10/2026.
 *
 * Uso: node firestore/sistema.ts
 */
import { conectar } from "./comun.ts";
import { leerArbolFirestore } from "../functions/src/arbol.ts";
import { generarInstantanea } from "../functions/src/instantanea.ts";
import { generarSistema, RUTA_CONTADORES, type Contadores } from "../functions/src/sistema.ts";
import { tiposPropios, unirTipos } from "../comun/tipos.ts";

if (import.meta.main) {
  const { db, cubo } = conectar();
  const arbol = await leerArbolFirestore(db);
  if (!(await db.collection("cambios").limit(1).get()).empty) {
    const actuales = ((await db.doc(RUTA_CONTADORES).get()).data() as Contadores | undefined)?.tiposPropios ?? {};
    const tipos = unirTipos(actuales, tiposPropios(Object.values(arbol.objetos).flat()));
    await db.doc(RUTA_CONTADORES).set({ tiposPropios: tipos }, { merge: true });
    const n = Object.values(tipos).reduce((s, l) => s + l.length, 0);
    console.log(`Ya hay cambios en el registro: índice y secuencias sin tocar. Tipos propios al día en ${RUTA_CONTADORES} (${n}).`);
    process.exit(0);
  }
  const s = await generarSistema(db, arbol.objetos);
  console.log(`sistema/indice: ${(s.bytesComprimido / 1e3).toFixed(0)} KB comprimido; sistema/contadores al día`);
  const r = await generarInstantanea(db, cubo);
  console.log(`Instantánea (versión 2): ${(r.bytesComprimido / 1e6).toFixed(2)} MB comprimida`);
}
