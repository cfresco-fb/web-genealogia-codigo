// Borrar fichas enteras (comun/borrado.ts) y lo que no puede guardar un
// familiar de una petición entera (comun/permisos.ts, noPermitidos), con el
// árbol inventado de las pruebas del servidor. Uso: npm run pruebas-comun
import { test } from "node:test";
import assert from "node:assert/strict";
import { arbolPrueba, evento, familia, nota, persona, refEvento } from "../functions/pruebas/arbolPrueba.ts";
import { peticionBorrado, sinReferencia, type Obtener } from "./borrado.ts";
import { clave, type ObjetoGramps, type Tipo } from "./gramps.ts";
import { Indice } from "./indice.ts";
import { noPermitidos, type ContextoPermisos } from "./permisos.ts";
import { calcularRama } from "./rama.ts";

type O = Record<string, any>;

function arbol(cambiar: (o: Partial<Record<Tipo, ObjetoGramps[]>>) => void = () => {}) {
  const objetos = arbolPrueba();
  cambiar(objetos);
  const mapa = new Map<string, ObjetoGramps>();
  for (const [tipo, lista] of Object.entries(objetos)) for (const o of lista ?? []) mapa.set(clave(tipo as Tipo, o.handle), o);
  const obtener: Obtener = (tipo, h) => mapa.get(clave(tipo, h)) ?? null;
  return { indice: Indice.desdeObjetos(objetos), obtener };
}

const resumen = (objetos: { tipo: string; handle: string; operacion: string }[]) => objetos.map((o) => `${o.operacion} ${o.tipo}_${o.handle}`);

test("borrar a Tio: con él, su evento y su nota; el evento compartido con P se queda; sale de la familia de sus padres", () => {
  const { indice, obtener } = arbol();
  const { objetos, arrastrados } = peticionBorrado(indice, obtener, "Person", "Tio");
  assert.deepEqual(resumen(objetos).sort(), [
    "borrar Event_E3", "borrar Note_N1", "borrar Person_Tio", "modificar Family_fAbuelos",
  ]);
  assert.equal(resumen(objetos)[0], "borrar Person_Tio");
  assert.deepEqual(arrastrados.map((a) => clave(a.tipo, a.handle)).sort(), ["Event_E3", "Note_N1"]);
  const f = objetos.find((o) => o.handle === "fAbuelos")!.despues as O;
  assert.deepEqual(f.child_ref_list.map((c: O) => c.ref), ["Padre"]);
  assert.equal(objetos.find((o) => o.handle === "fAbuelos")!.base, 1_700_000_000);
});

test("borrar a la cónyuge: la familia se queda con el padre y el hijo; borrar una familia: sale de las personas", () => {
  const { indice, obtener } = arbol();
  const c = peticionBorrado(indice, obtener, "Person", "C");
  assert.deepEqual(resumen(c.objetos), ["borrar Person_C", "modificar Family_fP"]);
  assert.equal((c.objetos[1].despues as O).mother_handle, null);
  const f = peticionBorrado(indice, obtener, "Family", "fP");
  assert.deepEqual(resumen(f.objetos).sort(), ["borrar Family_fP", "modificar Person_C", "modificar Person_H", "modificar Person_P"]);
  const p = f.objetos.find((o) => o.handle === "P")!.despues as O;
  assert.deepEqual(p.family_list, []);
  assert.deepEqual(p.parent_family_list, ["fPadres"]);
  assert.deepEqual((f.objetos.find((o) => o.handle === "H")!.despues as O).parent_family_list, []);
});

test("la familia que se queda vacía se borra también (como Gramps), con su evento", () => {
  const { indice, obtener } = arbol((o) => {
    o.Person!.push(persona("Solo", "Solo", { family_list: ["fSolo"] }) as ObjetoGramps);
    o.Family!.push(familia("fSolo", "Solo", null, [], { event_ref_list: [refEvento("Eb")] }) as unknown as ObjetoGramps);
    o.Event!.push(evento("Eb") as ObjetoGramps);
  });
  const r = peticionBorrado(indice, obtener, "Person", "Solo");
  assert.deepEqual(resumen(r.objetos), ["borrar Person_Solo", "borrar Family_fSolo", "borrar Event_Eb"]);
});

test("un lugar: los eventos se quedan sin lugar; una nota con un enlace a la persona borrada pierde el enlace", () => {
  const { indice, obtener } = arbol((o) => {
    const n = nota("Nenlace", "Ver a Tío") as O;
    n.text.tags = [{ _class: "StyledTextTag", name: { _class: "StyledTextTagType", string: "", value: 8 }, ranges: [[4, 7]], value: "gramps://Person/handle/Tio" }];
    o.Note!.push(n as ObjetoGramps);
    (o.Person!.find((p) => p.handle === "P") as O).note_list = ["Nenlace"];
  });
  const l = peticionBorrado(indice, obtener, "Place", "L1");
  assert.deepEqual(resumen(l.objetos), ["borrar Place_L1", "modificar Event_E1"]);
  assert.equal((l.objetos[1].despues as O).place, "");
  const t = peticionBorrado(indice, obtener, "Person", "Tio");
  const n = t.objetos.find((o) => o.handle === "Nenlace")!.despues as O;
  assert.deepEqual(n.text.tags, []);
  assert.equal(n.text.string, "Ver a Tío");
});

test("sinReferencia: los índices de nacimiento y defunción siguen al mismo evento", () => {
  const p = { _class: "Person", handle: "X", event_ref_list: [refEvento("A"), refEvento("B"), refEvento("C")], birth_ref_index: 1, death_ref_index: 2 } as ObjetoGramps;
  const sinA = sinReferencia(p, "Event", "A") as O;
  assert.deepEqual([sinA.birth_ref_index, sinA.death_ref_index], [0, 1]);
  const sinB = sinReferencia(p, "Event", "B") as O;
  assert.deepEqual([sinB.birth_ref_index, sinB.death_ref_index], [-1, 1]);
  assert.equal(p.birth_ref_index, 1, "no toca el original");
});

test("noPermitidos: quitar un hijo de una familia de la rama, un tipo nuevo, fuera de la rama; el administrador, nada", () => {
  const { indice, obtener } = arbol();
  const ctx = (rol: "familiar" | "administrador"): ContextoPermisos => ({
    usuario: { correo: "p@example.com", rol, persona: "P" }, indice, rama: calcularRama(indice, "P"), creador: () => null,
  });
  const fPadres = obtener("Family", "fPadres")!;
  const sinHermano = { ...fPadres, child_ref_list: (fPadres.child_ref_list as O[]).filter((c) => c.ref !== "Hermano") };
  const hermano = obtener("Person", "Hermano")!;
  const cambios = [
    { tipo: "Family" as Tipo, handle: "fPadres", operacion: "modificar" as const, antes: fPadres, despues: sinHermano },
    { tipo: "Person" as Tipo, handle: "Hermano", operacion: "modificar" as const, antes: hermano, despues: { ...hermano, parent_family_list: [] } },
  ];
  assert.deepEqual(noPermitidos(ctx("familiar"), cambios, {}).map((n) => `${n.handle} ${n.razon}`), ["fPadres quitaVinculo", "Hermano quitaVinculo"]);
  const tio = obtener("Person", "Tio")!;
  const e1 = obtener("Event", "E1")!;
  const conTipo = { ...e1, type: { _class: "EventType", value: 0, string: "Bar mitzvá" } };
  assert.deepEqual(noPermitidos(ctx("familiar"), [
    { tipo: "Person", handle: "Tio", operacion: "modificar", antes: tio, despues: { ...tio, gender: 1 } },
    { tipo: "Event", handle: "E1", operacion: "modificar", antes: e1, despues: conTipo },
  ], { EventType: ["Separación"] }).map((n) => `${n.handle} ${n.razon}${n.tipos ? ` ${n.tipos.map((x) => `${x.clase}:${x.texto}`).join(",")}` : ""}`), ["Tio fueraDeRama", "E1 tipoNuevo EventType:Bar mitzvá"]);
  assert.deepEqual(noPermitidos(ctx("administrador"), cambios, {}), []);
});
