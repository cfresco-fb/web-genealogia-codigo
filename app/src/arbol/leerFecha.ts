// Lectura de las fechas escritas en el campo de fecha de los formularios
// (respuesta de Carlos del 24/10/2026, «Formularios (inventario)» en
// docs/decisiones-web-familiar.md): acepta el formato de la web («3 de mayo
// de 1950», «antes del 12 de mayo de 1900», «del 1 de enero de 1900 al 5 de
// marzo de 1901»), el numérico de la región del usuario («03/05/1950») y el
// de Gramps de escritorio («3 mayo 1950»); el campo muestra siempre el de la
// web (textoFecha). Las fechas aproximadas, con «hacia», «c.», «c», «ca.» o
// «circa» (31/10/2026). Lo que no se entiende queda como «solo texto», igual que
// en Gramps.
//
// El análisis es el de gramps-date (parse.ts, en castellano). Antes se
// quitan los «de», «del», «el» y «al» que el formato de la web pone y Gramps
// no entiende, y se pasan las fechas numéricas al orden día/mes/año.
//
// Comprobado con todas las fechas del árbol de ejemplo y unas hechas a mano
// con Gramps (leerFecha.test.ts): la fecha escrita por la web, y la escrita
// por Gramps, se leen igual que la original, también su sortval.

import { getLocale, Modifier, parseDate, type GrampsDate } from "../gramps-connect/gramps-date";
import { plantilla } from "../../../comun/esquema.ts";
import { idioma } from "../i18n";
import { idiomaRegion, ordenCorto } from "./fechas";

/** La fecha vacía de Gramps (la de un evento sin fecha). */
export function fechaVacia(): GrampsDate {
  return plantilla<GrampsDate>("Date");
}

/** Una fecha de gramps-date con todos los campos de la de Gramps 6 (lleva
 * además `format`, que gramps-date no pone). */
export function completarFecha(f: GrampsDate, anterior?: GrampsDate | null): GrampsDate {
  const base = fechaVacia() as GrampsDate & { format?: unknown };
  return { ...base, ...f, format: (anterior as { format?: unknown } | null | undefined)?.format ?? base.format } as GrampsDate;
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let mesesCache: { codigo: string; re: string } | null = null;

/** Los nombres de los meses en castellano (largos y cortos, y los de los
 * calendarios hebreo, republicano francés, islámico y persa, de
 * gramps-date), para una expresión regular. */
function meses(): string {
  const codigo = idioma().fechas;
  if (mesesCache?.codigo === codigo) return mesesCache.re;
  const l = getLocale(codigo);
  const nombres = [...l.longMonths, ...l.shortMonths, ...l.hebrewMonths, ...l.frenchMonths, ...l.islamicMonths, ...l.persianMonths]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  mesesCache = { codigo, re: nombres.map(escapar).join("|") };
  return mesesCache.re;
}

/** «3 de mayo de 1950» → «3 mayo 1950»; «antes del 12…» → «antes de 12…»;
 * «hacia el 2…» → «hacia 2…»; «del 1… al 5…» → «de 1… a 5…». */
function sinArticulos(s: string): string {
  const m = meses();
  return s
    .replace(new RegExp(String.raw`(\d)\s+de\s+(${m})(?=[\s.,]|$)`, "giu"), "$1 $2")
    .replace(new RegExp(String.raw`(^|[\s(])(${m})(\.?)\s+de\s+(?=-?\d)`, "giu"), "$1$2$3 ")
    .replace(/(^|\s)del\s+(?=\d)/giu, "$1de ")
    .replace(/(^|\s)al\s+(?=\d)/giu, "$1a ")
    .replace(/(^|\s)el\s+(?=\d)/giu, "$1");
}

const AÑO = String.raw`\d{1,4}(?:/\d{1,3})?`;
// El año doble, solo en el último lugar (el del año en casi todas las
// regiones; donde va primero, como en Japón, no se lee en números).
const NUMERICA = new RegExp(String.raw`(^|[^\d/.-])(\d{1,4})([/.-])(\d{1,4})\3(${AÑO})(?![\d/.-])`, "g");

/** Las fechas numéricas en el orden de la región («05/03/1950» en Estados
 * Unidos) pasan al orden día/mes/año que entiende el análisis. Con año
 * doble («24/04/1826/7», que el análisis no entiende en números), con el
 * nombre del mes: «24 abril 1826/7»; y todas con el nombre del mes si
 * `conNombres` (para el análisis en otro idioma, que leería los números en
 * su propio orden). Las que empiezan por el año (ISO) se dejan. */
function numerosEnOrden(s: string, codigo: string, conNombres = false): string {
  const orden = ordenCorto();
  const nombres = getLocale(codigo).longMonths;
  return s.replace(NUMERICA, (t, antes: string, a: string, sep: string, b: string, c: string) => {
    const v: Record<string, string> = {};
    [a, b, c].forEach((x, i) => { v[orden[i]] = x; });
    if (!/^\d{1,2}$/.test(v.day ?? "") || !/^\d{1,2}$/.test(v.month ?? "")) return t;
    if (conNombres || v.year.includes("/")) return `${antes}${Number(v.day)} ${nombres[Number(v.month)] ?? v.month} ${v.year}`;
    return `${antes}${v.day}${sep}${v.month}${sep}${v.year}`;
  });
}

const soloTexto = (f: GrampsDate) => f.modifier === Modifier.TEXTONLY;

/** Lee una fecha escrita. Vacío: null (sin fecha). */
export function leerFecha(texto: string): GrampsDate | null {
  // «c 1850», como «c. 1850» (las dos, «hacia»; «ca.» y «circa» ya los
  // entiende el análisis; 31/10/2026).
  const t = texto.replace(/\s+/g, " ").trim().replace(/(^|\s)c (?=\d)/giu, "$1c. ");
  if (!t) return null;
  const web = idioma().fechas;
  const intentos: [string, string][] = [];
  // La región en otro idioma (en-US…): primero en su idioma, si hay letras.
  // Solo números: con el análisis en castellano, ya en orden.
  const otro = idiomaRegion();
  if (otro && /\p{L}/u.test(t)) intentos.push([numerosEnOrden(t, otro, true), otro]);
  intentos.push([numerosEnOrden(web === "es" ? sinArticulos(t) : t, web), web]);
  for (const [s, codigo] of intentos) {
    const f = parseDate(s, { locale: codigo });
    if (!soloTexto(f)) return completarFecha(f);
  }
  return completarFecha(parseDate(t, { locale: web }));
}
