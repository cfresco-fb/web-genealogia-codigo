// Pruebas de los datos de los gráficos con un árbol inventado que reúne los
// casos difíciles: primos casados entre sí (abuelos repetidos), varios
// matrimonios, hijos de distintas parejas, cónyuge desconocido, sexo
// desconocido, personas sin fechas ni padres, y datos con un ciclo.

import { beforeAll, describe, expect, it } from "vitest";
import { measureTreeChart, type TreeNode } from "../gramps-connect/graficos/charts/treeChart";
import { Arbol } from "./arbol";
import { prepararFechas } from "./fechas";
import {
  construirGrafico, generacionesEfectivas, generacionesQueHay, generacionesValidas, leerGeneraciones, leerTipo, opcionesGeneraciones,
} from "./grafico";
import { simbolosDe } from "./simbolos";
import type { Instantanea } from "./tipos";

const SIN_FECHA = { modifier: 0, quality: 0, calendar: 0, dateval: [0, 0, 0, false], text: "", sortval: 0, newyear: 0 };
const tipo = (_class: string, value: number) => ({ _class, value, string: "" });
const base = (handle: string) => ({ handle, gramps_id: handle.toUpperCase(), change: 0, private: false, note_list: [] });
const persona = (h: string, nombre: string, gender: number, padres: string[], familias: string[], eventos: string[] = []) => ({
  ...base(h), gender,
  primary_name: {
    first_name: nombre, suffix: "", title: "", call: "", nick: "", type: tipo("NameType", 2),
    surname_list: [{ surname: "Prueba", prefix: "", primary: true, connector: "" }],
  },
  alternate_names: [], media_list: [], family_list: familias, parent_family_list: padres,
  event_ref_list: eventos.map((ref) => ({ ref, role: tipo("EventRoleType", 1) })),
  birth_ref_index: eventos.length ? 0 : -1, death_ref_index: -1,
});
const NACIMIENTO = tipo("ChildRefType", 1);
const familia = (h: string, padre: string | null, madre: string | null, hijos: string[], eventos: string[] = [], adoptados: string[] = []) => ({
  ...base(h), father_handle: padre, mother_handle: madre, type: tipo("FamilyRelType", 0), media_list: [],
  event_ref_list: eventos.map((ref) => ({ ref, role: tipo("EventRoleType", 2) })),
  child_ref_list: hijos.map((ref) => {
    const rel = adoptados.includes(ref) ? tipo("ChildRefType", 2) : NACIMIENTO;
    return { ref, frel: rel, mrel: rel };
  }),
});
const evento = (h: string, valorTipo: number, anio: number) => ({
  ...base(h), type: tipo("EventType", valorTipo), description: "", place: "", media_list: [],
  date: { ...SIN_FECHA, dateval: [0, 0, anio, false], sortval: anio * 365 },
});

//            abuelo ═ abuela                    (fa)
//           ┌───────┴───────┐
//   x ═ pablo ═ w         quica ═ y            (fp1, fp2 | fq)
//   │         │                 │      y ═ ?    (fy2: sin cónyuge)
//   c1        c3 (adoptado)    c2       c4
//   └──────── c1 ═ c2 ────────┘                (fc: primos casados)
//                 z
// Y, aparte, un ciclo imposible: l1 es padre de l2 y l2 padre de l1.
const INSTANTANEA = {
  version_instantanea: 1, generada: "2026-10-22T00:00:00Z", version_gramps: "6.0.5", persona_inicio: "z",
  objetos: {
    Person: [
      persona("abuelo", "Abuelo", 1, [], ["fa"], ["e1"]),
      persona("abuela", "Abuela", 0, [], ["fa"]),
      persona("pablo", "Pablo", 1, ["fa"], ["fp1", "fp2"]),
      persona("quica", "Quica", 0, ["fa"], ["fq"]),
      persona("x", "", 0, [], ["fp1"]),
      persona("w", "Wenceslá", 2, [], ["fp2"]),
      persona("y", "Yago", 1, [], ["fq", "fy2"]),
      persona("c1", "Ce uno", 1, ["fp1"], ["fc"]),
      persona("c2", "Ce dos", 0, ["fq"], ["fc"]),
      persona("c3", "Ce tres", 3, ["fp2"], []),
      persona("c4", "Ce cuatro", 1, ["fy2"], []),
      persona("z", "Zeta", 0, ["fc"], []),
      persona("l1", "Ele uno", 1, ["fl2"], ["fl1"]),
      persona("l2", "Ele dos", 1, ["fl1"], ["fl2"]),
      // Tipos de relación de pareja (decisión del 24/10/2026): rr con cinco
      // parejas, en este orden en Gramps.
      persona("rr", "Erre", 1, [], ["fr1", "fr2", "fr3", "fr4", "fr5", "fr6", "fr7"]),
      ...["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((h, i) => persona(h, `Ese ${i + 1}`, 0, [], [`fr${i + 1}`])),
      persona("hr", "Hache", 1, ["fr3"], []),
    ],
    Family: [
      familia("fa", "abuelo", "abuela", ["pablo", "quica"], ["e2"]),
      familia("fp1", "pablo", "x", ["c1"]),
      familia("fp2", "pablo", "w", ["c3"], [], ["c3"]),
      familia("fq", "y", "quica", ["c2"]),
      familia("fy2", "y", null, ["c4"]),
      familia("fc", "c1", "c2", ["z"]),
      familia("fl1", "l1", null, ["l2"]),
      familia("fl2", "l2", null, ["l1"]),
      familia("fr1", "rr", "s1", [], ["e3", "e4", "e8"]),
      { ...familia("fr2", "rr", "s2", [], ["e5", "e6"]), type: tipo("FamilyRelType", 1) },
      { ...familia("fr3", "rr", "s3", ["hr"]), type: { ...tipo("FamilyRelType", 4), string: "@sin_relacion" } },
      { ...familia("fr4", "rr", "s4", []), type: tipo("FamilyRelType", 3) },
      { ...familia("fr5", "rr", "s5", [], ["e7"]), type: tipo("FamilyRelType", 2) },
      // Casados, sin evento de boda.
      familia("fr6", "rr", "s6", []),
      // Boda aproximada; divorcio sin datos y separación con lugar y sin
      // fecha (31/10/2026).
      familia("fr7", "rr", "s7", [], ["e9", "e10", "e11"]),
    ],
    Event: [
      evento("e1", 12, 1850), evento("e2", 1, 1875),
      { ...evento("e3", 1, 1980), place: "l1" }, { ...evento("e4", 7, 1990), place: "l1" },
      // El «Inicio de la relación» se descartó el 29/10/2026: es un evento
      // propio más, que no da «desde» ni cuenta como boda.
      { ...evento("e5", 0, 1975), type: { ...tipo("EventType", 0), string: "Inicio de la relación" } },
      { ...evento("e6", 0, 1985), type: { ...tipo("EventType", 0), string: "@separacion" }, place: "l1" },
      evento("e7", 1, 1970),
      { ...evento("e8", 0, 1995), type: { ...tipo("EventType", 0), string: "@separacion" } },
      { ...evento("e9", 1, 1960), date: { ...SIN_FECHA, modifier: 3, dateval: [0, 0, 1960, false], sortval: 1960 * 365 } },
      evento("e10", 7, 0),
      { ...evento("e11", 0, 0), type: { ...tipo("EventType", 0), string: "@separacion" }, place: "l1" },
    ],
    Place: [{ ...base("l1"), title: "", name: { value: "Madrid", lang: "" }, alt_names: [], placeref_list: [], place_type: tipo("PlaceType", 1), lat: "", long: "" }],
  },
} as unknown as Instantanea;

let arbol: Arbol;
const ABREV = simbolosDe({ juego: "abreviaturas" });
beforeAll(async () => {
  await prepararFechas();
  arbol = new Arbol(INSTANTANEA);
});

const p = (h: string) => arbol.persona(h)!;
/** Handles de las personas de cada nivel (sin las cajas de familia). */
function niveles(nodo: TreeNode | null): string[][] {
  const out: string[][] = [];
  const recorrer = (n: TreeNode, nivel: number) => {
    if (n.person) (out[nivel] ??= []).push(n.person.handle);
    for (const h of n.children ?? []) recorrer(h, n.family ? nivel : nivel + 1);
  };
  if (nodo) recorrer(nodo, 0);
  return out;
}
function todas(nodo: TreeNode | null): TreeNode[] {
  return nodo ? [nodo, ...(nodo.children ?? []).flatMap(todas)] : [];
}

describe("gráficos", () => {
  it("ascendientes de los hijos de primos: los abuelos comunes salen dos veces, marcados", () => {
    // Con 3 generaciones (z, padres y abuelos), los bisabuelos no se dibujan:
    // pablo y quica quedan en el borde, con la marca de «hay más».
    const g = construirGrafico(arbol, p("z"), "ascendientes", 3, ABREV);
    expect(niveles(g.ascendientes)).toEqual([["z"], ["c1", "c2"], ["pablo", "x", "y", "quica"]]);
    expect(todas(g.ascendientes).find((n) => n.person?.handle === "pablo")!.hasMore).toBe(true);
    expect(todas(g.ascendientes).find((n) => n.person?.handle === "x")!.hasMore).toBe(false);
    expect(todas(g.ascendientes).some((n) => n.person?.repeated)).toBe(false);
    expect(g.descendientes).toBeNull();
    // Con 4, sí: abuelo y abuela por los dos lados.
    const g5 = construirGrafico(arbol, p("z"), "ascendientes", 4, ABREV);
    expect(niveles(g5.ascendientes)[3]).toEqual(["abuelo", "abuela", "abuelo", "abuela"]);
    const repetidas = todas(g5.ascendientes).filter((n) => n.person?.repeated).map((n) => n.person!.handle);
    expect(repetidas.sort()).toEqual(["abuela", "abuela", "abuelo", "abuelo"]);
    expect(todas(g5.ascendientes).find((n) => n.person?.handle === "abuelo")!.person!.title).toContain("más de una vez");
    expect(g5.cajas).toBe(11);
  });

  it("el apodo, entre comillas, aparte del nombre de pila", () => {
    p("quica").primary_name.nick = "Kika";
    try {
      const g = construirGrafico(arbol, p("quica"), "ascendientes", 1, ABREV);
      expect(g.ascendientes!.person).toMatchObject({ nameGiven: "Quica", nick: "“Kika”", nameSurname: "Prueba" });
      expect(construirGrafico(arbol, p("pablo"), "ascendientes", 1, ABREV).ascendientes!.person!.nick).toBeUndefined();
    } finally {
      p("quica").primary_name.nick = "";
    }
  });

  it("ascendientes: la persona central con sus parejas y sus óvalos, sin los hijos", () => {
    const g = construirGrafico(arbol, p("pablo"), "ascendientes", 3, ABREV);
    expect(g.descendientes!.children!.map((f) => f.family!.spouse?.handle)).toEqual(["x", "w"]);
    expect(g.descendientes!.children!.every((f) => f.children!.length === 0)).toBe(true);
    // Sin parejas (bloques de continuación de otras personas), solo los ascendientes.
    expect(construirGrafico(arbol, p("pablo"), "ascendientes", 3, ABREV, undefined, undefined, false).descendientes).toBeNull();
  });

  it("tramos de hijos: desde el segundo, la pareja de arriba solo con el nombre", () => {
    const primero = construirGrafico(arbol, p("pablo"), "descendientes", 2, ABREV, { desde: 0, hasta: 1 });
    expect(primero.descendientes!.person!.birth.text).not.toBe("");
    const segundo = construirGrafico(arbol, p("pablo"), "descendientes", 2, ABREV, { desde: 1, hasta: 2 });
    expect(segundo.descendientes!.person!.birth.text).toBe("");
    expect(segundo.descendientes!.children!.every((f) => !f.family!.spouse || f.family!.spouse.birth.text === "")).toBe(true);
  });

  it("varios matrimonios: un óvalo por familia, con su cónyuge en su caja y los hijos de cada pareja", () => {
    const g = construirGrafico(arbol, p("pablo"), "descendientes", 2, ABREV);
    const familias = g.descendientes!.children!;
    expect(familias.map((f) => f.family!.spouse?.handle)).toEqual(["x", "w"]);
    expect(familias.map((f) => f.children!.map((c) => c.person!.handle))).toEqual([["c1"], ["c3"]]);
    // El hijo adoptado aparece, con su parentesco en el texto emergente.
    expect(familias[1].children![0].person!.title).toMatch(/Padre: .+ · Madre: /);
    // c1 tiene hijos más abajo: en el borde, con la marca de «hay más».
    const c1 = familias[0].children![0];
    expect(c1.children).toBeUndefined();
    expect(c1.hasMore).toBe(true);
  });

  it("cónyuge desconocido y fecha de boda", () => {
    const g = construirGrafico(arbol, p("y"), "descendientes", 2, ABREV);
    const [fq, fy2] = g.descendientes!.children!;
    // El cónyuge, en su propia caja (decisión del 23/10/2026).
    expect(fq.family!.spouse?.nameGiven).toBe("Quica");
    expect(fq.family!.spouse?.birth.text).toMatch(/^n\. /);
    expect(fy2.family!.spouse).toBeNull();
    expect(fy2.family!.title.split("\n")).toEqual(["Cónyuge desconocido", expect.stringMatching(/^Tipo de relación: /), "Matrimonio: sin datos"]);
    // Casados sin datos de la boda: «casados» (31/10/2026; antes, el óvalo
    // vacío); con ellos, «matr.» delante.
    expect(fy2.family!.lines.map((l) => l.text)).toEqual(["casados"]);
    expect(fy2.children!.map((c) => c.person!.handle)).toEqual(["c4"]);
    const fa = construirGrafico(arbol, p("abuelo"), "descendientes", 2, ABREV).descendientes!.children![0];
    expect(fa.family!.lines.map((l) => l.text)).toEqual(["matr. 1875"]);
    // El ID de Gramps, solo para el administrador.
    const conIds = construirGrafico(arbol, p("y"), "descendientes", 2, { ...ABREV, ids: true }).descendientes!;
    expect(conIds.children![1].family!.title).toContain("ID: FY2");
    expect(conIds.person!.grampsId).toBe("Y");
    expect(g.descendientes!.person!.grampsId).toBeUndefined();
  });

  it("tipos de relación de pareja en el óvalo, con los cónyuges por fecha de boda", () => {
    const g = construirGrafico(arbol, p("rr"), "descendientes", 2, ABREV);
    const fams = g.descendientes!.children!.map((n) => n.family!);
    // La unión civil (boda de 1970) y el matrimonio (1980); sin fecha de
    // boda, después, en el orden de Gramps. Decisiones del 31/10/2026:
    // «matr.» delante de la boda y «casados» sin ella; sin relación de
    // pareja, óvalo discontinuo con su texto.
    expect(fams.map((f) => f.handle)).toEqual(["fr7", "fr5", "fr1", "fr2", "fr3", "fr4", "fr6"]);
    // Divorcio sin datos y separación sin fecha (aunque tenga lugar): la
    // palabra sola; la boda aproximada, con «c.» (31/10/2026).
    expect(fams.map((f) => f.lines.map((l) => l.text))).toEqual([
      ["matr. c. 1960", "divorciados", "separados"],
      ["matr. 1970"],
      ["matr. 1980, Madrid", "div. 1990, Madrid", "sep. 1995"],
      ["Pareja", "sep. 1985"],
      ["sin relación de pareja"],
      [],
      ["casados"],
    ]);
    expect(fams.map((f) => !!f.dashed)).toEqual([false, false, false, false, true, false, false]);
    // Si no cabe en una línea, el lugar de la boda va debajo (lo parte el
    // dibujo).
    expect(fams[2].lines[0].wrap).toEqual(["matr. 1980", "Madrid"]);
    expect(fams[1].lines[0].wrap).toBeUndefined();
    expect(fams[2].title.split("\n").slice(2)).toEqual(["Matrimonio: 1980, Madrid", "Divorcio: 1990, Madrid", "Separación: 1995"]);
    expect(fams[3].title.split("\n").slice(2)).toEqual(["Separación: 1985, Madrid"]);
    expect(fams[5].title.split("\n")).toHaveLength(2);
    // En el texto emergente, el formato largo: «hacia».
    expect(fams[0].title.split("\n").slice(2)).toEqual(["Matrimonio: hacia 1960", "Divorcio: sin datos", "Separación: sin fecha, Madrid"]);
    // Con la pareja viva omitida, sin fechas.
    const privada = construirGrafico(arbol, p("rr"), "descendientes", 2, ABREV, undefined, new Set(["s2"]));
    expect(privada.descendientes!.children![3].family!.lines.map((l) => l.text)).toEqual(["Pareja"]);
    const casados = construirGrafico(arbol, p("rr"), "descendientes", 2, ABREV, undefined, new Set(["s1"]));
    expect(casados.descendientes!.children![2].family!.lines.map((l) => l.text)).toEqual(["casados"]);
    // El óvalo con tres líneas es más alto: el dibujo, también.
    const sinTres = construirGrafico(arbol, p("rr"), "descendientes", 2, ABREV, undefined, new Set(["s1", "s7"]));
    expect(measureTreeChart(null, g.descendientes).height).toBe(measureTreeChart(null, sinTres.descendientes).height + 15);
  });

  it("sin fechas, sin padres, sin nombre de pila y sexo desconocido", () => {
    const x = construirGrafico(arbol, p("x"), "ambos", 4, ABREV);
    expect(x.ascendientes!.children).toBeUndefined();
    expect(x.ascendientes!.hasMore).toBeFalsy();
    // Sin nombre de pila (el gráfico pone el rótulo) y sin eventos: el
    // nacimiento sale con «sin datos»; la defunción, nada.
    expect(x.ascendientes!.person).toMatchObject({ nameGiven: "", nameSurname: "Prueba" });
    expect([x.ascendientes!.person!.birth.text, x.ascendientes!.person!.death.text]).toEqual(["n. sin datos", ""]);
    expect(x.ascendientes!.person!.title.split("\n")).toEqual(["Prueba", "Sexo: mujer", "Nacimiento: sin datos"]);
    const w = construirGrafico(arbol, p("w"), "ascendientes", 4, ABREV).ascendientes!.person!;
    expect(w.gender).toBe(2);
    expect(w.title).toContain("Sexo: desconocido");
    const abuelo = construirGrafico(arbol, p("abuelo"), "ascendientes", 2, ABREV).ascendientes!.person!;
    expect([abuelo.birth.text, abuelo.death.text]).toEqual(["n. 1850", ""]);
    // Con otro juego de símbolos.
    const conAsterisco = construirGrafico(arbol, p("abuelo"), "ascendientes", 2, simbolosDe({ juego: "asterisco" }));
    expect(conAsterisco.ascendientes!.person!.birth.text).toBe("* 1850");
  });

  it("ambos sentidos comparten la caja central, que no cuenta como repetida", () => {
    const g = construirGrafico(arbol, p("c1"), "ambos", 3, ABREV);
    expect(g.ascendientes!.person).toBe(g.descendientes!.person);
    expect(g.ascendientes!.person!.repeated).toBe(false);
    expect(niveles(g.descendientes)).toEqual([["c1"], ["z"]]);
  });

  it("un ciclo en los datos no entra en bucle", () => {
    const g = construirGrafico(arbol, p("l1"), "ambos", 12, ABREV);
    expect(niveles(g.ascendientes)).toEqual([["l1"], ["l2"], ["l1"]]);
    expect(niveles(g.descendientes)).toEqual([["l1"], ["l2"], ["l1"]]);
    expect(todas(g.ascendientes).every((n) => (n.children?.length ?? 0) <= 2)).toBe(true);
  });

  it("el tamaño del dibujo crece con las generaciones", () => {
    const tam = (n: number) => {
      const g = construirGrafico(arbol, p("z"), "ascendientes", n, ABREV);
      return measureTreeChart(g.ascendientes, g.descendientes);
    };
    expect(tam(3).width).toBeGreaterThan(tam(2).width);
    expect(tam(4).height).toBeGreaterThan(tam(3).height);
    // Más generaciones de las que hay: el mismo tamaño.
    expect(tam(6)).toEqual(tam(4));
  });

  it("parámetros de la dirección: generaciones sin máximo fijo (29/10/2026)", () => {
    expect(leerGeneraciones(null)).toBe(4);
    expect(leerGeneraciones(null, "todas")).toBe("todas");
    expect(leerGeneraciones(null, 7)).toBe(7);
    expect(leerGeneraciones("1")).toBe(2);
    expect(leerGeneraciones("99")).toBe(99);
    expect(leerGeneraciones("todas", 4)).toBe("todas");
    expect(leerGeneraciones("x")).toBe(4);
    expect(leerTipo("descendientes")).toBe("descendientes");
    expect(leerTipo("otro")).toBe("ambos");
  });

  it("generaciones que hay, las que se dibujan y las opciones del selector", () => {
    expect(generacionesQueHay(arbol, p("z"), "ascendientes")).toBe(4);
    expect(generacionesQueHay(arbol, p("abuelo"), "descendientes")).toBe(4);
    expect(generacionesQueHay(arbol, p("pablo"), "ambos")).toBe(3);
    expect(generacionesQueHay(arbol, p("c4"), "descendientes")).toBe(1);
    // El ciclo no cuenta dos veces.
    expect(generacionesQueHay(arbol, p("l1"), "ascendientes")).toBe(2);
    // Lo que hay coincide con lo que dibuja el gráfico con «todas».
    const g = construirGrafico(arbol, p("z"), "ascendientes", generacionesEfectivas("todas", 4), ABREV);
    expect(niveles(g.ascendientes)).toHaveLength(4);
    expect(generacionesEfectivas("todas", 4)).toBe(4);
    expect(generacionesEfectivas(9, 4)).toBe(4);
    expect(generacionesEfectivas(3, 4)).toBe(3);
    expect(generacionesEfectivas("todas", 1)).toBe(2);
    expect(opcionesGeneraciones(4)).toEqual(["2", "3", "4", "todas"]);
    expect(opcionesGeneraciones(1)).toEqual(["2", "todas"]);
  });

  it("el libro cuenta desde 1 (sin la persona; 30/10/2026)", () => {
    expect(opcionesGeneraciones(3, 1)).toEqual(["1", "2", "3", "todas"]);
    expect(generacionesEfectivas("todas", 3, 1)).toBe(3);
    expect(generacionesEfectivas(9, 0, 1)).toBe(1);
  });

  it("identificadores: junto al nombre en pantalla; en su línea solo en el PDF con la casilla (30/10/2026)", () => {
    const cajas = (o: object) => todas(construirGrafico(arbol, p("z"), "ascendientes", 3, { ...ABREV, ...o }).ascendientes).map((n) => n.person!);
    expect(cajas({ ids: true }).every((c) => c.grampsId && !c.idLine)).toBe(true);
    expect(cajas({ idsDebajo: true }).every((c) => c.idLine === c.handle.toUpperCase())).toBe(true);
    expect(cajas({ idsDebajo: true }).some((c) => c.grampsId)).toBe(false);
    expect(cajas({}).some((c) => c.grampsId || c.idLine)).toBe(false);
  });

  it("generaciones guardadas en las preferencias (las reglas comprueban lo mismo)", () => {
    expect(generacionesValidas(2)).toBe(2);
    expect(generacionesValidas(250)).toBe(250);
    expect(generacionesValidas("todas")).toBe("todas");
    for (const no of [1, 0, -3, 4.5, "4", "Todas", null, undefined]) expect(generacionesValidas(no)).toBeNull();
  });
});
