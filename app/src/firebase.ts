// Conexión con Firebase: con los emuladores (proyecto «demo-…», que no
// existe en la nube) o con el proyecto real, según el destino con que se
// arranca o se compila la web (app/vite.config.ts; docs/puesta-en-marcha.md).
// En producción no se conecta ningún emulador; con los emuladores, nunca el
// proyecto real.

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectAuthEmulator, getAuth, signOut } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore/lite";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { connectStorageEmulator, getBlob, getBytes, getMetadata, getStorage, ref, uploadBytesResumable } from "firebase/storage";
import { CARPETA_MINIATURAS, rutaApartada, rutaSubida } from "../../comun/fotos.ts";
import { DEPOSITO_PRUEBAS, PROYECTO_PRUEBAS } from "../../comun/proyectos.ts";
import { REGION_FUNCIONES } from "../../comun/regiones.ts";
import { CLAVE_RECAPTCHA, CONFIG_PRODUCCION } from "./configuracion";
import { idioma } from "./i18n";

const EMULADORES = __DESTINO__ === "pruebas";

// Puertos de firebase.json. Se pueden cambiar con variables de entorno de
// Vite para usar otro juego de emuladores (p. ej. firebase.pruebas.json).
const PUERTOS = {
  auth: Number(import.meta.env.VITE_PUERTO_AUTH ?? 9099),
  firestore: Number(import.meta.env.VITE_PUERTO_FIRESTORE ?? 8080),
  storage: Number(import.meta.env.VITE_PUERTO_STORAGE ?? 9199),
  funciones: Number(import.meta.env.VITE_PUERTO_FUNCIONES ?? 5001),
};

const app = initializeApp(EMULADORES
  ? { projectId: PROYECTO_PRUEBAS, apiKey: "demo", authDomain: `${PROYECTO_PRUEBAS}.firebaseapp.com`, storageBucket: DEPOSITO_PRUEBAS }
  : CONFIG_PRODUCCION);

// App Check (D5; docs/puesta-en-marcha.md, «App Check»): en producción, con
// reCAPTCHA Enterprise, cada petición a Firestore, Storage y la función
// lleva un permiso que demuestra que viene de esta web (se renueva solo; dura
// lo que se configure en la consola: 12 horas). Con los emuladores no hace
// falta: no lo exigen. La web compilada servida en este ordenador
// (localhost) usa el proveedor de depuración: imprime en la consola del
// navegador un token que se registra en la consola de Firebase.
if (!EMULADORES && CLAVE_RECAPTCHA) {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(CLAVE_RECAPTCHA), isTokenAutoRefreshEnabled: true });
}

export const auth = getAuth(app);
// Idioma de los correos que envía Firebase Auth y de su ventana de Google.
auth.languageCode = idioma().codigo;
// Solo para leer la invitación propia: la versión ligera, sin tiempo real.
export const db = getFirestore(app);
const storage = getStorage(app);
// La función del servidor que guarda los cambios (docs/edicion.md).
const funciones = getFunctions(app, REGION_FUNCIONES);

if (EMULADORES) {
  // El emulador de Auth, con el mismo nombre que la página (localhost o
  // 127.0.0.1). La ventana de «Entrar con Google» del emulador devuelve el
  // resultado a un iframe del emulador dentro de la página; si la página y
  // el emulador son de sitios distintos, ese iframe queda como de terceros
  // y la ventana puede no encontrarlo («No matching frame»).
  const maquina = location.hostname === "localhost" ? "localhost" : "127.0.0.1";
  connectAuthEmulator(auth, `http://${maquina}:${PUERTOS.auth}`);
  connectFirestoreEmulator(db, "127.0.0.1", PUERTOS.firestore);
  connectStorageEmulator(storage, "127.0.0.1", PUERTOS.storage);
  connectFunctionsEmulator(funciones, "127.0.0.1", PUERTOS.funciones);
}

/** Llama a la función «arbol» del servidor con una acción. */
export async function llamarArbol<T>(accion: string, datos: Record<string, unknown> = {}): Promise<T> {
  const r = await httpsCallable<unknown, T>(funciones, "arbol")({ accion, ...datos });
  return r.data;
}

/** Despierta la función del servidor (arranque en frío, DA-26 a): se llama
 * al abrir un formulario, para que el «Guardar» no espere. Si falla, da
 * igual. */
export function calentarServidor(): void {
  llamarArbol("calentar").catch(() => {});
}

/** Cierra la sesión. */
export const salir = () => signOut(auth);

/** Ruta en Storage de la instantánea (firestore/instantanea.ts). */
const RUTA_INSTANTANEA = "instantanea/arbol.json.gz";

/** Secuencia (último cambio incluido) y fecha de la instantánea que hay
 * ahora en Storage, sin descargarla: para avisar de que hay datos nuevos. */
export async function estadoInstantanea(): Promise<{ secuencia: number; generada: string }> {
  const m = await getMetadata(ref(storage, RUTA_INSTANTANEA));
  return { secuencia: Number(m.customMetadata?.secuencia ?? 0), generada: m.customMetadata?.generada ?? "" };
}

/** Descarga la instantánea comprimida y la descomprime. */
export async function descargarInstantanea(): Promise<unknown> {
  const comprimida = await getBytes(ref(storage, RUTA_INSTANTANEA));
  const flujo = new Blob([comprimida]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(flujo).json();
}

const fotos = new Map<string, Promise<string | null>>();

/** Dirección local (blob:) de un fichero de Storage, o null si no está.
 * Cada fichero se descarga una sola vez por sesión. Si falla por otra cosa
 * (la conexión, algo pasajero), se quita del mapa para que la próxima vez
 * se vuelva a intentar (revisión del 02/11/2026, C4); solo si sigue siendo
 * la misma promesa, para no quitar la de una foto recién subida
 * (fotoLocal). */
function urlFichero(ruta: string): Promise<string | null> {
  let url = fotos.get(ruta);
  if (!url) {
    const esta: Promise<string | null> = getBlob(ref(storage, ruta))
      .then((blob) => URL.createObjectURL(blob))
      .catch((e: unknown) => {
        if ((e as { code?: string }).code !== "storage/object-not-found" && fotos.get(ruta) === esta) fotos.delete(ruta);
        return null;
      });
    url = esta;
    fotos.set(ruta, url);
  }
  return url;
}

/** Dirección local de una foto: la copia pequeña (miniaturas, árbol, PDF)
 * o la grande (el visor). Todas las imágenes tienen copia pequeña: las
 * subidas desde la web la traen y las de Gramps se hacen al cargar
 * (`npm run miniaturas`); si falta, la grande. Null si no está en Storage. */
export async function urlMultimedia(handle: string, copia: "pequena" | "grande" = "pequena"): Promise<string | null> {
  if (copia === "pequena") {
    const pequena = await urlFichero(`${CARPETA_MINIATURAS}${handle}`);
    if (pequena) return pequena;
  }
  return urlFichero(`multimedia/${handle}`);
}

/** Una foto recién subida, ya en el navegador: así se ve sin descargarla
 * (antes de guardar y después). */
export function fotoLocal(handle: string, urlGrande: string, urlPequena: string) {
  fotos.set(`multimedia/${handle}`, Promise.resolve(urlGrande));
  fotos.set(`${CARPETA_MINIATURAS}${handle}`, Promise.resolve(urlPequena));
}

/** Una copia de una foto apartada con una solicitud (la lee solo el
 * administrador, para «Modificar y aplicar», paso 14). */
export const descargarApartada = (correo: string, id: string, copia: "grande" | "pequena") => getBlob(ref(storage, rutaApartada(correo, id, copia)));

/** Sube las dos copias de una foto a la carpeta de paso (comun/fotos.ts).
 * `alProgreso`, de 0 a 1. */
export async function subirFoto(correo: string, id: string, grande: Blob, pequena: Blob, alProgreso: (p: number) => void) {
  const total = grande.size + pequena.size;
  const hecho = { grande: 0, pequena: 0 };
  await Promise.all((["grande", "pequena"] as const).map((copia) => new Promise<void>((ok, mal) => {
    const blob = copia === "grande" ? grande : pequena;
    const tarea = uploadBytesResumable(ref(storage, rutaSubida(correo, id, copia)), blob, { contentType: blob.type });
    tarea.on("state_changed", (e) => {
      hecho[copia] = e.bytesTransferred;
      alProgreso((hecho.grande + hecho.pequena) / total);
    }, mal, () => ok());
  })));
}

/** Libera las fotos descargadas (al salir). */
export function olvidarMultimedia() {
  for (const url of fotos.values()) url.then((u) => u && URL.revokeObjectURL(u));
  fotos.clear();
}
