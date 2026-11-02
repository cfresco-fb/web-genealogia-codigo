// Lo que hacen los formularios de persona y familia (fase 3, paso 10) con
// los datos, sin interfaz (para probarlo): índices de nacimiento y
// defunción, vínculos dobles y el conflicto (DA-14 a).

import { deClave, type ObjetoGramps, type Tipo } from "../../../comun/gramps.ts";
import type { FicheroPeticion, ObjetoPeticion } from "../../../comun/peticion.ts";
import { t } from "../i18n";
import type { Arbol } from "./arbol";
import type { Base, Evento, Familia, Multimedia, Nota, Persona } from "./tipos";

const EV_NACIMIENTO = 12;
const EV_DEFUNCION = 13;
const ROL_PRINCIPAL = 1;

const comoObjeto = (o: unknown) => o as ObjetoGramps;

/** Índices de nacimiento y defunción tras cambiar los eventos, como Gramps:
 * se mantiene el evento que había (en su nueva posición) mientras siga
 * siendo de ese tipo; si no, el primero de ese tipo con papel principal, o
 * ninguno. */
export function indicesVitales(p: Persona, antes: Persona, eventoDe: (h: string) => Evento | null): Pick<Persona, "birth_ref_index" | "death_ref_index"> {
  const indice = (anterior: number, tipo: number) => {
    const deTipo = (i: number) => eventoDe(p.event_ref_list[i].ref)?.type.value === tipo;
    const h = antes.event_ref_list[anterior]?.ref;
    const mismo = h ? p.event_ref_list.findIndex((r) => r.ref === h) : -1;
    if (mismo >= 0 && deTipo(mismo)) return mismo;
    return p.event_ref_list.findIndex((r, i) => r.role.value === ROL_PRINCIPAL && deTipo(i));
  };
  return { birth_ref_index: indice(antes.birth_ref_index, EV_NACIMIENTO), death_ref_index: indice(antes.death_ref_index, EV_DEFUNCION) };
}

/** Los cambios en las personas que hacen falta para que sus vínculos
 * cuadren con la familia (los vínculos dobles). Las personas nuevas, con su
 * lado ya puesto, se crean. */
export function objetosPersonas(
  base: Familia, f: Familia, nuevas: Map<string, Persona>, personaDe: (h: string) => Persona | null,
): ObjetoPeticion[] {
  const padres = (x: Familia) => new Set([x.father_handle, x.mother_handle].filter((h): h is string => !!h));
  const hijos = (x: Familia) => new Set(x.child_ref_list.map((c) => c.ref));
  const [padresAntes, padresDespues, hijosAntes, hijosDespues] = [padres(base), padres(f), hijos(base), hijos(f)];
  const out: ObjetoPeticion[] = [];
  for (const h of new Set([...padresAntes, ...padresDespues, ...hijosAntes, ...hijosDespues])) {
    const nueva = nuevas.get(h);
    const p = nueva ?? personaDe(h);
    if (!p) continue;
    const ajustar = (lista: string[], antes: boolean, despues: boolean) =>
      despues && !lista.includes(f.handle) ? [...lista, f.handle] : !despues && antes ? lista.filter((x) => x !== f.handle) : lista;
    const despues: Persona = {
      ...structuredClone(p),
      family_list: ajustar(p.family_list, padresAntes.has(h), padresDespues.has(h)),
      parent_family_list: ajustar(p.parent_family_list, hijosAntes.has(h), hijosDespues.has(h)),
    };
    if (nueva) {
      if (padresDespues.has(h) || hijosDespues.has(h)) out.push({ tipo: "Person", handle: h, operacion: "crear", base: null, despues: despues as unknown as ObjetoGramps });
    } else if (JSON.stringify(despues) !== JSON.stringify(p)) {
      out.push({ tipo: "Person", handle: h, operacion: "modificar", base: p.change, despues: despues as unknown as ObjetoGramps });
    }
  }
  return out;
}

// ---- Conflicto (DA-14 a) ----

/** Mis cambios sobre la versión nueva: de cada campo de primer nivel, el
 * mío si lo he cambiado y, si no, el de la versión nueva. */
export function reaplicar<T extends object>(base: T, mio: T, actual: T): T {
  const out = { ...actual } as Record<string, unknown>;
  const b = base as Record<string, unknown>;
  for (const [k, v] of Object.entries(mio)) {
    if (k !== "change" && JSON.stringify(v) !== JSON.stringify(b[k])) out[k] = v;
  }
  return out as T;
}

/** Las secciones del formulario que difieren entre dos versiones, con
 * `rotulos` (campo → sección); lo que no está, «Otros datos». */
export function seccionesCambiadas(antes: object, despues: object, rotulos: Record<string, string>, otros = t("formulario.otrosDatos")): string[] {
  const a = antes as Record<string, unknown>;
  const d = despues as Record<string, unknown>;
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(a), ...Object.keys(d)])) {
    if (k === "change" || JSON.stringify(a[k]) === JSON.stringify(d[k])) continue;
    out.add(rotulos[k] ?? otros);
  }
  return [...out];
}

/** La ficha sin ninguna referencia a `handle`, a cualquier profundidad: en
 * listas de handles (note_list…) y de referencias (event_ref_list…). Para
 * quitar un evento o una nota de todas las fichas que lo usan antes de
 * borrarlo (decisión del 27/10/2026). */
export function quitarReferencia<T>(obj: T, handle: string): T {
  const limpiar = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v
        .filter((x) => x !== handle && !(x && typeof x === "object" && (x as { ref?: unknown }).ref === handle))
        .map(limpiar);
    }
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpiar(x)]));
    return v;
  };
  return limpiar(obj) as T;
}

// ---- Borradores de los formularios (SeccionesFormulario.tsx) ----

/** Lo que «Quitar» borra si no lo usa nadie más (27/10/2026; las fotos,
 * desde el 29/10/2026). */
export type Quitable = "Event" | "Note" | "Media";

/** Lo que se ha hecho en el formulario fuera de la propia ficha: eventos
 * nuevos o corregidos (con lo que llevan: lugar nuevo, notas) y notas nuevas
 * o corregidas. */
export interface Borradores {
  eventos: Map<string, { evento: Evento; extras: ObjetoPeticion[] }>;
  notasNuevas: Nota[];
  notasCambiadas: Map<string, Nota>;
  /** Eventos, notas y fotos del árbol quitados de la ficha: de todas las
   * fichas (se borran) o solo de esta. */
  quitados: Map<string, { tipo: Quitable; todos: boolean }>;
  /** Fotos subidas desde el formulario (paso 11 b): el Media nuevo y su
   * subida (subidas.ts). */
  fotos: Map<string, { media: Multimedia; subida: string }>;
  /** Fotos del árbol con otra descripción o fecha (la foto en sí: cambia en
   * todas las fichas que la usan). */
  fotosCambiadas: Map<string, Multimedia>;
}

export const sinBorradores = (): Borradores => ({
  eventos: new Map(), notasNuevas: [], notasCambiadas: new Map(), quitados: new Map(), fotos: new Map(), fotosCambiadas: new Map(),
});

export const hayBorradores = (b: Borradores) =>
  b.eventos.size > 0 || b.notasNuevas.length > 0 || b.notasCambiadas.size > 0 || b.quitados.size > 0 || b.fotos.size > 0 || b.fotosCambiadas.size > 0;

/** Las fotos de los borradores que siguen en la galería (`media`, sus
 * handles), para la petición: las subidas (Media nuevos y sus ficheros) y
 * las del árbol con otra descripción o fecha (sobre su versión en `bases`,
 * si la hay, o en el árbol). Las quitadas antes de guardar no se mandan (la
 * limpieza nocturna borra su subida). */
export function fotosBorradores(
  b: Borradores, media: string[], arbol?: Arbol, bases?: Map<string, Base>,
): { objetos: ObjetoPeticion[]; ficheros: FicheroPeticion[]; subidas: string[] } {
  const fotos = [...b.fotos.values()].filter((f) => media.includes(f.media.handle));
  const cambiadas: ObjetoPeticion[] = [];
  for (const [h, m] of b.fotosCambiadas) {
    const antes = bases?.get(h) ?? arbol?.multimedia.get(h);
    if (!media.includes(h) || !antes) continue;
    cambiadas.push({ tipo: "Media", handle: h, operacion: "modificar", base: antes.change, despues: comoObjeto({ ...m, change: antes.change }) });
  }
  return {
    objetos: [
      ...fotos.map((f): ObjetoPeticion => ({ tipo: "Media", handle: f.media.handle, operacion: "crear", base: null, despues: f.media as unknown as ObjetoGramps })),
      ...cambiadas,
    ],
    ficheros: fotos.map((f) => ({ handle: f.media.handle, subida: f.subida })),
    subidas: fotos.map((f) => f.subida),
  };
}

/** Una ficha que usa un evento o una nota. `objeto`, null si es de un tipo
 * que la web aún no edita (fuentes, citas, repositorios). */
export interface Usuario {
  tipo: Tipo;
  handle: string;
  objeto: Base | null;
}

const TIPOS_WEB = new Set<Tipo>(["Person", "Family", "Event", "Place", "Media", "Note"]);

/** Las demás fichas que usan un evento, una nota o una foto (todas menos
 * `duenio`), con el índice de relaciones, que tiene todos los tipos. */
export function otrosQueUsan(arbol: Arbol, tipo: Quitable, handle: string, duenio: string): Usuario[] {
  return arbol.indiceRelaciones().referentesDe(tipo, handle).map(deClave)
    .filter((r) => r.handle !== duenio)
    .map((r) => ({ ...r, objeto: TIPOS_WEB.has(r.tipo) ? arbol.mapa(r.tipo as never).get(r.handle) ?? null : null }));
}

/** Lo que hay que guardar de los borradores que sigue usando la ficha
 * `duenio` (`eventos`, `notas` y `fotos`, sus listas como quedan), y de los
 * eventos, notas y fotos quitados. `bases`: versiones más nuevas que las del
 * árbol (tras un conflicto). */
export function objetosBorradores(
  b: Borradores, eventos: string[], notas: string[], arbol: Arbol, bases: Map<string, Base>, duenio: string, fotos: string[] = [],
): ObjetoPeticion[] {
  const out: ObjetoPeticion[] = [];
  const base = (h: string, del: Map<string, Base>) => bases.get(h) ?? del.get(h);

  // Lo quitado: qué se borra y qué otras fichas hay que cambiar.
  const borrar = new Map<string, Quitable>();
  const otras = new Map<string, { tipo: Tipo; antes: Base; despues: Base }>();
  for (const [h, { tipo, todos }] of b.quitados) {
    if (eventos.includes(h) || notas.includes(h) || fotos.includes(h)) continue;
    const usan = otrosQueUsan(arbol, tipo, h, duenio);
    // Solo de esta ficha; o de todas, si se pueden editar todas (si no, el
    // diálogo no lo ofrece).
    if (usan.length && (!todos || usan.some((r) => !r.objeto))) continue;
    borrar.set(h, tipo);
    for (const r of usan) {
      const x = otras.get(r.handle);
      const antes = (bases.get(r.handle) ?? r.objeto) as Base;
      otras.set(r.handle, { tipo: r.tipo, antes, despues: quitarReferencia(x?.despues ?? antes, h) });
    }
    // Las notas del evento (o de la foto) que no usa nadie más, también.
    if (tipo === "Event" || tipo === "Media") {
      for (const n of (tipo === "Event" ? arbol.eventos : arbol.multimedia).get(h)?.note_list ?? []) {
        if (otrosQueUsan(arbol, "Note", n, h).length === 0) borrar.set(n, "Note");
      }
    }
  }

  for (const [h, { evento, extras }] of b.eventos) {
    if (!eventos.includes(h)) continue;
    // Un evento de este formulario que tenía una nota quitada de todos.
    let despues: Evento = evento;
    if (otras.has(h)) {
      for (const n of borrar.keys()) despues = quitarReferencia(despues, n);
      otras.delete(h);
    }
    const antes = base(h, arbol.eventos);
    out.push(antes
      ? { tipo: "Event", handle: h, operacion: "modificar", base: antes.change, despues: comoObjeto({ ...despues, change: antes.change }) }
      : { tipo: "Event", handle: h, operacion: "crear", base: null, despues: comoObjeto(despues) });
    out.push(...extras);
  }
  for (const n of b.notasNuevas) {
    if (notas.includes(n.handle)) out.push({ tipo: "Note", handle: n.handle, operacion: "crear", base: null, despues: comoObjeto(n) });
  }
  for (const [h, n] of b.notasCambiadas) {
    if (borrar.has(h)) continue;
    const antes = base(h, arbol.notas)!;
    out.push({ tipo: "Note", handle: h, operacion: "modificar", base: antes.change, despues: comoObjeto({ ...n, change: antes.change }) });
  }
  for (const [h, { tipo, antes, despues }] of otras) {
    let d = despues;
    if (tipo === "Person") {
      const p = d as Persona;
      d = { ...p, ...indicesVitales(p, antes as Persona, (e) => arbol.eventos.get(e) ?? null) } as Base;
    }
    out.push({ tipo, handle: h, operacion: "modificar", base: antes.change, despues: comoObjeto(d) });
  }
  for (const [h, tipo] of borrar) {
    const antes = base(h, tipo === "Event" ? arbol.eventos : tipo === "Note" ? arbol.notas : arbol.multimedia);
    if (antes) out.push({ tipo, handle: h, operacion: "borrar", base: antes.change, despues: null });
  }
  return out;
}
