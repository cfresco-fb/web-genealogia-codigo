/**
 * Qué objetos de Gramps referencia un objeto, recorriendo también sus
 * partes (nombres, referencias de eventos, atributos…): el equivalente de
 * get_referenced_handles_recursively() de la biblioteca de Gramps, que
 * sirve de contraste en las pruebas (contraste.test.ts).
 *
 * Se deduce del nombre de cada campo en la serialización JSON de Gramps 6:
 * los campos de handles son siempre los mismos en cualquier parte del
 * objeto. También cuentan los enlaces dentro del texto de las notas
 * («gramps://Person/handle/…»), como en Gramps.
 */
import { esMapa, esTipo, type Tipo } from "./gramps.ts";

/** Listas de handles. */
const LISTAS: Record<string, Tipo> = {
  note_list: "Note",
  citation_list: "Citation",
  tag_list: "Tag",
  family_list: "Family",
  parent_family_list: "Family",
};

/** Listas de referencias ({ref, …}), que pueden llevar a su vez notas y
 * citas. */
const REFERENCIAS: Record<string, Tipo> = {
  event_ref_list: "Event",
  media_list: "Media",
  child_ref_list: "Person",
  person_ref_list: "Person",
  placeref_list: "Place",
  reporef_list: "Repository",
};

/** Campos con un handle suelto. */
const SUELTOS: Record<string, Tipo> = {
  father_handle: "Person",
  mother_handle: "Person",
  place: "Place",
  source_handle: "Source",
  famc: "Family",
};

export interface Referencia {
  tipo: Tipo;
  handle: string;
}

/** Todas las referencias del objeto, sin repetir, en el orden en que
 * aparecen. Los handles vacíos (lugar sin poner…) no cuentan. */
export function referenciasDe(objeto: unknown): Referencia[] {
  const vistas = new Set<string>();
  const salida: Referencia[] = [];
  const anadir = (tipo: Tipo, handle: unknown) => {
    if (typeof handle !== "string" || !handle) return;
    const k = `${tipo}_${handle}`;
    if (vistas.has(k)) return;
    vistas.add(k);
    salida.push({ tipo, handle });
  };
  const recorrer = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) recorrer(x);
      return;
    }
    if (!esMapa(v)) return;
    for (const [campo, x] of Object.entries(v)) {
      if (campo in LISTAS && Array.isArray(x)) {
        for (const h of x) anadir(LISTAS[campo], h);
      } else if (campo in REFERENCIAS && Array.isArray(x)) {
        for (const r of x) {
          if (esMapa(r)) anadir(REFERENCIAS[campo], r.ref);
          recorrer(r);
        }
      } else if (campo in SUELTOS) {
        anadir(SUELTOS[campo], x);
      } else if (campo === "value" && v._class === "StyledTextTag" && typeof x === "string") {
        // Enlace dentro del texto de una nota (StyledTextTagType.LINK).
        const m = /^gramps:\/\/([A-Za-z]+)\/handle\/(.+)$/.exec(x);
        if (m && esTipo(m[1])) anadir(m[1], m[2]);
      } else {
        recorrer(x);
      }
    }
  };
  recorrer(objeto);
  return salida;
}
