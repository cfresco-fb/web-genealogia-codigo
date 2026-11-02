/**
 * Documentos del sistema (docs/edicion.md, «Datos en Firestore»):
 *
 * - sistema/indice: el índice de relaciones (comun/indice.ts) en JSON
 *   comprimido con gzip, en un solo campo de bytes. Como mapa de Firestore
 *   pasaría del máximo de 20.000 campos por documento con un árbol
 *   mediano; comprimido, el del árbol de ejemplo (10.500 objetos) ocupa
 *   unos cientos de KB, lejos del MiB.
 * - sistema/contadores: el número del último cambio y de la última
 *   solicitud, el último número de ID de Gramps usado de cada tipo y los
 *   tipos propios que hay en el árbol (comun/tipos.ts).
 *
 * Los crea la carga (firestore/cargar.ts) y los mantiene la función del
 * servidor en la misma transacción que cada cambio.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { numeroId, PREFIJOS_ID, TIPOS, type ObjetoGramps, type Tipo } from "../../comun/gramps.ts";
import { Indice, type IndiceJson } from "../../comun/indice.ts";
import { tiposPropios, type TiposPropios } from "../../comun/tipos.ts";

export const RUTA_INDICE = "sistema/indice";
export const RUTA_CONTADORES = "sistema/contadores";

export interface Contadores {
  secuenciaCambios: number;
  secuenciaSolicitudes: number;
  /** Último número de ID usado por tipo («Person: 554» → el siguiente,
   * I0555). */
  ids: Partial<Record<Tipo, number>>;
  /** Tipos propios conocidos: los del árbol y los que ha añadido el
   * administrador (solo crece). Falta en los árboles cargados antes del
   * 25/10/2026 hasta pasar npm run sistema. */
  tiposPropios?: TiposPropios;
  /** Secuencia de la última carga en el proyecto real (firestore/cargar.ts):
   * los cambios hasta ella ya no se revierten. */
  ultimaCarga?: number;
  /** Cuándo se vació lo de las pruebas en el proyecto real (una sola vez). */
  pruebasVaciadas?: string;
}

/** El documento sistema/indice. */
export function documentoIndice(indice: Indice) {
  const j = indice.aJson();
  const json = Buffer.from(JSON.stringify(j), "utf8");
  return { version: j.version, secuencia: j.secuencia, bytesJson: json.length, datos: gzipSync(json, { level: 6 }) };
}

export function leerIndice(doc: DocumentSnapshot): Indice {
  if (!doc.exists) throw new Error(`No existe ${RUTA_INDICE}: hay que cargar el árbol (npm run cargar)`);
  const datos = doc.get("datos") as Buffer | Uint8Array;
  return Indice.desdeJson(JSON.parse(gunzipSync(Buffer.from(datos)).toString("utf8")) as IndiceJson);
}

/** Contadores de un árbol recién cargado: el número de ID más alto de cada
 * tipo con el prefijo de Gramps, y sus tipos propios. */
export function contadoresIniciales(objetos: Partial<Record<Tipo, ObjetoGramps[]>>): Contadores {
  const ids: Partial<Record<Tipo, number>> = {};
  for (const tipo of TIPOS) {
    if (!PREFIJOS_ID[tipo]) continue;
    ids[tipo] = Math.max(0, ...(objetos[tipo] ?? []).map((o) => numeroId(tipo, o.gramps_id) ?? 0));
  }
  return { secuenciaCambios: 0, secuenciaSolicitudes: 0, ids, tiposPropios: tiposPropios(Object.values(objetos).flat()) };
}

/** Escribe el índice y los contadores de un árbol completo (tras la carga). */
export async function generarSistema(db: Firestore, objetos: Partial<Record<Tipo, ObjetoGramps[]>>) {
  const indice = Indice.desdeObjetos(objetos);
  const doc = documentoIndice(indice);
  await db.doc(RUTA_INDICE).set(doc);
  await db.doc(RUTA_CONTADORES).set(contadoresIniciales(objetos));
  return { bytesJson: doc.bytesJson, bytesComprimido: doc.datos.length };
}
