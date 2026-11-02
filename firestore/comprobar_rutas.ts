/**
 * Comprueba que no queda ninguna ruta del PC en la web (decisión del
 * 30/10/2026): ni rutas absolutas en las fotos de Firestore, de la
 * instantánea ni en los metadatos de Storage (`ruta_gramps`), ni
 * descripciones de foto que sean una ruta, ni carpetas en la cabecera
 * (`metadatos/arbol`). Termina con código 0 si no hay ninguna y 1 si sí.
 *
 * Solo lee. Uso: node firestore/comprobar_rutas.ts [--produccion]
 * (sin «--produccion», con los emuladores en marcha).
 */
import { gunzipSync } from "node:zlib";
import { CARPETA_MULTIMEDIA, METADATOS, conReintentos, conectar, elegirDestino } from "./comun.ts";
import { RUTA_INSTANTANEA } from "./instantanea.ts";
import { sinAvisoDeOyentes } from "../functions/src/oyentes.ts";

/** «C:\…», «C:/…», «/…» o «\…». */
export const esRutaAbsoluta = (s: string) => /^([A-Za-z]:|[\\/])/.test(s);
/** Una descripción que es una ruta. */
const esRuta = (s: string) => s.includes("/") || s.includes("\\");

type Foto = { gramps_id?: string; path?: string; desc?: string };

function revisarFotos(donde: string, fotos: Foto[], errores: string[]) {
  for (const m of fotos) {
    if (m.path && esRutaAbsoluta(m.path)) errores.push(`${donde}: ${m.gramps_id} con ruta absoluta`);
    if (m.desc && esRuta(m.desc)) errores.push(`${donde}: ${m.gramps_id} con una ruta en la descripción`);
  }
}

export async function comprobarRutas(): Promise<boolean> {
  const { db, cubo } = conectar();
  const errores: string[] = [];

  const fotos = (await db.collection("Media").get()).docs.map((d) => d.data() as Foto);
  revisarFotos("Firestore", fotos, errores);
  const cabecera = (await db.collection(METADATOS.coleccion).doc(METADATOS.documento).get()).data() ?? {};
  for (const [k, v] of Object.entries(cabecera)) {
    if (typeof v === "string" && (esRutaAbsoluta(v) || esRuta(v))) errores.push(`metadatos/arbol: «${k}» es una ruta`);
  }

  const [gz] = await sinAvisoDeOyentes(() => conReintentos(() => cubo.file(RUTA_INSTANTANEA).download()));
  const instantanea = JSON.parse(gunzipSync(gz).toString("utf8")) as { objetos: Record<string, Foto[]> };
  revisarFotos("Instantánea", instantanea.objetos.Media ?? [], errores);

  const [ficheros] = await conReintentos(() => cubo.getFiles({ prefix: CARPETA_MULTIMEDIA }));
  for (const f of ficheros) {
    const ruta = String(f.metadata.metadata?.ruta_gramps ?? "");
    if (esRutaAbsoluta(ruta)) errores.push(`Storage: ${f.name} con ruta_gramps absoluta`);
  }

  console.log(`Rutas del PC: ${fotos.length} fotos en Firestore, ${ficheros.length} ficheros en Storage; ` +
    `${errores.length ? `${errores.length} problemas` : "ninguna"}`);
  for (const e of errores.slice(0, 20)) console.log(`  - ${e}`);
  return errores.length === 0;
}

if (import.meta.main) {
  await elegirDestino();
  process.exit((await comprobarRutas()) ? 0 : 1);
}
