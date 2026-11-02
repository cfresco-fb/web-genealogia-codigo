/**
 * Rama editable de un usuario vinculado a la persona P (decisiones
 * «Permisos de edición (regla de rama)» y «Fase 3: decisiones del diseño»
 * en docs/decisiones-web-familiar.md):
 *
 * - P, sus padres y sus abuelos;
 * - todos los descendientes de P, sin límite;
 * - los cónyuges de P y de cada descendiente, y los padres y abuelos de
 *   cada uno de esos cónyuges;
 * - y lo mismo para cada hermano de P y para cada hermano de cada cónyuge
 *   de P (no de los cónyuges de sus descendientes): «Ampliación de la
 *   rama», 24/10/2026, que sustituye a «nada lateral»), y para cada hijastro
 *   (hijo de un cónyuge con otra pareja) de P y de cualquiera que esté en
 *   la rama como raíz o descendiente de una raíz: de los hermanos, de los
 *   hijos, de los propios hijastros… (respuestas del 25/10/2026). Siguen
 *   fuera los tíos y los primos.
 *
 * «Hermano» es toda persona que comparte con P al menos un padre o una
 * madre, con cualquier filiación (DA-3 a), y los hijos que el cónyuge de un
 * padre de P tuvo con otra pareja (respuesta del 25/10/2026): los hijos de
 * todas las familias de cada padre de P y de cada cónyuge de ese padre, y
 * los demás hijos de las familias de P como hijo. Así entran los hermanos,
 * los medios hermanos y los hermanastros, tanto los que clasifica Gramps
 * (get_sibling_type: hijos de una misma familia en la que alguno no es hijo
 * de nacimiento) como los que no tienen ningún padre en común con P.
 *
 * Con las respuestas de Carlos: cuentan todas las filiaciones (DA-3 a);
 * «cónyuge» es el otro miembro de cualquier familia, también «Sin relación
 * de pareja» y «Desconocido» (DA-4 a); una familia está en la rama si al
 * menos uno de los dos miembros de la pareja (padre o madre) está en ella
 * (DA-5 b).
 *
 * Se calcula desde el índice de relaciones (indice.ts), en el servidor en
 * cada guardado (DA-2 a) y en la web para mostrar los botones. Los
 * ascendientes siguen las familias como hijo de cada persona y los
 * descendientes, los hijos de cada familia, como los filtros de Gramps
 * (IsLessThanNthGenerationAncestorOf, IsDescendantOf); con un conjunto de
 * visitados, por si hay ciclos en los datos.
 */
import type { Indice } from "./indice.ts";

export interface Rama {
  personas: Set<string>;
  familias: Set<string>;
}

export const RAMA_VACIA: Rama = { personas: new Set(), familias: new Set() };

/** Generaciones de ascendientes que entran: padres y abuelos. */
const GENERACIONES_ARRIBA = 2;

function padres(indice: Indice, persona: string): string[] {
  const salida: string[] = [];
  for (const f of indice.personas.get(persona)?.pf ?? []) {
    const fam = indice.familias.get(f);
    if (fam?.p) salida.push(fam.p);
    if (fam?.m) salida.push(fam.m);
  }
  return salida;
}

/** Ascendientes hasta `n` generaciones (sin la persona). */
function ascendientes(indice: Indice, persona: string, n: number): Set<string> {
  const salida = new Set<string>();
  let nivel = [persona];
  for (let g = 0; g < n; g++) {
    const siguiente: string[] = [];
    for (const x of nivel) {
      for (const p of padres(indice, x)) {
        if (!salida.has(p) && p !== persona) {
          salida.add(p);
          siguiente.push(p);
        }
      }
    }
    nivel = siguiente;
  }
  return salida;
}

/** Todos los descendientes (sin la persona). */
function descendientes(indice: Indice, persona: string): Set<string> {
  const salida = new Set<string>();
  const pendientes = [persona];
  while (pendientes.length) {
    const x = pendientes.pop()!;
    for (const f of indice.personas.get(x)?.f ?? []) {
      for (const h of indice.familias.get(f)?.h ?? []) {
        if (h.ref !== persona && !salida.has(h.ref)) {
          salida.add(h.ref);
          pendientes.push(h.ref);
        }
      }
    }
  }
  return salida;
}

/** El otro miembro de cada familia propia de la persona. */
function conyuges(indice: Indice, persona: string): string[] {
  const salida: string[] = [];
  for (const f of indice.personas.get(persona)?.f ?? []) {
    const fam = indice.familias.get(f);
    if (!fam) continue;
    const otro = fam.p === persona ? fam.m : fam.m === persona ? fam.p : null;
    if (otro) salida.push(otro);
  }
  return salida;
}

/** Los hijos de todas las familias propias de cada una de esas personas,
 * sin `excepto`. */
function hijosDe(indice: Indice, quienes: Iterable<string>, excepto: string): Set<string> {
  const salida = new Set<string>();
  for (const q of quienes) {
    for (const f of indice.personas.get(q)?.f ?? []) {
      for (const h of indice.familias.get(f)?.h ?? []) if (h.ref !== excepto) salida.add(h.ref);
    }
  }
  return salida;
}

/** Hermanos, medios hermanos y hermanastros de la persona (ver arriba), sin
 * ella. */
export function hermanos(indice: Indice, persona: string): Set<string> {
  const salida = new Set<string>();
  for (const f of indice.personas.get(persona)?.pf ?? []) {
    for (const h of indice.familias.get(f)?.h ?? []) if (h.ref !== persona) salida.add(h.ref);
  }
  for (const p of padres(indice, persona)) {
    for (const h of hijosDe(indice, [p, ...conyuges(indice, p)], persona)) salida.add(h);
  }
  return salida;
}

/** Hijos de los cónyuges de la persona con otras parejas (y los suyos con
 * ellos, que ya son descendientes), sin ella. */
export function hijastros(indice: Indice, persona: string): Set<string> {
  return hijosDe(indice, conyuges(indice, persona), persona);
}

/** La regla de la rama para una persona: ella, sus padres y abuelos, sus
 * descendientes, y los cónyuges de ella y de cada descendiente con sus
 * padres y abuelos. Devuelve los hijastros de ella y de cada descendiente,
 * que se tratan igual (respuesta del 25/10/2026). */
function ramaPropia(indice: Indice, persona: string, personas: Set<string>): Set<string> {
  personas.add(persona);
  for (const a of ascendientes(indice, persona, GENERACIONES_ARRIBA)) personas.add(a);
  const desc = descendientes(indice, persona);
  for (const d of desc) personas.add(d);
  for (const x of [persona, ...desc]) {
    for (const c of conyuges(indice, x)) {
      personas.add(c);
      for (const a of ascendientes(indice, c, GENERACIONES_ARRIBA)) personas.add(a);
    }
  }
  const nuevos = new Set<string>();
  for (const x of [persona, ...desc]) for (const h of hijastros(indice, x)) if (h !== persona && !desc.has(h)) nuevos.add(h);
  return nuevos;
}

export function calcularRama(indice: Indice, persona: string | null | undefined): Rama {
  if (!persona || !indice.personas.has(persona)) return { personas: new Set(), familias: new Set() };
  const raices = new Set<string>([persona, ...hermanos(indice, persona)]);
  for (const c of conyuges(indice, persona)) for (const h of hermanos(indice, c)) raices.add(h);
  // Cada raíz con su rama; los hijastros que aparecen, como raíces nuevas.
  const personas = new Set<string>();
  const pendientes = [...raices];
  while (pendientes.length) {
    for (const h of ramaPropia(indice, pendientes.pop()!, personas)) {
      if (!raices.has(h)) {
        raices.add(h);
        pendientes.push(h);
      }
    }
  }
  // DA-5 b: la familia está en la rama si lo está el padre o la madre.
  const familias = new Set<string>();
  for (const [h, f] of indice.familias) {
    if ((f.p && personas.has(f.p)) || (f.m && personas.has(f.m))) familias.add(h);
  }
  return { personas, familias };
}
