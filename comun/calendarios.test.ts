// Conversiones de calendario comparadas con Gramps: datos-prueba/
// calendarios-gramps.json, generado por migracion/calendarios_gramps.py.
// (La comparación con las de gramps-date, en app/src/arbol/vivos.test.ts.)
// Uso: npm run pruebas-comun
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aSdn, deSdn } from "./calendarios.ts";

const gramps = JSON.parse(readFileSync(new URL("./datos-prueba/calendarios-gramps.json", import.meta.url), "utf8")) as {
  calendarios: Record<string, { calendario: number; sdn: number[]; ymd: [number, number, number][] }>;
};

for (const [nombre, { calendario, sdn, ymd }] of Object.entries(gramps.calendarios)) {
  test(`${nombre}: igual que Gramps, de ida y de vuelta (${sdn.length} días)`, () => {
    sdn.forEach((n, i) => {
      assert.deepEqual(deSdn(calendario, n), ymd[i], `SDN ${n}`);
      assert.equal(aSdn(calendario, ...ymd[i]), n, `${ymd[i].join("-")}`);
    });
  });
}
