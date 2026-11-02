/**
 * Restaurar una copia de Firestore (decisión de Carlos del 31/10/2026, A;
 * docs/puesta-en-marcha.md, «Restaurar una copia»).
 *
 * Las copias gestionadas de Firestore se restauran siempre en una base de
 * datos nueva (`gcloud firestore databases restore … --destination-database=restauracion`),
 * y la web y las funciones usan `(default)`. Este programa sustituye todo
 * el contenido de `(default)` por el de la base restaurada: borra todas sus
 * colecciones (también las que la copia no tenga) y copia, documento a
 * documento, todas las de la restaurada (con sus subcolecciones, si las
 * hubiera). Después regenera la instantánea y avisa de las fotos de la
 * copia que ya no están en Storage (las copias de Firestore no guardan los
 * ficheros: se recuperan de la copia en Google Drive, apartado 8 bis).
 *
 * No toca la base restaurada (se borra después, a mano) ni Storage, salvo
 * la instantánea.
 *
 * Uso: node firestore/restaurar.ts <base restaurada> [--produccion]
 *   En el proyecto real pide escribir su identificador (elegirDestino) y,
 *   después de mostrar qué se sustituye, «SUSTITUIR TODO».
 */
import { getApps } from "firebase-admin/app";
import { getFirestore, type CollectionReference, type Firestore } from "firebase-admin/firestore";
import { CARPETA_MULTIMEDIA, confirmar, conectar, elegirDestino, enProduccion } from "./comun.ts";
import { RUTA_INSTANTANEA, generarInstantanea } from "./instantanea.ts";

type Cubo = ReturnType<typeof conectar>["cubo"];

/** Documentos de cada colección raíz (contando los de sus subcolecciones). */
async function contar(db: Firestore): Promise<Record<string, number>> {
  const salida: Record<string, number> = {};
  for (const c of await db.listCollections()) salida[c.id] = (await c.count().get()).data().count;
  return salida;
}

/** Copia una colección (y sus subcolecciones) de una base a otra. */
async function copiarColeccion(origen: CollectionReference, destino: CollectionReference, escritor: ReturnType<Firestore["bulkWriter"]>): Promise<number> {
  let n = 0;
  const refs = await origen.listDocuments();
  for (let i = 0; i < refs.length; i += 300) {
    const docs = await origen.firestore.getAll(...refs.slice(i, i + 300));
    for (const d of docs) {
      if (d.exists) {
        escritor.set(destino.doc(d.id), d.data()!);
        n++;
      }
      for (const sub of await d.ref.listCollections()) n += await copiarColeccion(sub, destino.doc(d.id).collection(sub.id), escritor);
    }
  }
  return n;
}

export interface Restauracion {
  /** Documentos copiados de cada colección. */
  copiados: Record<string, number>;
  /** Colecciones de `(default)` que la copia no tenía (se han vaciado). */
  sobrantes: string[];
  /** Fotos (Media) de la copia sin su fichero en Storage: ID, ruta y
   * nombre en Storage. */
  fotosSinFichero: string[];
}

/** Sustituye todo `destino` por `origen` y regenera la instantánea. */
export async function restaurar(destino: Firestore, origen: Firestore, cubo: Cubo): Promise<Restauracion> {
  const colecciones = await origen.listCollections();
  if (!colecciones.length) throw new Error("La base restaurada está vacía (o no existe): no se toca nada");
  const nombres = new Set(colecciones.map((c) => c.id));
  const actuales = await destino.listCollections();
  for (const c of actuales) await destino.recursiveDelete(c);
  const escritor = destino.bulkWriter();
  const copiados: Record<string, number> = {};
  for (const c of colecciones) copiados[c.id] = await copiarColeccion(c, destino.collection(c.id), escritor);
  await escritor.close();

  await generarInstantanea(destino, cubo);

  const fotosSinFichero: string[] = [];
  for (const d of (await destino.collection("Media").get()).docs) {
    const [existe] = await cubo.file(`${CARPETA_MULTIMEDIA}${d.id}`).exists();
    if (!existe) fotosSinFichero.push(`${d.get("gramps_id")} ${d.get("path")} (${CARPETA_MULTIMEDIA}${d.id})`);
  }
  return { copiados, sobrantes: actuales.map((c) => c.id).filter((c) => !nombres.has(c)), fotosSinFichero };
}

if (import.meta.main) {
  const args = await elegirDestino();
  const [nombre] = args.filter((a) => !a.startsWith("--"));
  if (!nombre || nombre === "(default)" || args.length !== 1) {
    console.error("Uso: node firestore/restaurar.ts <base restaurada> [--produccion]");
    process.exit(2);
  }
  try {
    const { db, cubo } = conectar();
    const origen = getFirestore(getApps()[0], nombre);
    const enCopia = await contar(origen);
    if (!Object.keys(enCopia).length) throw new Error(`La base «${nombre}» está vacía o no existe`);
    const ahora = await contar(db);
    console.log(`\n${enProduccion() ? "Proyecto REAL" : "Emuladores"}: se sustituye TODO el contenido de «(default)» por el de «${nombre}».`);
    console.log("Lo que se pierda desde la fecha de la copia (cambios, solicitudes, invitaciones…) no se puede recuperar.");
    console.log("Que nadie edite en la web mientras tanto.\n");
    console.log(`${"Colección".padEnd(20)}${"ahora".padStart(8)}${"copia".padStart(8)}`);
    for (const c of [...new Set([...Object.keys(ahora), ...Object.keys(enCopia)])].sort()) {
      console.log(`${c.padEnd(20)}${String(ahora[c] ?? 0).padStart(8)}${String(enCopia[c] ?? 0).padStart(8)}`);
    }
    if (enProduccion()) await confirmar("\nPara sustituirlo todo, escribe SUSTITUIR TODO: ", "SUSTITUIR TODO");
    const r = await restaurar(db, origen, cubo);
    console.log(`\nHecho: ${Object.values(r.copiados).reduce((a, b) => a + b, 0)} documentos copiados; instantánea regenerada (${RUTA_INSTANTANEA}).`);
    if (r.sobrantes.length) console.log(`Colecciones que la copia no tenía (vaciadas): ${r.sobrantes.join(", ")}`);
    if (r.fotosSinFichero.length) {
      console.log(`AVISO: ${r.fotosSinFichero.length} fotos de la copia ya no tienen su fichero en Storage; recupéralas de la copia de Drive:`);
      for (const f of r.fotosSinFichero) console.log(`  ${f}`);
    }
    console.log(`Cuando lo hayas comprobado, borra la base restaurada: gcloud firestore databases delete --database=${nombre}${enProduccion() ? " --project=arbol-freswer" : ""}`);
  } catch (e) {
    console.error(`\nError: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  process.exit(0);
}
