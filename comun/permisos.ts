/**
 * Qué puede hacer un usuario con cada objeto (docs/edicion.md, «Permisos»).
 * Lo comprueba la función del servidor en cada guardado y lo usa la web
 * para elegir entre «Editar» y «Proponer cambio». Decisiones en
 * docs/decisiones-web-familiar.md («Permisos de edición» y «Fase 3:
 * decisiones del diseño»):
 *
 * - Crear: todo lo nuevo se añade sin pedir permiso, salvo etiquetas (solo
 *   el administrador, DA-9).
 * - Borrar (y quitar vínculos, DA-10): solo el administrador; los demás,
 *   por solicitud. Salvo eventos y notas (decisión del 27/10/2026): al
 *   quitarlos de una ficha, si no los usa nadie más o se quitan de todas, se
 *   borran para que no queden sueltos; los borra quien puede modificarlos
 *   (todo lo que los usaba se puede modificar).
 * - Modificar:
 *   - administrador: todo;
 *   - personas: las de su rama y las que creó él (DA-7 b);
 *   - familias: las de su rama (DA-5 b) y las que creó él (como DA-7;
 *     respuesta de Carlos del 24/10/2026);
 *   - lugares, fuentes y repositorios (DA-9): solo su creador;
 *   - eventos, notas (DA-8), citas y fotos (DA-9): si todo lo que los usa se
 *     puede modificar (también por haberlo creado él: los eventos de una
 *     persona que creó cuentan como suyos); si nada los usa, solo su
 *     creador;
 *   - etiquetas: solo el administrador.
 * El revisor, con su rama, como un familiar (DA-11 a).
 */
import type { ObjetoGramps, Tipo } from "./gramps.ts";
import { deClave } from "./gramps.ts";
import type { Indice } from "./indice.ts";
import type { Operacion } from "./peticion.ts";
import type { Rama } from "./rama.ts";
import { tiposNuevos, type TiposPropios } from "./tipos.ts";

export type Rol = "administrador" | "revisor" | "familiar";

export interface Usuario {
  correo: string;
  rol: Rol;
  /** Persona vinculada a la invitación, o null. */
  persona: string | null;
}

export interface ContextoPermisos {
  usuario: Usuario;
  indice: Indice;
  rama: Rama;
  /** Correo de quien creó el objeto desde la web (datosWeb), o null si es
   * de la migración. */
  creador: (tipo: Tipo, handle: string) => string | null;
}

/** Por qué no se puede: para el mensaje y la solicitud. */
export type Razon =
  | "fueraDeRama"        // persona o familia fuera de la rama
  | "noEsCreador"        // lugar, fuente o repositorio que no creó
  | "usadoFueraDeRama"   // evento, nota, cita o foto usado por algo que no puede tocar
  | "sinUso"             // evento, nota, cita o foto que nada usa (ver docs/edicion.md)
  | "soloAdministrador"  // etiquetas y borrados
  | "quitaVinculo"       // quita un vínculo entre personas y familias (DA-10 b)
  | "tipoNuevo";         // tipo propio que no está en el árbol (comun/tipos.ts)

export type Permiso = { ok: true } | { ok: false; razon: Razon };

const SI: Permiso = { ok: true };
const no = (razon: Razon): Permiso => ({ ok: false, razon });

const POR_USO = new Set<Tipo>(["Event", "Note", "Citation", "Media"]);
const POR_CREADOR = new Set<Tipo>(["Place", "Source", "Repository"]);

export function puedeCrear(ctx: ContextoPermisos, tipo: Tipo): Permiso {
  if (ctx.usuario.rol === "administrador") return SI;
  return tipo === "Tag" ? no("soloAdministrador") : SI;
}

export function puedeBorrar(ctx: ContextoPermisos, tipo: Tipo, handle: string): Permiso {
  if (ctx.usuario.rol === "administrador") return SI;
  // Eventos, notas y (29/10/2026) fotos que se quitan de las fichas que los
  // usan: quien puede modificarlos.
  return tipo === "Event" || tipo === "Note" || tipo === "Media" ? puedeModificar(ctx, tipo, handle) : no("soloAdministrador");
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const hijosDe = (o: ObjetoGramps) =>
  (Array.isArray(o.child_ref_list) ? o.child_ref_list : []).map((c) => (c as { ref?: unknown }).ref).filter((x): x is string => typeof x === "string");

/** ¿Quita el cambio algún vínculo entre personas y familias? En una
 * familia, el padre o la madre (también cambiarlos por otro) o un hijo; en
 * una persona, una de sus familias o de sus familias de padres. Es borrado
 * (DA-10 b): solo el administrador; los demás, por solicitud. */
export function quitaVinculos(tipo: Tipo, antes: ObjetoGramps, despues: ObjetoGramps): boolean {
  const quita = (a: string[], d: string[]) => a.some((x) => !d.includes(x));
  if (tipo === "Family") {
    for (const campo of ["father_handle", "mother_handle"]) {
      if (antes[campo] && antes[campo] !== despues[campo]) return true;
    }
    return quita(hijosDe(antes), hijosDe(despues));
  }
  if (tipo === "Person") {
    return quita(lista(antes.family_list), lista(despues.family_list)) || quita(lista(antes.parent_family_list), lista(despues.parent_family_list));
  }
  return false;
}

export function puedeModificar(ctx: ContextoPermisos, tipo: Tipo, handle: string): Permiso {
  return modificar(ctx, tipo, handle, new Set());
}

function modificar(ctx: ContextoPermisos, tipo: Tipo, handle: string, enCurso: Set<string>): Permiso {
  const { usuario, rama } = ctx;
  if (usuario.rol === "administrador") return SI;
  const esCreador = ctx.creador(tipo, handle) === usuario.correo;
  if (tipo === "Tag") return no("soloAdministrador");
  if (tipo === "Person") return rama.personas.has(handle) || esCreador ? SI : no("fueraDeRama");
  if (tipo === "Family") return rama.familias.has(handle) || esCreador ? SI : no("fueraDeRama");
  if (POR_CREADOR.has(tipo)) return esCreador ? SI : no("noEsCreador");
  if (POR_USO.has(tipo)) {
    const k = `${tipo}_${handle}`;
    // Una nota que se cita a sí misma por el camino (nota → cita → nota):
    // lo que ya se está comprobando no añade nada.
    if (enCurso.has(k)) return SI;
    const usos = ctx.indice.referentesDe(tipo, handle);
    if (!usos.length) return esCreador ? SI : no("sinUso");
    enCurso.add(k);
    try {
      for (const u of usos) {
        const r = deClave(u);
        if (!modificar(ctx, r.tipo, r.handle, enCurso).ok) return no("usadoFueraDeRama");
      }
      return SI;
    } finally {
      enCurso.delete(k);
    }
  }
  return no("soloAdministrador");
}

/** Un objeto de una petición, con cómo estaba antes (null si se crea). */
export interface CambioPermiso {
  tipo: Tipo;
  handle: string;
  operacion: Operacion;
  antes: ObjetoGramps | null;
  despues: ObjetoGramps | null;
}

export interface NoPermitido {
  tipo: Tipo;
  handle: string;
  razon: Razon;
  /** Con `tipoNuevo`, los tipos nuevos (clase «EventType», texto «Bautizo
   * civil»…), para decirlos en la solicitud. */
  tipos?: { clase: string; texto: string }[];
}

/** Lo que no puede hacer el usuario de una petición entera: los permisos
 * de cada objeto, quitar vínculos (DA-10 b) y los tipos propios nuevos
 * (solo el administrador, decisión del 25/10/2026; `tiposConocidos`, los
 * del árbol). Vacío si se puede guardar; si no, es una solicitud (paso 12).
 * La misma comprobación en el servidor y en la web. */
export function noPermitidos(ctx: ContextoPermisos, cambios: CambioPermiso[], tiposConocidos: TiposPropios): NoPermitido[] {
  if (ctx.usuario.rol === "administrador") return [];
  const salida: NoPermitido[] = [];
  for (const c of cambios) {
    const p = c.operacion === "crear" ? puedeCrear(ctx, c.tipo) : c.operacion === "borrar" ? puedeBorrar(ctx, c.tipo, c.handle) : puedeModificar(ctx, c.tipo, c.handle);
    if (!p.ok) salida.push({ tipo: c.tipo, handle: c.handle, razon: p.razon });
    else if (c.operacion === "modificar" && c.antes && c.despues && quitaVinculos(c.tipo, c.antes, c.despues)) {
      salida.push({ tipo: c.tipo, handle: c.handle, razon: "quitaVinculo" });
    }
  }
  for (const c of cambios) {
    const nuevos = c.despues ? tiposNuevos(c.despues, c.antes, tiposConocidos) : [];
    if (nuevos.length) salida.push({ tipo: c.tipo, handle: c.handle, razon: "tipoNuevo", tipos: nuevos });
  }
  return salida;
}
