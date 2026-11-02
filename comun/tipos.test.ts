// Tipos propios (comun/tipos.ts). Uso: npm run pruebas-comun
import { test } from "node:test";
import assert from "node:assert/strict";
import { HANDLE, nuevoHandle } from "./gramps.ts";
import { plantilla } from "./esquema.ts";
import {
  CATALOGO, codigoDe, codigosDesconocidos, entradaCodigo, entradasClase, normalizarTipo, textoEntrada, tiposNuevos, tiposPropios, unirTipos,
} from "./tipos.ts";
import casos from "./tipos-propios.casos.json" with { type: "json" };

const tipo = (clase: string, value: number, string = "") => ({ _class: clase, value, string });

test("tiposPropios: solo los que llevan texto, de cualquier clase y a cualquier profundidad", () => {
  const evento = { ...plantilla<Record<string, unknown>>("Event"), type: tipo("EventType", 0, "Separación") };
  const persona = plantilla<Record<string, unknown>>("Person");
  (persona.event_ref_list as unknown[]).push({ ...plantilla<Record<string, unknown>>("EventRef"), role: tipo("EventRoleType", 0, "Padrino") });
  const familia = { ...plantilla<Record<string, unknown>>("Family"), type: tipo("FamilyRelType", 4, "Sin relación de pareja") };
  const deSerie = { ...plantilla<Record<string, unknown>>("Event"), type: tipo("EventType", 12) };
  assert.deepEqual(tiposPropios([evento, persona, familia, deSerie, null]), {
    EventRoleType: ["Padrino"], EventType: ["Separación"], FamilyRelType: ["Sin relación de pareja"],
  });
});

test("unirTipos: sin repetir", () => {
  assert.deepEqual(unirTipos({ EventType: ["B", "A"] }, { EventType: ["A", "C"], NoteType: ["X"] }), { EventType: ["A", "B", "C"], NoteType: ["X"] });
});

test("tiposNuevos: los que no están ni en el árbol ni en el objeto antes del cambio", () => {
  const conocidos = { EventType: ["Separación"] };
  const ev = (s: string) => ({ _class: "Event", type: tipo("EventType", 0, s) });
  assert.deepEqual(tiposNuevos(ev("Separación"), null, conocidos), []);
  assert.deepEqual(tiposNuevos(ev("separacion"), null, conocidos), [{ clase: "EventType", texto: "separacion" }]);
  // Uno que ya tenía el objeto (aunque no estuviera en la lista) se puede conservar.
  assert.deepEqual(tiposNuevos(ev("Deported"), ev("Deported"), conocidos), []);
  // El mismo texto en otra clase es otro tipo.
  assert.deepEqual(tiposNuevos({ type: tipo("NoteType", 0, "Separación") }, null, conocidos), [{ clase: "NoteType", texto: "Separación" }]);
});

test("catálogo: códigos únicos por clase, en minúsculas y sin acentos, con texto en castellano y sin textos repetidos en su clase", () => {
  const vistos = new Set<string>();
  for (const e of CATALOGO) {
    assert.match(e.codigo, /^[a-z][a-z0-9_]*$/);
    assert.ok(e.textos.es, e.codigo);
    assert.ok(!vistos.has(`${e.clase}|${e.codigo}`), e.codigo);
    vistos.add(`${e.clase}|${e.codigo}`);
  }
  for (const clase of new Set(CATALOGO.map((e) => e.clase))) {
    const textos = entradasClase(clase).flatMap((e) => [e.codigo, ...Object.values(e.textos), ...e.sinonimos].map(normalizarTipo));
    assert.equal(new Set(textos).size, new Set(entradasClase(clase).flatMap((e) => [e.codigo, ...Object.values(e.textos), ...e.sinonimos].map((t) => `${e.codigo}|${normalizarTipo(t)}`))).size, clase);
  }
});

test("codigoDe y textoEntrada: los casos comunes con la migración (tipos-propios.casos.json)", () => {
  for (const c of casos.aCodigo) assert.equal(codigoDe(c.clase, c.texto), c.codigo, `${c.clase} «${c.texto}»`);
  for (const c of casos.aTexto) assert.equal(textoEntrada(entradaCodigo(c.clase, c.codigo)!, c.idioma), c.texto, c.codigo);
});

test("codigosDesconocidos: los «@…» que no están en el catálogo de su clase", () => {
  const ev = (s: string) => ({ _class: "Event", type: tipo("EventType", 0, s) });
  assert.deepEqual(codigosDesconocidos(ev("@separacion")), []);
  assert.deepEqual(codigosDesconocidos(ev("LVG")), []);
  assert.deepEqual(codigosDesconocidos(ev("@inventado")), [{ clase: "EventType", texto: "@inventado" }]);
  assert.deepEqual(codigosDesconocidos({ type: tipo("NoteType", 0, "@separacion") }), [{ clase: "NoteType", texto: "@separacion" }]);
});

test("tiposNuevos: los códigos del catálogo nunca son nuevos", () => {
  const ev = (s: string) => ({ _class: "Event", type: tipo("EventType", 0, s) });
  assert.deepEqual(tiposNuevos(ev("@deportacion"), null, {}), []);
  assert.deepEqual(tiposNuevos(ev("@inventado"), null, {}), [{ clase: "EventType", texto: "@inventado" }]);
});

test("nuevoHandle: válido y distinto cada vez", () => {
  const hs = new Set(Array.from({ length: 1000 }, nuevoHandle));
  assert.equal(hs.size, 1000);
  for (const h of hs) assert.match(h, HANDLE);
});
