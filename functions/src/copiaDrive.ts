/**
 * Copia nocturna en el Google Drive de Carlos (decisiones del 31/10/2026;
 * docs/puesta-en-marcha.md, apartado 8 bis).
 *
 * Cada noche, en una carpeta que crea la propia web (permiso `drive.file`:
 * no ve el resto del Drive):
 * - las fotos nuevas o cambiadas (los originales, `multimedia/{handle}` de
 *   Storage), con las mismas rutas relativas que en Gramps
 *   («Fotos/50003.jpg»), así que la carpeta sirve de carpeta base de
 *   multimedia para `importar_json.py`. Una foto cambiada actualiza el
 *   mismo fichero (Drive guarda la versión anterior 30 días); las borradas
 *   en la web se quedan en Drive. Lo ya copiado se anota en
 *   `sistema/copiaDrive` (con su MD5): lo que no cambia no se vuelve a
 *   subir, tampoco si el administrador lo ha borrado a mano en Drive (por
 *   un borrado a petición);
 * - el árbol entero, el mismo JSON comprimido de `npm run descargar`
 *   («copias-del-arbol/arbol-AAAA-MM-DD.json.gz»), guardando los 30 últimos.
 *
 * Si falla (por ejemplo, porque caduque la autorización), un correo a los
 * administradores al empezar a fallar y otro al volver a funcionar, no
 * uno cada noche.
 *
 * Nunca dos a la vez (01/11/2026: dos lanzamientos a mano casi simultáneos
 * crearon dos carpetas): un bloqueo en `sistema/copiaDriveBloqueo` con
 * caducidad (por si una copia se corta sin soltarlo), y el estado se guarda
 * en cuanto se crea la carpeta y cada FOTOS_POR_GUARDADO fotos, no solo al
 * final. Las fotos se suben de FOTOS_A_LA_VEZ en FOTOS_A_LA_VEZ.
 *
 * La API de Drive va detrás de la interfaz `Drive`: en la función, la de
 * verdad (`driveReal`, con fetch); en las pruebas, una simulada.
 */
import { gzipSync } from "node:zlib";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Enviar } from "./avisos.ts";
import { leerArbolFirestore } from "./arbol.ts";
import { sinAvisoDeOyentes } from "./oyentes.ts";
import type { Cubo } from "./transaccion.ts";

export const RUTA_ESTADO = "sistema/copiaDrive";
export const RUTA_BLOQUEO = "sistema/copiaDriveBloqueo";
/** Lo que dura el bloqueo: más que el plazo de la función (540 s), así que
 * solo caduca si la copia se ha cortado. */
export const DURACION_BLOQUEO_MS = 10 * 60 * 1000;
export const FOTOS_A_LA_VEZ = 4;
export const FOTOS_POR_GUARDADO = 20;
export const CARPETA_RAIZ = "Árbol Frescó-Werchowsky (copia de la web)";
export const CARPETA_ARBOL = "copias-del-arbol";
export const COPIAS_ARBOL = 30;
const FICHERO_ARBOL = /^arbol-\d{4}-\d{2}-\d{2}\.json\.gz$/;

/** Lo que hace falta de Drive. Los `id` son los de Drive. */
export interface Drive {
  crearCarpeta(nombre: string, padre: string | null): Promise<string>;
  /** Si existe y no está en la papelera. */
  existe(id: string): Promise<boolean>;
  /** El primer fichero o carpeta con ese nombre en esa carpeta. */
  buscar(nombre: string, padre: string): Promise<string | null>;
  subir(nombre: string, padre: string, datos: Buffer, tipo: string): Promise<string>;
  /** Sustituye el contenido (lanza ErrorDrive 404 si ya no existe). */
  actualizar(id: string, datos: Buffer, tipo: string): Promise<void>;
  listar(padre: string): Promise<{ id: string; nombre: string }[]>;
  borrar(id: string): Promise<void>;
}

export class ErrorDrive extends Error {
  readonly estado: number;
  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}

interface FotoCopiada {
  md5: string;
  id: string;
  ruta: string;
}

interface Estado {
  raiz?: string | null;
  arbol?: string | null;
  /** Carpetas de las fotos, por ruta («Fotos», «Fotos/2020»). */
  carpetas?: Record<string, string>;
  fotos?: Record<string, FotoCopiada>;
  fallando?: boolean;
  ultimoError?: string | null;
  ultimaCopia?: Timestamp | null;
}

export interface ResultadoCopia {
  ok: boolean;
  /** Había otra copia en marcha: esta no ha hecho nada. */
  omitida?: boolean;
  fotosNuevas: number;
  fotosCambiadas: number;
  copiasBorradas: number;
  aviso: "fallo" | "recuperada" | null;
  error?: string;
}

const fecha = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** La copia de una noche. No lanza: los fallos se anotan y se avisan. */
export async function copiarADrive(
  db: Firestore, cubo: Cubo, drive: () => Promise<Drive>, enviar: Enviar, ahora = () => new Date(),
): Promise<ResultadoCopia> {
  const r: ResultadoCopia = { ok: false, fotosNuevas: 0, fotosCambiadas: 0, copiasBorradas: 0, aviso: null };
  const bloqueo = await tomarBloqueo(db, ahora());
  if (!bloqueo) return { ...r, omitida: true };
  try {
    return await copiarConBloqueo(db, cubo, drive, enviar, ahora, r);
  } finally {
    await soltarBloqueo(db, bloqueo);
  }
}

/** Toma el bloqueo si no lo tiene nadie o si ha caducado. Devuelve su
 * identificador, o null si hay otra copia en marcha. */
async function tomarBloqueo(db: Firestore, ahora: Date): Promise<string | null> {
  const ref = db.doc(RUTA_BLOQUEO);
  const id = `${ahora.getTime()}-${Math.random().toString(36).slice(2)}`;
  return db.runTransaction(async (tx) => {
    const hasta = (await tx.get(ref)).get("hasta") as Timestamp | undefined;
    if (hasta && hasta.toMillis() > ahora.getTime()) return null;
    tx.set(ref, { id, desde: Timestamp.fromDate(ahora), hasta: Timestamp.fromMillis(ahora.getTime() + DURACION_BLOQUEO_MS) });
    return id;
  });
}

/** Lo suelta solo si sigue siendo suyo (si caducó y lo tomó otra, no). */
async function soltarBloqueo(db: Firestore, id: string) {
  const ref = db.doc(RUTA_BLOQUEO);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).get("id") === id) tx.delete(ref);
  });
}

async function copiarConBloqueo(
  db: Firestore, cubo: Cubo, drive: () => Promise<Drive>, enviar: Enviar, ahora: () => Date, r: ResultadoCopia,
): Promise<ResultadoCopia> {
  const ref = db.doc(RUTA_ESTADO);
  const estado = ((await ref.get()).data() ?? {}) as Estado;
  // Lo copiado hasta ahora, sin tocar el estado de los avisos (eso, al final).
  const guardar = () => ref.set(estado);
  try {
    const d = await drive();
    await copiar(db, cubo, d, estado, r, ahora(), guardar);
    r.ok = true;
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
  }
  // Lo copiado se guarda aunque falle a mitad: la noche siguiente sigue.
  const avisar = r.ok ? estado.fallando === true : estado.fallando !== true;
  let avisado = false;
  if (avisar) {
    try {
      const para = (await db.collection("invitaciones").where("rol", "==", "administrador").where("estado", "==", "activa").get()).docs.map((x) => x.id);
      if (para.length) {
        await enviar(r.ok ? mensajeRecuperada(para) : mensajeFallo(para, r.error!));
        avisado = true;
        r.aviso = r.ok ? "recuperada" : "fallo";
      }
    } catch {
      // Sin correo: se vuelve a intentar avisar la noche siguiente.
    }
  }
  await ref.set({
    ...estado,
    // Solo cambia de estado si se ha podido avisar del cambio.
    fallando: avisar && !avisado ? estado.fallando === true : !r.ok,
    ultimoError: r.ok ? null : r.error,
    ...(r.ok && { ultimaCopia: Timestamp.fromDate(ahora()) }),
  });
  return r;
}

async function copiar(db: Firestore, cubo: Cubo, d: Drive, estado: Estado, r: ResultadoCopia, ahora: Date, guardar: () => Promise<unknown>) {
  // La carpeta de la copia; si ya no está (borrada a mano), se empieza de
  // nuevo. Se guarda en seguida, para no crear otra si esta copia se corta.
  if (!estado.raiz || !(await d.existe(estado.raiz))) {
    estado.raiz = await d.crearCarpeta(CARPETA_RAIZ, null);
    estado.arbol = null;
    estado.carpetas = {};
    estado.fotos = {};
    await guardar();
  }
  const raiz = estado.raiz;
  estado.carpetas ??= {};
  estado.fotos ??= {};

  // ---- Fotos ----
  // Las carpetas, una sola vez aunque las pidan varias fotos a la vez.
  const pendientes = new Map<string, Promise<string>>();
  const carpeta = (ruta: string): Promise<string> => {
    if (!ruta) return Promise.resolve(raiz);
    const ya = estado.carpetas![ruta];
    if (ya) return Promise.resolve(ya);
    let p = pendientes.get(ruta);
    if (!p) {
      p = (async () => {
        const corte = ruta.lastIndexOf("/");
        const padre = await carpeta(corte < 0 ? "" : ruta.slice(0, corte));
        const nombre = ruta.slice(corte + 1);
        const id = (await d.buscar(nombre, padre)) ?? (await d.crearCarpeta(nombre, padre));
        estado.carpetas![ruta] = id;
        return id;
      })();
      pendientes.set(ruta, p);
    }
    return p;
  };
  const [ficheros] = await cubo.getFiles({ prefix: "multimedia/" });
  const md5DeHandle = new Map(ficheros.map((f) => [f.name.slice("multimedia/".length), { f, md5: String(f.metadata.md5Hash ?? "") }]));
  type Foto = { handle: string; ruta: string; mime: unknown; enCubo: { f: (typeof ficheros)[number]; md5: string } };
  const porCopiar: Foto[] = [];
  for (const doc of (await db.collection("Media").get()).docs) {
    const ruta = String(doc.get("path") ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    const enCubo = md5DeHandle.get(doc.id);
    if (!ruta || /^[a-z][a-z0-9+.-]*:\/\//i.test(ruta) || !enCubo) continue;
    const antes = estado.fotos[doc.id];
    if (antes && antes.md5 === enCubo.md5 && antes.ruta === ruta) continue;
    porCopiar.push({ handle: doc.id, ruta, mime: doc.get("mime"), enCubo });
  }
  const copiarFoto = async ({ handle, ruta, mime, enCubo }: Foto) => {
    const antes = estado.fotos![handle];
    const [datos] = await sinAvisoDeOyentes(() => enCubo.f.download());
    const tipo = String(enCubo.f.metadata.contentType ?? mime ?? "application/octet-stream");
    const corte = ruta.lastIndexOf("/");
    const padre = await carpeta(corte < 0 ? "" : ruta.slice(0, corte));
    const nombre = ruta.slice(corte + 1);
    let id: string | null = antes && antes.ruta === ruta ? antes.id : await d.buscar(nombre, padre);
    if (id) {
      try {
        await d.actualizar(id, datos, tipo);
      } catch (e) {
        if (!(e instanceof ErrorDrive && e.estado === 404)) throw e;
        id = null;
      }
    }
    if (!id) id = await d.subir(nombre, padre, datos, tipo);
    if (antes) r.fotosCambiadas++;
    else r.fotosNuevas++;
    estado.fotos![handle] = { md5: enCubo.md5, id, ruta };
  };
  // Por tandas de FOTOS_POR_GUARDADO, cada una con FOTOS_A_LA_VEZ a la vez,
  // y el estado guardado al acabar cada tanda. Si falla una foto, no se
  // empiezan más, las que estaban en marcha terminan y lo hecho se guarda
  // antes de seguir con el error.
  for (let i = 0; i < porCopiar.length; i += FOTOS_POR_GUARDADO) {
    const tanda = porCopiar.slice(i, i + FOTOS_POR_GUARDADO);
    const errores: unknown[] = [];
    let siguiente = 0;
    await Promise.all(Array.from({ length: Math.min(FOTOS_A_LA_VEZ, tanda.length) }, async () => {
      while (siguiente < tanda.length && !errores.length) {
        await copiarFoto(tanda[siguiente++]).catch((e: unknown) => { errores.push(e); });
      }
    }));
    await guardar();
    if (errores.length) throw errores[0];
  }

  // ---- El árbol entero ----
  if (!estado.arbol || !(await d.existe(estado.arbol))) {
    estado.arbol = (await d.buscar(CARPETA_ARBOL, raiz)) ?? (await d.crearCarpeta(CARPETA_ARBOL, raiz));
  }
  const arbol = await leerArbolFirestore(db);
  const datos = gzipSync(Buffer.from(JSON.stringify(arbol, null, 1), "utf8"));
  const nombre = `arbol-${fecha(ahora)}.json.gz`;
  const deHoy = await d.buscar(nombre, estado.arbol);
  if (deHoy) await d.actualizar(deHoy, datos, "application/gzip");
  else await d.subir(nombre, estado.arbol, datos, "application/gzip");
  const copias = (await d.listar(estado.arbol)).filter((f) => FICHERO_ARBOL.test(f.nombre)).sort((a, b) => b.nombre.localeCompare(a.nombre));
  for (const vieja of copias.slice(COPIAS_ARBOL)) {
    await d.borrar(vieja.id);
    r.copiasBorradas++;
  }
}

function mensajeFallo(para: string[], error: string) {
  const autorizacion = /invalid_grant|unauthorized|401|403/i.test(error);
  return {
    para,
    asunto: "Copia en Google Drive: ha fallado",
    texto: [
      "La copia nocturna del árbol y de las fotos en Google Drive ha fallado.",
      "",
      `Error: ${error}`,
      "",
      autorizacion
        ? "Parece que la autorización de Google Drive ha caducado o se ha retirado: hay que volver a autorizarla (docs/puesta-en-marcha.md, apartado 8 bis)."
        : "Se volverá a intentar la noche siguiente. Si sigue fallando, revisa los registros de la función copiaNocturnaDrive.",
      "",
      "No se enviará otro aviso mientras siga fallando; sí cuando vuelva a funcionar.",
    ].join("\n"),
  };
}

function mensajeRecuperada(para: string[]) {
  return {
    para,
    asunto: "Copia en Google Drive: vuelve a funcionar",
    texto: "La copia nocturna del árbol y de las fotos en Google Drive ha vuelto a funcionar.",
  };
}

// ---- La API de Drive de verdad (REST v3, con fetch) ----

const API = "https://www.googleapis.com/drive/v3/files";
const SUBIDA = "https://www.googleapis.com/upload/drive/v3/files";
const CARPETA = "application/vnd.google-apps.folder";

/** El cliente de Drive con el permiso de refresco de Carlos (OAuth,
 * `drive.file`). */
export async function driveReal(clientId: string, clientSecret: string, refresco: string, buscarFetch: typeof fetch = fetch): Promise<Drive> {
  const t = await buscarFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresco, grant_type: "refresh_token" }),
  });
  if (!t.ok) throw new ErrorDrive(t.status, `No se pudo renovar el permiso de Drive: ${t.status} ${await t.text()}`);
  const token = ((await t.json()) as { access_token: string }).access_token;
  const pedir = async (url: string, init: RequestInit = {}) => {
    const r = await buscarFetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
    if (!r.ok) throw new ErrorDrive(r.status, `Drive: ${init.method ?? "GET"} ${url.split("?")[0]}: ${r.status} ${await r.text()}`);
    return r;
  };
  const comillas = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  /** Subida reanudable (cualquier tamaño): metadatos y, después, los datos. */
  const subida = async (url: string, metodo: "POST" | "PATCH", meta: object, datos: Buffer, tipo: string) => {
    const inicio = await pedir(`${url}${url.includes("?") ? "&" : "?"}uploadType=resumable&fields=id`, {
      method: metodo,
      headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": tipo },
      body: JSON.stringify(meta),
    });
    const destino = inicio.headers.get("location");
    if (!destino) throw new ErrorDrive(500, "Drive no ha dado la dirección de la subida");
    const r = await pedir(destino, { method: "PUT", headers: { "content-type": tipo }, body: new Uint8Array(datos) });
    return ((await r.json()) as { id: string }).id;
  };
  return {
    async crearCarpeta(nombre, padre) {
      const r = await pedir(`${API}?fields=id`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ name: nombre, mimeType: CARPETA, ...(padre && { parents: [padre] }) }),
      });
      return ((await r.json()) as { id: string }).id;
    },
    async existe(id) {
      try {
        const r = await pedir(`${API}/${encodeURIComponent(id)}?fields=id,trashed`);
        return !((await r.json()) as { trashed?: boolean }).trashed;
      } catch (e) {
        if (e instanceof ErrorDrive && e.estado === 404) return false;
        throw e;
      }
    },
    async buscar(nombre, padre) {
      const q = `name = '${comillas(nombre)}' and '${comillas(padre)}' in parents and trashed = false`;
      const r = await pedir(`${API}?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`);
      return ((await r.json()) as { files: { id: string }[] }).files[0]?.id ?? null;
    },
    subir: (nombre, padre, datos, tipo) => subida(SUBIDA, "POST", { name: nombre, parents: [padre] }, datos, tipo),
    async actualizar(id, datos, tipo) {
      await subida(`${SUBIDA}/${encodeURIComponent(id)}`, "PATCH", {}, datos, tipo);
    },
    async listar(padre) {
      const salida: { id: string; nombre: string }[] = [];
      let pagina: string | undefined;
      do {
        const q = `'${comillas(padre)}' in parents and trashed = false`;
        const r = await pedir(`${API}?${new URLSearchParams({ q, fields: "nextPageToken,files(id,name)", pageSize: "1000", ...(pagina && { pageToken: pagina }) })}`);
        const j = (await r.json()) as { nextPageToken?: string; files: { id: string; name: string }[] };
        salida.push(...j.files.map((f) => ({ id: f.id, nombre: f.name })));
        pagina = j.nextPageToken;
      } while (pagina);
      return salida;
    },
    async borrar(id) {
      await pedir(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  };
}
