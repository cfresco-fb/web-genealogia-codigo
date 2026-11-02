/**
 * Núcleo de la edición (docs/edicion.md; diseño en docs/diseno-fase-3.md,
 * apartados 1 a 4): aplica una transacción, es decir, lo que el usuario
 * hace con un solo «Guardar», tocando los objetos que toque.
 *
 * La web manda cada objeto completo en su estado «después» y la versión
 * («change») sobre la que lo hizo. Aquí, en una sola transacción de
 * Firestore:
 *
 *  1. invitación activa (rol y persona vinculada) y límites (DA-27);
 *  2. esquema de cada objeto (comun/esquema.ts) y códigos de tipos propios
 *     del catálogo (comun/tipos.ts);
 *  3. versiones: cada objeto sigue como lo vio la web (DA-14 a);
 *  4. permisos, con la rama calculada desde el índice anterior al cambio
 *     (comun/rama.ts, comun/permisos.ts); quitar vínculos entre personas y
 *     familias, solo el administrador (DA-10 b); y tipos propios: solo el
 *     administrador escribe tipos nuevos (comun/tipos.ts);
 *  5. integridad, con el índice posterior: referencias a objetos que
 *     existen, vínculos dobles familia ⇄ persona, índices de nacimiento y
 *     defunción, ID sin cambiar;
 *  6. ID de Gramps de los objetos nuevos (DA-28) y «change»;
 *  7. escritura: objetos, registro (cambios/c…), datosWeb, índice,
 *     contadores y límites.
 *
 * Las fotos subidas (paso 11 b, fotos.ts) se comprueban y se copian a su
 * sitio antes de la transacción de Firestore, que no puede tocar Storage;
 * dentro, el espacio de cada usuario (DF-6) y los datos del Media (tipo,
 * suma, ruta de Gramps). Si algo falla, se borra lo copiado.
 *
 * Lo llama la función invocable «arbol» (index.ts); se prueba contra el
 * emulador de Firestore (transaccion.test.ts).
 */
import { gzipSync } from "node:zlib";
import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";
import { validar } from "../../comun/esquema.ts";
import { cuotaFotos, ID_SUBIDA, rutaApartada, rutaGrampsWeb } from "../../comun/fotos.ts";
import type { FotoPropuesta } from "../../comun/solicitudes.ts";
import {
  aFirestore, clave, deClave, deFirestore, esMapa, esTipo, formatoId, HANDLE, PREFIJOS_ID,
  type ObjetoGramps, type Tipo,
} from "../../comun/gramps.ts";
import type { CambioObjeto, Indice } from "../../comun/indice.ts";
import { noPermitidos, type ContextoPermisos, type Rol, type Usuario } from "../../comun/permisos.ts";
import type { CodigoError, FicheroPeticion, ObjetoPeticion, Operacion, Peticion, Resultado } from "../../comun/peticion.ts";
import { calcularRama, RAMA_VACIA } from "../../comun/rama.ts";
import { referenciasDe } from "../../comun/referencias.ts";
import { codigosDesconocidos, tiposPropios, unirTipos } from "../../comun/tipos.ts";
import { borrarApartadas, borrarSubidas, colocarFotos, comprobarSubidas, ErrorFotos, quitarFicheros, type FotoColocada } from "./fotos.ts";
import { documentoIndice, leerIndice, RUTA_CONTADORES, RUTA_INDICE, type Contadores } from "./sistema.ts";

export type Cubo = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

export type { CodigoError, ObjetoPeticion, Operacion, Peticion, Resultado };

export class ErrorTransaccion extends Error {
  readonly codigo: CodigoError;
  readonly detalles: unknown;
  constructor(codigo: CodigoError, mensaje: string, detalles?: unknown) {
    super(mensaje);
    this.codigo = codigo;
    this.detalles = detalles ?? null;
  }
}

export interface ObjetoRegistro {
  tipo: Tipo;
  handle: string;
  operacion: Operacion;
  changeAntes: number | null;
  changeDespues: number | null;
  /** JSON de Gramps en texto (DA-24 a). */
  antes: string | null;
  despues: string | null;
}

export interface Opciones {
  /** Para las pruebas: la hora del servidor. */
  ahora?: () => Date;
  /** Para guardar fuera las entradas del registro muy grandes. */
  cubo?: Cubo;
}

/** Límites para familiares (DA-27 b): objetos por guardado y guardados por
 * minuto. Y un tope para todos, contra peticiones disparatadas. */
export const LIMITES = { objetosFamiliar: 50, guardadosPorMinuto: 20, objetosMaximo: 2000, motivo: 2000 };
/** Por encima, el antes y el después del registro van a Storage. */
export const TAMANO_MAXIMO_REGISTRO = 800_000;

const ROLES: Rol[] = ["administrador", "revisor", "familiar"];
const OPERACIONES: Operacion[] = ["crear", "modificar", "borrar"];

export const idCambio = (secuencia: number) => `c${String(secuencia).padStart(7, "0")}`;

// ---- 1. Forma de la petición y esquema ----

export function comprobarPeticion(entrada: unknown): Peticion {
  const mal = (m: string) => new ErrorTransaccion("PETICION", m);
  if (!esMapa(entrada)) throw mal("La petición no es un objeto");
  const { accion, motivo, objetos, ficheros, corrige, resuelve } = entrada;
  if (typeof accion !== "string" || !/^[A-Za-z]{1,40}$/.test(accion)) throw mal("Acción no válida");
  if (corrige !== undefined && corrige !== null && (typeof corrige !== "string" || !/^c\d{7}$/.test(corrige))) throw mal("Cambio corregido no válido");
  if (resuelve !== undefined && resuelve !== null && (typeof resuelve !== "string" || !/^s\d{7}$/.test(resuelve))) throw mal("Solicitud no válida");
  if (typeof corrige === "string" && typeof resuelve === "string") throw mal("Una corrección no resuelve una solicitud");
  if (motivo !== undefined && motivo !== null && (typeof motivo !== "string" || motivo.length > LIMITES.motivo)) throw mal("Motivo no válido");
  if (!Array.isArray(objetos) || !objetos.length) throw mal("Sin objetos");
  if (objetos.length > LIMITES.objetosMaximo) throw new ErrorTransaccion("LIMITE", `Más de ${LIMITES.objetosMaximo} objetos`);
  const vistos = new Set<string>();
  const salida: ObjetoPeticion[] = [];
  const errores: { tipo: string; handle: string; errores: string[] }[] = [];
  for (const o of objetos) {
    if (!esMapa(o)) throw mal("Objeto no válido");
    const { tipo, handle, operacion, base, despues } = o;
    if (!esTipo(tipo)) throw mal(`Tipo no válido: ${String(tipo)}`);
    if (typeof handle !== "string" || !HANDLE.test(handle)) throw mal(`Handle no válido: ${String(handle)}`);
    if (!OPERACIONES.includes(operacion as Operacion)) throw mal(`Operación no válida: ${String(operacion)}`);
    const k = clave(tipo, handle);
    if (vistos.has(k)) throw mal(`Objeto repetido: ${k}`);
    vistos.add(k);
    if (operacion === "crear" ? base !== null && base !== undefined : !Number.isInteger(base)) throw mal(`Versión (base) no válida en ${k}`);
    if (operacion === "borrar") {
      if (despues !== null && despues !== undefined) throw mal(`Un borrado no lleva «después»: ${k}`);
      salida.push({ tipo, handle, operacion, base: base as number, despues: null });
      continue;
    }
    if (!esMapa(despues)) throw mal(`Falta el objeto en ${k}`);
    const obj = structuredClone(despues) as ObjetoGramps;
    if (obj.handle !== handle) throw mal(`El handle del objeto no coincide: ${k}`);
    // El ID y el «change» los pone el servidor: al crear, la web puede
    // mandarlos vacíos.
    if (operacion === "crear") {
      if (tipo !== "Tag") obj.gramps_id = "";
      obj.change = 0;
    }
    const e = validar(tipo, obj);
    // Un código de tipo propio («@…») tiene que estar en el catálogo
    // (comun/tipos-propios.json; 31/10/2026).
    for (const d of codigosDesconocidos(obj)) e.push(`Código de tipo desconocido: ${d.clase} «${d.texto}»`);
    if (e.length) errores.push({ tipo, handle, errores: e.slice(0, 20) });
    salida.push({ tipo, handle, operacion: operacion as Operacion, base: operacion === "crear" ? null : (base as number), despues: obj });
  }
  if (errores.length) throw new ErrorTransaccion("ESQUEMA", "Objetos que no son de Gramps válidos", errores);
  // Fotos: cada Media nuevo, con su subida; y ninguna subida de más.
  if (ficheros !== undefined && !Array.isArray(ficheros)) throw mal("Ficheros no válidos");
  const mediasNuevos = new Set(salida.filter((o) => o.tipo === "Media" && o.operacion === "crear").map((o) => o.handle));
  const fotos: FicheroPeticion[] = [];
  for (const f of (ficheros as unknown[] | undefined) ?? []) {
    if (!esMapa(f) || typeof f.handle !== "string" || typeof f.subida !== "string" || !ID_SUBIDA.test(f.subida)) throw mal("Fichero no válido");
    if (!mediasNuevos.delete(f.handle)) throw mal(`Fichero sin su Media nuevo (o repetido): ${f.handle}`);
    fotos.push({ handle: f.handle, subida: f.subida });
  }
  if (mediasNuevos.size) throw mal(`Media nuevo sin su fichero: ${[...mediasNuevos][0]}`);
  return {
    accion, motivo: typeof motivo === "string" && motivo.trim() ? motivo.trim() : null, objetos: salida, ficheros: fotos,
    corrige: typeof corrige === "string" ? corrige : null,
    resuelve: typeof resuelve === "string" ? resuelve : null,
  };
}

// ---- 5. Integridad ----

/** Errores de integridad de una transacción, con el índice ya puesto al día
 * («después»). Vacío si todo cuadra. */
export function comprobarIntegridad(indice: Indice, cambios: CambioObjeto[]): string[] {
  const errores: string[] = [];
  const personas = new Set<string>();
  const familias = new Set<string>();
  const anotarFamilia = (o: ObjetoGramps | null) => {
    if (!o) return;
    for (const x of [o.father_handle, o.mother_handle]) if (typeof x === "string" && x) personas.add(x);
    for (const c of Array.isArray(o.child_ref_list) ? o.child_ref_list : []) if (esMapa(c) && typeof c.ref === "string") personas.add(c.ref);
  };
  const anotarPersona = (o: ObjetoGramps | null) => {
    if (!o) return;
    for (const l of [o.family_list, o.parent_family_list]) for (const f of Array.isArray(l) ? l : []) if (typeof f === "string") familias.add(f);
  };

  for (const c of cambios) {
    const k = clave(c.tipo, c.handle);
    if (c.despues) {
      // Referencias a objetos que existen (después del cambio).
      for (const r of referenciasDe(c.despues)) {
        if (!indice.existe(r.tipo, r.handle)) errores.push(`${k}: referencia a ${clave(r.tipo, r.handle)}, que no existe`);
      }
      if (c.antes && c.antes.gramps_id !== c.despues.gramps_id) errores.push(`${k}: no se puede cambiar el ID`);
    } else {
      // Un borrado no puede dejar referencias colgando.
      const quedan = indice.referentesDe(c.tipo, c.handle);
      if (quedan.length) errores.push(`${k}: se borra, pero lo siguen usando ${quedan.slice(0, 5).join(", ")}`);
    }
    if (c.tipo === "Person") {
      personas.add(c.handle);
      anotarPersona(c.antes);
      anotarPersona(c.despues);
      const d = c.despues;
      if (d) {
        const n = Array.isArray(d.event_ref_list) ? d.event_ref_list.length : 0;
        for (const campo of ["birth_ref_index", "death_ref_index"]) {
          const i = d[campo];
          if (typeof i !== "number" || i < -1 || i >= n) errores.push(`${k}: ${campo} fuera de rango`);
        }
      }
    }
    if (c.tipo === "Family") {
      familias.add(c.handle);
      anotarFamilia(c.antes);
      anotarFamilia(c.despues);
      const d = c.despues;
      if (d && d.father_handle && d.father_handle === d.mother_handle) errores.push(`${k}: el padre y la madre son la misma persona`);
    }
  }

  // Vínculos dobles: lo que dice la persona y lo que dice la familia,
  // en todas las personas y familias afectadas.
  for (const p of personas) {
    const per = indice.personas.get(p);
    if (!per) continue;
    for (const f of per.pf) {
      const fam = indice.familias.get(f);
      if (fam && !fam.h.some((h) => h.ref === p)) errores.push(`Person_${p}: es hijo de Family_${f}, pero la familia no lo tiene entre sus hijos`);
    }
    for (const f of per.f) {
      const fam = indice.familias.get(f);
      if (fam && fam.p !== p && fam.m !== p) errores.push(`Person_${p}: tiene la familia Family_${f}, pero la familia no lo tiene como padre ni madre`);
    }
  }
  for (const f of familias) {
    const fam = indice.familias.get(f);
    if (!fam) continue;
    for (const h of fam.h) {
      if (!indice.personas.get(h.ref)?.pf.includes(f)) errores.push(`Family_${f}: tiene a Person_${h.ref} como hijo, pero la persona no tiene esa familia de padres`);
    }
    for (const x of [fam.p, fam.m]) {
      if (x && !indice.personas.get(x)?.f.includes(f)) errores.push(`Family_${f}: tiene a Person_${x} como padre o madre, pero la persona no tiene esa familia`);
    }
  }
  return [...new Set(errores)];
}

// ---- La transacción ----

export interface Invitacion {
  rol: Rol;
  persona: string | null;
}

export function leerInvitacion(datos: Record<string, unknown> | undefined): Invitacion | null {
  if (!datos || datos.estado !== "activa" || !ROLES.includes(datos.rol as Rol)) return null;
  return { rol: datos.rol as Rol, persona: typeof datos.persona === "string" && datos.persona ? datos.persona : null };
}

export async function aplicarTransaccion(db: Firestore, correoToken: string, entrada: unknown, opciones: Opciones = {}): Promise<Resultado> {
  const correo = correoToken.toLowerCase();
  const peticion = comprobarPeticion(entrada);
  const ficheros = peticion.ficheros ?? [];
  // «Modificar y aplicar» (paso 14): las fotos de la solicitud que el
  // administrador añade vienen de su carpeta aparte y son de quien la pidió
  // (su espacio y su creador, como al aplicarla tal cual).
  const solicitud = peticion.resuelve ? await fotosDeSolicitud(db, peticion.resuelve) : null;
  const esApartada = (f: FicheroPeticion) => !!solicitud?.ficheros.some((a) => a.handle === f.handle && a.subida === f.subida);
  const apartadas = ficheros.filter(esApartada);
  const propias = ficheros.filter((f) => !esApartada(f));
  if (!ficheros.length) {
    const r = await transaccion(db, correo, peticion, opciones, new Map());
    await limpiarResuelta(opciones.cubo, solicitud);
    return r;
  }

  // Fotos: comprobarlas y copiarlas a su sitio antes; si la transacción
  // falla, borrar lo copiado; si va bien, la carpeta de paso.
  const { cubo } = opciones;
  if (!cubo) throw new Error("Hacen falta Storage para las fotos");
  const colocadas: FotoColocada[] = [];
  const rutas: string[] = [];
  try {
    const subidas = await comprobarSubidas(cubo, correo, propias);
    // Antes de copiar nada, el espacio (se vuelve a mirar en la transacción).
    if (subidas.length) {
      const [inv, lim] = await Promise.all([db.doc(`invitaciones/${correo}`).get(), db.doc(`limites/${correo}`).get()]);
      comprobarCuota(String(inv.get("rol") ?? ""), Number(lim.get("bytesFotos") ?? 0), subidas.reduce((n, f) => n + f.bytes, 0));
    }
    const ajenas = apartadas.map((f) => solicitud!.ficheros.find((a) => a.handle === f.handle)!);
    if (ajenas.length) {
      const lim = await db.doc(`limites/${solicitud!.autor.correo}`).get();
      comprobarCuota(solicitud!.autor.rol, Number(lim.get("bytesFotos") ?? 0), ajenas.reduce((n, f) => n + f.bytes, 0));
    }
    try {
      const a = await colocarFotos(cubo, correo, subidas);
      colocadas.push(...a.colocadas);
      rutas.push(...a.rutas);
      const b = await colocarFotos(cubo, solicitud?.autor.correo ?? correo, ajenas, rutaApartada);
      colocadas.push(...b.colocadas.map((f) => ({ ...f, de: solicitud!.autor })));
      rutas.push(...b.rutas);
    } catch (e) {
      await quitarFicheros(cubo, rutas);
      throw e;
    }
  } catch (e) {
    if (e instanceof ErrorFotos) throw new ErrorTransaccion("PETICION", e.message);
    throw e;
  }
  try {
    const r = await transaccion(db, correo, peticion, opciones, new Map(colocadas.map((f) => [f.handle, f])));
    await borrarSubidas(cubo, correo, propias).catch(() => undefined);
    await limpiarResuelta(cubo, solicitud);
    return r;
  } catch (e) {
    await quitarFicheros(cubo, rutas);
    throw e;
  }
}

/** La solicitud que se resuelve con «Modificar y aplicar»: quién la pidió y
 * sus fotos apartadas (si no existe, la transacción lo dirá). */
async function fotosDeSolicitud(db: Firestore, id: string): Promise<{ autor: Aplicando["autor"]; ficheros: FotoPropuesta[] } | null> {
  const s = await db.doc(`solicitudes/${id}`).get();
  if (!s.exists) return null;
  return { autor: s.get("autor") as Aplicando["autor"], ficheros: (s.get("ficheros") as FotoPropuesta[] | undefined) ?? [] };
}

/** «Modificar y aplicar»: las fotos apartadas que no se han usado (y las
 * usadas, ya copiadas a su sitio) se borran, como al aplicarla o
 * rechazarla. */
async function limpiarResuelta(cubo: Cubo | undefined, solicitud: { autor: { correo: string }; ficheros: FotoPropuesta[] } | null) {
  if (!cubo || !solicitud?.ficheros.length) return;
  await borrarApartadas(cubo, solicitud.autor.correo, solicitud.ficheros).catch(() => undefined);
}

/** Si no caben `nuevos` bytes en el espacio de fotos del usuario, LIMITE. */
function comprobarCuota(rol: string, usados: number, nuevos: number) {
  const cuota = cuotaFotos(rol);
  if (usados + nuevos > cuota) {
    throw new ErrorTransaccion("LIMITE", "No queda espacio para estas fotos", { espacio: { usados, nuevos, cuota } });
  }
}

/** Aplicar una solicitud (solicitudes.ts): la solicitud y quien la pidió,
 * que queda como autor del cambio (y creador de lo nuevo); quien la aplica
 * (el administrador, `correo`), en `aplicadoPor`. */
export interface Aplicando {
  solicitud: string;
  autor: { correo: string; persona: string | null; rol: Rol };
  comentario: string | null;
}

export async function transaccion(
  db: Firestore, correo: string, peticion: Peticion, opciones: Opciones, fotos: Map<string, FotoColocada>, aplicando?: Aplicando,
): Promise<Resultado> {
  const ahora = opciones.ahora ?? (() => new Date());

  return db.runTransaction(async (tx) => {
    // 1. Invitación y límites (al aplicar una solicitud, el espacio de fotos
    // es el de quien la pidió).
    const refInvitacion = db.doc(`invitaciones/${correo}`);
    const refLimites = db.doc(`limites/${aplicando ? aplicando.autor.correo : correo}`);
    const refContadores = db.doc(RUTA_CONTADORES);
    const refIndice = db.doc(RUTA_INDICE);
    const refs = peticion.objetos.map((o) => db.collection(o.tipo).doc(o.handle));
    const [docInvitacion, docLimites, docContadores, docIndice, ...docs] = await tx.getAll(refInvitacion, refLimites, refContadores, refIndice, ...refs);
    const invitacion = leerInvitacion(docInvitacion.data());
    if (!invitacion) throw new ErrorTransaccion("ACCESO", "Sin invitación activa");
    const usuario: Usuario = { correo, rol: invitacion.rol, persona: invitacion.persona };
    const momento = ahora();
    const ms = momento.getTime();
    let marcas: number[] = [];
    if (usuario.rol === "familiar") {
      if (peticion.objetos.length > LIMITES.objetosFamiliar) {
        throw new ErrorTransaccion("LIMITE", `Como mucho ${LIMITES.objetosFamiliar} fichas en un guardado`);
      }
      marcas = ((docLimites.get("marcas") as number[] | undefined) ?? []).filter((t) => t > ms - 60_000);
      if (marcas.length >= LIMITES.guardadosPorMinuto) {
        throw new ErrorTransaccion("LIMITE", `Como mucho ${LIMITES.guardadosPorMinuto} guardados por minuto`);
      }
    }
    // Aplicar una solicitud: solo el administrador, y solo si sigue pendiente.
    const refSolicitud = aplicando ? db.doc(`solicitudes/${aplicando.solicitud}`) : null;
    if (aplicando) {
      if (usuario.rol !== "administrador") throw new ErrorTransaccion("SIN_PERMISO", "Solo el administrador aplica solicitudes");
      const s = await tx.get(refSolicitud!);
      if (!s.exists) throw new ErrorTransaccion("PETICION", `No existe la solicitud ${aplicando.solicitud}`);
      if (s.get("estado") !== "pendiente") throw new ErrorTransaccion("PETICION", "La solicitud ya no está pendiente");
    }
    const bytesFotos = [...fotos.values()].filter((f) => !f.de).reduce((n, f) => n + f.bytes, 0);
    if (bytesFotos) comprobarCuota(aplicando ? aplicando.autor.rol : usuario.rol, Number(docLimites.get("bytesFotos") ?? 0), bytesFotos);
    // Las de una solicitud que el administrador añade al modificarla: en el
    // espacio de quien la pidió.
    const ajenas = [...fotos.values()].filter((f) => f.de);
    const bytesAjenos = ajenas.reduce((n, f) => n + f.bytes, 0);
    const refLimitesAjenos = ajenas.length ? db.doc(`limites/${ajenas[0].de!.correo}`) : null;
    if (refLimitesAjenos) {
      const d = await tx.get(refLimitesAjenos);
      comprobarCuota(ajenas[0].de!.rol, Number(d.get("bytesFotos") ?? 0), bytesAjenos);
    }
    if (!docContadores.exists) throw new Error(`No existe ${RUTA_CONTADORES}: hay que cargar el árbol (npm run cargar)`);
    const contadores = docContadores.data() as Contadores;
    const indiceAntes = leerIndice(docIndice);

    // Corrección (diseño, 5.4): solo el administrador, de un cambio que
    // existe y no está revertido.
    let corregido: { estado: string; objetos: { tipo: Tipo; handle: string }[] } | null = null;
    if (peticion.corrige) {
      if (usuario.rol !== "administrador") throw new ErrorTransaccion("SIN_PERMISO", "Solo el administrador corrige cambios");
      const d = await tx.get(db.doc(`cambios/${peticion.corrige}`));
      if (!d.exists) throw new ErrorTransaccion("PETICION", `No existe el cambio ${peticion.corrige}`);
      if (d.get("estado") === "revertido") throw new ErrorTransaccion("PETICION", "No se corrige un cambio revertido");
      corregido = { estado: String(d.get("estado")), objetos: d.get("objetos") as { tipo: Tipo; handle: string }[] };
    }
    // «Modificar y aplicar» (paso 14): solo el administrador, de una
    // solicitud pendiente; el cambio es suyo (lo ha rehecho él).
    const refResuelta = peticion.resuelve ? db.doc(`solicitudes/${peticion.resuelve}`) : null;
    if (refResuelta) {
      if (usuario.rol !== "administrador" || aplicando) throw new ErrorTransaccion("SIN_PERMISO", "Solo el administrador aplica solicitudes");
      const s = await tx.get(refResuelta);
      if (!s.exists) throw new ErrorTransaccion("PETICION", `No existe la solicitud ${peticion.resuelve}`);
      if (s.get("estado") !== "pendiente") throw new ErrorTransaccion("PETICION", "La solicitud ya no está pendiente");
    }

    // 3. Versiones.
    const cambios: CambioObjeto[] = [];
    const conflictos: { tipo: Tipo; handle: string; actual: number | null }[] = [];
    peticion.objetos.forEach((o, i) => {
      const doc = docs[i];
      const antes = doc.exists ? (deFirestore(doc.data()) as ObjetoGramps) : null;
      if (o.operacion === "crear") {
        if (antes) throw new ErrorTransaccion("PETICION", `Ya existe ${clave(o.tipo, o.handle)}`);
      } else {
        const actual = antes && typeof antes.change === "number" ? antes.change : null;
        if (actual === null || actual !== o.base) conflictos.push({ tipo: o.tipo, handle: o.handle, actual });
      }
      cambios.push({ tipo: o.tipo, handle: o.handle, antes, despues: o.despues });
    });
    if (conflictos.length) throw new ErrorTransaccion("CONFLICTO", "Otra persona ha cambiado estas fichas mientras las editabas", conflictos);

    // 4. Permisos, con la rama y los creadores de lo que haga falta.
    const necesarios = new Set<string>();
    if (usuario.rol !== "administrador") {
      const pendientes = peticion.objetos.filter((o) => o.operacion === "modificar").map((o) => clave(o.tipo, o.handle));
      while (pendientes.length) {
        const k = pendientes.pop()!;
        if (necesarios.has(k)) continue;
        necesarios.add(k);
        const { tipo, handle } = deClave(k);
        if (tipo === "Event" || tipo === "Note" || tipo === "Citation" || tipo === "Media") pendientes.push(...indiceAntes.referentesDe(tipo, handle));
      }
    }
    for (const o of peticion.objetos) necesarios.add(clave(o.tipo, o.handle));
    const refsDatosWeb = [...necesarios].map((k) => db.doc(`datosWeb/${k}`));
    const datosWeb = new Map<string, Record<string, unknown> | undefined>();
    (await tx.getAll(...refsDatosWeb)).forEach((d) => datosWeb.set(d.id, d.data()));

    const ctx: ContextoPermisos = {
      usuario,
      indice: indiceAntes,
      rama: usuario.rol === "administrador" ? RAMA_VACIA : calcularRama(indiceAntes, usuario.persona),
      creador: (tipo, handle) => {
        const c = datosWeb.get(clave(tipo, handle))?.creador;
        return esMapa(c) && typeof c.correo === "string" ? c.correo : null;
      },
    };
    // Tipos propios: los demás solo eligen de los que ya hay (decisión del
    // 25/10/2026).
    if (!contadores.tiposPropios) throw new Error(`Faltan los tipos propios en ${RUTA_CONTADORES}: hay que pasar npm run sistema`);
    const prohibido = noPermitidos(ctx, cambios.map((c, i) => ({ ...c, operacion: peticion.objetos[i].operacion })), contadores.tiposPropios);
    if (prohibido.length) throw new ErrorTransaccion("SIN_PERMISO", "Sin permiso para cambiar estas fichas", prohibido);

    // 6. ID de Gramps y «change» (antes de la integridad, que comprueba que
    // el ID no cambia).
    const segundos = Math.floor(ms / 1000);
    const ids = { ...contadores.ids };
    for (const c of cambios) {
      if (!c.despues) continue;
      if (!c.antes && PREFIJOS_ID[c.tipo]) {
        ids[c.tipo] = (ids[c.tipo] ?? 0) + 1;
        c.despues.gramps_id = formatoId(c.tipo, ids[c.tipo]!);
      }
      const anterior = c.antes && typeof c.antes.change === "number" ? c.antes.change : 0;
      c.despues.change = c.antes ? Math.max(segundos, anterior + 1) : segundos;
      // Foto subida: lo que sabe el servidor del fichero, no lo que diga la
      // web.
      const foto = c.tipo === "Media" && !c.antes ? fotos.get(c.handle) : undefined;
      if (foto) {
        c.despues.mime = foto.mime;
        c.despues.checksum = foto.checksum;
        c.despues.path = rutaGrampsWeb(String(c.despues.gramps_id), foto.mime);
      }
    }

    // 5. Integridad, con el índice «después».
    const indiceDespues = indiceAntes.copia();
    const secuencia = contadores.secuenciaCambios + 1;
    indiceDespues.aplicar(cambios, secuencia);
    const errores = comprobarIntegridad(indiceDespues, cambios);
    if (errores.length) throw new ErrorTransaccion("INTEGRIDAD", "El cambio dejaría el árbol incoherente", errores.slice(0, 50));
    await comprobarVinculadas(db, tx, peticion.objetos);

    // 7. Registro.
    const id = idCambio(secuencia);
    // Al aplicar una solicitud, el autor es quien la pidió; quien la aplica
    // (el administrador) la da por revisada.
    const quien = { correo, persona: usuario.persona, rol: usuario.rol };
    const autor = aplicando ? aplicando.autor : quien;
    const estado = usuario.rol === "administrador" ? "aceptado" : "marcado";
    const objetosRegistro: ObjetoRegistro[] = cambios.map((c, i) => ({
      tipo: c.tipo,
      handle: c.handle,
      operacion: peticion.objetos[i].operacion,
      changeAntes: c.antes ? (c.antes.change as number) : null,
      changeDespues: c.despues ? (c.despues.change as number) : null,
      antes: c.antes ? JSON.stringify(c.antes) : null,
      despues: c.despues ? JSON.stringify(c.despues) : null,
    }));
    const claves = new Set<string>();
    for (const c of cambios) {
      claves.add(clave(c.tipo, c.handle));
      for (const r of c.despues ? referenciasDe(c.despues) : []) claves.add(clave(r.tipo, r.handle));
    }
    const principal = { tipo: cambios[0].tipo, handle: cambios[0].handle };
    const { objetos: objetosGuardados, fuera } = await objetosParaRegistro(objetosRegistro, id, opciones.cubo);
    const fecha = Timestamp.fromDate(momento);
    tx.set(db.doc(`cambios/${id}`), {
      secuencia,
      fecha,
      autor,
      origen: aplicando || refResuelta ? "solicitud" : corregido ? "correccion" : "edicion",
      accion: peticion.accion,
      principal,
      motivo: peticion.motivo,
      objetos: objetosGuardados,
      claves: [...claves],
      estado,
      revision: estado === "aceptado" ? { por: quien, fecha, comentario: aplicando?.comentario ?? null } : null,
      revertidoPor: null,
      revierte: null,
      corrige: peticion.corrige ?? null,
      corregidoPor: [],
      solicitud: aplicando?.solicitud ?? peticion.resuelve ?? null,
      aplicadoPor: aplicando ? { correo, persona: usuario.persona } : null,
      fuera,
    });
    if (aplicando) {
      tx.update(refSolicitud!, { estado: "aplicada", resolucion: { por: quien, fecha, comentario: aplicando.comentario, cambio: id } });
    }
    // Modificada: el motivo del administrador es el comentario que ve
    // quien la pidió.
    if (refResuelta) {
      tx.update(refResuelta, { estado: "aplicada", resolucion: { por: quien, fecha, comentario: peticion.motivo, cambio: id, modificada: true } });
    }
    // El corregido se da por revisado (si estaba marcado, sale de los
    // pendientes de sus objetos).
    if (corregido) {
      tx.update(db.doc(`cambios/${peticion.corrige}`), {
        corregidoPor: FieldValue.arrayUnion(id),
        ...(corregido.estado === "marcado" && { estado: "aceptado", revision: { por: quien, fecha, comentario: peticion.motivo } }),
      });
      if (corregido.estado === "marcado") {
        for (const o of corregido.objetos) tx.set(db.doc(`datosWeb/${clave(o.tipo, o.handle)}`), { pendientes: FieldValue.increment(-1) }, { merge: true });
      }
    }

    // Objetos de Gramps.
    cambios.forEach((c, i) => {
      if (c.despues) tx.set(refs[i], aFirestore(c.despues) as Record<string, unknown>);
      else tx.delete(refs[i]);
    });

    // datosWeb: creador de lo nuevo, último cambio y pendientes de revisión.
    for (const c of cambios) {
      const datos: Record<string, unknown> = {
        tipo: c.tipo,
        handle: c.handle,
        ultimoCambio: id,
        ultimoAutor: { correo: autor.correo, persona: autor.persona },
      };
      if (!c.antes) {
        const de = c.tipo === "Media" ? fotos.get(c.handle)?.de : undefined;
        datos.creador = de ? { correo: de.correo, persona: de.persona } : { correo: autor.correo, persona: autor.persona };
        datos.creado = fecha;
        datos.cambioCreacion = id;
        // Lo que ocupa una foto subida, para devolverlo si se borra.
        const foto = c.tipo === "Media" ? fotos.get(c.handle) : undefined;
        if (foto) datos.bytes = foto.bytes;
      }
      // Foto borrada: sus ficheros se borran pasados 30 días
      // (limpiarFotosBorradas, fotos.ts).
      if (c.tipo === "Media" && !c.despues) datos.borrado = fecha;
      if (estado === "marcado") datos.pendientes = FieldValue.increment(1);
      tx.set(db.doc(`datosWeb/${clave(c.tipo, c.handle)}`), datos, { merge: true });
    }

    tx.set(refIndice, documentoIndice(indiceDespues));
    const tipos = unirTipos(contadores.tiposPropios, tiposPropios(cambios.map((c) => c.despues)));
    tx.set(refContadores, { ...contadores, secuenciaCambios: secuencia, ids, tiposPropios: tipos });
    // Espacio de fotos: lo nuevo, en el de quien lo sube (o lo pidió); lo
    // borrado, se devuelve a quien lo subió.
    const espacio = espacioFotos(cambios, (k) => datosWeb.get(k));
    const sumar = (c: string, n: number) => espacio.set(c, (espacio.get(c) ?? 0) + n);
    const correoLimites = aplicando ? aplicando.autor.correo : correo;
    if (bytesFotos) sumar(correoLimites, bytesFotos);
    if (refLimitesAjenos) sumar(ajenas[0].de!.correo, bytesAjenos);
    const limites: Record<string, unknown> = {};
    if (usuario.rol === "familiar") limites.marcas = [...marcas, ms];
    if (espacio.get(correoLimites)) limites.bytesFotos = FieldValue.increment(espacio.get(correoLimites)!);
    if (Object.keys(limites).length) tx.set(refLimites, limites, { merge: true });
    for (const [c, n] of espacio) {
      if (c !== correoLimites && n) tx.set(db.doc(`limites/${c}`), { bytesFotos: FieldValue.increment(n) }, { merge: true });
    }

    return {
      cambio: id,
      secuencia,
      estado,
      objetos: cambios.map((c, i) => ({ tipo: c.tipo, handle: c.handle, operacion: peticion.objetos[i].operacion, despues: c.despues })),
    } satisfies Resultado;
  });
}

/** El espacio de fotos que cambia con estos cambios (29/10/2026), por
 * correo: si desaparece del árbol una foto subida desde la web (al borrarla
 * o al revertir el cambio que la subió), lo que ocupa vuelve a quien la
 * subió (negativo); si una reversión la recupera, vuelve a contar (sin
 * mirar el límite: ya estaba). Lo que ocupa y quién la subió, de
 * `datosWeb` (`bytes`, desde el 29/10/2026; las anteriores no lo tienen y no
 * se devuelven). Los ficheros se quedan en Storage, para poder revertir. */
export function espacioFotos(
  cambios: { tipo: Tipo; handle: string; antes: unknown; despues: unknown }[],
  datosWeb: (k: string) => Record<string, unknown> | undefined,
): Map<string, number> {
  const espacio = new Map<string, number>();
  for (const c of cambios) {
    if (c.tipo !== "Media" || !c.antes === !c.despues) continue;
    const d = datosWeb(clave(c.tipo, c.handle));
    const bytes = Number(d?.bytes ?? 0);
    const creador = d?.creador;
    if (!bytes || !esMapa(creador) || typeof creador.correo !== "string") continue;
    espacio.set(creador.correo, (espacio.get(creador.correo) ?? 0) + (c.despues ? bytes : -bytes));
  }
  return espacio;
}

/** Los objetos de una entrada del registro como se guardan: en el documento
 * o, si no caben, en Storage (`registro/{id}.json.gz`), dejando en el
 * documento solo la cabecera de cada uno. */
export async function objetosParaRegistro(objetos: ObjetoRegistro[], id: string, cubo?: Cubo): Promise<{
  objetos: ObjetoRegistro[] | Omit<ObjetoRegistro, "antes" | "despues">[];
  fuera: { ruta: string } | null;
}> {
  const tamano = objetos.reduce((n, o) => n + (o.antes?.length ?? 0) + (o.despues?.length ?? 0), 0);
  if (tamano <= TAMANO_MAXIMO_REGISTRO) return { objetos, fuera: null };
  if (!cubo) throw new ErrorTransaccion("LIMITE", "Cambio demasiado grande para el registro");
  // Si la transacción se repite con otro número, queda un fichero suelto,
  // que no estorba.
  const ruta = `registro/${id}.json.gz`;
  await cubo.file(ruta).save(gzipSync(Buffer.from(JSON.stringify(objetos), "utf8")), { resumable: false, contentType: "application/gzip" });
  return { objetos: objetos.map(({ antes: _a, despues: _d, ...cabecera }) => cabecera), fuera: { ruta } };
}

/** Una persona vinculada a una invitación o que es la persona de inicio del
 * árbol (la de Gramps) no se puede borrar (paso 12): antes, cambiar la
 * invitación o la persona de inicio. */
export interface Vinculada {
  handle: string;
  motivo: "invitacion" | "inicio";
}

export async function comprobarVinculadas(db: Firestore, tx: Transaction, objetos: Pick<ObjetoPeticion, "tipo" | "handle" | "operacion">[]) {
  const borradas = objetos.filter((o) => o.tipo === "Person" && o.operacion === "borrar").map((o) => o.handle);
  if (!borradas.length) return;
  const vinculadas: Vinculada[] = [];
  for (let i = 0; i < borradas.length; i += 30) {
    const q = await tx.get(db.collection("invitaciones").where("persona", "in", borradas.slice(i, i + 30)));
    for (const d of q.docs) vinculadas.push({ handle: String(d.get("persona")), motivo: "invitacion" });
  }
  const inicio = (await tx.get(db.doc("metadatos/arbol"))).get("persona_inicio");
  if (typeof inicio === "string" && borradas.includes(inicio)) vinculadas.push({ handle: inicio, motivo: "inicio" });
  if (vinculadas.length) throw new ErrorTransaccion("INTEGRIDAD", "Persona vinculada a una invitación o persona de inicio", { vinculadas });
}

/** Para las pruebas y la regeneración nocturna: el índice guardado. */
export async function leerIndiceGuardado(db: Firestore): Promise<Indice> {
  return leerIndice(await db.doc(RUTA_INDICE).get());
}
