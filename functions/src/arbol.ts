/**
 * Lectura del árbol completo de Firestore, con el mismo formato que genera
 * migracion/exportar_json.py (version_formato 1). La usan la instantánea
 * (aquí, en las funciones) y firestore/descargar.ts.
 */
import type { Firestore } from "firebase-admin/firestore";
import { deFirestore, TIPOS, type ObjetoGramps } from "../../comun/gramps.ts";

export const VERSION_FORMATO = 1;

/** Documento con los datos de cabecera del JSON (origen, versión…). */
export const METADATOS = { coleccion: "metadatos", documento: "arbol" };

export interface ArbolJson {
  version_formato: number;
  generado: string;
  origen: string;
  version_gramps: string;
  /** Carpeta de este PC de la que cuelgan las rutas de las fotos: solo en el
   * JSON (para subirlas), nunca en Firestore; leído de Firestore, vacío. */
  base_multimedia: string;
  /** Handle de la persona de inicio de Gramps (null si no hay). Los JSON
   * anteriores al 21/10/2026 no lo traen. */
  persona_inicio?: string | null;
  objetos: Record<string, ObjetoGramps[]>;
}

/** Lee el árbol completo de Firestore. */
export async function leerArbolFirestore(db: Firestore, avisar: (texto: string) => void = () => {}): Promise<ArbolJson> {
  const cab = await db.collection(METADATOS.coleccion).doc(METADATOS.documento).get();
  if (!cab.exists) throw new Error("Firestore está vacío: no hay metadatos/arbol");
  // base_multimedia: solo en las cargas anteriores al 30/10/2026.
  const { version_formato, generado, origen, version_gramps, base_multimedia = "", persona_inicio } = cab.data()!;
  if (version_formato !== VERSION_FORMATO) {
    throw new Error(`Formato no reconocido en Firestore: ${version_formato}`);
  }

  const objetos: Record<string, ObjetoGramps[]> = {};
  for (const tipo of TIPOS) {
    const docs = await db.collection(tipo).orderBy("__name__").get();
    objetos[tipo] = docs.docs.map((d) => deFirestore(d.data()) as ObjetoGramps);
    avisar(`  ${tipo.padEnd(12)}${String(docs.size).padStart(7)}`);
  }
  // persona_inicio solo existe en los JSON generados desde el 21/10/2026;
  // si no está en Firestore, tampoco se añade al reconstruirlo.
  return {
    version_formato, generado, origen, version_gramps, base_multimedia,
    ...(persona_inicio !== undefined && { persona_inicio }),
    objetos,
  };
}
