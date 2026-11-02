/**
 * Borrar una ficha entera (persona, familia o lugar; fase 3, paso 12;
 * docs/edicion.md, «Borrar»): la petición que la borra y deja el árbol
 * coherente, como hace Gramps (gramps/gen/db/base.py,
 * delete_person_from_database y remove_family_relationships):
 *
 * - quita las referencias a lo borrado de las fichas que lo usan (el padre o
 *   la madre de una familia, un hijo, las familias de una persona, el lugar
 *   de un evento, una asociación, un enlace en el texto de una nota…),
 *   ajustando los índices de nacimiento y defunción de las personas;
 * - borra las familias que se quedan sin padre, sin madre y sin hijos;
 * - y, con DA-21 a, los eventos y las notas que solo usaba lo que se borra
 *   (también las notas de esos eventos). Las fotos se conservan.
 *
 * La usan la web (el administrador borra; los demás lo mandan como
 * solicitud) y, al aplicar una solicitud, el servidor.
 */
import { clave, deClave, esMapa, type ObjetoGramps, type Tipo } from "./gramps.ts";
import type { Indice } from "./indice.ts";
import type { ObjetoPeticion } from "./peticion.ts";
import { referenciasDe } from "./referencias.ts";

export const BORRABLES: Tipo[] = ["Person", "Family", "Place"];

export interface Ficha {
  tipo: Tipo;
  handle: string;
}

/** Un objeto del árbol tal como está (null si no existe). */
export type Obtener = (tipo: Tipo, handle: string) => ObjetoGramps | null | undefined;

/** Campos con un handle suelto y lo que queda al quitarlo. */
const SUELTOS: Record<string, null | ""> = { father_handle: null, mother_handle: null, famc: null, place: "", source_handle: "" };

const refsEventos = (p: ObjetoGramps): unknown[] =>
  (Array.isArray(p.event_ref_list) ? p.event_ref_list : []).map((r) => (esMapa(r) ? r.ref : null));

/** El objeto sin ninguna referencia a `handle` (de tipo `tipo`), a cualquier
 * profundidad. En una persona, los índices de nacimiento y defunción siguen
 * apuntando al mismo evento (o a ninguno, si es el que se quita). */
export function sinReferencia(obj: ObjetoGramps, tipo: Tipo, handle: string): ObjetoGramps {
  const enlace = `gramps://${tipo}/handle/${handle}`;
  const fuera = (x: unknown) =>
    x === handle || (esMapa(x) && (x.ref === handle || (x._class === "StyledTextTag" && x.value === enlace)));
  const limpiar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.filter((x) => !fuera(x)).map(limpiar);
    if (esMapa(v)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k in SUELTOS && x === handle ? SUELTOS[k] : limpiar(x)]));
    }
    return v;
  };
  const d = limpiar(obj) as ObjetoGramps;
  if (obj._class === "Person") {
    const antes = refsEventos(obj);
    const despues = refsEventos(d);
    for (const campo of ["birth_ref_index", "death_ref_index"]) {
      const i = obj[campo];
      const ref = typeof i === "number" && i >= 0 ? antes[i] : null;
      d[campo] = ref ? despues.indexOf(ref) : -1;
    }
  }
  return d;
}

const vacia = (f: ObjetoGramps) =>
  !f.father_handle && !f.mother_handle && !(Array.isArray(f.child_ref_list) && f.child_ref_list.length);

/**
 * La petición que borra la ficha `tipo`/`handle`: primero la ficha, luego
 * lo que se borra con ella y por último las fichas que cambian. Devuelve
 * también lo que se borra con ella (`arrastrados`), para enseñarlo antes.
 */
export function peticionBorrado(indice: Indice, obtener: Obtener, tipo: Tipo, handle: string): { objetos: ObjetoPeticion[]; arrastrados: Ficha[] } {
  const principal = clave(tipo, handle);
  const borrar = new Set([principal]);
  let cambiados = new Map<string, ObjetoGramps>();
  // Hasta que no se añada nada: cada vuelta, desde cero con lo que se borra.
  for (let otra = true; otra;) {
    otra = false;
    cambiados = new Map();
    for (const k of borrar) {
      const b = deClave(k);
      for (const r of indice.referentesDe(b.tipo, b.handle)) {
        if (borrar.has(r)) continue;
        const x = deClave(r);
        const actual = cambiados.get(r) ?? obtener(x.tipo, x.handle);
        if (actual) cambiados.set(r, sinReferencia(actual, b.tipo, b.handle));
      }
    }
    const anadir = (k: string) => {
      if (borrar.has(k)) return;
      borrar.add(k);
      otra = true;
    };
    // Familias que se quedan vacías.
    for (const [k, o] of cambiados) if (deClave(k).tipo === "Family" && vacia(o)) anadir(k);
    // Eventos y notas que solo usa lo que se borra.
    for (const k of [...borrar]) {
      const b = deClave(k);
      const o = obtener(b.tipo, b.handle);
      for (const r of o ? referenciasDe(o) : []) {
        if (r.tipo !== "Event" && r.tipo !== "Note") continue;
        const usan = indice.referentesDe(r.tipo, r.handle);
        if (usan.length && usan.every((u) => borrar.has(u))) anadir(clave(r.tipo, r.handle));
      }
    }
  }
  const objetos: ObjetoPeticion[] = [];
  const version = (o: ObjetoGramps | null | undefined) => (o && typeof o.change === "number" ? o.change : 0);
  for (const k of borrar) {
    const b = deClave(k);
    objetos.push({ tipo: b.tipo, handle: b.handle, operacion: "borrar", base: version(obtener(b.tipo, b.handle)), despues: null });
  }
  for (const [k, d] of cambiados) {
    const x = deClave(k);
    objetos.push({ tipo: x.tipo, handle: x.handle, operacion: "modificar", base: version(obtener(x.tipo, x.handle)), despues: d });
  }
  return { objetos, arrastrados: [...borrar].filter((k) => k !== principal).map(deClave) };
}
