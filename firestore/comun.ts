/**
 * Piezas comunes de los programas de carga y descarga de Firestore.
 *
 * Trabajan contra los emuladores (proyecto «demo-…»). Los que lo admiten
 * (carga, invitaciones, descarga, instantánea, copias pequeñas, rutas,
 * migración de los usuarios de Supabase) trabajan con
 * el proyecto real si se les pasa «--produccion»: piden escribir su
 * identificador para seguir (`elegirDestino`) y usan las credenciales de la
 * cuenta de Google del ordenador (`gcloud auth application-default login`),
 * nunca un fichero de claves (docs/puesta-en-marcha.md). Sin «--produccion»,
 * un proyecto que no empiece por «demo-» se rechaza.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { applicationDefault, initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";

// Tipos de Gramps y conversión de listas anidadas: compartidos con la web
// y las funciones del servidor (comun/gramps.ts).
export { TIPOS, aFirestore, deFirestore, type ObjetoGramps } from "../comun/gramps.ts";
import type { ObjetoGramps } from "../comun/gramps.ts";
// Formato del JSON de la web y lectura del árbol: compartidos con las
// funciones del servidor (functions/src/arbol.ts).
export { METADATOS, VERSION_FORMATO, type ArbolJson } from "../functions/src/arbol.ts";
import { VERSION_FORMATO, type ArbolJson } from "../functions/src/arbol.ts";
import { DEPOSITO_PRODUCCION, PROYECTO_PRODUCCION } from "../comun/proyectos.ts";

/** Carpeta de Storage para los ficheros multimedia: multimedia/{handle}. */
export const CARPETA_MULTIMEDIA = "multimedia/";

const RAIZ = new URL("../", import.meta.url);

function proyecto(): string {
  const rc = JSON.parse(readFileSync(new URL(".firebaserc", RAIZ), "utf8"));
  return process.env.GCLOUD_PROJECT ?? rc.projects.default;
}

const VARIABLES_EMULADORES = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"];

/** Si este programa trabaja con el proyecto real (lo decide elegirDestino). */
let produccion = false;
export const enProduccion = () => produccion;

/** Pregunta en la consola y devuelve la respuesta. */
export async function preguntar(pregunta: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = (await rl.question(pregunta)).trim();
  rl.close();
  return respuesta;
}

/** Pregunta en la consola y sigue solo si se escribe exactamente `esperado`;
 * si no, termina el programa sin hacer nada. */
export async function confirmar(pregunta: string, esperado: string): Promise<void> {
  if ((await preguntar(pregunta)) !== esperado) {
    console.error("No coincide: no se hace nada.");
    process.exit(1);
  }
}

/** Para los programas que pueden trabajar con el proyecto real: con
 * «--produccion» entre los argumentos, avisa, pide escribir el
 * identificador del proyecto y, si coincide, conectar() irá a producción.
 * Devuelve los argumentos sin «--produccion». Con los emuladores de prueba
 * arrancados para este programa (sus variables definidas), se niega. */
export async function elegirDestino(args = process.argv.slice(2)): Promise<string[]> {
  if (!args.includes("--produccion")) return args;
  const emuladores = VARIABLES_EMULADORES.filter((v) => process.env[v]);
  if (emuladores.length) throw new Error(`«--produccion» con emuladores (${emuladores.join(", ")}): no se mezclan`);
  console.log(`\nVas a trabajar con el proyecto REAL de Firebase: «${PROYECTO_PRODUCCION}» (depósito ${DEPOSITO_PRODUCCION}).`);
  await confirmar(`Para seguir, escribe su identificador (${PROYECTO_PRODUCCION}): `, PROYECTO_PRODUCCION);
  produccion = true;
  return args.filter((a) => a !== "--produccion");
}

/** Conecta con los emuladores o, tras elegirDestino con «--produccion», con
 * el proyecto real. Con los emuladores, si no se han definido las variables
 * de entorno (por ejemplo, con los emuladores arrancados en otra ventana),
 * usa los puertos de firebase.json. */
export function conectar() {
  if (produccion) return conectarProduccion();
  if (process.argv.includes("--produccion")) throw new Error("Este programa no trabaja con el proyecto real (o le falta elegirDestino)");
  const id = proyecto();
  if (!id.startsWith("demo-")) {
    throw new Error(`Proyecto «${id}»: estos programas solo trabajan con emuladores (demo-…)`);
  }
  const emu = JSON.parse(readFileSync(new URL("firebase.json", RAIZ), "utf8")).emulators;
  process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${emu.firestore.port}`;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= `127.0.0.1:${emu.storage.port}`;
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${emu.auth.port}`;
  const app = getApps()[0] ?? initializeApp({ projectId: id, storageBucket: `${id}.appspot.com` });
  return { db: getFirestore(app) as Firestore, cubo: getStorage(app).bucket(), auth: getAuth(app) };
}

/** El proyecto real, con las credenciales de la cuenta de Google del
 * ordenador (Application Default Credentials). Las cuotas de las API se
 * cargan al propio proyecto (si no, irían al de la configuración de gcloud,
 * que puede ser otro). */
function conectarProduccion() {
  for (const v of VARIABLES_EMULADORES) {
    if (process.env[v]) throw new Error(`Proyecto real con ${v} definida: no se mezclan`);
  }
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = PROYECTO_PRODUCCION;
  const app = getApps()[0] ?? initializeApp({ projectId: PROYECTO_PRODUCCION, storageBucket: DEPOSITO_PRODUCCION, credential: applicationDefault() });
  if (app.options.projectId !== PROYECTO_PRODUCCION) throw new Error(`Ya había una conexión con «${app.options.projectId}»`);
  return { db: getFirestore(app) as Firestore, cubo: getStorage(app).bucket(), auth: getAuth(app) };
}

export function leerArbol(ruta: string): ArbolJson {
  const doc = JSON.parse(readFileSync(ruta, "utf8"));
  if (doc.version_formato !== VERSION_FORMATO) {
    throw new Error(`Formato no reconocido en ${ruta}: ${doc.version_formato}`);
  }
  return doc;
}

/** Ruta local del fichero de un objeto Media, como media_path_full de
 * Gramps: las rutas relativas cuelgan de base_multimedia. Devuelve null si
 * es una dirección web, que no se sube. */
export function rutaMultimedia(media: ObjetoGramps, base: string): string | null {
  const ruta = String(media.path ?? "");
  if (/^https?:\/\//.test(ruta)) return null;
  return path.isAbsolute(ruta) ? ruta : path.join(base, ruta);
}

/** Errores de red pasajeros. El emulador de Storage cierra las conexiones
 * que quedan inactivas unos segundos; si el cliente reutiliza una ya
 * cerrada, la petición falla con ECONNRESET aunque el servicio funcione.
 * Pasa en el circuito tras el paso de comparación en Python, que deja la
 * conexión de Storage sin uso un rato. */
const ERRORES_PASAJEROS = new Set(["ECONNRESET", "EPIPE", "ECONNREFUSED", "ETIMEDOUT"]);

/** Ejecuta fn y la repite (con una conexión nueva) si falla por un error
 * de red pasajero. */
export async function conReintentos<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const codigo = (e as { code?: string }).code ?? "";
      if (i >= intentos || !ERRORES_PASAJEROS.has(codigo)) throw e;
      console.log(`  (error de red pasajero ${codigo}; reintento ${i} de ${intentos - 1})`);
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

/** Ejecuta fn sobre todos los elementos, con como mucho n a la vez. */
export async function enParalelo<T>(elementos: T[], n: number, fn: (e: T) => Promise<void>) {
  const cola = [...elementos];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let e = cola.shift(); e !== undefined; e = cola.shift()) await fn(e);
  }));
}
