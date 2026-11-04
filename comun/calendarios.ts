// Conversión de fechas de los calendarios de Gramps 6.0 a un número de día
// (SDN, «serial day number») y al revés: traducción completa de
// gramps/gen/lib/gcalendar.py (gregoriano, juliano, hebreo, republicano
// francés, persa, islámico y sueco). La usan el cálculo de quién está vivo
// (vivos.ts), que, como Gramps, suma años a una fecha en el calendario
// gregoriano y la devuelve a su calendario, y los aniversarios
// (aniversarios.ts), en la web y en las funciones.
//
// Está aquí, y no se toma de gramps-date (app/src/gramps-connect/), porque
// las funciones no admiten esa biblioteca tal cual (usa `enum` e
// importaciones sin extensión); gramps-date sigue en la web para presentar y
// leer fechas, con sus propias conversiones. Para que las dos no diverjan,
// app/src/arbol/vivos.test.ts las compara de ida y vuelta en un rango amplio
// de días, y calendarios.test.ts compara estas con Gramps
// (datos-prueba/calendarios-gramps.json, de migracion/calendarios_gramps.py).
// Decisión de Carlos del 03/11/2026 (docs/decisiones-web-familiar.md,
// «Calendario de aniversarios»).
//
// Original: Gramps, gramps/gen/lib/gcalendar.py
//   Copyright (C) 2000-2006 Donald N. Allingham
//   GNU General Public License, versión 2 o posterior.

/** Date.CAL_* de Gramps (los mismos números que el `enum Calendar` de
 * gramps-date). Los lunisolares de Gramps 6.2 no se usan en el árbol. */
export const Calendario = {
  GREGORIANO: 0,
  JULIANO: 1,
  HEBREO: 2,
  FRANCES: 3,
  PERSA: 4,
  ISLAMICO: 5,
  SUECO: 6,
} as const;

// La división y el resto de Python redondean hacia menos infinito.
const div = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;

const GRG_SDN_OFFSET = 32045;
const GRG_DAYS_PER_5_MONTHS = 153;
const GRG_DAYS_PER_4_YEARS = 1461;
const GRG_DAYS_PER_400_YEARS = 146097;

const JLN_SDN_OFFSET = 32083;
const JLN_DAYS_PER_5_MONTHS = 153;
const JLN_DAYS_PER_4_YEARS = 1461;

const HBR_HALAKIM_PER_DAY = 25920;
const HBR_HALAKIM_PER_LUNAR_CYCLE = 29 * HBR_HALAKIM_PER_DAY + 13753;
const HBR_HALAKIM_PER_METONIC_CYCLE = HBR_HALAKIM_PER_LUNAR_CYCLE * (12 * 19 + 7);
const HBR_SDN_OFFSET = 347997;
const HBR_NEW_MOON_OF_CREATION = 31524;
const HBR_NOON = 18 * 1080;
const HBR_AM3_11_20 = 9 * 1080 + 204;
const HBR_AM9_32_43 = 15 * 1080 + 589;
const HBR_MONTHS_PER_YEAR = [12, 12, 13, 12, 12, 13, 12, 13, 12, 12, 13, 12, 12, 13, 12, 12, 13, 12, 13];
const HBR_YEAR_OFFSET = [0, 12, 24, 37, 49, 61, 74, 86, 99, 111, 123, 136, 148, 160, 173, 185, 197, 210, 222];

const FR_SDN_OFFSET = 2375474;
const FR_DAYS_PER_4_YEARS = 1461;
const FR_DAYS_PER_MONTH = 30;
const PRS_EPOCH = 1948320.5;
const ISM_EPOCH = 1948439.5;

function tishri1(metonicYear: number, moladDay: number, moladHalakim: number): number {
  let dia = moladDay;
  let dow = dia % 7;
  const bisiesto = [2, 5, 7, 10, 13, 16, 18].includes(metonicYear);
  const anteriorBisiesto = [3, 6, 8, 11, 14, 17, 0].includes(metonicYear);
  if (
    moladHalakim >= HBR_NOON
    || (!bisiesto && dow === 2 && moladHalakim >= HBR_AM3_11_20)
    || (anteriorBisiesto && dow === 1 && moladHalakim >= HBR_AM9_32_43)
  ) {
    dia += 1;
    dow += 1;
    if (dow === 7) dow = 0;
  }
  if (dow === 3 || dow === 5 || dow === 0) dia += 1;
  return dia;
}

function moladOfMetonicCycle(metonicCycle: number): [number, number] {
  let r1 = HBR_NEW_MOON_OF_CREATION + metonicCycle * (HBR_HALAKIM_PER_METONIC_CYCLE & 0xffff);
  let r2 = Math.floor(r1 / 65536);
  r2 += metonicCycle * (Math.floor(HBR_HALAKIM_PER_METONIC_CYCLE / 65536) & 0xffff);
  const d2 = div(r2, HBR_HALAKIM_PER_DAY);
  r2 -= d2 * HBR_HALAKIM_PER_DAY;
  r1 = (r2 << 16) | (r1 & 0xffff);
  const d1 = div(r1, HBR_HALAKIM_PER_DAY);
  r1 -= d1 * HBR_HALAKIM_PER_DAY;
  return [(d2 << 16) | d1, r1];
}

function tishriMolad(inputDay: number): [number, number, number, number] {
  let metonicCycle = div(inputDay + 310, 6940);
  let [moladDay, moladHalakim] = moladOfMetonicCycle(metonicCycle);
  while (moladDay < inputDay - 6940 + 310) {
    metonicCycle += 1;
    moladHalakim += HBR_HALAKIM_PER_METONIC_CYCLE;
    moladDay += div(moladHalakim, HBR_HALAKIM_PER_DAY);
    moladHalakim = mod(moladHalakim, HBR_HALAKIM_PER_DAY);
  }
  let metonicYear = 0;
  for (; metonicYear < 20; metonicYear++) {
    if (moladDay > inputDay - 74) break;
    moladHalakim += HBR_HALAKIM_PER_LUNAR_CYCLE * HBR_MONTHS_PER_YEAR[metonicYear];
    moladDay += div(moladHalakim, HBR_HALAKIM_PER_DAY);
    moladHalakim = mod(moladHalakim, HBR_HALAKIM_PER_DAY);
  }
  // Como en Python: si el bucle no se corta, metonic_year queda en 19.
  return [metonicCycle, Math.min(metonicYear, 19), moladDay, moladHalakim];
}

/** hebrew_ymd. */
export function hebrewYmd(sdn: number): [number, number, number] {
  const inputDay = sdn - HBR_SDN_OFFSET;
  let [metonicCycle, metonicYear, day1, halakim] = tishriMolad(inputDay);
  let t1 = tishri1(metonicYear, day1, halakim);
  let year: number;
  let month: number;
  let day: number;
  let t1Despues: number;
  if (inputDay >= t1) {
    year = metonicCycle * 19 + metonicYear + 1;
    if (inputDay < t1 + 59) {
      return inputDay < t1 + 30 ? [year, 1, inputDay - t1 + 1] : [year, 2, inputDay - t1 - 29];
    }
    halakim += HBR_HALAKIM_PER_LUNAR_CYCLE * HBR_MONTHS_PER_YEAR[metonicYear];
    day1 += div(halakim, HBR_HALAKIM_PER_DAY);
    halakim = mod(halakim, HBR_HALAKIM_PER_DAY);
    t1Despues = tishri1(mod(metonicYear + 1, 19), day1, halakim);
  } else {
    year = metonicCycle * 19 + metonicYear;
    if (inputDay >= t1 - 177) {
      if (inputDay > t1 - 30) return [year, 13, inputDay - t1 + 30];
      if (inputDay > t1 - 60) return [year, 12, inputDay - t1 + 60];
      if (inputDay > t1 - 89) return [year, 11, inputDay - t1 + 89];
      if (inputDay > t1 - 119) return [year, 10, inputDay - t1 + 119];
      if (inputDay > t1 - 148) return [year, 9, inputDay - t1 + 148];
      return [year, 8, inputDay - t1 + 178];
    }
    if (HBR_MONTHS_PER_YEAR[mod(year - 1, 19)] === 13) {
      month = 7;
      day = inputDay - t1 + 207;
      if (day > 0) return [year, month, day];
      month -= 1;
      day += 30;
      if (day > 0) return [year, month, day];
      month -= 1;
      day += 30;
    } else {
      month = 6;
      day = inputDay - t1 + 207;
      if (day > 0) return [year, month, day];
      month -= 1;
      day += 30;
    }
    if (day > 0) return [year, month, day];
    month -= 1;
    day += 29;
    if (day > 0) return [year, month, day];
    t1Despues = t1;
    [metonicCycle, metonicYear, day1, halakim] = tishriMolad(day1 - 365);
    t1 = tishri1(metonicYear, day1, halakim);
  }
  const largo = t1Despues - t1;
  day = inputDay - t1 - 29;
  if (largo === 355 || largo === 385) {
    if (day <= 30) return [year, 2, day];
    day -= 30;
  } else {
    if (day <= 29) return [year, 2, day];
    day -= 29;
  }
  return [year, 3, day];
}

/** _start_of_year: [ciclo, año del ciclo, día y halakim del molad, 1 de Tishri]. */
function startOfYear(year: number): [number, number, number, number, number] {
  const metonicCycle = div(year - 1, 19);
  const metonicYear = mod(year - 1, 19);
  let [moladDay, moladHalakim] = moladOfMetonicCycle(metonicCycle);
  moladHalakim += HBR_HALAKIM_PER_LUNAR_CYCLE * HBR_YEAR_OFFSET[metonicYear];
  moladDay += div(moladHalakim, HBR_HALAKIM_PER_DAY);
  moladHalakim = mod(moladHalakim, HBR_HALAKIM_PER_DAY);
  return [metonicCycle, metonicYear, moladDay, moladHalakim, tishri1(metonicYear, moladDay, moladHalakim)];
}

/** hebrew_sdn. */
export function hebrewSdn(year: number, month: number, day: number): number {
  let sdn: number;
  if (month === 1 || month === 2) {
    const t1 = startOfYear(year)[4];
    sdn = month === 1 ? t1 + day - 1 : t1 + day + 29;
  } else if (month === 3) {
    const [, metonicYear, d, h, t1] = startOfYear(year);
    const halakim = h + HBR_HALAKIM_PER_LUNAR_CYCLE * HBR_MONTHS_PER_YEAR[metonicYear];
    const moladDay = d + div(halakim, HBR_HALAKIM_PER_DAY);
    const t1Despues = tishri1(mod(metonicYear + 1, 19), moladDay, mod(halakim, HBR_HALAKIM_PER_DAY));
    const largo = t1Despues - t1;
    sdn = largo === 355 || largo === 385 ? t1 + day + 59 : t1 + day + 58;
  } else if (month === 4 || month === 5 || month === 6) {
    const t1Despues = startOfYear(year + 1)[4];
    const adar = HBR_MONTHS_PER_YEAR[mod(year - 1, 19)] === 12 ? 29 : 59;
    sdn = t1Despues + day - adar - (month === 4 ? 237 : month === 5 ? 208 : 178);
  } else {
    const t1Despues = startOfYear(year + 1)[4];
    const resta: Record<number, number> = { 7: 207, 8: 178, 9: 148, 10: 119, 11: 89, 12: 60, 13: 30 };
    if (!(month in resta)) return 0;
    sdn = t1Despues + day - resta[month];
  }
  return sdn + HBR_SDN_OFFSET;
}

/** julian_sdn. */
export function julianSdn(year: number, month: number, day: number): number {
  let y = year < 0 ? year + 4801 : year + 4800;
  let m = month;
  if (m > 2) m -= 3;
  else {
    m += 9;
    y -= 1;
  }
  return div(y * JLN_DAYS_PER_4_YEARS, 4) + div(m * JLN_DAYS_PER_5_MONTHS + 2, 5) + day - JLN_SDN_OFFSET;
}

/** julian_ymd. */
export function julianYmd(sdn: number): [number, number, number] {
  let temp = (sdn + JLN_SDN_OFFSET) * 4 - 1;
  let year = div(temp, JLN_DAYS_PER_4_YEARS);
  const dayOfYear = div(mod(temp, JLN_DAYS_PER_4_YEARS), 4) + 1;
  temp = dayOfYear * 5 - 3;
  let month = div(temp, JLN_DAYS_PER_5_MONTHS);
  const day = div(mod(temp, JLN_DAYS_PER_5_MONTHS), 5) + 1;
  if (month < 10) month += 3;
  else {
    year += 1;
    month -= 9;
  }
  year -= 4800;
  if (year <= 0) year -= 1;
  return [year, month, day];
}

/** gregorian_sdn. */
export function gregorianSdn(year: number, month: number, day: number): number {
  let y = year < 0 ? year + 4801 : year + 4800;
  let m = month;
  if (m > 2) m -= 3;
  else {
    m += 9;
    y -= 1;
  }
  return div(div(y, 100) * GRG_DAYS_PER_400_YEARS, 4)
    + div(mod(y, 100) * GRG_DAYS_PER_4_YEARS, 4)
    + div(m * GRG_DAYS_PER_5_MONTHS + 2, 5)
    + day
    - GRG_SDN_OFFSET;
}

/** gregorian_ymd. */
export function gregorianYmd(sdn: number): [number, number, number] {
  let temp = (GRG_SDN_OFFSET + sdn) * 4 - 1;
  const century = div(temp, GRG_DAYS_PER_400_YEARS);
  temp = div(mod(temp, GRG_DAYS_PER_400_YEARS), 4) * 4 + 3;
  let year = century * 100 + div(temp, GRG_DAYS_PER_4_YEARS);
  const dayOfYear = div(mod(temp, GRG_DAYS_PER_4_YEARS), 4) + 1;
  temp = dayOfYear * 5 - 3;
  let month = div(temp, GRG_DAYS_PER_5_MONTHS);
  const day = div(mod(temp, GRG_DAYS_PER_5_MONTHS), 5) + 1;
  if (month < 10) month += 3;
  else {
    year += 1;
    month -= 9;
  }
  year -= 4800;
  if (year <= 0) year -= 1;
  return [year, month, day];
}

/** french_sdn (sin restringir al periodo republicano, como lo usa Date). */
export function frenchSdn(year: number, month: number, day: number): number {
  return div(year * FR_DAYS_PER_4_YEARS, 4) + (month - 1) * FR_DAYS_PER_MONTH + day + FR_SDN_OFFSET;
}

/** french_ymd. */
export function frenchYmd(sdn: number): [number, number, number] {
  const temp = (sdn - FR_SDN_OFFSET) * 4 - 1;
  const year = div(temp, FR_DAYS_PER_4_YEARS);
  const dayOfYear = div(mod(temp, FR_DAYS_PER_4_YEARS), 4);
  return [year, div(dayOfYear, FR_DAYS_PER_MONTH) + 1, mod(dayOfYear, FR_DAYS_PER_MONTH) + 1];
}

/** persian_sdn. */
export function persianSdn(year: number, month: number, day: number): number {
  const epbase = year >= 0 ? year - 474 : year - 473;
  const epyear = 474 + mod(epbase, 2820);
  const v1 = month <= 7 ? (month - 1) * 31 : (month - 1) * 30 + 6;
  const v2 = div(epyear * 682 - 110, 2816);
  const v3 = (epyear - 1) * 365 + day;
  const v4 = div(epbase, 2820) * 1029983;
  return Math.ceil(v1 + v2 + v3 + v4 + PRS_EPOCH - 1);
}

/** persian_ymd. */
export function persianYmd(sdn: number): [number, number, number] {
  const depoch = sdn - 2121446;
  const cycle = Math.floor(depoch / 1029983);
  const cyear = mod(depoch, 1029983);
  let ycycle: number;
  if (cyear === 1029982) {
    ycycle = 2820;
  } else {
    const aux1 = div(cyear, 366);
    const aux2 = mod(cyear, 366);
    ycycle = div(2134 * aux1 + 2816 * aux2 + 2815, 1028522) + aux1 + 1;
  }
  let year = ycycle + 2820 * cycle + 474;
  if (year <= 0) year -= 1;
  const yday = sdn - persianSdn(year, 1, 1) + 1;
  const month = yday < 186 ? Math.ceil(yday / 31) : Math.ceil((yday - 6) / 30);
  const day = sdn - persianSdn(year, month, 1) + 1;
  return [year, month, day];
}

/** islamic_sdn. */
export function islamicSdn(year: number, month: number, day: number): number {
  const v1 = Math.ceil(29.5 * (month - 1));
  const v2 = (year - 1) * 354;
  const v3 = div(3 + 11 * year, 30);
  return Math.ceil(day + v1 + v2 + v3 + ISM_EPOCH - 1);
}

/** islamic_ymd. */
export function islamicYmd(sdn: number): [number, number, number] {
  const s = Math.floor(sdn) + 0.5;
  const year = Math.floor((30 * (s - ISM_EPOCH) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((s - (29 + islamicSdn(year, 1, 1))) / 29.5) + 1);
  const day = s - islamicSdn(year, month, 1) + 1;
  return [year, month, Math.trunc(day)];
}

/** Compara (año, mes, día) como las tuplas de Python. */
const antes = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** swedish_sdn. */
export function swedishSdn(year: number, month: number, day: number): number {
  const fecha: [number, number, number] = [year, month, day];
  if (antes([1700, 3, 1], fecha) <= 0 && antes(fecha, [1712, 2, 30]) <= 0) return julianSdn(year, month, day) - 1;
  if (antes([1753, 3, 1], fecha) <= 0) return gregorianSdn(year, month, day);
  return julianSdn(year, month, day);
}

/** swedish_ymd. */
export function swedishYmd(sdn: number): [number, number, number] {
  if (sdn === 2346425) return [1712, 2, 30];
  if (sdn >= 2342042 && sdn < 2346425) return julianYmd(sdn + 1);
  if (sdn >= 2361390) return gregorianYmd(sdn);
  return julianYmd(sdn);
}

/** Calendario de Gramps (Date._calendar_convert): año, mes y día → SDN,
 * sin ajustar los ceros (eso lo hace quien llama, como en Gramps). */
export function aSdn(calendario: number, y: number, m: number, d: number): number {
  switch (calendario) {
    case Calendario.GREGORIANO: return gregorianSdn(y, m, d);
    case Calendario.JULIANO: return julianSdn(y, m, d);
    case Calendario.HEBREO: return hebrewSdn(y, m, d);
    case Calendario.FRANCES: return frenchSdn(y, m, d);
    case Calendario.PERSA: return persianSdn(y, m, d);
    case Calendario.ISLAMICO: return islamicSdn(y, m, d);
    case Calendario.SUECO: return swedishSdn(y, m, d);
    default: throw new Error(`Calendario ${calendario} no admitido`);
  }
}

/** Date._calendar_change: SDN → año, mes y día. */
export function deSdn(calendario: number, sdn: number): [number, number, number] {
  switch (calendario) {
    case Calendario.GREGORIANO: return gregorianYmd(sdn);
    case Calendario.JULIANO: return julianYmd(sdn);
    case Calendario.HEBREO: return hebrewYmd(sdn);
    case Calendario.FRANCES: return frenchYmd(sdn);
    case Calendario.PERSA: return persianYmd(sdn);
    case Calendario.ISLAMICO: return islamicYmd(sdn);
    case Calendario.SUECO: return swedishYmd(sdn);
    default: throw new Error(`Calendario ${calendario} no admitido`);
  }
}
