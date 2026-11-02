/**
 * Carga el JSON de la web (migracion/exportar_json.py) en Firestore y
 * Storage.
 *
 * En los emuladores (`cargar`), sustituye por completo lo que hubiera:
 * vacía antes las colecciones de Gramps, las de la edición (registro,
 * solicitudes, datosWeb, sistema, límites) y las carpetas multimedia, del
 * registro y de las fotos subidas desde la web (miniaturas, carpeta de paso
 * y fotos de las solicitudes). Hace las copias pequeñas de las fotos
 * (miniaturas.ts). Al terminar, genera el índice de relaciones y los
 * contadores (sistema/indice, sistema/contadores) y la instantánea del
 * árbol.
 *
 * En el proyecto real (`recargar`, con «--produccion»; docs/puesta-en-marcha.md,
 * «Carga en producción»): sustituye el árbol y sus fotos, pero nunca vacía
 * el registro ni las solicitudes, y queda como una entrada más del registro
 * (DA-12; origen «carga», con el recuento de fichas, sin el antes y el
 * después). Su autor es quien la lanza (Carlos, 29/10/2026, opción b): el
 * correo de la cuenta de Google con que se identifica el programa, que debe
 * tener invitación activa de administrador, y su persona, como en cualquier
 * cambio del administrador. Las secuencias siguen, y los cambios anteriores
 * a la carga ya no se pueden revertir (reversion.ts). Única excepción (Carlos, 29/10/2026):
 * antes del corte, una sola vez y con doble confirmación
 * («--vaciar-pruebas»), se vacía lo de las pruebas: registro, solicitudes,
 * datosWeb, límites y sus carpetas de Storage.
 *
 * Uso: node firestore/cargar.ts datos/salida/arbol.json
 *      node firestore/cargar.ts datos/salida/arbol.json --produccion [--vaciar-pruebas]
 */
import path from "node:path";
import { applicationDefault } from "firebase-admin/app";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  CARPETA_MULTIMEDIA, METADATOS, TIPOS, aFirestore, confirmar, conReintentos, conectar, elegirDestino, enProduccion, leerArbol,
  preguntar, type ArbolJson,
} from "./comun.ts";
import { COLECCION_INVITACIONES, normalizarCorreo } from "./invitaciones.ts";
import { CARPETA_MINIATURAS, CARPETA_SOLICITUDES, CARPETA_SUBIDAS } from "../comun/fotos.ts";
import { Indice } from "../comun/indice.ts";
import { unirTipos } from "../comun/tipos.ts";
import { subirMultimedia } from "./subir_multimedia.ts";
import { mostrarMiniaturas } from "./miniaturas.ts";
import { RUTA_INSTANTANEA, generarInstantanea } from "./instantanea.ts";
import {
  contadoresIniciales, documentoIndice, generarSistema, RUTA_CONTADORES, RUTA_INDICE, type Contadores,
} from "../functions/src/sistema.ts";
import { idCambio } from "../functions/src/transaccion.ts";

/** Colecciones de la edición (docs/edicion.md), que también se vacían. */
const COLECCIONES_EDICION = ["cambios", "solicitudes", "datosWeb", "sistema", "limites"];

/** Lo que se vacía, una sola vez, de las pruebas en el proyecto real. */
const COLECCIONES_PRUEBAS = ["cambios", "solicitudes", "datosWeb", "limites"];
const CARPETAS_PRUEBAS = ["registro/", CARPETA_SOLICITUDES, CARPETA_SUBIDAS];

type Conexion = ReturnType<typeof conectar>;

export async function cargar(rutaJson: string) {
  const { db, cubo } = conectar();
  const arbol = leerArbol(rutaJson);

  console.log("Vaciando Firestore y Storage…");
  for (const coleccion of [...TIPOS, METADATOS.coleccion, ...COLECCIONES_EDICION]) {
    await db.recursiveDelete(db.collection(coleccion));
  }
  await conReintentos(() => cubo.deleteFiles({ prefix: "registro/" }));
  for (const carpeta of [CARPETA_SUBIDAS, CARPETA_SOLICITUDES]) await conReintentos(() => cubo.deleteFiles({ prefix: carpeta }));
  await sustituirArbol({ db, cubo }, arbol);

  console.log("Generando el índice de relaciones y los contadores…");
  const s = await generarSistema(db, arbol.objetos);
  console.log(`  sistema/indice: ${(s.bytesJson / 1e6).toFixed(2)} MB de JSON, ${(s.bytesComprimido / 1e3).toFixed(0)} KB comprimido`);

  console.log("Generando la instantánea…");
  const r = await generarInstantanea(db, cubo);
  console.log(`  ${RUTA_INSTANTANEA}: ${(r.bytesComprimido / 1e6).toFixed(2)} MB comprimida`);
}

/** El árbol y sus fotos, en lugar de los que hubiera: las colecciones de
 * Gramps, la cabecera, `multimedia/` y `miniaturas/`. */
async function sustituirArbol({ db, cubo }: Pick<Conexion, "db" | "cubo">, arbol: ArbolJson) {
  console.log("Sustituyendo el árbol…");
  for (const coleccion of [...TIPOS, METADATOS.coleccion]) await db.recursiveDelete(db.collection(coleccion));
  for (const carpeta of [CARPETA_MULTIMEDIA, CARPETA_MINIATURAS]) await conReintentos(() => cubo.deleteFiles({ prefix: carpeta }));

  const escritor = db.bulkWriter();
  for (const tipo of TIPOS) {
    const lista = arbol.objetos[tipo] ?? [];
    for (const obj of lista) {
      if (!obj.handle) throw new Error(`${tipo} sin handle: ${JSON.stringify(obj).slice(0, 200)}`);
      escritor.set(db.collection(tipo).doc(obj.handle), aFirestore(obj) as object);
    }
    console.log(`  ${tipo.padEnd(12)}${String(lista.length).padStart(7)}`);
  }
  // Sin base_multimedia: es una carpeta de este PC, que solo sirve aquí para
  // encontrar los ficheros (decisión del 30/10/2026: nada de rutas del PC en
  // la web).
  const { objetos: _, base_multimedia: __, ...cabecera } = arbol;
  escritor.set(db.collection(METADATOS.coleccion).doc(METADATOS.documento), cabecera);
  await escritor.close();

  await subirMultimedia(cubo, arbol);
  await mostrarMiniaturas(cubo, { todas: true });
}

/** El autor de una carga: el administrador con ese correo (invitación
 * activa), con su persona, como en los cambios hechos desde la web. */
export async function autorCarga(db: Firestore, correo: string) {
  const c = normalizarCorreo(correo);
  const inv = (await db.collection(COLECCION_INVITACIONES).doc(c).get()).data();
  if (inv?.estado !== "activa" || inv.rol !== "administrador") {
    throw new Error(`${c} no tiene invitación activa de administrador: solo un administrador puede cargar el árbol`);
  }
  return { correo: c, persona: (inv.persona as string | undefined) ?? null, rol: "administrador" as const };
}

/** El correo de la cuenta de Google con que se identifica el programa
 * (`gcloud auth application-default login` pide permiso para verlo); si no
 * se puede saber, se pregunta. */
export async function correoDeLaCuenta(): Promise<string> {
  try {
    const { access_token } = await applicationDefault().getAccessToken();
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`);
    const correo = r.ok ? ((await r.json()) as { email?: string }).email : undefined;
    if (correo) {
      console.log(`Cuenta de Google: ${correo}`);
      return correo;
    }
  } catch {
    // Se pregunta.
  }
  return preguntar("No se sabe con qué cuenta de Google se identifica el programa. Escribe tu correo de administrador: ");
}

/** La carga en el proyecto real (ver la cabecera). `autor`: el correo de
 * quien la lanza, que debe ser administrador. Devuelve el número de la
 * entrada del registro. La usan `npm run cargar -- … --produccion` y las
 * pruebas del servidor (contra los emuladores). */
export async function recargar(
  conexion: Pick<Conexion, "db" | "cubo">, arbol: ArbolJson,
  { autor: correo, vaciarPruebas = false, fichero = "", ahora = new Date() }: { autor: string; vaciarPruebas?: boolean; fichero?: string; ahora?: Date },
): Promise<string> {
  const { db, cubo } = conexion;
  const autor = await autorCarga(db, correo);
  const antes = (await db.doc(RUTA_CONTADORES).get()).data() as Contadores | undefined;
  if (vaciarPruebas) {
    if (antes?.pruebasVaciadas) throw new Error(`Lo de las pruebas ya se vació el ${antes.pruebasVaciadas}: solo se hace una vez`);
    console.log("Vaciando lo de las pruebas (registro, solicitudes, datosWeb, límites)…");
    for (const coleccion of COLECCIONES_PRUEBAS) await db.recursiveDelete(db.collection(coleccion));
    for (const carpeta of CARPETAS_PRUEBAS) await conReintentos(() => cubo.deleteFiles({ prefix: carpeta }));
  }
  await sustituirArbol(conexion, arbol);

  // Índice, contadores y la entrada del registro, juntos; las secuencias
  // siguen donde iban.
  console.log("Índice de relaciones, contadores y registro…");
  const secuencia = (antes?.secuenciaCambios ?? 0) + 1;
  const iniciales = contadoresIniciales(arbol.objetos);
  const pruebasVaciadas = vaciarPruebas ? ahora.toISOString() : antes?.pruebasVaciadas;
  const contadores: Contadores = {
    ...iniciales,
    secuenciaCambios: secuencia,
    secuenciaSolicitudes: antes?.secuenciaSolicitudes ?? 0,
    tiposPropios: unirTipos(antes?.tiposPropios ?? {}, iniciales.tiposPropios ?? {}),
    ultimaCarga: secuencia,
    ...(pruebasVaciadas && { pruebasVaciadas }),
  };
  const fichas = Object.fromEntries(TIPOS.map((t) => [t, (arbol.objetos[t] ?? []).length]).filter(([, n]) => n));
  const id = idCambio(secuencia);
  const lote = db.batch();
  lote.set(db.doc(RUTA_INDICE), documentoIndice(Indice.desdeObjetos(arbol.objetos, secuencia)));
  lote.set(db.doc(RUTA_CONTADORES), contadores);
  lote.set(db.doc(`cambios/${id}`), {
    secuencia,
    fecha: Timestamp.fromDate(ahora),
    autor,
    origen: "carga",
    accion: "cargar",
    principal: null,
    motivo: null,
    objetos: [],
    claves: [],
    estado: "aceptado",
    revision: null,
    revertidoPor: null,
    revierte: null,
    corrige: null,
    corregidoPor: [],
    solicitud: null,
    aplicadoPor: null,
    fuera: null,
    carga: { fichero, fichas, versionGramps: arbol.version_gramps ?? null, pruebasVaciadas: vaciarPruebas },
  });
  await lote.commit();

  console.log("Generando la instantánea…");
  const r = await generarInstantanea(db, cubo);
  console.log(`  ${RUTA_INSTANTANEA}: ${(r.bytesComprimido / 1e6).toFixed(2)} MB comprimida`);
  return id;
}

if (import.meta.main) {
  const args = await elegirDestino();
  const vaciarPruebas = args.includes("--vaciar-pruebas");
  const [ruta] = args.filter((a) => !a.startsWith("--"));
  if (!ruta) {
    console.error("Uso: node firestore/cargar.ts <arbol.json> [--produccion [--vaciar-pruebas]]");
    process.exit(2);
  }
  if (!enProduccion()) {
    if (vaciarPruebas) {
      console.error("«--vaciar-pruebas» es solo para el proyecto real (con «--produccion»).");
      process.exit(2);
    }
    await cargar(ruta);
  } else {
    const arbol = leerArbol(ruta);
    console.log(`\nSe sustituye el árbol entero (${(arbol.objetos.Person ?? []).length} personas) y sus fotos por los de ${ruta}.`);
    console.log("El registro de cambios y las solicitudes se conservan; la carga queda como una entrada más.");
    if (vaciarPruebas) {
      console.log("\nADEMÁS se vacía, para siempre, lo de las pruebas: el registro de cambios, las solicitudes,");
      console.log("datosWeb y los límites, con sus carpetas de Storage. Solo se puede hacer una vez, antes del corte.");
      await confirmar("Para vaciarlo, escribe VACIAR LAS PRUEBAS: ", "VACIAR LAS PRUEBAS");
    }
    const conexion = conectar();
    // Quién la lanza, antes de tocar nada.
    const correo = await correoDeLaCuenta();
    try {
      await autorCarga(conexion.db, correo);
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
    const id = await recargar(conexion, arbol, { autor: correo, vaciarPruebas, fichero: path.basename(ruta) });
    console.log(`Hecho: entrada ${id} del registro.`);
  }
  process.exit(0);
}
