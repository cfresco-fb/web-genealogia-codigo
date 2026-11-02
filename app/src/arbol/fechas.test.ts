// Fechas en castellano: «3 de mayo de 1950», con el mes en minúscula
// (decisión del 22/10/2026). Las fechas de entrada las ha generado Gramps
// 6.0.5 (Gramps de escritorio las muestra como «29 Agosto 1987», formato
// «Día Mes Año»).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GrampsDate } from "../gramps-connect/gramps-date";
import {
  anio, anioSuelto, fijarRegion, fraseFecha, hayFecha, normalizarRegion, ordenPorFecha, porFecha, prepararFechas, regionFechas, textoFecha, valorOrden, type FormatoFecha,
} from "./fechas";

const CASOS: [string, string, Omit<GrampsDate, "_class" | "format">][] = [
  ["simple", "29 de agosto de 1987", { modifier: 0, quality: 0, calendar: 0, dateval: [29, 8, 1987, false], text: "", sortval: 2447037, newyear: 0 }],
  ["solo año", "1850", { modifier: 0, quality: 0, calendar: 0, dateval: [0, 0, 1850, false], text: "", sortval: 2396759, newyear: 0 }],
  ["mes y año", "marzo de 1850", { modifier: 0, quality: 0, calendar: 0, dateval: [0, 3, 1850, false], text: "", sortval: 2396818, newyear: 0 }],
  ["hacia", "hacia 1850", { modifier: 3, quality: 0, calendar: 0, dateval: [0, 0, 1850, false], text: "", sortval: 2396759, newyear: 0 }],
  ["antes", "antes del 12 de mayo de 1900", { modifier: 1, quality: 0, calendar: 0, dateval: [12, 5, 1900, false], text: "", sortval: 2415152, newyear: 0 }],
  ["después", "después de 1920", { modifier: 2, quality: 0, calendar: 0, dateval: [0, 0, 1920, false], text: "", sortval: 2422325, newyear: 0 }],
  ["rango", "entre 1746 y 1755", { modifier: 4, quality: 0, calendar: 0, dateval: [0, 0, 1746, false, 0, 0, 1755, false], text: "", sortval: 2358774, newyear: 0 }],
  ["periodo estimado", "estimado de 1800 a 1805", { modifier: 5, quality: 1, calendar: 0, dateval: [0, 0, 1800, false, 0, 0, 1805, false], text: "", sortval: 2378497, newyear: 0 }],
  ["hacia estimado", "estimado hacia 1850", { modifier: 3, quality: 1, calendar: 0, dateval: [0, 0, 1850, false], text: "", sortval: 2396759, newyear: 0 }],
  ["calculado", "calculado 1850", { modifier: 0, quality: 2, calendar: 0, dateval: [0, 0, 1850, false], text: "", sortval: 2396759, newyear: 0 }],
  ["desde", "desde el 1 de enero de 1900", { modifier: 7, quality: 0, calendar: 0, dateval: [1, 1, 1900, false], text: "", sortval: 2415021, newyear: 0 }],
  ["hasta", "hasta 1910", { modifier: 8, quality: 0, calendar: 0, dateval: [0, 0, 1910, false], text: "", sortval: 2418673, newyear: 0 }],
  ["juliano", "10 de abril de 1700 (Juliano)", { modifier: 0, quality: 0, calendar: 1, dateval: [10, 4, 1700, false], text: "", sortval: 2342083, newyear: 0 }],
  ["islámico", "1300 (Islámico)", { modifier: 0, quality: 0, calendar: 5, dateval: [0, 0, 1300, false], text: "", sortval: 2408762, newyear: 0 }],
  ["rango con días", "entre el 3 de mayo de 1950 y el 5 de junio de 1950", { modifier: 4, quality: 0, calendar: 0, dateval: [3, 5, 1950, false, 5, 6, 1950, false], text: "", sortval: 2433405, newyear: 0 }],
  ["periodo con días", "del 1 de enero de 1900 a marzo de 1901", { modifier: 5, quality: 0, calendar: 0, dateval: [1, 1, 1900, false, 0, 3, 1901, false], text: "", sortval: 2415021, newyear: 0 }],
  ["hacia con día", "hacia el 2 de febrero de 1800", { modifier: 3, quality: 0, calendar: 0, dateval: [2, 2, 1800, false], text: "", sortval: 2378530, newyear: 0 }],
  ["año doble", "11 de febrero de 1749/50 (Juliano, Mar25)", { modifier: 0, quality: 0, calendar: 1, dateval: [11, 2, 1750, true], text: "", sortval: 2360000, newyear: 2 }],
  ["hebreo", "15 de Nisán de 5710 (Hebreo)", { modifier: 0, quality: 0, calendar: 2, dateval: [15, 8, 5710, false], text: "", sortval: 2433393, newyear: 0 }],
  ["texto", "en la guerra", { modifier: 6, quality: 0, calendar: 0, dateval: [0, 0, 0, false], text: "en la guerra", sortval: 0, newyear: 0 }],
  ["vacía", "", { modifier: 0, quality: 0, calendar: 0, dateval: [0, 0, 0, false], text: "", sortval: 0, newyear: 0 }],
];

beforeAll(prepararFechas);

describe("textoFecha", () => {
  it.each(CASOS)("%s → «%s»", (_, esperado, fecha) => {
    expect(textoFecha(fecha as GrampsDate)).toBe(esperado);
  });

  it("sin fecha → cadena vacía", () => {
    expect(textoFecha(null)).toBe("");
    expect(textoFecha(undefined)).toBe("");
  });
});

describe("fraseFecha (dentro de una frase del libro)", () => {
  const fecha = (nombre: string) => CASOS.find(([n]) => n === nombre)![2] as GrampsDate;
  it.each([
    ["simple", "el 29 de agosto de 1987"],
    ["solo año", "en 1850"],
    ["mes y año", "en marzo de 1850"],
    ["hacia", "hacia 1850"],
    ["antes", "antes del 12 de mayo de 1900"],
    ["rango", "entre 1746 y 1755"],
    ["periodo estimado", "de 1800 a 1805 (fecha estimada)"],
    ["calculado", "en 1850 (fecha calculada)"],
    ["juliano", "el 10 de abril de 1700 (Juliano)"],
    ["texto", "(fecha: en la guerra)"],
    ["vacía", ""],
  ])("%s → «%s»", (nombre, esperado) => {
    expect(fraseFecha(fecha(nombre))).toBe(esperado);
  });
});

// Formatos corto (listas y cajas en la web) y abreviado (cajas en los PDF),
// y otras regiones (decisión del 23/10/2026, «Ajustes, persona de inicio,
// cajas y fechas»).
describe("formatos y regiones", () => {
  const fecha = (nombre: string) => CASOS.find(([n]) => n === nombre)![2] as GrampsDate;
  const en = async (region: string, casos: [string, FormatoFecha, string][]) => {
    await fijarRegion(region);
    for (const [nombre, formato, esperado] of casos) expect(textoFecha(fecha(nombre), formato), `${region} ${nombre} ${formato}`).toBe(esperado);
  };
  afterAll(() => fijarRegion("es-ES"));

  it("España", () => en("es-ES", [
    ["simple", "corto", "29/08/1987"],
    ["simple", "abreviado", "29 ago 1987"],
    ["mes y año", "corto", "03/1850"],
    ["mes y año", "abreviado", "mar 1850"],
    ["solo año", "corto", "1850"],
    ["antes", "corto", "antes del 12/05/1900"],
    ["rango", "abreviado", "entre 1746 y 1755"],
    ["juliano", "corto", "10/04/1700 (Juliano)"],
    ["año doble", "corto", "11/02/1749/50 (Juliano, Mar25)"],
    ["hebreo", "corto", "15 de Nisán de 5710 (Hebreo)"],
    ["texto", "corto", "en la guerra"],
    // Fechas aproximadas: «hacia» en el largo y «c.» en los otros dos;
    // «antes de» y «después de», igual en todos (31/10/2026).
    ["hacia", "largo", "hacia 1850"],
    ["hacia", "corto", "c. 1850"],
    ["hacia", "abreviado", "c. 1850"],
    ["hacia con día", "largo", "hacia el 2 de febrero de 1800"],
    ["hacia con día", "corto", "c. 02/02/1800"],
    ["hacia con día", "abreviado", "c. 2 feb 1800"],
    ["hacia estimado", "corto", "estimado c. 1850"],
    ["antes", "abreviado", "antes del 12 may 1900"],
    ["después", "corto", "después de 1920"],
    ["después", "abreviado", "después de 1920"],
  ]));

  it("Estados Unidos: mes, día y año, con las palabras de Gramps en inglés", () => en("en-US", [
    ["simple", "largo", "August 29, 1987"],
    ["simple", "corto", "08/29/1987"],
    ["simple", "abreviado", "Aug 29, 1987"],
    ["mes y año", "corto", "03/1850"],
    ["mes y año", "largo", "March 1850"],
    ["hacia", "largo", "about 1850"],
    ["antes", "corto", "before 05/12/1900"],
    ["rango", "largo", "between 1746 and 1755"],
    ["juliano", "largo", "April 10, 1700 (Julian)"],
  ]));

  it("Alemania: con puntos", () => en("de-DE", [
    ["simple", "corto", "29.08.1987"],
    ["simple", "largo", "29. August 1987"],
    ["mes y año", "corto", "03.1850"],
  ]));

  // Región numérica (UN M.49): la que traen muchos navegadores en
  // Hispanoamérica; las reglas la admiten desde el 02/11/2026.
  it("Hispanoamérica (es-419)", async () => {
    expect(normalizarRegion("es-419")).toBe("es-419");
    await en("es-419", [
      ["simple", "largo", "29 de agosto de 1987"],
      ["simple", "corto", "29/08/1987"],
      ["hacia", "corto", "c. 1850"],
    ]);
    expect(regionFechas()).toBe("es-419");
  });

  it("las frases del libro van siempre en castellano", async () => {
    await fijarRegion("en-US");
    expect(fraseFecha(fecha("simple"))).toBe("el 29 de agosto de 1987");
    expect(fraseFecha(fecha("antes"))).toBe("antes del 12 de mayo de 1900");
  });

  it("la región se normaliza y, si no vale, es la del navegador", async () => {
    expect(normalizarRegion("en-us")).toBe("en-US");
    expect(normalizarRegion("de")).toBe("de-DE");
    expect(normalizarRegion("xx-!!")).toBeNull();
    await fijarRegion("no vale");
    expect(regionFechas()).toBe("es-ES");
  });
});

describe("valores para filtrar y ordenar", () => {
  const fecha = (nombre: string) => CASOS.find(([n]) => n === nombre)![2] as GrampsDate;

  it("año inicial", () => {
    expect(anio(fecha("simple"))).toBe(1987);
    expect(anio(fecha("antes"))).toBe(1900);
    expect(anio(fecha("rango"))).toBe(1746);
    expect(anio(fecha("texto"))).toBeNull();
    expect(anio(fecha("vacía"))).toBeNull();
    expect(anio(null)).toBeNull();
  });

  it("año suelto (cajas pequeñas, índices del libro): «c.» solo en las aproximadas", () => {
    expect(anioSuelto(fecha("hacia"))).toBe("c. 1850");
    expect(anioSuelto(fecha("hacia con día"))).toBe("c. 1800");
    expect(anioSuelto(fecha("antes"))).toBe("1900");
    expect(anioSuelto(fecha("después"))).toBe("1920");
    expect(anioSuelto(fecha("simple"))).toBe("1987");
    expect(anioSuelto(fecha("texto"))).toBeNull();
  });

  it("hay fecha", () => {
    expect(hayFecha(fecha("hacia"))).toBe(true);
    expect(hayFecha(fecha("texto"))).toBe(true);
    expect(hayFecha(fecha("vacía"))).toBe(false);
  });

  it("las fechas vacías no tienen valor de orden", () => {
    expect(valorOrden(fecha("simple"))).toBe(2447037);
    expect(valorOrden(fecha("vacía"))).toBeNull();
    expect(valorOrden(fecha("texto"))).toBeNull();
  });

  it("orden por fecha (los eventos, decisión del 29/10/2026): sin fecha o solo texto, al final, en su orden", () => {
    const nombres = ["texto", "simple", "vacía", "mes y año", "solo año", "antes", "hacia con día", "rango"];
    expect(ordenPorFecha(nombres.map(fecha)).map((i) => nombres[i]))
      .toEqual(["rango", "hacia con día", "solo año", "mes y año", "antes", "simple", "texto", "vacía"]);
    // Las de igual fecha, en su orden.
    const iguales = ["calculado", "hacia", "solo año"];
    expect(porFecha(iguales, fecha)).toEqual(iguales);
    expect(porFecha([...iguales].reverse(), fecha)).toEqual([...iguales].reverse());
  });
});
