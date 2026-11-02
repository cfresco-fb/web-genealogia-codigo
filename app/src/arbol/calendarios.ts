// Conversión de un número de día (SDN) a año, mes y día en cada calendario
// de Gramps 6.0, y al revés. gramps-date trae casi todas; aquí se añaden
// las que le faltan (hebreo y persa), traducidas de gramps/gen/lib/
// gcalendar.py (hebrew_ymd, persian_ymd y sus funciones auxiliares). Las
// usa el cálculo de quién está vivo (vivos.ts), que, como Gramps, suma
// años a una fecha en el calendario gregoriano y la devuelve a su
// calendario.
//
// Original: Gramps, gramps/gen/lib/gcalendar.py
//   Copyright (C) 2000-2006 Donald N. Allingham
//   GNU General Public License, versión 2 o posterior.

import {
  Calendar, frenchSdn, frenchYmd, gregorianSdn, gregorianYmd, hebrewSdn, islamicSdn, islamicYmd, julianSdn, julianYmd,
  persianSdn, swedishSdn, swedishYmd,
} from "../gramps-connect/gramps-date";

// La división y el resto de Python redondean hacia menos infinito.
const div = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;

const HBR_HALAKIM_PER_DAY = 25920;
const HBR_HALAKIM_PER_LUNAR_CYCLE = 29 * HBR_HALAKIM_PER_DAY + 13753;
const HBR_HALAKIM_PER_METONIC_CYCLE = HBR_HALAKIM_PER_LUNAR_CYCLE * (12 * 19 + 7);
const HBR_SDN_OFFSET = 347997;
const HBR_NEW_MOON_OF_CREATION = 31524;
const HBR_NOON = 18 * 1080;
const HBR_AM3_11_20 = 9 * 1080 + 204;
const HBR_AM9_32_43 = 15 * 1080 + 589;
const HBR_MONTHS_PER_YEAR = [12, 12, 13, 12, 12, 13, 12, 13, 12, 12, 13, 12, 12, 13, 12, 12, 13, 12, 13];

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

/** Calendario de Gramps (Date._calendar_convert): año, mes y día → SDN,
 * sin ajustar los ceros (eso lo hace quien llama, como en Gramps). */
export function aSdn(calendario: Calendar, y: number, m: number, d: number): number {
  switch (calendario) {
    case Calendar.GREGORIAN: return gregorianSdn(y, m, d);
    case Calendar.JULIAN: return julianSdn(y, m, d);
    case Calendar.HEBREW: return hebrewSdn(y, m, d);
    case Calendar.FRENCH: return frenchSdn(y, m, d);
    case Calendar.PERSIAN: return persianSdn(y, m, d);
    case Calendar.ISLAMIC: return islamicSdn(y, m, d);
    case Calendar.SWEDISH: return swedishSdn(y, m, d);
    default: throw new Error(`Calendario ${calendario} no admitido`);
  }
}

/** Date._calendar_change: SDN → año, mes y día. */
export function deSdn(calendario: Calendar, sdn: number): [number, number, number] {
  switch (calendario) {
    case Calendar.GREGORIAN: return gregorianYmd(sdn);
    case Calendar.JULIAN: return julianYmd(sdn);
    case Calendar.HEBREW: return hebrewYmd(sdn);
    case Calendar.FRENCH: return frenchYmd(sdn);
    case Calendar.PERSIAN: return persianYmd(sdn);
    case Calendar.ISLAMIC: return islamicYmd(sdn);
    case Calendar.SWEDISH: return swedishYmd(sdn);
    default: throw new Error(`Calendario ${calendario} no admitido`);
  }
}
