// Cambios propios aplicados al árbol en memoria (Arbol.conCambios) y el
// índice de relaciones construido desde la instantánea.
import { describe, expect, it } from "vitest";
import { Arbol } from "./arbol";
import { calcularRama } from "../../../comun/rama.ts";
import type { Instantanea } from "./tipos";

const persona = (handle: string, campos: Record<string, unknown> = {}) => ({
  handle, gramps_id: handle.toUpperCase(), gender: 2, change: 1,
  primary_name: { first_name: handle, surname_list: [], title: "", suffix: "", call: "", nick: "" },
  alternate_names: [], event_ref_list: [], family_list: [], parent_family_list: [],
  birth_ref_index: -1, death_ref_index: -1, media_list: [], note_list: [], citation_list: [], tag_list: [],
  attribute_list: [], address_list: [], urls: [], lds_ord_list: [], person_ref_list: [], private: false,
  ...campos,
});

const instantanea = (): Instantanea => ({
  version_instantanea: 2, generada: "2026-10-24T00:00:00Z", version_gramps: "6.0.5", persona_inicio: "a", secuencia: 3,
  objetos: {
    Person: [persona("a", { family_list: ["f"] }), persona("c", { parent_family_list: ["f"] })] as never,
    Family: [{ handle: "f", gramps_id: "F1", father_handle: "a", mother_handle: null, child_ref_list: [{ ref: "c", frel: { value: 1 }, mrel: { value: 1 } }], event_ref_list: [] }] as never,
  },
  web: { creadoPor: {}, recientes: [] },
});

describe("Arbol.conCambios", () => {
  it("crea, modifica y borra en orden de handle, sin tocar el árbol de antes", () => {
    const antes = new Arbol(instantanea());
    const despues = antes.conCambios([
      { tipo: "Person", handle: "b", despues: persona("b") as never },
      { tipo: "Person", handle: "a", despues: persona("a", { gender: 1, family_list: ["f"] }) as never },
      { tipo: "Person", handle: "c", despues: null },
    ], 4);
    expect([...despues.personas.keys()]).toEqual(["a", "b"]);
    expect(despues.instantanea.objetos.Person!.map((p) => p.handle)).toEqual(["a", "b"]);
    expect(despues.personas.get("a")!.gender).toBe(1);
    expect(despues.secuencia).toBe(4);
    expect([...antes.personas.keys()]).toEqual(["a", "c"]);
    expect(antes.personas.get("a")!.gender).toBe(2);
  });

  it("el índice de relaciones sale de la instantánea y da la rama", () => {
    const arbol = new Arbol(instantanea());
    const rama = calcularRama(arbol.indiceRelaciones(), "a");
    expect([...rama.personas].sort()).toEqual(["a", "c"]);
    expect([...rama.familias]).toEqual(["f"]);
  });

  it("acepta instantáneas de la versión 1 (sin secuencia)", () => {
    const { secuencia: _, web: __, ...v1 } = instantanea();
    expect(new Arbol({ ...v1, version_instantanea: 1 }).secuencia).toBe(0);
  });
});
