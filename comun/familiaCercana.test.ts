// «Mi familia cercana» (Carlos, 11/11/2026): casos dibujados a mano, con un
// árbol inventado. Uso: npm run pruebas-comun
import { test } from "node:test";
import assert from "node:assert/strict";
import { Indice } from "./indice.ts";
import { conyugesNoSeparados, familiaCercana } from "./familiaCercana.ts";
import { familiasSeparadas, soloDe, type Aniversario } from "./aniversarios.ts";
import type { ObjetoGramps } from "./gramps.ts";

/** Cada familia con padre, madre e hijos (y su tipo de filiación: 1,
 * nacimiento; 2, adopción); las personas salen de las familias. */
type Fam = [handle: string, padre: string | null, madre: string | null, hijos: (string | [string, number])[]];

function arbol(familias: Fam[]) {
  const personas = new Map<string, ObjetoGramps>();
  const persona = (h: string) => {
    if (!personas.has(h)) personas.set(h, { handle: h, _class: "Person", parent_family_list: [], family_list: [], event_ref_list: [] });
    return personas.get(h)!;
  };
  const fams: ObjetoGramps[] = familias.map(([h, p, m, hijos]) => {
    for (const x of [p, m]) if (x) (persona(x).family_list as string[]).push(h);
    const refs = hijos.map((c) => (typeof c === "string" ? [c, 1] : c) as [string, number]);
    for (const [c] of refs) (persona(c).parent_family_list as string[]).push(h);
    return {
      handle: h, _class: "Family", father_handle: p, mother_handle: m, event_ref_list: [],
      child_ref_list: refs.map(([c, rel]) => ({ ref: c, frel: { value: rel }, mrel: { value: rel } })),
    };
  });
  return Indice.desdeObjetos({ Person: [...personas.values()], Family: fams });
}

// La familia de P:
// TT1+TT2 → BB1 (bisabuelo); BB1+BB2 → A1 y TioAbuelo; A1+A2 → Padre y Tio;
// A3+A4 → Madre y TiaM. Padre+Madre → P, Hermano y Adoptado; Padre+OtraPareja
// → MedioHermano; OtroX+OtraPareja → Hermanastro (sin padres en común con P).
// Hermano+CunadaH → Sobrino → SobrinoNieto; SuegroH → CunadaH (suegro de un
// hermano). Tio+TiaPolitica → Primo → HijoPrimo → NietoPrimo; Primo con
// ConyPrimo. TiaM → PrimaM. TioAbuelo → TioSegundo → PrimoSegundo.
// P+C → H1; H1+NueraH → N1; ConsP → NueraH (consuegro).
// La de C: CA1+CA2 → CP1 y TioC; CP1+CP2 → C y HermanaC; HermanaC+CunadoC →
// SobrinoC; TioC → PrimoC; C+ExDeC → HijoDeC (hijo de C con otra pareja).
// Expareja: P+ExP (familia con divorcio) → HijoEx; ExPadre → ExP y HermanoEx.
const FAMILIAS: Fam[] = [
  ["fTT", "TT1", "TT2", ["BB1"]],
  ["fBB", "BB1", "BB2", ["A1", "TioAbuelo"]],
  ["fA", "A1", "A2", ["Padre", "Tio"]],
  ["fA2", "A3", "A4", ["Madre", "TiaM"]],
  ["fPadres", "Padre", "Madre", ["P", "Hermano", ["Adoptado", 2]]],
  ["fOtra", "Padre", "OtraPareja", ["MedioHermano"]],
  ["fOtraX", "OtroX", "OtraPareja", ["Hermanastro"]],
  ["fHermano", "Hermano", "CunadaH", ["Sobrino"]],
  ["fSobrino", "Sobrino", null, ["SobrinoNieto"]],
  ["fSuegroH", "SuegroH", null, ["CunadaH"]],
  ["fTio", "Tio", "TiaPolitica", ["Primo"]],
  ["fPrimo", "Primo", "ConyPrimo", ["HijoPrimo"]],
  ["fHijoPrimo", "HijoPrimo", null, ["NietoPrimo"]],
  ["fTiaM", null, "TiaM", ["PrimaM"]],
  ["fTioAbuelo", "TioAbuelo", null, ["TioSegundo"]],
  ["fTioSegundo", "TioSegundo", null, ["PrimoSegundo"]],
  ["fP", "P", "C", ["H1"]],
  ["fH1", "H1", "NueraH", ["N1"]],
  ["fConsP", "ConsP", null, ["NueraH"]],
  ["fCA", "CA1", "CA2", ["CP1", "TioC"]],
  ["fCP", "CP1", "CP2", ["C", "HermanaC"]],
  ["fHermanaC", "CunadoC", "HermanaC", ["SobrinoC"]],
  ["fTioC", "TioC", null, ["PrimoC"]],
  ["fDeC", "ExDeC", "C", ["HijoDeC"]],
  ["fEx", "P", "ExP", ["HijoEx"]],
  ["fExPadre", "ExPadre", null, ["ExP", "HermanoEx"]],
];
const indice = arbol(FAMILIAS);
const SEPARADAS = new Set(["fEx"]);
const familia = familiaCercana(indice, "P", SEPARADAS)!;
const comprobar = (dentro: string[], fuera: string[]) => {
  for (const h of dentro) assert.ok(familia.has(h), `${h} debería estar`);
  for (const h of fuera) assert.ok(!familia.has(h), `${h} no debería estar`);
};

test("P, sus cónyuges y sus descendientes, con los cónyuges de cada uno", () => {
  comprobar(["P", "C", "H1", "N1", "NueraH", "HijoEx", "ExP"], []);
});

test("todos los ascendientes, sin límite", () => {
  comprobar(["Padre", "Madre", "A1", "A2", "A3", "A4", "BB1", "BB2", "TT1", "TT2"], []);
});

test("hermanos como en la rama: medios hermanos, hermanastros y adoptados, con sus descendientes y cónyuges", () => {
  comprobar(["Hermano", "Adoptado", "MedioHermano", "Hermanastro", "Sobrino", "SobrinoNieto", "CunadaH", "OtraPareja"], []);
});

test("tíos y primos hermanos, con todos sus descendientes y sus cónyuges", () => {
  comprobar(["Tio", "TiaM", "TiaPolitica", "Primo", "PrimaM", "ConyPrimo", "HijoPrimo", "NietoPrimo"], []);
});

test("la familia política: la del cónyuge con la misma regla", () => {
  comprobar(["CP1", "CP2", "CA1", "CA2", "HermanaC", "CunadoC", "SobrinoC", "TioC", "PrimoC", "HijoDeC", "ExDeC"], []);
});

test("no entran la familia de una expareja, los consuegros, los suegros de un hermano ni los primos segundos", () => {
  comprobar([], ["ExPadre", "HermanoEx", "ConsP", "SuegroH", "TioAbuelo", "TioSegundo", "PrimoSegundo", "OtroX"]);
});

test("una expareja con la que hay otra familia sin divorcio no es expareja; un cónyuge fallecido tampoco lo es", () => {
  const i = arbol([["f1", "X", "Y", []], ["f2", "X", "Y", []], ["fY", "PadreY", null, ["Y"]]]);
  assert.deepEqual([...conyugesNoSeparados(i, "X", new Set(["f1"]))], ["Y"]);
  assert.ok(familiaCercana(i, "X", new Set(["f1"]))!.has("PadreY"));
  assert.deepEqual([...conyugesNoSeparados(i, "X", new Set(["f1", "f2"]))], []);
  assert.ok(!familiaCercana(i, "X", new Set(["f1", "f2"]))!.has("PadreY"));
});

test("sin persona, o con una que no está en el árbol: null (todo el árbol)", () => {
  assert.equal(familiaCercana(indice, null, SEPARADAS), null);
  assert.equal(familiaCercana(indice, "NoExiste", SEPARADAS), null);
});

test("un ciclo en los datos no la cuelga", () => {
  // Z es hijo de Y, que es hijo de Z.
  const i = arbol([["f1", "Z", null, ["Y"]], ["f2", "Y", null, ["Z"]]]);
  assert.deepEqual([...familiaCercana(i, "Z", new Set())!].sort(), ["Y", "Z"]);
});

test("familias separadas y aniversarios solo de la familia: las bodas, si está cualquiera de los dos", () => {
  const ev = (h: string, value: number, string = "") => [h, { type: { value, string }, date: null }] as const;
  const fam = (h: string, p: string | null, m: string | null, evs: string[]) =>
    [h, { handle: h, father_handle: p, mother_handle: m, child_ref_list: [], event_ref_list: evs.map((ref) => ({ ref })), type: { value: 0 } }] as const;
  const datos = {
    familias: new Map([fam("fDiv", "a", "b", ["div"]), fam("fSep", "c", "d", ["sep"]), fam("fBien", "e", null, ["boda"]), fam("fFuera", "x", "y", [])]),
    eventos: new Map([ev("div", 7), ev("sep", 0, "@separacion"), ev("boda", 1)]),
  };
  assert.deepEqual([...familiasSeparadas(datos as never)].sort(), ["fDiv", "fSep"]);
  const a = (persona: string | null, familia: string | null) => ({ tipo: familia ? "boda" : "cumpleanos", persona, familia }) as Aniversario;
  const lista = [a("e", null), a("x", null), a(null, "fBien"), a(null, "fFuera")];
  assert.deepEqual(soloDe(lista, new Set(["e"]), datos as never), [lista[0], lista[2]]);
});
