/**
 * Solicitudes (fase 3, paso 12; docs/edicion.md, «Solicitudes»; tipos en
 * comun/solicitudes.ts). La función invocable «arbol» llama a:
 *
 * - crearSolicitud: lo que el usuario no puede guardar él (un cambio fuera
 *   de su rama, quitar vínculos, un tipo nuevo) o el borrado de una ficha.
 *   Se comprueba como un guardado (esquema, versiones, integridad), salvo
 *   los permisos, que son justo el motivo de la solicitud: se anotan
 *   (`noPermitidos`). El motivo es obligatorio (DA-18 a). Las fotos subidas
 *   se apartan hasta que se resuelva.
 * - retirarSolicitud: su autor, mientras esté pendiente (DA-19 a).
 *
 * El aviso por correo a los administradores lo manda el disparador
 * alCrearSolicitud (avisos.ts). Aplicarlas y rechazarlas, en la pantalla de
 * administración (paso 14).
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { clave, deClave, deFirestore, esMapa, type ObjetoGramps } from "../../comun/gramps.ts";
import type { CambioObjeto } from "../../comun/indice.ts";
import { noPermitidos, type ContextoPermisos } from "../../comun/permisos.ts";
import { calcularRama } from "../../comun/rama.ts";
import { referenciasDe } from "../../comun/referencias.ts";
import {
  CLASES_SOLICITUD, ID_SOLICITUD, idSolicitud, type ClaseSolicitud, type FotoPropuesta, type Solicitud,
} from "../../comun/solicitudes.ts";
import { rutaApartada } from "../../comun/fotos.ts";
import type { Resultado } from "../../comun/peticion.ts";
import {
  apartarFotos, borrarApartadas, borrarSubidas, colocarFotos, comprobarSubidas, ErrorFotos, quitarFicheros, type FotoColocada,
} from "./fotos.ts";
import { leerIndice, RUTA_CONTADORES, RUTA_INDICE, type Contadores } from "./sistema.ts";
import {
  comprobarIntegridad, comprobarPeticion, ErrorTransaccion, LIMITES, leerInvitacion, transaccion, type Opciones,
} from "./transaccion.ts";

/** Una solicitud cabe de sobra en un documento de Firestore (1 MiB). */
export const TAMANO_MAXIMO_SOLICITUD = 900_000;

export async function crearSolicitud(db: Firestore, correoToken: string, entrada: unknown, opciones: Opciones = {}): Promise<{ solicitud: string; secuencia: number }> {
  const correo = correoToken.toLowerCase();
  const mal = (m: string) => new ErrorTransaccion("PETICION", m);
  if (!esMapa(entrada)) throw mal("La solicitud no es un objeto");
  const clase = entrada.clase as ClaseSolicitud;
  if (!CLASES_SOLICITUD.includes(clase)) throw mal("Clase de solicitud no válida");
  const peticion = comprobarPeticion(entrada.peticion);
  if (!peticion.motivo) throw mal("Falta el motivo");
  if (clase === "borrado" && peticion.objetos[0].operacion !== "borrar") throw mal("Un borrado empieza por la ficha que se borra");

  // Fotos: comprobarlas y apartarlas antes; si la transacción falla, quitar
  // lo apartado; si va bien, la carpeta de paso.
  const ficheros = peticion.ficheros ?? [];
  let fotos: FotoPropuesta[] = [];
  let rutas: string[] = [];
  if (ficheros.length) {
    if (!opciones.cubo) throw new Error("Hacen falta Storage para las fotos");
    try {
      const subidas = await comprobarSubidas(opciones.cubo, correo, ficheros);
      rutas = await apartarFotos(opciones.cubo, correo, subidas);
      fotos = subidas.map(({ handle, subida, mime, bytes }) => ({ handle, subida, mime, bytes }));
    } catch (e) {
      if (e instanceof ErrorFotos) throw new ErrorTransaccion("PETICION", e.message);
      throw e;
    }
  }
  const ahora = opciones.ahora ?? (() => new Date());
  try {
    const r = await db.runTransaction(async (tx) => {
      const refInvitacion = db.doc(`invitaciones/${correo}`);
      const refLimites = db.doc(`limites/${correo}`);
      const refContadores = db.doc(RUTA_CONTADORES);
      const refs = peticion.objetos.map((o) => db.collection(o.tipo).doc(o.handle));
      const [docInvitacion, docLimites, docContadores, docIndice, ...docs] = await tx.getAll(
        refInvitacion, refLimites, refContadores, db.doc(RUTA_INDICE), ...refs,
      );
      const invitacion = leerInvitacion(docInvitacion.data());
      if (!invitacion) throw new ErrorTransaccion("ACCESO", "Sin invitación activa");
      const usuario = { correo, rol: invitacion.rol, persona: invitacion.persona };
      const momento = ahora();
      const ms = momento.getTime();
      let marcas: number[] = [];
      if (usuario.rol === "familiar") {
        if (peticion.objetos.length > LIMITES.objetosFamiliar) throw new ErrorTransaccion("LIMITE", `Como mucho ${LIMITES.objetosFamiliar} fichas`);
        marcas = ((docLimites.get("marcas") as number[] | undefined) ?? []).filter((t) => t > ms - 60_000);
        if (marcas.length >= LIMITES.guardadosPorMinuto) throw new ErrorTransaccion("LIMITE", `Como mucho ${LIMITES.guardadosPorMinuto} guardados por minuto`);
      }
      const contadores = docContadores.data() as Contadores;
      const indiceAntes = leerIndice(docIndice);

      // Versiones: la propuesta se hace sobre las fichas como están.
      const cambios: CambioObjeto[] = [];
      const conflictos: { tipo: string; handle: string; actual: number | null }[] = [];
      peticion.objetos.forEach((o, i) => {
        const antes = docs[i].exists ? (deFirestore(docs[i].data()) as ObjetoGramps) : null;
        if (o.operacion === "crear") {
          if (antes) throw new ErrorTransaccion("PETICION", `Ya existe ${clave(o.tipo, o.handle)}`);
        } else {
          const actual = antes && typeof antes.change === "number" ? antes.change : null;
          if (actual === null || actual !== o.base) conflictos.push({ tipo: o.tipo, handle: o.handle, actual });
        }
        cambios.push({ tipo: o.tipo, handle: o.handle, antes, despues: o.despues });
      });
      if (conflictos.length) throw new ErrorTransaccion("CONFLICTO", "Otra persona ha cambiado estas fichas mientras las editabas", conflictos);

      // Integridad, como si se aplicara (sin ID nuevos: se ponen al aplicarla).
      const indiceDespues = indiceAntes.copia();
      indiceDespues.aplicar(cambios);
      const errores = comprobarIntegridad(indiceDespues, cambios);
      if (errores.length) throw new ErrorTransaccion("INTEGRIDAD", "El cambio dejaría el árbol incoherente", errores.slice(0, 50));

      // Por qué no se puede guardar directamente.
      // Los creadores de lo que haga falta (como en transaccion.ts).
      const necesarios = new Set<string>();
      const pendientes = peticion.objetos.filter((o) => o.operacion !== "crear").map((o) => clave(o.tipo, o.handle));
      while (pendientes.length) {
        const k = pendientes.pop()!;
        if (necesarios.has(k)) continue;
        necesarios.add(k);
        const { tipo, handle } = deClave(k);
        if (tipo === "Event" || tipo === "Note" || tipo === "Citation" || tipo === "Media") pendientes.push(...indiceAntes.referentesDe(tipo, handle));
      }
      const datosWeb = new Map<string, unknown>();
      if (necesarios.size) (await tx.getAll(...[...necesarios].map((k) => db.doc(`datosWeb/${k}`)))).forEach((d) => datosWeb.set(d.id, d.get("creador")));
      const ctx: ContextoPermisos = {
        usuario,
        indice: indiceAntes,
        rama: calcularRama(indiceAntes, usuario.persona),
        creador: (tipo, handle) => {
          const c = datosWeb.get(clave(tipo, handle));
          return esMapa(c) && typeof c.correo === "string" ? c.correo : null;
        },
      };
      const prohibido = noPermitidos(ctx, cambios.map((c, i) => ({ ...c, operacion: peticion.objetos[i].operacion })), contadores.tiposPropios ?? {});

      const secuencia = (contadores.secuenciaSolicitudes ?? 0) + 1;
      const id = idSolicitud(secuencia);
      const objetos = peticion.objetos.map((o, i) => ({
        ...o,
        antes: cambios[i].antes ? JSON.stringify(cambios[i].antes) : null,
        despues: o.despues ? JSON.stringify(o.despues) : null,
      }));
      if (objetos.reduce((n, o) => n + (o.antes?.length ?? 0) + (o.despues?.length ?? 0), 0) > TAMANO_MAXIMO_SOLICITUD) {
        throw new ErrorTransaccion("LIMITE", "Solicitud demasiado grande");
      }
      const claves = new Set<string>();
      for (const c of cambios) {
        claves.add(clave(c.tipo, c.handle));
        for (const r of c.despues ? referenciasDe(c.despues) : []) claves.add(clave(r.tipo, r.handle));
      }
      const solicitud: Solicitud = {
        secuencia,
        fecha: Timestamp.fromDate(momento),
        autor: { correo, persona: usuario.persona, rol: usuario.rol },
        clase,
        accion: peticion.accion,
        motivo: peticion.motivo!,
        principal: { tipo: peticion.objetos[0].tipo, handle: peticion.objetos[0].handle },
        objetos,
        ficheros: fotos,
        noPermitidos: prohibido,
        claves: [...claves],
        estado: "pendiente",
        resolucion: null,
        aviso: { enviado: null, error: null },
      };
      tx.set(db.doc(`solicitudes/${id}`), solicitud);
      tx.update(refContadores, { secuenciaSolicitudes: secuencia });
      if (usuario.rol === "familiar") tx.set(refLimites, { marcas: [...marcas, ms] }, { merge: true });
      return { solicitud: id, secuencia };
    });
    if (ficheros.length) await borrarSubidas(opciones.cubo!, correo, ficheros).catch(() => undefined);
    return r;
  } catch (e) {
    if (rutas.length) await quitarFicheros(opciones.cubo!, rutas);
    throw e;
  }
}

/** Lo que manda la web para resolver una solicitud. */
function leerResolucion(entrada: unknown): { id: string; comentario: string | null } {
  if (!esMapa(entrada)) throw new ErrorTransaccion("PETICION", "La petición no es un objeto");
  const { solicitud, comentario } = entrada;
  if (typeof solicitud !== "string" || !ID_SOLICITUD.test(solicitud)) throw new ErrorTransaccion("PETICION", "Solicitud no válida");
  if (comentario !== undefined && comentario !== null && (typeof comentario !== "string" || comentario.length > LIMITES.motivo)) {
    throw new ErrorTransaccion("PETICION", "Comentario no válido");
  }
  return { id: solicitud, comentario: typeof comentario === "string" && comentario.trim() ? comentario.trim() : null };
}

/** El administrador la aplica tal cual (DA-20 a: solo si las fichas no han
 * cambiado desde que se pidió; si no, CONFLICTO). Es un guardado más
 * (transaccion.ts), a nombre de quien la pidió, con `origen: "solicitud"`;
 * las fotos apartadas pasan a su sitio y cuentan en su espacio. */
export async function aplicarSolicitud(db: Firestore, correoToken: string, entrada: unknown, opciones: Opciones = {}): Promise<Resultado> {
  const correo = correoToken.toLowerCase();
  const { id, comentario } = leerResolucion(entrada);
  const doc = await db.doc(`solicitudes/${id}`).get();
  if (!doc.exists) throw new ErrorTransaccion("PETICION", `No existe la solicitud ${id}`);
  const s = doc.data() as Solicitud;
  if (s.estado !== "pendiente") throw new ErrorTransaccion("PETICION", "La solicitud ya no está pendiente");
  const fotos = s.ficheros ?? [];
  const peticion = comprobarPeticion({
    accion: s.accion,
    motivo: s.motivo,
    objetos: s.objetos.map((o) => ({ tipo: o.tipo, handle: o.handle, operacion: o.operacion, base: o.base, despues: o.despues ? JSON.parse(o.despues) : null })),
    ficheros: fotos.map((f) => ({ handle: f.handle, subida: f.subida })),
  });
  const aplicando = { solicitud: id, autor: { ...s.autor, rol: s.autor.rol }, comentario };
  if (!fotos.length) return transaccion(db, correo, peticion, opciones, new Map(), aplicando);

  // Las fotos, de su carpeta aparte a su sitio, antes de la transacción; si
  // falla, se quitan; si va bien, se borra la carpeta aparte.
  if (!opciones.cubo) throw new Error("Hacen falta Storage para las fotos");
  let colocadas: FotoColocada[];
  let rutas: string[];
  try {
    ({ colocadas, rutas } = await colocarFotos(opciones.cubo, s.autor.correo, fotos, rutaApartada));
  } catch (e) {
    if (e instanceof ErrorFotos) throw new ErrorTransaccion("PETICION", e.message);
    throw e;
  }
  try {
    const r = await transaccion(db, correo, peticion, opciones, new Map(colocadas.map((f) => [f.handle, f])), aplicando);
    await borrarApartadas(opciones.cubo, s.autor.correo, fotos).catch(() => undefined);
    return r;
  } catch (e) {
    await quitarFicheros(opciones.cubo, rutas);
    throw e;
  }
}

/** El administrador la rechaza (DA-19 a), con un comentario opcional; sus
 * fotos apartadas se borran. */
export async function rechazarSolicitud(db: Firestore, correoToken: string, entrada: unknown, opciones: Opciones = {}): Promise<{ solicitud: string }> {
  const correo = correoToken.toLowerCase();
  const { id, comentario } = leerResolucion(entrada);
  const ahora = opciones.ahora ?? (() => new Date());
  const ref = db.doc(`solicitudes/${id}`);
  const fotos = await db.runTransaction(async (tx) => {
    const [docInvitacion, doc] = await tx.getAll(db.doc(`invitaciones/${correo}`), ref);
    const invitacion = leerInvitacion(docInvitacion.data());
    if (!invitacion) throw new ErrorTransaccion("ACCESO", "Sin invitación activa");
    if (invitacion.rol !== "administrador") throw new ErrorTransaccion("SIN_PERMISO", "Solo el administrador rechaza solicitudes");
    if (!doc.exists) throw new ErrorTransaccion("PETICION", "No existe la solicitud");
    const s = doc.data() as Solicitud;
    if (s.estado !== "pendiente") throw new ErrorTransaccion("PETICION", "La solicitud ya no está pendiente");
    tx.update(ref, {
      estado: "rechazada",
      resolucion: { por: { correo, persona: invitacion.persona, rol: invitacion.rol }, fecha: Timestamp.fromDate(ahora()), comentario, cambio: null },
    });
    return { correo: s.autor.correo, ficheros: s.ficheros ?? [] };
  });
  if (fotos.ficheros.length && opciones.cubo) await borrarApartadas(opciones.cubo, fotos.correo, fotos.ficheros).catch(() => undefined);
  return { solicitud: id };
}

/** Su autor la retira mientras esté pendiente (DA-19 a); sus fotos
 * apartadas se borran. */
export async function retirarSolicitud(db: Firestore, correoToken: string, id: unknown, opciones: Opciones = {}): Promise<{ solicitud: string }> {
  const correo = correoToken.toLowerCase();
  if (typeof id !== "string" || !ID_SOLICITUD.test(id)) throw new ErrorTransaccion("PETICION", "Solicitud no válida");
  const ahora = opciones.ahora ?? (() => new Date());
  const ref = db.doc(`solicitudes/${id}`);
  const fotos = await db.runTransaction(async (tx) => {
    const [docInvitacion, doc] = await tx.getAll(db.doc(`invitaciones/${correo}`), ref);
    const invitacion = leerInvitacion(docInvitacion.data());
    if (!invitacion) throw new ErrorTransaccion("ACCESO", "Sin invitación activa");
    if (!doc.exists) throw new ErrorTransaccion("PETICION", "No existe la solicitud");
    const s = doc.data() as Solicitud;
    if (s.autor.correo !== correo) throw new ErrorTransaccion("SIN_PERMISO", "Solo la puede retirar quien la hizo");
    if (s.estado !== "pendiente") throw new ErrorTransaccion("PETICION", "La solicitud ya no está pendiente");
    tx.update(ref, {
      estado: "retirada",
      resolucion: { por: { correo, persona: invitacion.persona, rol: invitacion.rol }, fecha: Timestamp.fromDate(ahora()), comentario: null, cambio: null },
    });
    return s.ficheros ?? [];
  });
  if (fotos.length && opciones.cubo) await borrarApartadas(opciones.cubo, correo, fotos).catch(() => undefined);
  return { solicitud: id };
}

