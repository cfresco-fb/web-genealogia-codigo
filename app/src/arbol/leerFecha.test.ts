// Lector de fechas de los formularios contra Gramps: las 2.000 fechas
// distintas del árbol de ejemplo y unas hechas a mano con Gramps
// (datos-prueba/fechas-ejemplo.json.gz, de migracion/fechas_gramps.py). Cada
// una, escrita como la escribe la web y como la escribe Gramps, se lee igual
// que la original, sortval incluido.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GrampsDate } from "../gramps-connect/gramps-date";
import { fijarRegion, prepararFechas, textoFecha } from "./fechas";
import { fechaVacia, leerFecha } from "./leerFecha";

const datos = JSON.parse(gunzipSync(readFileSync(new URL("./datos-prueba/fechas-ejemplo.json.gz", import.meta.url))).toString("utf8")) as {
  fechas: { origen: string; fecha: GrampsDate; gramps: { numerico: string; diaMesAnio: string } }[];
};

const CAMPOS = ["modifier", "quality", "calendar", "dateval", "text", "newyear", "sortval"] as const;
const igual = (f: GrampsDate | null, g: GrampsDate) => {
  const a = f ?? fechaVacia();
  return CAMPOS.every((k) => JSON.stringify(a[k]) === JSON.stringify(g[k]));
};
const resumen = (f: GrampsDate | null) => (f ? CAMPOS.map((k) => JSON.stringify(f[k])).join(" ") : "null");

/** Las que no se leen igual, con lo leído. */
function fallos(escribir: (f: GrampsDate, x: (typeof datos.fechas)[number]) => string) {
  const salida: string[] = [];
  for (const x of datos.fechas) {
    const texto = escribir(x.fecha, x);
    const leida = leerFecha(texto);
    if (!igual(leida, x.fecha)) salida.push(`«${texto}»: ${resumen(leida)} ≠ ${resumen(x.fecha)}`);
  }
  return salida;
}

beforeAll(prepararFechas);
afterAll(() => fijarRegion(null));

describe("leerFecha", () => {
  it("los casos de la decisión: formato de la web, numérico de la región y de Gramps", () => {
    for (const t of ["3 de mayo de 1950", "03/05/1950", "3/5/1950", "3 mayo 1950", "3 Mayo 1950", "1950-05-03"]) {
      expect(leerFecha(t)?.dateval, t).toEqual([3, 5, 1950, false]);
    }
    expect(leerFecha("antes del 12 de mayo de 1900")).toMatchObject({ modifier: 1, dateval: [12, 5, 1900, false] });
    expect(leerFecha("del 1 de enero de 1900 al 5 de marzo de 1901")).toMatchObject({ modifier: 5, dateval: [1, 1, 1900, false, 5, 3, 1901, false] });
    expect(leerFecha("entre el 3 de mayo de 1950 y el 5 de junio de 1950")).toMatchObject({ modifier: 4 });
    expect(leerFecha("hacia el 2 de febrero de 1800")).toMatchObject({ modifier: 3, dateval: [2, 2, 1800, false] });
    expect(leerFecha("mayo de 1950")).toMatchObject({ modifier: 0, dateval: [0, 5, 1950, false] });
    expect(leerFecha("estimado de 1800 a 1805")).toMatchObject({ modifier: 5, quality: 1 });
  });

  it("las fechas aproximadas, también con «c.», «c», «ca.» y «circa» (31/10/2026)", () => {
    for (const t of ["hacia 1850", "c. 1850", "c 1850", "C. 1850", "ca. 1850", "circa 1850"]) {
      expect(leerFecha(t), t).toMatchObject({ modifier: 3, dateval: [0, 0, 1850, false] });
    }
    expect(leerFecha("c. 02/02/1800")).toMatchObject({ modifier: 3, dateval: [2, 2, 1800, false] });
    expect(leerFecha("c 2 de febrero de 1800")).toMatchObject({ modifier: 3, dateval: [2, 2, 1800, false] });
    expect(leerFecha("estimado c. 1850")).toMatchObject({ modifier: 3, quality: 1 });
  });

  it("vacío: sin fecha; lo que no se entiende, solo texto; con todos los campos de Gramps", () => {
    expect(leerFecha("  ")).toBeNull();
    const t = leerFecha("en la guerra")!;
    expect(t).toMatchObject({ modifier: 6, text: "en la guerra", sortval: 0 });
    expect(Object.keys(t).sort()).toEqual(Object.keys(fechaVacia()).sort());
  });

  it(`las ${datos.fechas.length} fechas, escritas por la web (formato largo), se leen igual`, () => {
    expect(fallos((f) => textoFecha(f, "largo"))).toEqual([]);
  });

  it("y escritas por la web en formato corto", () => {
    expect(fallos((f) => textoFecha(f, "corto"))).toEqual([]);
  });

  it("y escritas por Gramps («29 Agosto 1987» y «29/8/1987»)", () => {
    expect(fallos((_f, x) => x.gramps.diaMesAnio)).toEqual([]);
    expect(fallos((_f, x) => x.gramps.numerico)).toEqual([]);
  });

  it("con la región de Estados Unidos: «05/03/1950» es el 3 de mayo, y sus fechas se leen igual", async () => {
    await fijarRegion("en-US");
    try {
      expect(leerFecha("05/03/1950")?.dateval).toEqual([3, 5, 1950, false]);
      expect(leerFecha("3 de mayo de 1950")?.dateval).toEqual([3, 5, 1950, false]);
      expect(fallos((f) => textoFecha(f, "largo"))).toEqual([]);
      expect(fallos((f) => textoFecha(f, "corto"))).toEqual([]);
    } finally {
      await fijarRegion(null);
    }
  });
});
