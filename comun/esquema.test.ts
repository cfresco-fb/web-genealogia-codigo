// Plantillas y esquemas de Gramps (gramps/plantillas.json). Uso: npm run pruebas-comun
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { MAXIMO_TEXTO_NOTA, plantilla, validar } from "./esquema.ts";
import { TIPOS, type ObjetoGramps, type Tipo } from "./gramps.ts";

const muestra = JSON.parse(gunzipSync(readFileSync(new URL("./datos-prueba/rama-ejemplo.json.gz", import.meta.url))).toString("utf8"))
  .referencias as { tipo: Tipo; objeto: ObjetoGramps }[];

test("las plantillas de cada tipo, con handle e ID, pasan su esquema", () => {
  for (const t of TIPOS) {
    const o = plantilla<Record<string, unknown>>(t);
    // Vacíos en la plantilla: los pone la web (handle) y el servidor (ID).
    assert.equal(o.handle, null);
    o.handle = "h1";
    if (t !== "Tag") o.gramps_id = "X0001";
    if (t === "Citation") o.source_handle = "s1";
    assert.deepEqual(validar(t, o), [], t);
  }
});

test(`${muestra.length} objetos del árbol de ejemplo, tal como los da Gramps, pasan su esquema`, () => {
  for (const { tipo, objeto } of muestra) assert.deepEqual(validar(tipo, objeto), [], `${tipo} ${objeto.handle}`);
});

test("rechaza tipos equivocados, valores no permitidos, campos que faltan o sobran y otra clase", () => {
  const p = plantilla<Record<string, any>>("Person");
  p.gender = "hombre";
  p.primary_name.first_name = 3;
  delete p.primary_name.nick;
  p.primary_name.apodo = "x";
  p.event_ref_list = [{ ...plantilla("EventRef"), ref: 5 }];
  const errores = validar("Person", p);
  for (const e of [
    "Person.gender: se esperaba integer",
    "Person.primary_name.first_name: se esperaba string",
    "Person.primary_name: faltan nick",
    "Person.primary_name: sobran apodo",
  ]) assert.ok(errores.includes(e), `${e}\n${errores.join("\n")}`);
  assert.ok(errores.some((e) => e.startsWith("Person.event_ref_list[0].ref")), errores.join("\n"));
  assert.deepEqual(validar("Family", plantilla("Person")).slice(0, 1), ["Family: _class es \"Person\""]);
  const h = plantilla<Record<string, unknown>>("Person");
  h.handle = "x".repeat(51);
  assert.ok(validar("Person", h).some((e) => e.includes("más de 50 caracteres")));
});

test(`el texto de una nota, como mucho ${MAXIMO_TEXTO_NOTA} caracteres`, () => {
  const n = plantilla<Record<string, any>>("Note");
  n.handle = "h1";
  n.gramps_id = "N0001";
  n.text.string = "x".repeat(MAXIMO_TEXTO_NOTA);
  assert.deepEqual(validar("Note", n), []);
  n.text.string += "x";
  assert.deepEqual(validar("Note", n), [`Note.text.string: más de ${MAXIMO_TEXTO_NOTA} caracteres`]);
});

test("plantilla() da copias independientes", () => {
  const a = plantilla<Record<string, any>>("Person");
  a.primary_name.first_name = "A";
  assert.equal(plantilla<Record<string, any>>("Person").primary_name.first_name, "");
});
