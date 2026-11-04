// Comparación persona a persona con la biblioteca de Gramps sobre el árbol
// de ejemplo: datos-prueba/vivos-ejemplo.json.gz, generado por
// migracion/vivos_gramps.py con varios juegos de parámetros y fechas. El
// cálculo está en comun/vivos.ts (lo usan también las funciones); la
// prueba sigue aquí porque compara además sus conversiones de calendario
// (comun/calendarios.ts) con las de gramps-date, que solo carga la web.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  Calendar, frenchSdn, frenchYmd, gregorianSdn, gregorianYmd, islamicSdn, islamicYmd, julianSdn, julianYmd, swedishSdn, swedishYmd,
} from "../gramps-connect/gramps-date";
import { aSdn, deSdn } from "../../../comun/calendarios.ts";
import type { Evento, Familia, Persona } from "./tipos";
import {
  constaFallecida, Fecha, personasVivas, probablementeVivaGramps, validarParametrosVivos, type DatosVivos,
} from "../../../comun/vivos.ts";

interface Caso {
  edadMaxima: number;
  aniosGeneracion: number;
  difHermanos: number;
  fecha: [number, number, number];
  resultados: Record<string, { vivo: boolean; explicacion: string; nacimiento: string | null; defuncion: string | null }>;
}

const fichero = JSON.parse(gunzipSync(readFileSync(new URL("./datos-prueba/vivos-ejemplo.json.gz", import.meta.url))).toString("utf8")) as {
  hoy: [number, number, number];
  objetos: { Person: Persona[]; Family: Familia[]; Event: Evento[] };
  casos: Caso[];
};

const datos = {
  personas: new Map(fichero.objetos.Person.map((p) => [p.handle, p])),
  familias: new Map(fichero.objetos.Family.map((f) => [f.handle, f])),
  eventos: new Map(fichero.objetos.Event.map((e) => [e.handle, e])),
} satisfies DatosVivos;
const hoyGramps = Fecha.ymd(...fichero.hoy);

describe("pruebas de fallecimiento (regla añadida)", () => {
  // Una persona sola, sin parientes, con un único evento sin fecha: Gramps
  // no encuentra pruebas y la daría por viva.
  const sola = (tipo: number): DatosVivos => {
    const evento = { handle: "e", type: { value: tipo }, date: { modifier: 0, quality: 0, calendar: 0, dateval: [0, 0, 0, false], text: "", sortval: 0, newyear: 0 } } as unknown as Evento;
    const persona = {
      handle: "p", gramps_id: "P", event_ref_list: [{ ref: "e", role: { value: 1 } }], birth_ref_index: -1,
      death_ref_index: tipo === 13 ? 0 : -1, family_list: [], parent_family_list: [],
    } as unknown as Persona;
    return { personas: new Map([["p", persona]]), familias: new Map(), eventos: new Map([["e", evento]]) };
  };
  const params = { edadMaxima: 120, aniosGeneracion: 20, difHermanos: 20 };
  it.each([
    [13, "defunción"], [19, "entierro"], [24, "incineración"], [45, "mortinato"], [20, "causa de muerte"], [39, "testamentaría"],
  ])("%i (%s): fallecida", (tipo) => {
    const d = sola(tipo);
    expect(probablementeVivaGramps(d.personas.get("p")!, d, params).viva).toBe(true);
    expect(constaFallecida(d.personas.get("p")!, d)).toBe(true);
    expect(personasVivas(d, params).size).toBe(0);
  });
  it("otro evento (ocupación): sigue viva", () => {
    const d = sola(37);
    expect(constaFallecida(d.personas.get("p")!, d)).toBe(false);
    expect(personasVivas(d, params).has("p")).toBe(true);
  });
});

describe("probablemente vivo, como Gramps", () => {
  for (const caso of fichero.casos) {
    const { edadMaxima, aniosGeneracion, difHermanos, fecha } = caso;
    it(`${edadMaxima} años, ${aniosGeneracion} por generación, ${difHermanos} entre hermanos, a ${fecha.join("-")}: igual persona a persona`, () => {
      const distintas: string[] = [];
      for (const p of datos.personas.values()) {
        const g = caso.resultados[p.handle];
        const r = probablementeVivaGramps(p, datos, { edadMaxima, aniosGeneracion, difHermanos }, Fecha.ymd(...fecha), hoyGramps);
        if (r.viva !== g.vivo) distintas.push(`${p.gramps_id}: Gramps ${g.vivo} (${g.explicacion}; ${g.nacimiento} - ${g.defuncion}), web ${r.viva} (${r.estimacion.explicacion})`);
      }
      expect(distintas).toEqual([]);
      expect(datos.personas.size).toBe(2157);
    });
  }

  it("la regla añadida: con defunción, entierro, incineración, mortinato, causa de muerte o testamentaría, fallecida aunque Gramps no pueda estimar", () => {
    const caso = fichero.casos[0];
    const params = { edadMaxima: caso.edadMaxima, aniosGeneracion: caso.aniosGeneracion, difHermanos: caso.difHermanos };
    const vivas = personasVivas(datos, params, Fecha.ymd(...caso.fecha), hoyGramps);
    const cambian = [...datos.personas.values()].filter((p) => caso.resultados[p.handle].vivo && !vivas.has(p.handle));
    // Todas las diferencias con Gramps son de esta regla, y en el sentido de
    // dar por fallecida a quien Gramps daba por viva.
    for (const p of cambian) expect(constaFallecida(p, datos)).toBe(true);
    for (const p of datos.personas.values()) {
      if (!caso.resultados[p.handle].vivo) expect(vivas.has(p.handle)).toBe(false);
    }
    // En el árbol de ejemplo cambian 17 (docs/libro.md); ninguna por
    // mortinato, causa de muerte ni testamentaría, que se prueban aparte.
    expect(cambian.length).toBe(17);
  });
});

describe("fechas de Gramps", () => {
  it("convierte de ida y vuelta en todos los calendarios", () => {
    // El republicano francés, solo en su época (1792-1805).
    for (const [cal, desde, hasta] of [
      [Calendar.GREGORIAN, 2300000, 2470000], [Calendar.JULIAN, 2300000, 2470000], [Calendar.HEBREW, 2300000, 2470000],
      [Calendar.FRENCH, 2375840, 2380950], [Calendar.PERSIAN, 2300000, 2470000], [Calendar.ISLAMIC, 2300000, 2470000],
    ]) {
      for (let sdn = desde; sdn < hasta; sdn += 97) {
        const [y, m, d] = deSdn(cal, sdn);
        expect(aSdn(cal, y, m, d), `calendario ${cal}, ${sdn}`).toBe(sdn);
      }
    }
  });

  it("las conversiones de comun/ y las de gramps-date coinciden, de ida y de vuelta", () => {
    // Las dos traducen gcalendar.py de Gramps; si una cambia, salta aquí.
    // Del año 1 al 2400, día a día de 3 en 3 (el francés, en su época).
    type Ymd = [number, number, number];
    const deGrampsDate: [Calendar, (sdn: number) => Ymd, (...ymd: Ymd) => number, number, number][] = [
      [Calendar.GREGORIAN, gregorianYmd, gregorianSdn, 1721426, 2597641], [Calendar.JULIAN, julianYmd, julianSdn, 1721426, 2597641],
      [Calendar.FRENCH, frenchYmd, frenchSdn, 2375840, 2380950], [Calendar.ISLAMIC, islamicYmd, islamicSdn, 1948440, 2597641],
      [Calendar.SWEDISH, swedishYmd, swedishSdn, 2300000, 2400000],
    ];
    const distintas: string[] = [];
    for (const [cal, aYmd, aSdnGd, desde, hasta] of deGrampsDate) {
      for (let sdn = desde; sdn < hasta; sdn += 3) {
        const ymd = deSdn(cal, sdn);
        if (ymd.join() !== aYmd(sdn).join()) distintas.push(`calendario ${cal}, día ${sdn}: ${ymd} y ${aYmd(sdn)}`);
        if (aSdn(cal, ...ymd) !== aSdnGd(...ymd)) distintas.push(`calendario ${cal}, ${ymd}: ${aSdn(cal, ...ymd)} y ${aSdnGd(...ymd)}`);
      }
    }
    expect(distintas.slice(0, 10)).toEqual([]);
  });

  it("suma años y compara con los márgenes de «hacia» y «antes de»", () => {
    const f = Fecha.ymd(1900, 2, 28);
    const g = f.copiaSumada(120);
    expect([g.anio(), g.mes(), g.dia()]).toEqual([2020, 2, 28]);
    const hacia = Fecha.ymd(1900);
    hacia.modificador = 3; // ABOUT: de 1850 a 1950
    expect(Fecha.ymd(1949, 6, 1).coincide(hacia, "<")).toBe(true);
    expect(Fecha.ymd(1951, 6, 1).coincide(hacia, "<")).toBe(false);
  });
});

describe("parámetros", () => {
  it("valida como las reglas", () => {
    expect(validarParametrosVivos({ edadMaxima: 120, aniosGeneracion: 20, difHermanos: 20 })).not.toBeNull();
    expect(validarParametrosVivos({ edadMaxima: 120.5, aniosGeneracion: 20, difHermanos: 20 })).toBeNull();
    expect(validarParametrosVivos({ edadMaxima: 200, aniosGeneracion: 20, difHermanos: 20 })).toBeNull();
    expect(validarParametrosVivos({ edadMaxima: 120, aniosGeneracion: 20 })).toBeNull();
    expect(validarParametrosVivos({ edadMaxima: 120, aniosGeneracion: 20, difHermanos: 20, otro: 1 })).toBeNull();
    expect(validarParametrosVivos({ edadMaxima: "120", aniosGeneracion: 20, difHermanos: 20 })).toBeNull();
  });
});
