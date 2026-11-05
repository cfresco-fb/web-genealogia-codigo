// Qué pide una solicitud, en palabras (cambiosSolicitud.ts): el título, el
// porqué y lo que cambia (casos de la prueba de Carlos del 28/10/2026).

import { beforeAll, describe, expect, it } from "vitest";
import type { ObjetoGramps } from "../../../comun/gramps.ts";
import type { NoPermitido } from "../../../comun/permisos.ts";
import { Arbol } from "../arbol/arbol";
import { prepararFechas } from "../arbol/fechas";
import type { Instantanea } from "../arbol/tipos";
import { type Cambio, cambiosDePropuesta, Descripcion } from "./cambiosSolicitud";

const tipo = (_class: string, value: number, string = "") => ({ _class, value, string });
const fecha = (anio: number) => ({ _class: "Date", calendar: 0, modifier: 0, quality: 0, dateval: [0, 0, anio, false], text: "", sortval: 0, newyear: 0 });
const base = (handle: string, o: object = {}) => ({ handle, gramps_id: handle, change: 7, private: false, note_list: [], ...o });
const persona = (h: string, nombre: string, apellido: string, o: object = {}) => base(h, {
  gender: 2,
  primary_name: { first_name: nombre, surname_list: [{ surname: apellido, prefix: "", primary: true, connector: "" }], suffix: "", title: "", call: "", nick: "", type: tipo("NameType", 2) },
  alternate_names: [], media_list: [], family_list: [], parent_family_list: [], event_ref_list: [], birth_ref_index: -1, death_ref_index: -1,
  attribute_list: [], address_list: [], urls: [], person_ref_list: [], ...o,
});
const evento = (h: string, t: ReturnType<typeof tipo>, anio: number) => base(h, { type: t, date: fecha(anio), place: "", description: "", media_list: [] });
const hijo = (h: string) => ({ ref: h, frel: tipo("ChildRefType", 1), mrel: tipo("ChildRefType", 1) });
const NACIMIENTO = tipo("EventType", 12);
const PRUEBA = tipo("EventType", 0, "Prueba");

const SARAH = persona("S", "Sarah", "Warner", { gender: 0, event_ref_list: [{ ref: "E1", role: tipo("EventRoleType", 1) }], birth_ref_index: 0 });
const PADRE = persona("PA", "Juan", "Warner", { family_list: ["F"] });
const MADRE = persona("MA", "Ana", "Pérez", { family_list: ["F"] });
const HERMANO = persona("H", "Luis", "Warner", { parent_family_list: ["F"] });
const FAMILIA = base("F", { father_handle: "PA", mother_handle: "MA", child_ref_list: [hijo("S"), hijo("H")], event_ref_list: [], type: tipo("FamilyRelType", 0), media_list: [], attribute_list: [] });
const E1 = evento("E1", NACIMIENTO, 1855);

let arbol: Arbol;
beforeAll(async () => {
  await prepararFechas();
  arbol = new Arbol({
    version_instantanea: 1, generada: "", version_gramps: "6.0.5", persona_inicio: null,
    objetos: { Person: [SARAH, PADRE, MADRE, HERMANO], Family: [FAMILIA], Event: [E1], Note: [], Place: [] },
  } as unknown as Instantanea);
});

const modificar = (o: object, cambio: (x: Record<string, unknown>) => void): Cambio => {
  const despues = structuredClone(o) as Record<string, unknown>;
  cambio(despues);
  const x = o as { handle: string };
  const tipoDe = "primary_name" in o ? "Person" : "child_ref_list" in o ? "Family" : "Event";
  return { tipo: tipoDe, handle: x.handle, operacion: "modificar", antes: o as ObjetoGramps, despues: despues as ObjetoGramps };
};
const describir = (cambios: Cambio[], noPermitidos: NoPermitido[], clase: "cambio" | "borrado" = "cambio") => {
  const d = new Descripcion(arbol, cambios, noPermitidos);
  const principal = { tipo: cambios[0].tipo, handle: cambios[0].handle };
  return { titulo: d.titulo(clase, principal), razones: d.razones(clase === "borrado" ? principal : undefined), ...d.describir(clase, principal) };
};

describe("qué pide una solicitud", () => {
  it("un evento nuevo con un tipo nuevo: el tipo por su nombre, el evento dentro de la persona", () => {
    const nuevo = evento("E2", PRUEBA, 1890);
    const r = describir([
      modificar(SARAH, (p) => { p.event_ref_list = [...(p.event_ref_list as object[]), { ref: "E2", role: tipo("EventRoleType", 1) }]; }),
      { tipo: "Event", handle: "E2", operacion: "crear", antes: null, despues: nuevo as ObjetoGramps },
    ], [{ tipo: "Event", handle: "E2", razon: "tipoNuevo", tipos: [{ clase: "EventType", texto: "Prueba" }] }]);
    expect(r.titulo).toBe("Cambio en la persona Sarah Warner");
    expect(r.razones).toEqual(["El tipo de evento «Prueba» es nuevo y solo el administrador puede añadirlo."]);
    expect(r.lineas).toEqual(["Evento nuevo: «Prueba» (tipo nuevo), 1890"]);
    expect(r.grupos).toEqual([]);
  });

  it("datos de una persona fuera de la rama: dato a dato, antes y después", () => {
    const r = describir([modificar(SARAH, (p) => {
      (p.primary_name as { nick: string }).nick = "Sally";
      p.gender = 2;
    })], [{ tipo: "Person", handle: "S", razon: "fueraDeRama" }]);
    expect(r.razones).toEqual(["La persona Sarah “Sally” Warner no es de tu rama."]);
    expect(r.lineas).toEqual(["Apodo: sin datos → Sally", "Sexo: Mujer → Desconocido"]);
  });

  it("cambiar el tipo de un evento: el título con el evento como era", () => {
    const r = describir([modificar(E1, (e) => { e.type = PRUEBA; })],
      [{ tipo: "Event", handle: "E1", razon: "tipoNuevo", tipos: [{ clase: "EventType", texto: "Prueba" }] }]);
    expect(r.titulo).toBe("Cambio en el evento Nacimiento, 1855");
    expect(r.lineas).toEqual(["Tipo: Nacimiento → «Prueba» (tipo nuevo)"]);
  });

  it("quitar a un hijo: a quién y de qué familia, una vez; la persona no se repite", () => {
    const r = describir([
      modificar(FAMILIA, (f) => { f.child_ref_list = [hijo("S")]; }),
      modificar(HERMANO, (p) => { p.parent_family_list = []; }),
    ], [{ tipo: "Family", handle: "F", razon: "quitaVinculo" }, { tipo: "Person", handle: "H", razon: "quitaVinculo" }]);
    expect(r.titulo).toBe("Cambio en la familia Juan Warner y Ana Pérez");
    expect(r.razones).toEqual(["Quitar a Luis Warner de la familia Juan Warner y Ana Pérez solo lo puede hacer el administrador."]);
    expect(r.lineas).toEqual(["Hijo quitado: Luis Warner"]);
    expect(r.grupos).toEqual([]);
  });

  it("borrar: lo que se borra con ella y de dónde se quita", () => {
    const r = describir([
      { tipo: "Person", handle: "H", operacion: "borrar", antes: HERMANO as ObjetoGramps, despues: null },
      modificar(FAMILIA, (f) => { f.child_ref_list = [hijo("S")]; }),
    ], [{ tipo: "Person", handle: "H", razon: "soloAdministrador" }, { tipo: "Family", handle: "F", razon: "fueraDeRama" }], "borrado");
    expect(r.titulo).toBe("Borrar la persona Luis Warner");
    expect(r.razones).toEqual(["Borrar la persona Luis Warner solo lo puede hacer el administrador."]);
    expect(r.lineas).toEqual(["Se quita de la familia Juan Warner y Ana Pérez."]);
  });

  it("tipos nuevos guardados solo con el texto (solicitudes de la mañana del 28/10/2026)", () => {
    const r = describir([modificar(E1, (e) => { e.type = PRUEBA; })],
      [{ tipo: "Event", handle: "E1", razon: "tipoNuevo", tipos: ["Prueba"] as never }]);
    expect(r.razones).toEqual(["El tipo «Prueba» es nuevo y solo el administrador puede añadirlo."]);
    expect(r.lineas).toEqual(["Tipo: Nacimiento → «Prueba» (tipo nuevo)"]);
  });

  it("una hija, como hija", () => {
    const r = describir([modificar(FAMILIA, (f) => { f.child_ref_list = [hijo("H")]; })], []);
    expect(r.lineas).toEqual(["Hija quitada: Sarah Warner"]);
  });

  it("una solicitud guardada sin «antes» (anterior al 28/10/2026): el árbol de ahora", () => {
    const [c] = cambiosDePropuesta(arbol, [{ tipo: "Person", handle: "S", operacion: "modificar", base: 7, despues: JSON.stringify(SARAH) }]);
    expect(c.antes).toEqual(SARAH);
  });
});
