// Contraste con la biblioteca de Gramps sobre el árbol de ejemplo
// (migracion/rama_gramps.py → datos-prueba/rama-ejemplo.json.gz): la rama
// de 30 personas y las referencias de una muestra de objetos de cada tipo.
// Uso: npm run pruebas-comun
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Indice } from "./indice.ts";
import { calcularRama } from "./rama.ts";
import { referenciasDe } from "./referencias.ts";
import type { ObjetoGramps, Tipo } from "./gramps.ts";

const datos = JSON.parse(gunzipSync(readFileSync(new URL("./datos-prueba/rama-ejemplo.json.gz", import.meta.url))).toString("utf8")) as {
  objetos: Record<Tipo, ObjetoGramps[]>;
  casos: { persona: string; id: string; personas: string[]; familias: string[] }[];
  referencias: { tipo: Tipo; objeto: ObjetoGramps; referencias: [Tipo, string][] }[];
};

test(`la rama coincide con Gramps en ${datos.casos.length} personas del árbol de ejemplo`, () => {
  const indice = Indice.desdeObjetos(datos.objetos);
  for (const c of datos.casos) {
    const r = calcularRama(indice, c.persona);
    assert.deepEqual([...r.personas].sort(), c.personas, `personas de ${c.id}`);
    assert.deepEqual([...r.familias].sort(), c.familias, `familias de ${c.id}`);
  }
  // Que la muestra no sea trivial: ramas de distintos tamaños.
  const tamanos = new Set(datos.casos.map((c) => c.personas.length));
  assert.ok(tamanos.size > 5);
});

test(`las referencias coinciden con get_referenced_handles_recursively en ${datos.referencias.length} objetos`, () => {
  for (const r of datos.referencias) {
    const nuestras = referenciasDe(r.objeto).map((x) => `${x.tipo}_${x.handle}`).sort();
    const gramps = r.referencias.map(([t, h]) => `${t}_${h}`).sort();
    assert.deepEqual(nuestras, gramps, `${r.tipo} ${r.objeto.gramps_id ?? r.objeto.handle}`);
  }
});
