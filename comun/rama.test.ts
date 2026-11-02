// Rama editable: casos dibujados a mano (docs/diseno-fase-3.md, 9) y
// permisos por tipo. Uso: npm run pruebas-comun
import { test } from "node:test";
import assert from "node:assert/strict";
import { Indice } from "./indice.ts";
import { calcularRama } from "./rama.ts";
import { puedeBorrar, puedeCrear, puedeModificar, type ContextoPermisos, type Usuario } from "./permisos.ts";
import type { ObjetoGramps } from "./gramps.ts";

/** Árbol inventado: cada familia con padre, madre e hijos (y su tipo de
 * filiación); las personas salen de las familias. */
type Fam = [handle: string, padre: string | null, madre: string | null, hijos: (string | [string, number])[]];

function arbol(familias: Fam[], extra: Record<string, ObjetoGramps[]> = {}) {
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
  return Indice.desdeObjetos({ Person: [...personas.values()], Family: fams, ...extra });
}

// Bisabuelos BB1+BB2 → A1 (abuelo); A1+A2 → Padre; A3+A4 → Madre;
// Padre+Madre → P, Hermano, Hermanastro (hijastro en esa familia);
// Padre+OtraPareja → MedioHermano; OtraPareja+OtroX → HijoDeOtraPareja
// (hermanastro sin padres en común).
// Hermano+CuñadaH → Sobrino; CuñadaH es hija de CHP1, y hermana de HermanaCuñadaH.
// Tío: hijo de A1+A2; Primo: hijo del tío.
// P+C (cónyuge) → H1 → N1 → … (5 generaciones); C es hija de CP1+CP2, que
// son hijos de CA1+CA2 (abuelos de C), y de CB1+CB2 (bisabuelos de C);
// HermanaC, hija de CP1+CP2, casada con CuñadoC, con un hijo SobrinoC.
// H1+CH1; CH1 es hija de CH1P, con una hermana HermanaCH1.
// ExC+C → Hijastro (de P), casado con NueraH, con NietoH; ExC+OtraExC →
// HijoExC (hermano del hijastro, no de P).
// Hijastros de otros: OtroCH+CunadaH → HijastroHermano; OtroCH1+CH1 →
// HijastroH1; OtroNuera+NueraH → HijastroDeHijastro.
const FAMILIAS: Fam[] = [
  ["fBB", "BB1", "BB2", ["A1"]],
  ["fA", "A1", "A2", ["Padre", "Tio"]],
  ["fA2", "A3", "A4", ["Madre"]],
  ["fPadres", "Padre", "Madre", ["P", "Hermano", ["Hermanastro", 6]]],
  ["fOtra", "Padre", "OtraPareja", ["MedioHermano"]],
  ["fOtraX", "OtroX", "OtraPareja", ["HijoDeOtraPareja"]],
  ["fHermano", "Hermano", "CunadaH", ["Sobrino"]],
  ["fCunadaH", "CHP1", null, ["CunadaH", "HermanaCunadaH"]],
  ["fTio", "Tio", null, ["Primo"]],
  ["fP", "P", "C", ["H1"]],
  ["fH1", "H1", "CH1", ["N1"]],
  ["fN1", "N1", null, ["N2"]],
  ["fN2", "N2", null, ["N3"]],
  ["fN3", "N3", null, ["N4"]],
  ["fCP", "CP1", "CP2", ["C", "HermanaC"]],
  ["fHermanaC", "CunadoC", "HermanaC", ["SobrinoC"]],
  ["fCH1", "CH1P", null, ["CH1", "HermanaCH1"]],
  ["fCA", "CA1", "CA2", ["CP1"]],
  ["fCB", "CB1", "CB2", ["CA1"]],
  ["fCOtra", "ExC", "C", ["Hijastro"]],
  ["fHijastro", "Hijastro", "NueraH", ["NietoH"]],
  ["fExC2", "ExC", "OtraExC", ["HijoExC"]],
  ["fCunadaHOtra", "OtroCH", "CunadaH", ["HijastroHermano"]],
  ["fCH1Otra", "OtroCH1", "CH1", ["HijastroH1"]],
  ["fNueraOtra", "OtroNuera", "NueraH", ["HijastroDeHijastro"]],
];

const rama = calcularRama(arbol(FAMILIAS), "P");
const dentro = (h: string) => rama.personas.has(h);

test("P, sus padres y sus abuelos; no los bisabuelos", () => {
  for (const h of ["P", "Padre", "Madre", "A1", "A2", "A3", "A4"]) assert.ok(dentro(h), h);
  for (const h of ["BB1", "BB2"]) assert.ok(!dentro(h), h);
});

test("hermanos, medios hermanos y hermanastros, con su rama completa (ampliación del 24/10/2026)", () => {
  for (const h of ["Hermano", "MedioHermano", "Hermanastro", "Sobrino", "CunadaH", "CHP1", "OtraPareja"]) assert.ok(dentro(h), h);
});

test("hijos de la pareja de un padre con otro, aunque no haya padres en común (respuesta del 25/10/2026)", () => {
  for (const h of ["HijoDeOtraPareja", "OtroX"]) assert.ok(dentro(h), h);
});

test("hijastros de P, con su rama; no sus hermanos por la otra parte (respuesta del 25/10/2026)", () => {
  for (const h of ["Hijastro", "ExC", "NueraH", "NietoH"]) assert.ok(dentro(h), h);
  for (const h of ["HijoExC", "OtraExC"]) assert.ok(!dentro(h), h);
});

test("hijastros de todos: de un hermano, de un hijo y de un hijastro, con su rama (respuesta del 25/10/2026)", () => {
  for (const h of ["HijastroHermano", "OtroCH", "HijastroH1", "OtroCH1", "HijastroDeHijastro", "OtroNuera"]) assert.ok(dentro(h), h);
});

test("no entran tíos, primos ni los hermanos de los cuñados", () => {
  for (const h of ["Tio", "Primo", "HermanaCunadaH"]) assert.ok(!dentro(h), h);
});

test("hermanos del cónyuge con su rama; no los de los cónyuges de los descendientes", () => {
  for (const h of ["HermanaC", "CunadoC", "SobrinoC"]) assert.ok(dentro(h), h);
  assert.ok(!dentro("HermanaCH1"));
  // CH1P sí, como padre de un cónyuge de un descendiente.
  assert.ok(dentro("CH1P"));
});

test("descendientes a 5 generaciones, y los cónyuges de P y de los descendientes", () => {
  for (const h of ["H1", "N1", "N2", "N3", "N4", "C", "CH1"]) assert.ok(dentro(h), h);
});

test("padres y abuelos del cónyuge, pero no sus bisabuelos", () => {
  for (const h of ["CP1", "CP2", "CA1", "CA2"]) assert.ok(dentro(h), h);
  for (const h of ["CB1", "CB2"]) assert.ok(!dentro(h), h);
});

test("familias (DA-5 b): basta con que esté el padre o la madre", () => {
  for (const f of ["fA", "fA2", "fPadres", "fOtra", "fOtraX", "fHermano", "fCunadaH", "fP", "fH1", "fN1", "fN3", "fCP", "fCA", "fHermanaC", "fCH1", "fCOtra", "fHijastro", "fExC2"]) assert.ok(rama.familias.has(f), f);
  // La del padre del hijastro con otra, sí (está él); la de los bisabuelos
  // y la del tío, no.
  for (const f of ["fBB", "fTio", "fCB"]) assert.ok(!rama.familias.has(f), f);
});

test("dos familias de padres (nacimiento y adopción): cuentan las dos (DA-3 a)", () => {
  const r = calcularRama(arbol([
    ["fBio", "Bio1", "Bio2", [["P", 1]]],
    ["fAdop", "Adop1", "Adop2", [["P", 2]]],
    ["fAA", "AbAdop", null, ["Adop1"]],
  ]), "P");
  for (const h of ["Bio1", "Bio2", "Adop1", "Adop2", "AbAdop"]) assert.ok(r.personas.has(h), h);
});

test("cónyuge desconocido y familia sin pareja (DA-4 a): sus hijos son descendientes", () => {
  const r = calcularRama(arbol([["fSola", "P", null, ["H"]], ["fH", null, "H", ["N"]]]), "P");
  assert.deepEqual([...r.personas].sort(), ["H", "N", "P"]);
  assert.deepEqual([...r.familias].sort(), ["fH", "fSola"]);
});

test("ciclo en los datos (una persona antepasada de sí misma): termina", () => {
  const r = calcularRama(arbol([["f1", "P", null, ["X"]], ["f2", "X", null, ["P"]]]), "P");
  assert.deepEqual([...r.personas].sort(), ["P", "X"]);
  // Y hermano de sí mismo por dos familias: no cuenta.
  const r2 = calcularRama(arbol([["f1", "A", null, ["P"]], ["f2", "A", "B", ["P"]]]), "P");
  assert.deepEqual([...r2.personas].sort(), ["A", "B", "P"]);
});

test("usuario sin persona vinculada o con una que no existe: rama vacía", () => {
  const ind = arbol(FAMILIAS);
  for (const p of [null, undefined, "NoExiste"]) {
    const r = calcularRama(ind, p);
    assert.equal(r.personas.size + r.familias.size, 0);
  }
});

// ---- Permisos ----

const evento = (h: string): ObjetoGramps => ({ handle: h, _class: "Event", place: "L1", note_list: [], citation_list: [] });
const conEventos = (lista: Fam[], usos: Record<string, string[]>) => {
  const ind = arbol(lista, { Event: [evento("E1"), evento("E2"), evento("E3"), evento("Huerfano")], Place: [{ handle: "L1", _class: "Place" }] });
  // Cada evento, usado por esas personas o familias.
  for (const [e, quienes] of Object.entries(usos)) {
    for (const q of quienes) {
      const tipo = q.startsWith("f") ? "Family" : "Person";
      ind.referentes.get("Event")!.set(e, new Set([...(ind.referentes.get("Event")!.get(e) ?? []), `${tipo}_${q}`]));
    }
  }
  return ind;
};

function ctx(usuario: Usuario, creados: Record<string, string> = {}): ContextoPermisos {
  const indice = conEventos(FAMILIAS, { E1: ["P", "fPadres"], E2: ["P", "Tio"], E3: ["Primo"] });
  return { usuario, indice, rama: calcularRama(indice, usuario.persona), creador: (_t, h) => creados[h] ?? null };
}

const familiar: Usuario = { correo: "p@example.com", rol: "familiar", persona: "P" };

test("personas y familias: según la rama; su creador, siempre (DA-7 b y respuesta del 24/10/2026)", () => {
  const c = ctx(familiar);
  assert.ok(puedeModificar(c, "Person", "Padre").ok);
  assert.ok(puedeModificar(c, "Person", "Hermano").ok);
  assert.deepEqual(puedeModificar(c, "Person", "Tio"), { ok: false, razon: "fueraDeRama" });
  assert.ok(puedeModificar(c, "Family", "fOtra").ok);
  assert.deepEqual(puedeModificar(c, "Family", "fTio"), { ok: false, razon: "fueraDeRama" });
  const creador = ctx(familiar, { Tio: "p@example.com", fTio: "p@example.com" });
  assert.ok(puedeModificar(creador, "Person", "Tio").ok);
  assert.ok(puedeModificar(creador, "Family", "fTio").ok);
});

test("eventos: solo si todo lo que los usa se puede modificar", () => {
  const c = ctx(familiar);
  assert.ok(puedeModificar(c, "Event", "E1").ok);
  assert.deepEqual(puedeModificar(c, "Event", "E2"), { ok: false, razon: "usadoFueraDeRama" });
  assert.deepEqual(puedeModificar(c, "Event", "E3"), { ok: false, razon: "usadoFueraDeRama" });
  // Borrar eventos y notas (27/10/2026) y fotos (29/10/2026): quien los
  // puede modificar.
  assert.deepEqual(puedeBorrar(c, "Media", "Huerfano"), puedeModificar(c, "Media", "Huerfano"));
  assert.notDeepEqual(puedeBorrar(c, "Media", "Huerfano"), { ok: false, razon: "soloAdministrador" });
  assert.ok(puedeBorrar(c, "Event", "E1").ok);
  assert.deepEqual(puedeBorrar(c, "Event", "E2"), { ok: false, razon: "usadoFueraDeRama" });
  assert.deepEqual(puedeModificar(c, "Event", "Huerfano"), { ok: false, razon: "sinUso" });
  // Si al tío lo creó él, el evento compartido con él también.
  assert.ok(puedeModificar(ctx(familiar, { Tio: "p@example.com" }), "Event", "E2").ok);
  // El que nada usa, si lo creó él.
  assert.ok(puedeModificar(ctx(familiar, { Huerfano: "p@example.com" }), "Event", "Huerfano").ok);
});

test("lugares: solo su creador; etiquetas y borrados, solo el administrador", () => {
  assert.deepEqual(puedeModificar(ctx(familiar), "Place", "L1"), { ok: false, razon: "noEsCreador" });
  assert.ok(puedeModificar(ctx(familiar, { L1: "p@example.com" }), "Place", "L1").ok);
  assert.deepEqual(puedeCrear(ctx(familiar), "Tag"), { ok: false, razon: "soloAdministrador" });
  assert.ok(puedeCrear(ctx(familiar), "Person").ok);
  assert.deepEqual(puedeBorrar(ctx(familiar), "Person", "P"), { ok: false, razon: "soloAdministrador" });
});

test("revisor con su rama (DA-11 a); administrador, todo", () => {
  const revisor = ctx({ correo: "r@example.com", rol: "revisor", persona: "P" });
  assert.ok(!puedeModificar(revisor, "Person", "Tio").ok);
  const admin = ctx({ correo: "a@example.com", rol: "administrador", persona: null });
  for (const [t, h] of [["Person", "Tio"], ["Place", "L1"], ["Event", "E3"], ["Tag", "x"]] as const) assert.ok(puedeModificar(admin, t, h).ok);
  assert.ok(puedeBorrar(admin, "Person", "Tio").ok);
});
