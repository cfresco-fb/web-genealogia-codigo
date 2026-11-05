// Pruebas de los datos de los gráficos con un árbol inventado que reúne los
// casos difíciles: primos casados entre sí (abuelos repetidos), varios
// matrimonios, hijos de distintas parejas, cónyuge desconocido, sexo
// desconocido, personas sin fechas ni padres, y datos con un ciclo.

import { beforeAll, describe, expect, it } from "vitest";
import { fitName, measureTreeChart, treeChartShapes, type TreeNode } from "../gramps-connect/graficos/charts/treeChart";
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
      // Divorcio o separación con y sin datos de la boda (05/11/2026).
      persona("dd", "De", 1, [], ["fd1", "fd2", "fd3", "fd4", "fd5"]),
      ...[1, 2, 3, 4, 5].map((i) => persona(`sd${i}`, `Ese de ${i}`, 0, [], [`fd${i}`])),
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
      familia("fd1", "dd", "sd1", [], ["e10"]),
      familia("fd2", "dd", "sd2", [], ["e12"]),
      familia("fd3", "dd", "sd3", [], ["e7", "e10"]),
      familia("fd4", "dd", "sd4", [], ["e13", "e11"]),
      { ...familia("fd5", "dd", "sd5", [], ["e11"]), type: tipo("FamilyRelType", 1) },
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
      evento("e12", 7, 1990),
      evento("e13", 1, 0),
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

  it("el apodo, entre comillas, dentro del nombre de pila; los apellidos, aparte (05/11/2026)", () => {
    p("quica").primary_name.nick = "Kika";
    try {
      const g = construirGrafico(arbol, p("quica"), "ascendientes", 1, ABREV);
      expect(g.ascendientes!.person).toMatchObject({ nameGiven: "Quica “Kika”", nameSurname: "Prueba" });
      expect(g.ascendientes!.person!.title.split("\n")[0]).toBe("Quica “Kika” Prueba");
      expect(construirGrafico(arbol, p("pablo"), "ascendientes", 1, ABREV).ascendientes!.person!.nameGiven).toBe("Pablo");
    } finally {
      p("quica").primary_name.nick = "";
    }
  });

  describe("el nombre de las cajas, en dos líneas (05/11/2026)", () => {
    /** Una línea de texto medida a 1 unidad por carácter. */
    const linea = (max: number, attrs: Record<string, string> = {}) => ({
      textContent: "",
      getAttribute: (a: string) => (a === "data-max" ? String(max) : attrs[a] ?? null),
      getComputedTextLength() { return this.textContent.length; },
    });
    const textos = (max: number, n: number, attrs: Record<string, string>) => {
      const lineas = [linea(max, attrs), ...Array.from({ length: n - 1 }, () => linea(max))];
      fitName(lineas as unknown as SVGTextElement[]);
      return lineas.map((l) => l.textContent);
    };
    const NOMBRE = { "data-full": "Ana “Pepa”", "data-full2": "Pérez Núñez" };

    it("salto forzado: cada uno en su línea, aunque quepan juntos", () => {
      expect(textos(40, 2, NOMBRE)).toEqual(["Ana “Pepa”", "Pérez Núñez"]);
    });
    it("cada línea, recortada con «…» si no cabe: se pierde el final, el apodo", () => {
      expect(textos(8, 2, NOMBRE)).toEqual(["Ana “Pe…", "Pérez N…"]);
    });
    it("el ID, detrás de la última línea", () => {
      expect(textos(40, 2, { ...NOMBRE, "data-suffix": " [I1]" })).toEqual(["Ana “Pepa”", "Pérez Núñez [I1]"]);
      expect(textos(10, 2, { ...NOMBRE, "data-suffix": " [I1]" })).toEqual(["Ana “Pepa”", "Pére… [I1]"]);
    });
    it("con tres líneas, el nombre de pila que no cabe se parte por palabras y los apellidos van en la tercera", () => {
      expect(textos(14, 3, { "data-full": "Ana María “Pepa”", "data-full2": "Pérez" })).toEqual(["Ana María", "“Pepa”", "Pérez"]);
      expect(textos(8, 3, NOMBRE)).toEqual(["Ana", "“Pepa”", "Pérez N…"]);
    });
    it("el apodo no se parte, aunque tenga varias palabras: va entero a la segunda", () => {
      expect(textos(13, 3, { "data-full": "Ana “Big Pepa” Sr", "data-full2": "Pérez" })).toEqual(["Ana", "“Big Pepa” Sr", "Pérez"]);
    });
    it("si ni con tres cabe, recorte con «…»", () => {
      expect(textos(10, 3, { "data-full": "Ana María Luisa “Pepa”", "data-full2": "Pérez Núñez" })).toEqual(["Ana María", "Luisa “Pe…", "Pérez Núñ…"]);
    });
    it("los apellidos, en su línea; solo con foto en horizontal pueden ocupar dos", () => {
      expect(textos(10, 3, NOMBRE)).toEqual(["Ana “Pepa”", "Pérez Núñ…", ""]);
      expect(textos(10, 3, { ...NOMBRE, "data-surname-wrap": "" })).toEqual(["Ana “Pepa”", "Pérez", "Núñez"]);
    });
    it("«Cónyuge desconocido», sin apellidos: el texto, en todas las líneas", () => {
      expect(textos(10, 2, { "data-full": "Cónyuge desconocido" })).toEqual(["Cónyuge", "desconoci…"]);
    });
  });

  describe("tercera línea del nombre, solo en las filas que la necesitan (05/11/2026)", () => {
    const LARGO = "Ana María Luisa";
    /** En horizontal cabe más: hace falta uno más largo. */
    const MUY_LARGO = "Ana María Luisa Teresa";
    /** El árbol de z (z, su óvalo y sus padres c1 y c2), con c1 de nombre largo. */
    const conLargo = <T,>(fn: () => T, nick = "Pepa", pila = LARGO): T => {
      const n = p("c1").primary_name;
      const antes = [n.first_name, n.nick];
      n.first_name = pila;
      n.nick = nick;
      try {
        return fn();
      } finally {
        [n.first_name, n.nick] = antes;
      }
    };
    const arbolDeZ = () => construirGrafico(arbol, p("z"), "ascendientes", 2, ABREV).ascendientes!;
    const altos = (t: TreeNode, disp: "vertical" | "horizontal") => {
      const filas = new Map<number, Set<number>>();
      for (const r of treeChartShapes(t, null, disp, false).rects) {
        const clave = disp === "vertical" ? (r.y0 + r.y1) / 2 : (r.x0 + r.x1) / 2;
        filas.set(clave, (filas.get(clave) ?? new Set()).add(r.y1 - r.y0));
      }
      return [...filas.values()].map((x) => [...x]);
    };

    it("con nombres cortos, dos líneas: la fila no crece", () => {
      expect(measureTreeChart(arbolDeZ(), null, "vertical").height).toBe(84 + 40 + 46 + 40 + 84);
    });
    it("fila mixta en vertical: una línea (16) más alta, solo esa fila, para todas sus cajas", () => {
      conLargo(() => {
        const t = arbolDeZ();
        expect(measureTreeChart(t, null, "vertical").height).toBe(84 + 40 + 46 + 40 + 84 + 16);
        expect(altos(t, "vertical")).toEqual([[84], [100], [46]]);
      });
    });
    it("en horizontal, si hay alguna, todas las columnas", () => {
      conLargo(() => {
        const t = arbolDeZ();
        expect(altos(t, "horizontal")).toEqual([[106], [106], [46]]);
      }, "Pepa", MUY_LARGO);
    });
    it("en horizontal, una columna con fotos ya tiene el hueco: no crece", () => {
      conLargo(() => {
        const t = structuredClone(arbolDeZ());
        t.children![0].children![1].person!.photo = { handle: "foto", rect: null };
        expect(altos(t, "horizontal")).toEqual([[90], [90], [46]]);
      }, "Pepa", MUY_LARGO);
    });
    it("una sola palabra larga no se parte: no hace falta la tercera", () => {
      conLargo(() => {
        expect(measureTreeChart(arbolDeZ(), null, "vertical").height).toBe(84 + 40 + 46 + 40 + 84);
      }, "", "Wolfeschlegelsteinhausenberg");
    });
    it("el reparto del PDF cuenta las filas más altas (y los ID, además)", () => {
      conLargo(() => {
        const g = construirGrafico(arbol, p("z"), "ascendientes", 2, { ...ABREV, idsDebajo: true });
        expect(measureTreeChart(g.ascendientes, null, "vertical").height).toBe(84 + 16 + 40 + 46 + 40 + 84 + 32);
      });
    });
  });

  describe("óvalo de los padres de la persona central (05/11/2026)", () => {
    const ovaloDe = (h: string, tipoG: "ascendientes" | "ambos" = "ascendientes", parejas = true) =>
      construirGrafico(arbol, p(h), tipoG, 3, ABREV, undefined, undefined, parejas).ascendientes!.children?.[0];

    it("con dos padres: en su fila, con los mismos textos que los demás óvalos, sin caja de cónyuge", () => {
      const o = ovaloDe("pablo")!;
      expect(o.family).toMatchObject({ handle: "fa", parents: true, spouse: null, dashed: false });
      expect(o.family!.lines.map((l) => l.text)).toEqual(["matr. 1875"]);
      expect(o.family!.title.split("\n")).toEqual(["Abuelo Prueba y Abuela Prueba", "Tipo de relación: Casados", "Matrimonio: 1875"]);
      expect(o.children!.map((n) => n.person!.handle)).toEqual(["abuelo", "abuela"]);
    });
    it("con un solo padre, igual, sin caja de padre desconocido", () => {
      const o = ovaloDe("c4")!;
      expect(o.family!.parents).toBe(true);
      expect(o.family!.lines.map((l) => l.text)).toEqual(["casados"]);
      expect(o.children!.map((n) => n.person!.handle)).toEqual(["y"]);
      const g = construirGrafico(arbol, p("c4"), "ascendientes", 2, ABREV);
      expect(measureTreeChart(g.ascendientes, null, "vertical").height).toBe(84 + 40 + 46 + 40 + 84);
      expect(measureTreeChart(g.ascendientes, null, "horizontal").width).toBe(230 + 60 + 170 + 60 + 230 + 4);
    });
    it("sin familia de padres, nada cambia", () => {
      expect(ovaloDe("abuelo")).toBeUndefined();
      expect(measureTreeChart(construirGrafico(arbol, p("abuelo"), "ascendientes", 2, ABREV).ascendientes, null, "vertical").height).toBe(84);
    });
    it("los padres sin relación de pareja, discontinuo", () => {
      expect(ovaloDe("hr")!.family).toMatchObject({ dashed: true, lines: [expect.objectContaining({ text: "sin relación de pareja" })] });
    });
    it("solo en la persona central: las demás generaciones, sin óvalo", () => {
      const g = construirGrafico(arbol, p("z"), "ascendientes", 4, ABREV);
      expect(todas(g.ascendientes).filter((n) => n.family).map((n) => n.family!.handle)).toEqual(["fc"]);
    });
    it("no en los bloques de continuación del PDF (sin parejas)", () => {
      expect(ovaloDe("pablo", "ascendientes", false)!.family).toBeUndefined();
    });
    it("en «Ambos», el de los padres arriba y los de las parejas abajo", () => {
      const g = construirGrafico(arbol, p("c1"), "ambos", 2, ABREV);
      expect(g.ascendientes!.children![0].family).toMatchObject({ handle: "fp1", parents: true });
      expect(g.descendientes!.children![0].family).toMatchObject({ handle: "fc", spouse: expect.objectContaining({ handle: "c2" }) });
      expect(g.descendientes!.children![0].family!.parents).toBeUndefined();
    });
    it("con un padre vivo omitido (libro), sin fechas", () => {
      const g = construirGrafico(arbol, p("pablo"), "ascendientes", 2, ABREV, undefined, new Set(["abuela"]));
      expect(g.ascendientes!.children![0].family!.lines.map((l) => l.text)).toEqual(["casados"]);
    });
    it("las personas se cuentan igual: el óvalo no es una caja", () => {
      // Pablo, sus padres y sus dos parejas.
      expect(construirGrafico(arbol, p("pablo"), "ascendientes", 2, ABREV).cajas).toBe(5);
    });
  });

  it("óvalos con divorcio o separación: sin «casados» ni «Pareja» (05/11/2026)", () => {
    const lineas = (h: string) => construirGrafico(arbol, p(h), "descendientes", 2, ABREV).descendientes!.children!
      .map((n) => [n.family!.handle, n.family!.lines.map((l) => l.text)] as const);
    const dd = new Map(lineas("dd"));
    // Boda sin datos y divorcio sin datos.
    expect(dd.get("fd1")).toEqual(["divorciados"]);
    // Boda sin datos y divorcio con fecha.
    expect(dd.get("fd2")).toEqual(["div. 1990"]);
    // Boda con fecha y divorcio sin datos.
    expect(dd.get("fd3")).toEqual(["matr. 1970", "divorciados"]);
    // Boda sin fecha ni lugar y separación con lugar y sin fecha.
    expect(dd.get("fd4")).toEqual(["separados"]);
    // Pareja sin casar y separación sin fecha.
    expect(dd.get("fd5")).toEqual(["separados"]);
    const rr = new Map(lineas("rr"));
    // Boda y divorcio con datos: las dos líneas (y la separación).
    expect(rr.get("fr1")).toEqual(["matr. 1980, Madrid", "div. 1990, Madrid", "sep. 1995"]);
    // Pareja sin casar y separación con fecha.
    expect(rr.get("fr2")).toEqual(["sep. 1985"]);
    // Sin divorcio ni separación, como hasta ahora.
    expect(rr.get("fr5")).toEqual(["matr. 1970"]);
    expect(rr.get("fr6")).toEqual(["casados"]);
    expect(rr.get("fr4")).toEqual([]);
    // En el texto emergente sigue todo: el tipo de relación y los eventos.
    const fd5 = construirGrafico(arbol, p("dd"), "descendientes", 2, ABREV).descendientes!.children!.find((n) => n.family!.handle === "fd5")!.family!;
    expect(fd5.title.split("\n").slice(1)).toEqual(["Tipo de relación: No casados", "Separación: sin fecha, Madrid"]);
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
      ["sep. 1985"],
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
    const cajas = (o: object) => todas(construirGrafico(arbol, p("z"), "ascendientes", 3, { ...ABREV, ...o }).ascendientes).flatMap((n) => n.person ?? []);
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
