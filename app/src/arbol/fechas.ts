// Fechas de Gramps: presentación según la región de quien mira y valores
// para ordenar y filtrar.
//
// Decisiones (docs/decisiones-web-familiar.md): «Libro: respuestas…» del
// 22/10/2026 (en castellano, el mes en minúscula y con «de») y «Ajustes,
// persona de inicio, cajas y fechas» del 23/10/2026:
// - tres formatos: largo («3 de mayo de 1950»; fichas, frases del libro),
//   corto numérico («03/05/1950»; listas y cajas del árbol en la web) y
//   abreviado («3 may 1950»; cajas del árbol en los PDF, sin ambigüedad
//   entre países). Las fechas aproximadas, «hacia 1850» en el largo y
//   «c. 1850» en los otros dos (31/10/2026);
// - la región (idioma y país, «es-ES», «en-US») la da el navegador y se
//   puede cambiar en Ajustes. El orden del día, el mes y el año, los
//   separadores y los nombres de los meses salen del formateo regional del
//   navegador (Intl.DateTimeFormat); los modificadores («hacia», «antes
//   de»…), los rangos, la calidad y los calendarios, de gramps-date, en el
//   idioma de la región. En castellano, con las reglas propias de artículo
//   («antes del 12 de mayo de 1900»).
//
// Intl solo da el patrón (el orden y los separadores) y los nombres de los
// meses: los números del día, el mes y el año se ponen tal cual vienen de
// Gramps, sin convertir nada, para que una fecha juliana o un año antes de
// Cristo salgan como en Gramps.

import {
  Calendar, DateFormat, Modifier, Quality, displayIso, formatDate, formatExtras, getLocale, getStartDate, getStopDate,
  isLunarCalendar, loadLocale, resolveLocaleCode, type DateLocale, type DatePart, type GrampsDate,
} from "../gramps-connect/gramps-date";
import { idioma } from "../i18n";

export type FormatoFecha = "largo" | "corto" | "abreviado";

/** Las fechas aproximadas en los formatos corto y abreviado: «c. 1850»
 * (decisión del 31/10/2026; en el largo, «hacia 1850»). */
const CIRCA = "c.";

// ---- Región ----

/** «es-ES», «en-US»…: idioma y país, o null si no se reconoce. */
export function normalizarRegion(etiqueta: string | null | undefined): string | null {
  if (!etiqueta) return null;
  try {
    const l = new Intl.Locale(etiqueta).maximize();
    return l.region ? `${l.language}-${l.region}` : null;
  } catch {
    return null;
  }
}

/** La región del navegador (fuera del navegador, en las pruebas, la del
 * idioma de la web). */
export function regionNavegador(): string {
  if (typeof document === "undefined") return idioma().intl;
  return normalizarRegion(navigator.languages?.[0] ?? navigator.language) ?? idioma().intl;
}

let region = regionNavegador();
/** Código de gramps-date del idioma de la región (null: el castellano de
 * la web, con sus reglas propias). */
let codigoGramps: string | null = null;
const patrones = new Map<string, Pieza[]>();
const meses = new Map<string, string[]>();

/** La región con la que se escriben las fechas ahora. */
export function regionFechas(): string {
  return region;
}

const lenguaje = (r: string) => r.split("-")[0];

/** Carga lo que hace falta para escribir las fechas de `r`: el idioma de
 * la web (siempre) y el de la región en gramps-date. Devuelve el código de
 * gramps-date del idioma de la región, o null si es el de la web. */
async function cargar(r: string): Promise<string | null> {
  const web = idioma().fechas;
  if (web !== "en" && !(await loadLocale(web))) throw new Error(`gramps-date no tiene el idioma «${web}»`);
  if (lenguaje(r) === web) return null;
  // Un idioma que gramps-date no tiene: sus palabras, en inglés.
  const codigo = resolveLocaleCode(r.replace("-", "_")) ?? "en";
  if (codigo !== "en") await loadLocale(codigo);
  return codigo;
}

/** Carga el idioma de las fechas. Hay que esperarla antes de mostrar
 * ninguna fecha. */
export async function prepararFechas(): Promise<void> {
  codigoGramps = await cargar(region);
}

/** Cambia la región de las fechas (null: la del navegador). */
export async function fijarRegion(r: string | null): Promise<void> {
  const nueva = normalizarRegion(r) ?? regionNavegador();
  const codigo = await cargar(nueva);
  region = nueva;
  codigoGramps = codigo;
  patrones.clear();
  meses.clear();
}

// ---- Patrones de Intl ----

type Pieza = { tipo: "day" | "month" | "year" } | { literal: string };
type Partes = "dma" | "ma";

const OPCIONES: Record<FormatoFecha, Intl.DateTimeFormatOptions> = {
  largo: { day: "numeric", month: "long", year: "numeric" },
  corto: { day: "2-digit", month: "2-digit", year: "numeric" },
  abreviado: { day: "numeric", month: "short", year: "numeric" },
};

function formateador(loc: string, formato: FormatoFecha, partes: Partes): Intl.DateTimeFormat {
  const { day: _, ...sinDia } = OPCIONES[formato];
  return new Intl.DateTimeFormat(loc, { timeZone: "UTC", calendar: "gregory", numberingSystem: "latn", ...(partes === "dma" ? OPCIONES[formato] : sinDia) });
}

/** El patrón de la región: en qué orden van el día, el mes y el año, y con
 * qué separadores. */
function patron(loc: string, formato: FormatoFecha, partes: Partes): Pieza[] {
  const clave = `${loc}|${formato}|${partes}`;
  let p = patrones.get(clave);
  if (p) return p;
  // El corto sin día sale del completo quitando el día y su separador:
  // Intl da «9/1926» en España (sin cero) pero «05/09/1926» con día.
  const conDia = partes === "ma" && formato === "corto" ? "dma" : partes;
  p = [];
  for (const x of formateador(loc, formato, conDia).formatToParts(new Date(Date.UTC(2000, 10, 22)))) {
    if (x.type === "day" || x.type === "month" || x.type === "year") p.push({ tipo: x.type });
    else if (x.type === "literal") p.push({ literal: x.value });
  }
  if (conDia !== partes) {
    const i = p.findIndex((x) => "tipo" in x && x.tipo === "day");
    // El separador de después del día o, si el día va el último, el de antes.
    const j = i + 1 < p.length && "literal" in p[i + 1] ? i + 1 : i - 1;
    p = p.filter((_, k) => k !== i && k !== j);
  }
  patrones.set(clave, p);
  return p;
}

/** Nombres de los meses de la región (índice 1 a 12), en la forma que
 * llevan dentro de la fecha (en algunos idiomas cambia con el día). */
function nombresMeses(loc: string, formato: FormatoFecha, partes: Partes): string[] {
  const clave = `${loc}|${formato}|${partes}`;
  let m = meses.get(clave);
  if (m) return m;
  const f = formateador(loc, formato, partes);
  m = [""];
  for (let i = 0; i < 12; i++) {
    m.push(f.formatToParts(new Date(Date.UTC(2000, i, 15))).find((x) => x.type === "month")?.value ?? "");
  }
  meses.set(clave, m);
  return m;
}

// ---- Partes de una fecha ----

/** Año con barra («1749/50», doble fecha de año nuevo), como Gramps. */
function textoAnio(anio: number, barra: boolean): string {
  const a = Math.abs(anio);
  if (!barra) return String(a);
  if ((a - 1) % 100 === 99) return `${a - 1}/${a % 1000}`;
  if ((a - 1) % 10 === 9) return `${a - 1}/${a % 100}`;
  return `${a - 1}/${a % 10}`;
}

/** Calendarios con sus propios meses: van siempre con el nombre del mes,
 * de la traducción de Gramps. */
function mesesPropios(calendario: Calendar, l: DateLocale): readonly string[] | null {
  switch (calendario) {
    case Calendar.HEBREW: return l.hebrewMonths;
    case Calendar.FRENCH: return l.frenchMonths;
    case Calendar.ISLAMIC: return l.islamicMonths;
    case Calendar.PERSIAN: return l.persianMonths;
    default: return null;
  }
}

/** Una parte de la fecha en el formato y la región: «3 de mayo de 1950»,
 * «mayo de 1950», «1950»; «05/1950» en corto. */
function textoParte(p: DatePart, calendario: Calendar, l: DateLocale, loc: string, formato: FormatoFecha): string {
  const [dia, mes, anio, barra] = p;
  // Día sin mes: Gramps lo muestra en formato ISO (su fallo 8477).
  if (dia !== 0 && mes === 0) return displayIso(p, l);
  let texto: string;
  if (mes === 0) {
    texto = textoAnio(anio, barra);
  } else {
    const propios = mesesPropios(calendario, l);
    // Con meses propios (hebreo…), siempre con el nombre, en formato largo.
    const f: FormatoFecha = propios ? "largo" : formato;
    const partes: Partes = dia ? "dma" : "ma";
    const nombre = propios ? (propios[mes] ?? "") : nombresMeses(loc, f, partes)[mes] ?? "";
    texto = patron(loc, f, partes).map((x) => {
      if ("literal" in x) return x.literal;
      if (x.tipo === "year") return textoAnio(anio, barra);
      const n = x.tipo === "day" ? dia : mes;
      if (x.tipo === "month" && f !== "corto") return nombre;
      return f === "corto" ? String(n).padStart(2, "0") : String(n);
    }).join("");
  }
  return anio < 0 ? l.bceFormat.replace("%s", texto) : texto;
}

// ---- Castellano: reglas propias de artículo ----

/** ¿Lleva día (y mes)? Entonces va con artículo: «el 3 de mayo». */
const conDia = (p: DatePart) => p[0] !== 0 && p[1] !== 0;

/** «de»/«del», «a»/«al»: la preposición, con artículo si hay día. */
function prep(palabra: string, p: DatePart, texto: string): string {
  if (!conDia(p)) return `${palabra} ${texto}`;
  if (palabra.endsWith(" de") || palabra === "de") return `${palabra}l ${texto}`;
  if (palabra === "a") return `al ${texto}`;
  return `${palabra} el ${texto}`;
}

/** La fecha sin calidad ni calendario: «hacia 1850», «antes del 12 de mayo
 * de 1900», «entre 1746 y 1755», «del 1 de enero de 1900 al 5 de marzo de
 * 1901». */
function nucleo(f: GrampsDate, l: DateLocale, loc: string, formato: FormatoFecha): string {
  const ini = getStartDate(f);
  const a = textoParte(ini, f.calendar, l, loc, formato);
  switch (f.modifier) {
    case Modifier.BEFORE: return prep("antes de", ini, a);
    case Modifier.AFTER: return prep("después de", ini, a);
    // «hacia» en el largo y «c.» (circa) en los cortos (31/10/2026).
    case Modifier.ABOUT: return formato === "largo" ? prep("hacia", ini, a) : `${CIRCA} ${a}`;
    case Modifier.FROM: return prep("desde", ini, a);
    case Modifier.TO: return prep("hasta", ini, a);
    case Modifier.RANGE: {
      const fin = getStopDate(f);
      return `${prep("entre", ini, a)} ${prep("y", fin, textoParte(fin, f.calendar, l, loc, formato))}`;
    }
    case Modifier.SPAN: {
      const fin = getStopDate(f);
      return `${prep("de", ini, a)} ${prep("a", fin, textoParte(fin, f.calendar, l, loc, formato))}`;
    }
    default: return a;
  }
}

// ---- Otros idiomas: las plantillas de gramps-date ----

function rellenar(plantilla: string, valores: Record<string, string>): string {
  return plantilla.replace(/\{(quality|start|stop|date|calendar)\}/g, (_m, k: string) => valores[k] ?? "");
}

/** Como formatDate de gramps-date, pero con las partes de la fecha en el
 * formato de la región. */
function conPlantillas(f: GrampsDate, l: DateLocale, loc: string, formato: FormatoFecha): string {
  const parte = (p: DatePart, cal: Calendar) => textoParte(p, cal, l, loc, formato);
  const extras = (cal: Calendar, ny: GrampsDate["newyear"]) => formatExtras(cal, ny, l);
  if (l.display) return l.display(f, { locale: l, part: parte, extras });
  const plantillas = l.templates[f.quality] ?? l.templates[0];
  const valores = {
    quality: l.qualityStrings[f.quality] ?? "",
    calendar: extras(f.calendar, f.newyear),
    date: parte(getStartDate(f), f.calendar),
    start: parte(getStartDate(f), f.calendar),
    stop: f.modifier === Modifier.RANGE || f.modifier === Modifier.SPAN ? parte(getStopDate(f), f.calendar) : "",
  };
  if (f.modifier === Modifier.SPAN) return rellenar(plantillas.span, valores);
  if (f.modifier === Modifier.RANGE) return rellenar(plantillas.range, valores);
  return rellenar(plantillas.modifiers[f.modifier] ?? "{quality}{date}{calendar}", valores);
}

// ---- Lo que usa la web ----

const vacia = (f: GrampsDate) => {
  const [d, m, a] = getStartDate(f);
  return d === 0 && m === 0 && a === 0;
};

/** La fecha para mostrar: en formato largo («3 de mayo de 1950», «hacia
 * 1850», «estimado entre 1746 y 1755», «10 de abril de 1700 (Juliano)»),
 * corto («03/05/1950») o abreviado («3 may 1950»), según la región.
 * Cadena vacía si no hay fecha. */
export function textoFecha(fecha: GrampsDate | null | undefined, formato: FormatoFecha = "largo"): string {
  if (!fecha) return "";
  if (fecha.modifier === Modifier.TEXTONLY) return fecha.text;
  if (vacia(fecha)) return "";
  const codigo = codigoGramps ?? idioma().fechas;
  // Los calendarios lunares (chino, coreano, vietnamita), como Gramps.
  if (isLunarCalendar(fecha.calendar)) return formatDate(fecha, { locale: codigo, format: DateFormat.DAY_LONG_MONTH_YEAR });
  const l = getLocale(codigo);
  if (codigoGramps) return conPlantillas(fecha, l, region, formato);
  return `${l.qualityStrings[fecha.quality] ?? ""}${nucleo(fecha, l, region, formato)}${formatExtras(fecha.calendar, fecha.newyear, l)}`;
}

/** La fecha dentro de una frase del libro, como el informe detallado de
 * Gramps: «el 3 de mayo de 1950», «en mayo de 1950», «en 1950», «hacia
 * 1850», «entre 1746 y 1755». La calidad va al final, entre paréntesis
 * («en 1850 (fecha estimada)»), y una fecha que es solo texto, también
 * («(fecha: en la guerra)»), porque no se puede encajar en la frase.
 * Siempre en el idioma de la web (el del texto del libro), con el formato
 * largo de su país. Cadena vacía si no hay fecha. */
export function fraseFecha(fecha: GrampsDate | null | undefined): string {
  if (!fecha) return "";
  if (fecha.modifier === Modifier.TEXTONLY) return fecha.text.trim() ? `(fecha: ${fecha.text.trim()})` : "";
  if (vacia(fecha)) return "";
  const codigo = idioma().fechas;
  if (isLunarCalendar(fecha.calendar)) return formatDate(fecha, { locale: codigo, format: DateFormat.DAY_LONG_MONTH_YEAR });
  const l = getLocale(codigo);
  const loc = `${lenguaje(idioma().intl)}-${region.split("-")[1] ?? ""}`;
  const ini = getStartDate(fecha);
  let texto = nucleo(fecha, l, normalizarRegion(loc) ?? idioma().intl, "largo");
  if (fecha.modifier === Modifier.NONE) texto = conDia(ini) ? `el ${texto}` : `en ${texto}`;
  texto += formatExtras(fecha.calendar, fecha.newyear, l);
  if (fecha.quality === Quality.ESTIMATED) texto += " (fecha estimada)";
  else if (fecha.quality === Quality.CALCULATED) texto += " (fecha calculada)";
  return texto;
}

/** Una fecha y hora de la propia web («Datos actualizados el …»), con el
 * formato largo de la región. */
export function textoMomento(d: Date, conHora = false): string {
  return d.toLocaleString(region, conHora ? { dateStyle: "long", timeStyle: "short" } : { dateStyle: "long" });
}

/** ¿Tiene la fecha algún valor (aunque sea solo texto)? */
export function hayFecha(fecha: GrampsDate | null | undefined): boolean {
  if (!fecha) return false;
  if (fecha.modifier === Modifier.TEXTONLY) return fecha.text.trim() !== "";
  return fecha.dateval[2] !== 0 || fecha.dateval[1] !== 0 || fecha.dateval[0] !== 0;
}

/** Año inicial de la fecha, para filtrar; null si no hay año. Para «antes
 * de 1900» es 1900 y para «entre 1746 y 1755», 1746: el mismo criterio
 * aproximado que Gramps usa al ordenar. */
export function anio(fecha: GrampsDate | null | undefined): number | null {
  if (!fecha || fecha.modifier === Modifier.TEXTONLY) return null;
  const a = fecha.dateval[2];
  return a === 0 ? null : a;
}

/** El año para mostrarlo solo (cajas pequeñas, índices del libro): «1850»
 * o, si la fecha es aproximada, «c. 1850». «antes de» y «después de», solo
 * el año. null si no hay año. */
export function anioSuelto(fecha: GrampsDate | null | undefined): string | null {
  const a = anio(fecha);
  if (a === null) return null;
  return fecha!.modifier === Modifier.ABOUT ? `${CIRCA} ${a}` : String(a);
}

/** Valor para ordenar (número de día juliano que calcula Gramps); null
 * si no hay fecha, para que vaya siempre al final. */
export function valorOrden(fecha: GrampsDate | null | undefined): number | null {
  return fecha && fecha.sortval ? fecha.sortval : null;
}

/** Las posiciones de una lista ordenada por fecha (valorOrden: «antes de»,
 * «después de» y «hacia» como la fecha que llevan; intervalos y rangos, por
 * su primera fecha); las de igual fecha y las que no tienen (o solo texto),
 * en su orden, estas al final. Para mostrar los eventos sin cambiar el orden
 * guardado (decisión del 29/10/2026). */
export function ordenPorFecha(fechas: (GrampsDate | null | undefined)[]): number[] {
  const v = fechas.map(valorOrden);
  return v.map((_, i) => i).sort((a, b) => {
    const x = v[a], y = v[b];
    return x === null ? (y === null ? a - b : 1) : y === null ? -1 : x - y || a - b;
  });
}

/** La lista ordenada por fecha, como ordenPorFecha. */
export const porFecha = <T,>(lista: T[], fecha: (x: T) => GrampsDate | null | undefined): T[] =>
  ordenPorFecha(lista.map(fecha)).map((i) => lista[i]);

/** Orden del día, el mes y el año en el formato corto de la región
 * («03/05/1950» en España, «05/03/1950» en Estados Unidos), para leer las
 * fechas escritas así (leerFecha.ts). */
export function ordenCorto(): ("day" | "month" | "year")[] {
  return patron(region, "corto", "dma").flatMap((x) => ("tipo" in x ? [x.tipo] : []));
}

/** Código de gramps-date del idioma de la región, o null si es el de la
 * web (leerFecha.ts). */
export function idiomaRegion(): string | null {
  return codigoGramps;
}

/** Una fecha de muestra (3 de mayo de 1950) en el formato y la región
 * dados, para enseñar en Ajustes cómo saldrán. */
export function muestraFecha(r: string, formato: FormatoFecha): string {
  return textoParte([3, 5, 1950, false] as DatePart, Calendar.GREGORIAN, getLocale(idioma().fechas), r, formato);
}
