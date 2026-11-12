/**
 * «Mi familia cercana»: de quién son los aniversarios del correo y de la
 * página «Calendario» si el usuario no elige «Todo el árbol» (Carlos,
 * 11/11/2026; docs/encargo-aniversarios-familia.md y docs/calendario.md).
 *
 * Desde la persona vinculada a la invitación (P):
 *
 * - P, sus cónyuges y todos sus descendientes;
 * - todos los ascendientes de P, sin límite;
 * - los hermanos, los tíos (hermanos de los padres) y los primos hermanos
 *   (hijos de los tíos) de P, cada uno con todos sus descendientes;
 * - lo mismo de cada cónyuge de P que no sea expareja: sus ascendientes; él
 *   y sus hermanos, tíos y primos hermanos, con todos sus descendientes (así
 *   entran también los hijos del cónyuge con otra pareja). Expareja es el
 *   otro miembro de una familia de P con divorcio o separación, salvo que
 *   tengan otra familia sin ellos; su familia no entra (él sí, como
 *   cónyuge). La familia de los cónyuges de los demás no entra;
 * - y todos ellos con sus cónyuges.
 *
 * El parentesco, como en la rama de edición (rama.ts): «hermano» es lo de
 * hermanos() (también medios hermanos y hermanastros), también para los
 * hermanos de los padres; cuentan todas las filiaciones; «cónyuge» es el
 * otro miembro de cualquier familia. Con un conjunto de visitados en cada
 * recorrido, por si hay ciclos.
 */
import type { Indice } from "./indice.ts";
import { ascendientes, conyuges, descendientes, hermanos, hijosDe, padres } from "./rama.ts";

/** Lo que se recorre desde una persona: sus ascendientes; ella y sus
 * hermanos, tíos y primos hermanos, con todos sus descendientes. */
function nucleo(indice: Indice, persona: string, salida: Set<string>): void {
  for (const a of ascendientes(indice, persona, Infinity)) salida.add(a);
  const tios = new Set<string>();
  for (const p of padres(indice, persona)) for (const h of hermanos(indice, p)) tios.add(h);
  const primos = hijosDe(indice, tios, persona);
  for (const r of new Set([persona, ...hermanos(indice, persona), ...tios, ...primos])) {
    salida.add(r);
    for (const d of descendientes(indice, r)) salida.add(d);
  }
}

/** Los cónyuges de la persona que no son exparejas: con alguna familia sin
 * divorcio ni separación (`separadas`, familiasSeparadas de
 * aniversarios.ts). */
export function conyugesNoSeparados(indice: Indice, persona: string, separadas: ReadonlySet<string>): Set<string> {
  const r = new Set<string>();
  for (const f of indice.personas.get(persona)?.f ?? []) {
    const fam = indice.familias.get(f);
    if (!fam || separadas.has(f)) continue;
    const otro = fam.p === persona ? fam.m : fam.m === persona ? fam.p : null;
    if (otro) r.add(otro);
  }
  return r;
}

/** Las personas de la familia cercana de `persona`; null si no hay persona
 * o no está en el árbol (entonces, todo el árbol; Carlos, 11/11/2026). */
export function familiaCercana(indice: Indice, persona: string | null | undefined, separadas: ReadonlySet<string>): Set<string> | null {
  if (!persona || !indice.personas.has(persona)) return null;
  const dentro = new Set<string>();
  nucleo(indice, persona, dentro);
  for (const c of conyugesNoSeparados(indice, persona, separadas)) nucleo(indice, c, dentro);
  // Todos con sus cónyuges (también los de P, aunque sean exparejas).
  for (const x of [...dentro]) for (const c of conyuges(indice, x)) dentro.add(c);
  return dentro;
}
