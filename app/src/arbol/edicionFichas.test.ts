// Lo que hacen los formularios de persona y familia con los datos
// (edicionFichas.ts): índices de nacimiento y defunción, vínculos dobles y
// el conflicto.

import { beforeAll, describe, expect, it } from "vitest";
import { Arbol } from "./arbol";
import { prepararFechas } from "./fechas";
import { fotosBorradores, indicesVitales, objetosBorradores, objetosPersonas, quitarReferencia, reaplicar, seccionesCambiadas, sinBorradores } from "./edicionFichas";
import type { Evento, Familia, Instantanea, Multimedia, Persona } from "./tipos";

const tipo = (_class: string, value: number) => ({ _class, value, string: "" });
const ref = (h: string, rol = 1) => ({ ref: h, role: tipo("EventRoleType", rol) });
const eventos: Record<string, Evento> = Object.fromEntries(
  [["nac", 12], ["def", 13], ["bau", 15], ["nac2", 12]].map(([h, v]) => [h, { handle: h, type: tipo("EventType", v as number) } as Evento]),
);
const eventoDe = (h: string) => eventos[h] ?? null;
const persona = (h: string, o: Partial<Persona> = {}): Persona => ({
  handle: h, change: 1, family_list: [], parent_family_list: [], event_ref_list: [], birth_ref_index: -1, death_ref_index: -1, ...o,
} as Persona);
const familia = (o: Partial<Familia>): Familia => ({
  handle: "F", change: 1, father_handle: null, mother_handle: null, child_ref_list: [], ...o,
} as Familia);
const hijo = (h: string) => ({ ref: h, frel: tipo("ChildRefType", 1), mrel: tipo("ChildRefType", 1) });

describe("índices de nacimiento y defunción", () => {
  const antes = persona("P", { event_ref_list: [ref("bau"), ref("nac"), ref("def")], birth_ref_index: 1, death_ref_index: 2 });
  it("siguen a su evento cuando cambia el orden", () => {
    const p = { ...antes, event_ref_list: [ref("def"), ref("nac"), ref("bau")] };
    expect(indicesVitales(p, antes, eventoDe)).toEqual({ birth_ref_index: 1, death_ref_index: 0 });
  });
  it("si se quita el evento, el siguiente de ese tipo con papel principal, o ninguno", () => {
    const p = { ...antes, event_ref_list: [ref("bau"), ref("nac2", 7), ref("nac2")] };
    expect(indicesVitales({ ...p, event_ref_list: [ref("bau"), ref("nac2")] }, antes, eventoDe)).toEqual({ birth_ref_index: 1, death_ref_index: -1 });
    expect(indicesVitales({ ...p, event_ref_list: [ref("bau"), ref("nac2", 7)] }, antes, eventoDe)).toEqual({ birth_ref_index: -1, death_ref_index: -1 });
  });
  it("un nacimiento nuevo en quien no tenía, con papel principal", () => {
    const sin = persona("Q", { event_ref_list: [ref("bau")] });
    expect(indicesVitales({ ...sin, event_ref_list: [ref("bau"), ref("nac")] }, sin, eventoDe)).toEqual({ birth_ref_index: 1, death_ref_index: -1 });
  });
});

describe("vínculos dobles de la familia", () => {
  const personas: Record<string, Persona> = {
    pa: persona("pa", { family_list: ["F"] }),
    ma: persona("ma"),
    h1: persona("h1", { parent_family_list: ["F", "G"] }),
    h2: persona("h2"),
  };
  const base = familia({ father_handle: "pa", child_ref_list: [hijo("h1")] });
  const de = (h: string) => personas[h] ?? null;

  it("sin cambios de personas, ninguno", () => {
    expect(objetosPersonas(base, { ...base, type: tipo("FamilyRelType", 0) } as Familia, new Map(), de)).toEqual([]);
  });
  it("añadir madre e hijo del árbol: su lado, con su versión", () => {
    const f = familia({ father_handle: "pa", mother_handle: "ma", child_ref_list: [hijo("h1"), hijo("h2")] });
    const out = objetosPersonas(base, f, new Map(), de);
    expect(out.map((o) => [o.handle, o.operacion, o.base])).toEqual([["ma", "modificar", 1], ["h2", "modificar", 1]]);
    expect((out[0].despues as unknown as Persona).family_list).toEqual(["F"]);
    expect((out[1].despues as unknown as Persona).parent_family_list).toEqual(["F"]);
  });
  it("quitar al padre y a un hijo (administrador): se les quita la familia, y nada más", () => {
    const out = objetosPersonas(base, familia({}), new Map(), de);
    expect(out.map((o) => o.handle)).toEqual(["pa", "h1"]);
    expect((out[0].despues as unknown as Persona).family_list).toEqual([]);
    expect((out[1].despues as unknown as Persona).parent_family_list).toEqual(["G"]);
  });
  it("personas nuevas: se crean con su lado puesto; las que se quitan antes de guardar, no", () => {
    const nuevas = new Map([["n1", persona("n1")], ["n2", persona("n2")]]);
    const out = objetosPersonas(base, { ...base, mother_handle: "n1" }, nuevas, de);
    expect(out.map((o) => [o.handle, o.operacion, o.base])).toEqual([["n1", "crear", null]]);
    expect((out[0].despues as unknown as Persona).family_list).toEqual(["F"]);
  });
});

describe("conflicto", () => {
  it("mis campos cambiados sobre la versión nueva; los demás, los de la nueva", () => {
    const base = { change: 1, a: 1, b: [1], c: "x" };
    const mio = { change: 1, a: 2, b: [1], c: "x" };
    const actual = { change: 5, a: 1, b: [1, 2], c: "y" };
    expect(reaplicar(base, mio, actual)).toEqual({ change: 5, a: 2, b: [1, 2], c: "y" });
  });
  it("las secciones que han cambiado, sin repetir, y lo demás como «otros»", () => {
    const r = { gender: "Sexo", primary_name: "Nombres", alternate_names: "Nombres" };
    expect(seccionesCambiadas({ change: 1, gender: 1, primary_name: 1, alternate_names: 1, x: 1 },
      { change: 2, gender: 0, primary_name: 2, alternate_names: 2, x: 2 }, r, "Otros")).toEqual(["Sexo", "Nombres", "Otros"]);
  });
});

describe("quitar una referencia", () => {
  it("de las listas de handles y de referencias, a cualquier profundidad, sin tocar lo demás", () => {
    const o = {
      handle: "P", note_list: ["N1", "N2"], event_ref_list: [{ ref: "E1", note_list: ["N1"] }, { ref: "E2", note_list: [] }],
      primary_name: { first_name: "N1", note_list: ["N1"] }, gender: 1,
    };
    expect(quitarReferencia(o, "N1")).toEqual({
      handle: "P", note_list: ["N2"], event_ref_list: [{ ref: "E1", note_list: [] }, { ref: "E2", note_list: [] }],
      primary_name: { first_name: "N1", note_list: [] }, gender: 1,
    });
    expect(quitarReferencia(o, "E1").event_ref_list).toEqual([{ ref: "E2", note_list: [] }]);
  });
});

describe("lo que se guarda al quitar eventos y notas", () => {
  const base = (handle: string, o: object = {}) => ({ handle, gramps_id: handle, change: 7, private: false, note_list: [], ...o });
  const persona2 = (h: string, eventos: string[], notas: string[], fotos: string[] = []) => base(h, {
    gender: 2, primary_name: { first_name: h, surname_list: [], suffix: "", title: "", call: "", nick: "", type: tipo("NameType", 2) },
    alternate_names: [], media_list: fotos.map((f) => ({ ref: f, rect: null })), family_list: [], parent_family_list: [], note_list: notas,
    event_ref_list: eventos.map((e) => ref(e)), birth_ref_index: eventos.indexOf("E2"), death_ref_index: -1,
  });
  const ev = (h: string, notas: string[] = []) => base(h, { type: tipo("EventType", 12), date: { dateval: [0, 0, 0, false] }, place: "", description: "", media_list: [], note_list: notas });
  const nota = (h: string) => base(h, { text: { string: h }, type: tipo("NoteType", 1) });
  let arbol: Arbol;
  beforeAll(async () => {
    await prepararFechas();
    arbol = new Arbol({
      version_instantanea: 1, generada: "", version_gramps: "6.0.5", persona_inicio: null,
      objetos: {
        Person: [persona2("P", ["E1", "E2"], ["N2"], ["M1", "M2"]), persona2("Q", ["E2"], ["N2"], ["M2"])],
        Event: [ev("E1", ["N1"]), ev("E2")], Note: [nota("N1"), nota("N2"), nota("N3")],
        Media: [base("M1", { desc: "M1", mime: "image/jpeg", path: "", note_list: ["N3"] }), base("M2", { desc: "M2", mime: "image/jpeg", path: "" })],
      },
    } as unknown as Instantanea);
  });
  const quitando = (h: string, tipo: "Event" | "Note" | "Media", todos: boolean) => ({ ...sinBorradores(), quitados: new Map([[h, { tipo, todos }]]) });
  const resumen = (o: { tipo: string; handle: string; operacion: string }[]) => o.map((x) => `${x.operacion} ${x.tipo} ${x.handle}`);

  it("solo de esta ficha: se borra, con las notas del evento que no usa nadie más", () => {
    expect(resumen(objetosBorradores(quitando("E1", "Event", true), ["E2"], ["N2"], arbol, new Map(), "P")))
      .toEqual(["borrar Event E1", "borrar Note N1"]);
  });
  it("compartido, solo de aquí: nada más que guardar", () => {
    expect(objetosBorradores(quitando("E2", "Event", false), ["E1"], ["N2"], arbol, new Map(), "P")).toEqual([]);
  });
  it("compartido, de todos: se quita de las demás fichas (con su índice de nacimiento) y se borra", () => {
    const out = objetosBorradores(quitando("E2", "Event", true), ["E1"], ["N2"], arbol, new Map(), "P");
    expect(resumen(out)).toEqual(["modificar Person Q", "borrar Event E2"]);
    const q = out[0].despues as unknown as Persona;
    expect(q.event_ref_list).toEqual([]);
    expect(q.birth_ref_index).toBe(-1);
    expect(out[0].base).toBe(7);
    expect(resumen(objetosBorradores(quitando("N2", "Note", true), ["E1", "E2"], [], arbol, new Map(), "P")))
      .toEqual(["modificar Person Q", "borrar Note N2"]);
  });
  it("fotos (29/10/2026): solo de esta ficha, se borra con sus notas; de todas, se quita de las demás; si sigue en la galería, nada", () => {
    expect(resumen(objetosBorradores(quitando("M1", "Media", true), [], [], arbol, new Map(), "P", ["M2"])))
      .toEqual(["borrar Media M1", "borrar Note N3"]);
    expect(resumen(objetosBorradores(quitando("M2", "Media", true), [], [], arbol, new Map(), "P", ["M1"])))
      .toEqual(["modificar Person Q", "borrar Media M2"]);
    expect(objetosBorradores(quitando("M2", "Media", false), [], [], arbol, new Map(), "P", ["M1"])).toEqual([]);
    expect(objetosBorradores(quitando("M1", "Media", true), [], [], arbol, new Map(), "P", ["M1", "M2"])).toEqual([]);
  });
  it("lo que vuelve a la ficha antes de guardar no se toca", () => {
    expect(objetosBorradores(quitando("E1", "Event", true), ["E1", "E2"], ["N2"], arbol, new Map(), "P")).toEqual([]);
  });
});

describe("fotos subidas (paso 11 b)", () => {
  it("se mandan las que siguen en la galería, cada una con su subida", () => {
    const b = sinBorradores();
    const media = (h: string) => ({ handle: h, desc: h }) as unknown as Multimedia;
    b.fotos.set("m1", { media: media("m1"), subida: "s1" });
    b.fotos.set("m2", { media: media("m2"), subida: "s2" });
    const r = fotosBorradores(b, ["viejo", "m2"]);
    expect(r.objetos).toEqual([{ tipo: "Media", handle: "m2", operacion: "crear", base: null, despues: media("m2") }]);
    expect(r.ficheros).toEqual([{ handle: "m2", subida: "s2" }]);
    expect(r.subidas).toEqual(["s2"]);
  });
  it("las del árbol con otra descripción o fecha, sobre su versión (la de `bases` si la hay), si siguen en la galería (29/10/2026)", () => {
    const b = sinBorradores();
    const media = (h: string, desc: string, change: number) => ({ handle: h, desc, change }) as unknown as Multimedia;
    const arbolFotos = { multimedia: new Map([["m1", media("m1", "antes", 5)], ["m2", media("m2", "antes", 5)]]) } as never;
    b.fotosCambiadas.set("m1", media("m1", "nueva", 5));
    b.fotosCambiadas.set("m2", media("m2", "quitada", 5));
    expect(fotosBorradores(b, ["m1"], arbolFotos).objetos)
      .toEqual([{ tipo: "Media", handle: "m1", operacion: "modificar", base: 5, despues: media("m1", "nueva", 5) }]);
    const bases = new Map([["m1", media("m1", "de otro", 9) as never]]);
    expect(fotosBorradores(b, ["m1"], arbolFotos, bases).objetos[0]).toMatchObject({ base: 9, despues: { desc: "nueva", change: 9 } });
  });
});
