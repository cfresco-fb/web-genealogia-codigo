// Calendario de aniversarios (docs/calendario.md; decisiones de Carlos del
// 01/11/2026 y del 03/11/2026 en docs/decisiones-web-familiar.md,
// «Calendario de aniversarios»). Lo usan la página «Calendario» de la web y
// el correo de aniversarios de las funciones.
//
// - Cuentan solo las fechas exactas del calendario gregoriano (día, mes y
//   año, sin modificador ni calidad, sin intervalos ni texto) de los eventos
//   de nacimiento y defunción de cada persona y del de matrimonio de las
//   familias «Casados» y «Unión civil» sin divorcio ni separación.
// - Vivo o fallecido, según el cálculo de quién se considera vivo
//   (vivos.ts): cumpleaños de los vivos; nacimiento y defunción de los
//   fallecidos; bodas («aniversario de boda» si viven los dos, «se casaron
//   hace» si no).
// - Cada año cuenta. El 29 de febrero, en los años no bisiestos, el 28.
// - Los textos están en la web (app/src/i18n/es.ts, claves «calendario.*»):
//   quien llama pasa su función de traducción.

import { gregorianSdn, gregorianYmd } from "./calendarios.ts";
import type { EventoVivos, FamiliaVivos, FechaGramps, PersonaVivos } from "./vivos.ts";

/** Un día del calendario gregoriano: [año, mes, día]. */
export type Dia = [number, number, number];

export const sdnDia = (d: Dia): number => gregorianSdn(d[0], d[1], d[2]);
export const diaDeSdn = (sdn: number): Dia => gregorianYmd(sdn);
export const sumarDias = (d: Dia, n: number): Dia => diaDeSdn(sdnDia(d) + n);
export const bisiesto = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** 0 = lunes … 6 = domingo (el resto del número de día entre 7). */
export const diaSemana = (d: Dia): number => sdnDia(d) % 7;

/** Hoy en una zona horaria (por defecto, la del sistema). */
export function hoyEn(zona?: string, ahora = new Date()): Dia {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ahora);
  const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return [n("year"), n("month"), n("day")];
}

// Tipos de Gramps (gramps/gen/lib/eventtype.py y familyreltype.py).
const EV_MATRIMONIO = 1;
const EV_DIVORCIO = 7;
const EV_NACIMIENTO = 12;
const EV_DEFUNCION = 13;
const EV_PERSONALIZADO = 0;
const EVENTO_SEPARACION = "@separacion"; // comun/tipos-propios.json
const FAM_CASADOS = 0;
const FAM_UNION_CIVIL = 2;

/** La fecha si es exacta: gregoriana, con día, mes y año, sin modificador
 * («hacia», «antes de»…), sin calidad («estimada», «calculada»), sin
 * intervalo ni texto. */
export function fechaExacta(f: FechaGramps | null | undefined): Dia | null {
  if (!f || f.calendar !== 0 || f.modifier !== 0 || f.quality !== 0) return null;
  const [d, m, y] = f.dateval.map(Number);
  if (!d || !m || !(y > 0) || m > 12 || d > 31) return null;
  return [y, m, d];
}

export type TipoAniversario = "cumpleanos" | "nacimiento" | "defuncion" | "boda";
export const TIPOS_ANIVERSARIO: TipoAniversario[] = ["cumpleanos", "nacimiento", "defuncion", "boda"];

/** Los tipos del correo de un usuario (campo `aniversariosTipos` de sus
 * preferencias; Carlos, 04/11/2026): una lista sin repetir, con alguno,
 * en el orden de siempre. null = todos (sin el campo, o si no vale). */
export function leerTiposCorreo(v: unknown): TipoAniversario[] | null {
  if (!Array.isArray(v) || !v.length || new Set(v).size !== v.length || v.some((x) => !TIPOS_ANIVERSARIO.includes(x))) return null;
  return v.length === TIPOS_ANIVERSARIO.length ? null : TIPOS_ANIVERSARIO.filter((x) => v.includes(x));
}

type TipoG = { value: number | string; string?: string };

/** Lo que el cálculo lee del árbol (la instantánea; los tipos de la web lo
 * cumplen). */
export interface DatosAniversarios {
  personas: ReadonlyMap<string, PersonaVivos>;
  familias: ReadonlyMap<string, FamiliaVivos & { handle: string; type: TipoG }>;
  eventos: ReadonlyMap<string, EventoVivos & { type: TipoG }>;
}

export interface Aniversario {
  tipo: TipoAniversario;
  /** El día en que se cumple. */
  fecha: Dia;
  /** Años que cumple o que hace (año del aniversario menos año del evento). */
  anios: number;
  anioEvento: number;
  /** Cumpleaños y bodas de dos vivos: van antes dentro de cada día. */
  vivos: boolean;
  /** La persona (cumpleaños, nacimiento, defunción) o null. */
  persona: string | null;
  /** La familia (bodas) o null. */
  familia: string | null;
}

interface Origen extends Omit<Aniversario, "fecha" | "anios" | "anioEvento"> {
  dia: Dia;
}

/** Los eventos de los que salen aniversarios, con su fecha exacta. */
function origenes(datos: DatosAniversarios, vivas: ReadonlySet<string>): Origen[] {
  const r: Origen[] = [];
  const fechaDe = (ref: { ref: string } | undefined, tipo: number) => {
    const ev = ref && datos.eventos.get(ref.ref);
    return ev && ev.type.value === tipo ? fechaExacta(ev.date) : null;
  };
  for (const p of datos.personas.values()) {
    const viva = vivas.has(p.handle);
    const nacimiento = fechaDe(p.event_ref_list[p.birth_ref_index], EV_NACIMIENTO);
    if (nacimiento) r.push({ tipo: viva ? "cumpleanos" : "nacimiento", dia: nacimiento, vivos: viva, persona: p.handle, familia: null });
    const defuncion = fechaDe(p.event_ref_list[p.death_ref_index], EV_DEFUNCION);
    if (defuncion) r.push({ tipo: "defuncion", dia: defuncion, vivos: false, persona: p.handle, familia: null });
  }
  for (const f of datos.familias.values()) {
    if (f.type.value !== FAM_CASADOS && f.type.value !== FAM_UNION_CIVIL) continue;
    const eventos = f.event_ref_list.map((x) => datos.eventos.get(x.ref)).filter((e) => !!e);
    const separados = eventos.some((e) => e.type.value === EV_DIVORCIO || (e.type.value === EV_PERSONALIZADO && e.type.string === EVENTO_SEPARACION));
    if (separados) continue;
    // El primer matrimonio, como en la ficha (Arbol.pareja).
    const boda = eventos.find((e) => e.type.value === EV_MATRIMONIO);
    const dia = fechaExacta(boda?.date);
    if (!dia) continue;
    const conyuges = [f.father_handle, f.mother_handle].filter((h): h is string => !!h && datos.personas.has(h));
    r.push({ tipo: "boda", dia, vivos: conyuges.length > 0 && conyuges.every((h) => vivas.has(h)), persona: null, familia: f.handle });
  }
  return r;
}

const ORDEN_TIPO: Record<TipoAniversario, number> = { cumpleanos: 0, boda: 1, nacimiento: 2, defuncion: 3 };

/** Los aniversarios entre dos días (los dos incluidos), por día; dentro de
 * cada día, primero los vivos y después los fallecidos, y en cada grupo
 * por año del evento. */
export function aniversarios(datos: DatosAniversarios, vivas: ReadonlySet<string>, desde: Dia, hasta: Dia): Aniversario[] {
  const inicio = sdnDia(desde);
  const fin = sdnDia(hasta);
  const r: (Aniversario & { sdn: number })[] = [];
  for (const o of origenes(datos, vivas)) {
    const [anioEvento, mes, dia] = o.dia;
    for (let anio = desde[0]; anio <= hasta[0]; anio++) {
      const anios = anio - anioEvento;
      if (anios < 1) continue;
      const fecha: Dia = [anio, mes, mes === 2 && dia === 29 && !bisiesto(anio) ? 28 : dia];
      const sdn = sdnDia(fecha);
      if (sdn < inicio || sdn > fin) continue;
      const { dia: _, ...resto } = o;
      r.push({ ...resto, fecha, anios, anioEvento, sdn });
    }
  }
  r.sort((a, b) => a.sdn - b.sdn || Number(b.vivos) - Number(a.vivos) || a.anioEvento - b.anioEvento
    || ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || (a.persona ?? a.familia ?? "").localeCompare(b.persona ?? b.familia ?? ""));
  return r.map(({ sdn: _, ...a }) => a);
}

/** Agrupados por día, en orden. */
export function porDia(lista: Aniversario[]): { fecha: Dia; aniversarios: Aniversario[] }[] {
  const r: { fecha: Dia; aniversarios: Aniversario[] }[] = [];
  for (const a of lista) {
    const ultimo = r[r.length - 1];
    if (ultimo && sdnDia(ultimo.fecha) === sdnDia(a.fecha)) ultimo.aniversarios.push(a);
    else r.push({ fecha: a.fecha, aniversarios: [a] });
  }
  return r;
}

// ---- Textos ----

/** Las claves de app/src/i18n/es.ts que usan los aniversarios. */
export type ClaveAniversarios =
  | "calendario.tipo.cumpleanos" | "calendario.tipo.nacimiento" | "calendario.tipo.defuncion" | "calendario.tipo.boda"
  | "calendario.cumple" | "calendario.cumpleUno" | "calendario.nacio" | "calendario.nacioUno"
  | "calendario.fallecio" | "calendario.fallecioUno" | "calendario.aniversarioBoda" | "calendario.aniversarioBodaUno"
  | "calendario.seCasaron" | "calendario.seCasaronUno"
  | "calendario.asunto" | "calendario.correoSaludo" | "calendario.correoSaludoSinNombre"
  | "calendario.correoIntroSemana" | "calendario.correoIntroMes" | "calendario.correoSemana" | "calendario.correoMes";
export type Traducir = (clave: ClaveAniversarios, valores?: Record<string, string | number>) => string;

/** «Cumpleaños», «Nacimiento», «Defunción» o «Boda». */
export const nombreTipoAniversario = (a: Aniversario, t: Traducir): string => t(`calendario.tipo.${a.tipo}`);

/** «cumple 80 años», «nació hace 120 años», «falleció hace 30 años»,
 * «aniversario de boda: 25 años» o «se casaron hace 60 años». */
export function textoAniversario(a: Aniversario, t: Traducir): string {
  const base = a.tipo === "cumpleanos" ? "calendario.cumple"
    : a.tipo === "nacimiento" ? "calendario.nacio"
      : a.tipo === "defuncion" ? "calendario.fallecio"
        : a.vivos ? "calendario.aniversarioBoda" : "calendario.seCasaron";
  return a.anios === 1 ? t(`${base}Uno` as ClaveAniversarios) : t(base, { n: a.anios });
}

// ---- Correo ----

export type Suscripcion = "semanal" | "mensual";
export const SUSCRIPCIONES: Suscripcion[] = ["semanal", "mensual"];

export interface Periodo {
  suscripcion: Suscripcion;
  desde: Dia;
  hasta: Dia;
}

/** Lo que toca enviar un día: el correo sale el día anterior al periodo
 * (Carlos, 03/11/2026). El domingo, los de lunes a domingo de la semana
 * siguiente; el último día del mes, los del mes siguiente. */
export function periodosDelDia(hoy: Dia): Periodo[] {
  const manana = sumarDias(hoy, 1);
  const r: Periodo[] = [];
  if (diaSemana(manana) === 0) r.push({ suscripcion: "semanal", desde: manana, hasta: sumarDias(manana, 6) });
  if (manana[2] === 1) {
    const [y, m] = manana;
    r.push({ suscripcion: "mensual", desde: manana, hasta: sumarDias(m === 12 ? [y + 1, 1, 1] : [y, m + 1, 1], -1) });
  }
  return r;
}

const fechaUtc = (d: Dia) => new Date(Date.UTC(d[0], d[1] - 1, d[2]));
const formato = (region: string, opciones: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(region, { timeZone: "UTC", calendar: "gregory", numberingSystem: "latn", ...opciones });

/** La fecha en el formato largo de la región («3 de noviembre de 2026»):
 * el mismo de las fichas de la web (app/src/arbol/fechas.ts) para una
 * fecha gregoriana con día, mes y año. */
export const fechaLarga = (region: string, d: Dia): string =>
  formato(region, { day: "numeric", month: "long", year: "numeric" }).format(fechaUtc(d));

const nombreMes = (region: string, d: Dia) => formato(region, { month: "long" }).format(fechaUtc(d));

/** «Árbol Pérez-Gómez: aniversarios (9–15 nov)» o «…: aniversarios
 * (diciembre)», con el nombre del árbol (el de Ajustes) y en la región del
 * usuario (Carlos, 07/11/2026). */
export function asuntoCorreo(p: Periodo, region: string, t: Traducir, arbol: string): string {
  const periodo = p.suscripcion === "mensual" ? nombreMes(region, p.desde)
    : formato(region, { day: "numeric", month: "short" }).formatRange(fechaUtc(p.desde), fechaUtc(p.hasta));
  return t("calendario.asunto", { arbol, periodo });
}

/** «del 9 al 15 de noviembre», «del 30 de noviembre al 6 de diciembre»,
 * «del 28 de diciembre de 2026 al 3 de enero de 2027» o «de diciembre». */
export function periodoCorreo(p: Periodo, region: string, t: Traducir): string {
  if (p.suscripcion === "mensual") return t("calendario.correoMes", { mes: nombreMes(region, p.desde) });
  const [d, h] = [p.desde, p.hasta];
  const otroAnio = d[0] !== h[0];
  const desde: Intl.DateTimeFormatOptions = otroAnio ? { day: "numeric", month: "long", year: "numeric" }
    : d[1] !== h[1] ? { day: "numeric", month: "long" } : { day: "numeric" };
  const hasta: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", ...(otroAnio ? { year: "numeric" } : {}) };
  return t("calendario.correoSemana", { desde: formato(region, desde).format(fechaUtc(d)), hasta: formato(region, hasta).format(fechaUtc(h)) });
}

/** El principio del correo (Carlos, 07/11/2026): el saludo, con el apodo o
 * el nombre de pila (sin nombre, «Hola:»), y por qué le llega, qué periodo
 * es y dónde se cambia. */
export function introCorreo(p: Periodo, region: string, t: Traducir, nombre: string, urlAjustes: string): string[] {
  const clave = p.suscripcion === "mensual" ? "calendario.correoIntroMes" : "calendario.correoIntroSemana";
  return [
    nombre ? t("calendario.correoSaludo", { nombre }) : t("calendario.correoSaludoSinNombre"),
    "",
    t(clave, { periodo: periodoCorreo(p, region, t), url: urlAjustes }),
  ];
}
