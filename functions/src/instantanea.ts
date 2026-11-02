/**
 * Instantánea del árbol, versión 2 (docs/instantanea.md; DA-23 a): un
 * único fichero JSON comprimido en Storage que la web descarga para
 * consultar.
 *
 * - generarInstantanea: la entera, desde Firestore (carga, regeneración
 *   nocturna y si la que hay no es de la versión 2).
 * - actualizarInstantanea: por partes, tras cada cambio. Descarga la
 *   actual, le aplica los «después» de los cambios del registro posteriores
 *   a su secuencia, en orden, y la sube solo si nadie la ha subido entre
 *   tanto (condición de generación de Storage); si no, vuelve a empezar.
 *   Es idempotente: si llegan varios cambios seguidos, el primer disparador
 *   los incorpora todos y los demás no encuentran nada que hacer.
 * - comprobarInstantanea: la regeneración nocturna; compara la instantánea
 *   por partes y el índice con los reconstruidos desde cero y avisa si
 *   difieren.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import type { Firestore } from "firebase-admin/firestore";
import { clave, jsonCanonico, TIPOS, type ObjetoGramps, type Tipo } from "../../comun/gramps.ts";
import { Indice } from "../../comun/indice.ts";
import { leerArbolFirestore } from "./arbol.ts";
import { sinAvisoDeOyentes } from "./oyentes.ts";
import { leerIndice, RUTA_CONTADORES, RUTA_INDICE } from "./sistema.ts";
import type { Cubo, ObjetoRegistro } from "./transaccion.ts";

export const VERSION_INSTANTANEA = 2;
export const RUTA_INSTANTANEA = "instantanea/arbol.json.gz";
/** Cambios recientes que lleva la instantánea (para la página de inicio). */
export const RECIENTES = 20;

export interface Reciente {
  cambio: string;
  secuencia: number;
  fecha: string;
  accion: string;
  /** La ficha protagonista; ninguna en una carga del árbol. */
  principal: { tipo: Tipo; handle: string } | null;
  /** Persona vinculada del autor (no el correo: lo ven todos, DA-17 a). */
  autor: string | null;
}

export interface Instantanea {
  version_instantanea: number;
  generada: string;
  version_gramps: string;
  persona_inicio: string | null;
  /** Último cambio del registro incluido. */
  secuencia: number;
  objetos: Record<string, ObjetoGramps[]>;
  web: {
    /** De cada objeto creado en la web, la persona vinculada de quien lo
     * creó (no el correo): para que la web sepa qué botón mostrar. */
    creadoPor: Record<string, string | null>;
    recientes: Reciente[];
  };
}

type Cambio = {
  secuencia: number;
  origen?: string;
  fecha: { toDate(): Date };
  accion: string;
  principal: { tipo: Tipo; handle: string } | null;
  autor: { persona: string | null };
  objetos: ObjetoRegistro[];
  fuera: { ruta: string } | null;
};

const reciente = (id: string, c: Cambio): Reciente => ({
  cambio: id, secuencia: c.secuencia, fecha: c.fecha.toDate().toISOString(), accion: c.accion, principal: c.principal, autor: c.autor.persona ?? null,
});

/** La instantánea entera, desde Firestore, sin subirla. */
export async function construirInstantanea(db: Firestore): Promise<Instantanea> {
  // La secuencia se lee antes que los objetos: si entre tanto llega otro
  // cambio, la siguiente actualización por partes lo vuelve a aplicar, sin
  // daño.
  const secuencia = ((await db.doc(RUTA_CONTADORES).get()).get("secuenciaCambios") as number | undefined) ?? 0;
  const arbol = await leerArbolFirestore(db);
  const creadoPor: Record<string, string | null> = {};
  for (const d of (await db.collection("datosWeb").get()).docs) {
    const c = d.get("creador") as { persona?: string | null } | undefined;
    if (c) creadoPor[d.get("handle") as string] = c.persona ?? null;
  }
  const ultimos = await db.collection("cambios").orderBy("secuencia", "desc").limit(RECIENTES).get();
  return {
    version_instantanea: VERSION_INSTANTANEA,
    generada: new Date().toISOString(),
    version_gramps: arbol.version_gramps,
    persona_inicio: arbol.persona_inicio ?? null,
    secuencia,
    objetos: arbol.objetos,
    web: { creadoPor: ordenar(creadoPor), recientes: ultimos.docs.map((d) => reciente(d.id, d.data() as Cambio)) },
  };
}

const ordenar = <T>(m: Record<string, T>) => Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]]));

async function subir(cubo: Cubo, instantanea: Instantanea, generacion?: number) {
  const json = Buffer.from(JSON.stringify(instantanea), "utf8");
  const gz = gzipSync(json, { level: 9 });
  await cubo.file(RUTA_INSTANTANEA).save(gz, {
    resumable: false,
    contentType: "application/gzip",
    metadata: {
      // Que el navegador pregunte siempre si ha cambiado (ETag) en vez de
      // usar una copia guardada que puede estar desfasada.
      cacheControl: "no-cache",
      metadata: {
        generada: instantanea.generada,
        version_instantanea: String(instantanea.version_instantanea),
        secuencia: String(instantanea.secuencia),
      },
    },
    ...(generacion !== undefined && { preconditionOpts: { ifGenerationMatch: generacion } }),
  });
  return { bytesJson: json.length, bytesComprimido: gz.length };
}

export async function generarInstantanea(db: Firestore, cubo: Cubo) {
  const instantanea = await construirInstantanea(db);
  const r = await subir(cubo, instantanea);
  return { generada: instantanea.generada, secuencia: instantanea.secuencia, ...r };
}

/** La instantánea guardada y su generación de Storage (null si no hay). */
async function descargar(cubo: Cubo): Promise<{ instantanea: Instantanea; generacion: number } | null> {
  const f = cubo.file(RUTA_INSTANTANEA);
  const [existe] = await f.exists();
  if (!existe) return null;
  const [meta] = await f.getMetadata();
  const generacion = Number(meta.generation);
  // Si entre leer la generación y descargar la sube otro, la subida con la
  // generación antigua falla y se vuelve a empezar.
  const [gz] = await sinAvisoDeOyentes(() => f.download());
  return { instantanea: JSON.parse(gunzipSync(gz).toString("utf8")), generacion };
}

/** Los objetos de un cambio, del documento o, si no cabían, de Storage. */
async function objetosDe(cubo: Cubo, c: Cambio): Promise<ObjetoRegistro[]> {
  if (!c.fuera) return c.objetos;
  const [gz] = await sinAvisoDeOyentes(() => cubo.file(c.fuera!.ruta).download());
  return JSON.parse(gunzipSync(gz).toString("utf8"));
}

/** Aplica a la instantánea los cambios posteriores a su secuencia. Devuelve
 * cuántos ha aplicado, o «carga» si entre ellos hay una carga del árbol
 * (firestore/cargar.ts), que no lleva los objetos: entonces hay que
 * regenerarla entera. */
async function aplicarPendientes(db: Firestore, cubo: Cubo, ins: Instantanea): Promise<number | "carga"> {
  const nuevos = await db.collection("cambios").where("secuencia", ">", ins.secuencia).orderBy("secuencia").get();
  if (nuevos.docs.some((d) => d.get("origen") === "carga")) return "carga";
  for (const d of nuevos.docs) {
    const c = d.data() as Cambio;
    for (const o of await objetosDe(cubo, c)) {
      const lista = (ins.objetos[o.tipo] ??= []);
      // Ordenada por handle, como la lee la regeneración completa.
      let i = 0;
      let j = lista.length;
      while (i < j) {
        const m = (i + j) >> 1;
        if (lista[m].handle < o.handle) i = m + 1;
        else j = m;
      }
      const esta = lista[i]?.handle === o.handle;
      if (o.despues === null) {
        if (esta) lista.splice(i, 1);
      } else {
        const despues = JSON.parse(o.despues) as ObjetoGramps;
        if (esta) lista[i] = despues;
        else lista.splice(i, 0, despues);
        // Al revertir un borrado, el objeto vuelve con su creador de antes
        // (el de datosWeb, que no cambia; como la regeneración completa).
        if (o.operacion === "crear" && c.origen !== "reversion") ins.web.creadoPor[o.handle] = c.autor.persona ?? null;
      }
    }
    ins.web.creadoPor = ordenar(ins.web.creadoPor);
    ins.web.recientes = [reciente(d.id, c), ...ins.web.recientes.filter((r) => r.secuencia !== c.secuencia)]
      .sort((a, b) => b.secuencia - a.secuencia)
      .slice(0, RECIENTES);
    ins.secuencia = c.secuencia;
  }
  return nuevos.size;
}

/** Actualización por partes (disparador de cada cambio). */
export async function actualizarInstantanea(db: Firestore, cubo: Cubo, intentos = 8): Promise<{ aplicados: number; completa: boolean }> {
  for (let intento = 1; ; intento++) {
    const actual = await descargar(cubo);
    if (!actual || actual.instantanea.version_instantanea !== VERSION_INSTANTANEA) {
      await generarInstantanea(db, cubo);
      return { aplicados: 0, completa: true };
    }
    const { instantanea, generacion } = actual;
    const aplicados = await aplicarPendientes(db, cubo, instantanea);
    if (aplicados === "carga") {
      await generarInstantanea(db, cubo);
      return { aplicados: 0, completa: true };
    }
    if (!aplicados) return { aplicados: 0, completa: false };
    instantanea.generada = new Date().toISOString();
    try {
      await subir(cubo, instantanea, generacion);
      return { aplicados, completa: false };
    } catch (e) {
      // 412: otro proceso la ha subido entre tanto; se empieza de nuevo
      // con la suya.
      if ((e as { code?: number }).code !== 412 || intento >= intentos) throw e;
      await new Promise((r) => setTimeout(r, 50 * intento + Math.random() * 100));
    }
  }
}

/** Diferencias entre dos instantáneas (sin contar la fecha de generación). */
export function diferencias(a: Instantanea, b: Instantanea): string[] {
  const salida: string[] = [];
  for (const campo of ["version_instantanea", "version_gramps", "persona_inicio", "secuencia"] as const) {
    if (a[campo] !== b[campo]) salida.push(`${campo}: ${a[campo]} ≠ ${b[campo]}`);
  }
  for (const tipo of TIPOS) {
    const ma = new Map((a.objetos[tipo] ?? []).map((o) => [o.handle, jsonCanonico(o)]));
    const mb = new Map((b.objetos[tipo] ?? []).map((o) => [o.handle, jsonCanonico(o)]));
    for (const [h, j] of ma) if (mb.get(h) !== j) salida.push(`${clave(tipo, h)}: ${mb.has(h) ? "distinto" : "sobra"}`);
    for (const h of mb.keys()) if (!ma.has(h)) salida.push(`${clave(tipo, h)}: falta`);
    if (ma.size === mb.size && (a.objetos[tipo] ?? []).some((o, i) => o.handle !== b.objetos[tipo]?.[i]?.handle)) salida.push(`${tipo}: otro orden`);
  }
  if (jsonCanonico(a.web) !== jsonCanonico(b.web)) salida.push("web: distinta");
  return salida;
}

/** Regeneración nocturna con comprobación: pone al día la instantánea por
 * partes, la compara con la reconstruida desde cero, compara el índice
 * guardado con el reconstruido desde los objetos, y sube la completa.
 * Devuelve las diferencias encontradas (vacías si todo cuadraba). */
export async function comprobarInstantanea(db: Firestore, cubo: Cubo): Promise<{ instantanea: string[]; indice: string[] }> {
  await actualizarInstantanea(db, cubo);
  const porPartes = (await descargar(cubo))?.instantanea;
  const completa = await construirInstantanea(db);
  const instantanea = porPartes ? diferencias(porPartes, completa) : ["no había instantánea"];
  const guardado = leerIndice(await db.doc(RUTA_INDICE).get());
  const reconstruido = Indice.desdeObjetos(completa.objetos as Partial<Record<Tipo, ObjetoGramps[]>>, guardado.secuencia);
  const indice: string[] = [];
  const jg = guardado.aJson();
  const jr = reconstruido.aJson();
  for (const campo of ["personas", "familias", "referentes", "objetos"] as const) {
    if (jsonCanonico(jg[campo]) !== jsonCanonico(jr[campo])) indice.push(`${campo}: distinto`);
  }
  await subir(cubo, completa);
  return { instantanea, indice };
}
