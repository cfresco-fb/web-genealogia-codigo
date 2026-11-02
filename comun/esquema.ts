/**
 * Plantillas y esquemas de los objetos de Gramps (gramps/plantillas.json,
 * generado por migracion/plantillas_gramps.py con la biblioteca de Gramps).
 *
 * - plantilla(clase): un objeto vacío de esa clase, con todos sus campos;
 *   los formularios parten de ella.
 * - validar(tipo, objeto): los errores del objeto, o una lista vacía. Lo
 *   comprueba contra el esquema de Gramps (get_schema(): tipos, valores
 *   permitidos, longitudes) y exige que cada parte con «_class» tenga
 *   exactamente los campos de su plantilla, ni más ni menos.
 */
import datos from "./gramps/plantillas.json" with { type: "json" };
import { esMapa, type Tipo } from "./gramps.ts";

type Esquema = {
  type?: string | string[];
  enum?: unknown[];
  oneOf?: Esquema[];
  properties?: Record<string, Esquema>;
  items?: Esquema;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

const PLANTILLAS = datos.plantillas as Record<string, Record<string, unknown>>;
const ESQUEMAS = datos.esquemas as unknown as Record<Tipo, Esquema>;

export const VERSION_GRAMPS_PLANTILLAS: string = datos.version_gramps;

/** Caracteres como mucho del texto de una nota (Carlos, 02/11/2026). Gramps
 * no pone límite; este evita que una nota llene el documento de Firestore
 * (1 MiB) y la instantánea. */
export const MAXIMO_TEXTO_NOTA = 50_000;
ESQUEMAS.Note.properties!.text.properties!.string.maxLength = MAXIMO_TEXTO_NOTA;

/** Copia nueva de la plantilla de una clase de Gramps. */
export function plantilla<T = Record<string, unknown>>(clase: string): T {
  const p = PLANTILLAS[clase];
  if (!p) throw new Error(`No hay plantilla de ${clase}`);
  return structuredClone(p) as T;
}

const esDeTipo = (t: string, v: unknown): boolean => {
  switch (t) {
    case "string": return typeof v === "string";
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    case "array": return Array.isArray(v);
    case "object": return esMapa(v);
    default: return false;
  }
};

function comprobar(esq: Esquema, v: unknown, ruta: string, errores: string[]): void {
  if (esq.oneOf) {
    const alguno = esq.oneOf.some((e) => {
      const err: string[] = [];
      comprobar(e, v, ruta, err);
      return !err.length;
    });
    if (!alguno) errores.push(`${ruta}: no encaja en ninguna de las formas posibles`);
    return;
  }
  if (esq.type !== undefined) {
    const tipos = Array.isArray(esq.type) ? esq.type : [esq.type];
    if (!tipos.some((t) => esDeTipo(t, v))) {
      errores.push(`${ruta}: se esperaba ${tipos.join(" o ")}`);
      return;
    }
  }
  if (esq.enum && !esq.enum.includes(v)) errores.push(`${ruta}: valor no permitido (${JSON.stringify(v)})`);
  if (typeof v === "string" && esq.maxLength !== undefined && v.length > esq.maxLength) errores.push(`${ruta}: más de ${esq.maxLength} caracteres`);
  if (typeof v === "number") {
    if (esq.minimum !== undefined && v < esq.minimum) errores.push(`${ruta}: menor que ${esq.minimum}`);
    if (esq.maximum !== undefined && v > esq.maximum) errores.push(`${ruta}: mayor que ${esq.maximum}`);
  }
  if (Array.isArray(v)) {
    if (esq.minItems !== undefined && v.length < esq.minItems) errores.push(`${ruta}: menos de ${esq.minItems} elementos`);
    if (esq.maxItems !== undefined && v.length > esq.maxItems) errores.push(`${ruta}: más de ${esq.maxItems} elementos`);
    if (esq.items) v.forEach((x, i) => comprobar(esq.items!, x, `${ruta}[${i}]`, errores));
  }
  if (esMapa(v) && esq.properties) {
    for (const [campo, sub] of Object.entries(esq.properties)) {
      if (campo in v) comprobar(sub, v[campo], `${ruta}.${campo}`, errores);
    }
  }
}

/** Cada parte con «_class» tiene exactamente los campos de su plantilla. */
function comprobarCampos(v: unknown, ruta: string, errores: string[]): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => comprobarCampos(x, `${ruta}[${i}]`, errores));
    return;
  }
  if (!esMapa(v)) return;
  const clase = v._class;
  if (typeof clase === "string") {
    const p = PLANTILLAS[clase];
    if (!p) {
      errores.push(`${ruta}: clase desconocida ${clase}`);
    } else {
      const faltan = Object.keys(p).filter((k) => !(k in v));
      const sobran = Object.keys(v).filter((k) => !(k in p));
      if (faltan.length) errores.push(`${ruta}: faltan ${faltan.join(", ")}`);
      if (sobran.length) errores.push(`${ruta}: sobran ${sobran.join(", ")}`);
    }
  }
  for (const [k, x] of Object.entries(v)) comprobarCampos(x, `${ruta}.${k}`, errores);
}

export function validar(tipo: Tipo, objeto: unknown): string[] {
  const errores: string[] = [];
  if (!esMapa(objeto)) return [`${tipo}: no es un objeto`];
  if (objeto._class !== tipo) errores.push(`${tipo}: _class es ${JSON.stringify(objeto._class)}`);
  comprobar(ESQUEMAS[tipo], objeto, tipo, errores);
  comprobarCampos(objeto, tipo, errores);
  return errores;
}
