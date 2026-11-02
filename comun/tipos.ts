/**
 * Tipos propios (personalizados) de Gramps: los tipos que no están en la
 * lista de serie de Gramps y que el usuario escribió («Separación», «LVG»…).
 * Gramps los guarda con el texto en «string»; los de serie, con «string»
 * vacío y solo el número. En la web, los del catálogo van como código
 * («@separacion», más abajo); los demás, como texto libre.
 *
 * Decisión de Carlos del 25/10/2026 (docs/decisiones-web-familiar.md): todos
 * eligen de la lista (los de serie, en su idioma, más los propios que ya hay
 * en el árbol) y solo el administrador puede añadir un tipo nuevo; el de
 * los demás va como solicitud (paso 12). La web ofrece la lista y el
 * servidor lo comprueba en cada guardado, con la lista de tipos propios
 * conocidos que guarda en sistema/contadores.
 */
import { esMapa } from "./gramps.ts";
import catalogo from "./tipos-propios.json" with { type: "json" };

/** Tipos propios por clase de tipo («EventType» → [«@separacion», «LVG», …]). */
export type TiposPropios = Record<string, string[]>;

// ---- Catálogo de códigos (docs/idiomas.md, apartado 3) ----
//
// Los tipos propios conocidos se guardan como código: «string» lleva «@» y
// el código («@separacion»), y la web lo muestra en el idioma de cada uno.
// Los demás siguen como texto libre. La migración convierte en los dos
// sentidos (migracion/tipos_propios.py, con el mismo catálogo y los mismos
// casos de prueba, comun/tipos-propios.casos.json).

export interface EntradaCatalogo {
  clase: string;
  /** Sin la «@». */
  codigo: string;
  /** Texto en cada idioma; el de «es», el de reserva. */
  textos: Record<string, string>;
  /** Otros textos que se convierten en este código. */
  sinonimos: string[];
}

export const MARCA_CODIGO = "@";
export const CATALOGO: readonly EntradaCatalogo[] = catalogo.tipos;

/** Para comparar textos de tipos: sin mayúsculas, acentos ni espacios de
 * más (igual que `normalizar` en migracion/tipos_propios.py). */
export function normalizarTipo(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Si un «string» de tipo es un código («@…»). */
export const esCodigo = (s: unknown): s is string => typeof s === "string" && s.startsWith(MARCA_CODIGO);

/** La entrada del catálogo de un código de esa clase, si existe. */
export function entradaCodigo(clase: string, codigo: string): EntradaCatalogo | undefined {
  return esCodigo(codigo) ? CATALOGO.find((e) => e.clase === clase && MARCA_CODIGO + e.codigo === codigo) : undefined;
}

/** Las entradas del catálogo de una clase de tipo. */
export const entradasClase = (clase: string): EntradaCatalogo[] => CATALOGO.filter((e) => e.clase === clase);

/** El texto de una entrada en un idioma (si no lo tiene, el castellano). */
export const textoEntrada = (e: EntradaCatalogo, idioma: string): string => e.textos[idioma] ?? e.textos.es;

/** El código («@…») de un texto de esa clase (su texto en cualquier
 * idioma, el código sin «@» o un sinónimo), o null si no está en el
 * catálogo. */
export function codigoDe(clase: string, texto: string): string | null {
  const n = normalizarTipo(texto);
  if (!n || n.startsWith(MARCA_CODIGO)) return null;
  const e = entradasClase(clase).find((x) => [x.codigo, ...Object.values(x.textos), ...x.sinonimos].some((s) => normalizarTipo(s) === n));
  return e ? MARCA_CODIGO + e.codigo : null;
}

/** Los códigos de un objeto que no están en el catálogo (con su clase):
 * una petición que los lleva está mal hecha. */
export function codigosDesconocidos(objeto: unknown): { clase: string; texto: string }[] {
  const salida: { clase: string; texto: string }[] = [];
  for (const [clase, lista] of Object.entries(tiposPropios([objeto]))) {
    for (const texto of lista) if (esCodigo(texto) && !entradaCodigo(clase, texto)) salida.push({ clase, texto });
  }
  return salida;
}

/** Un tipo de Gramps: un mapa cuya clase acaba en «Type» (EventType,
 * NameType, PlaceType, ChildRefType…). */
const esTipoGramps = (v: Record<string, unknown>) => typeof v._class === "string" && v._class.endsWith("Type");

/** Recorre un objeto de Gramps y anota sus tipos propios en `salida`. */
function anotar(v: unknown, salida: Map<string, Set<string>>): void {
  if (Array.isArray(v)) {
    for (const x of v) anotar(x, salida);
    return;
  }
  if (!esMapa(v)) return;
  if (esTipoGramps(v)) {
    if (typeof v.string === "string" && v.string !== "") {
      const clase = v._class as string;
      if (!salida.has(clase)) salida.set(clase, new Set());
      salida.get(clase)!.add(v.string);
    }
    return;
  }
  for (const x of Object.values(v)) anotar(x, salida);
}

const aObjeto = (m: Map<string, Set<string>>): TiposPropios =>
  Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([c, s]) => [c, [...s].sort()]));

/** Los tipos propios de unos objetos de Gramps. */
export function tiposPropios(objetos: Iterable<unknown>): TiposPropios {
  const m = new Map<string, Set<string>>();
  for (const o of objetos) anotar(o, m);
  return aObjeto(m);
}

/** Suma de dos listas de tipos propios. */
export function unirTipos(a: TiposPropios, b: TiposPropios): TiposPropios {
  const m = new Map<string, Set<string>>();
  for (const t of [a, b]) for (const [c, l] of Object.entries(t)) for (const s of l) {
    if (!m.has(c)) m.set(c, new Set());
    m.get(c)!.add(s);
  }
  return aObjeto(m);
}

/** Los tipos propios de `despues` que no están ni en `antes` (el mismo
 * objeto antes del cambio) ni entre los conocidos del árbol. Los códigos del
 * catálogo nunca son nuevos, aunque nadie los use todavía. */
export function tiposNuevos(despues: unknown, antes: unknown, conocidos: TiposPropios): { clase: string; texto: string }[] {
  const ya = unirTipos(conocidos, tiposPropios([antes]));
  const salida: { clase: string; texto: string }[] = [];
  for (const [clase, lista] of Object.entries(tiposPropios([despues]))) {
    for (const texto of lista) if (!ya[clase]?.includes(texto) && !entradaCodigo(clase, texto)) salida.push({ clase, texto });
  }
  return salida;
}
