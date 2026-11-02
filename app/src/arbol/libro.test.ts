// Contenido del libro en PDF (libro.ts), con un árbol inventado pequeño:
// numeración Sosa y d'Aboville, generaciones, personas repetidas, personas
// vivas omitidas, eventos y notas según las opciones.

import { beforeAll, describe, expect, it } from "vitest";
import { Arbol } from "./arbol";
import { prepararFechas } from "./fechas";
import { construirGrafico } from "./grafico";
import { simbolosDe } from "./simbolos";
import {
  aniosIndice, conjuncionY, construirLibro, personasDelLibro, romano, type Direccion, type Libro, type OpcionesLibro, type Parrafo, type TipoParte,
} from "./libro";
import type { Instantanea } from "./tipos";

const tipo = (_class: string, value: number) => ({ _class, value, string: "" });
const base = (handle: string, notas: string[] = []) => ({ handle, gramps_id: handle, change: 0, private: false, note_list: notas });
const NAC = tipo("ChildRefType", 1);
const PRINCIPAL = tipo("EventRoleType", 1);
const personas: object[] = [];
const familias: object[] = [];
const eventos: object[] = [];
const fecha = (y: number) => ({ _class: "Date", modifier: 0, quality: 0, calendar: 0, dateval: [0, 0, y, false], text: "", newyear: 0, sortval: y * 365 });
let nEv = 0;
function evento(t: number, y: number | null, lugar = "", descripcion = ""): string {
  const h = `e${nEv++}`;
  eventos.push({ ...base(h), type: tipo("EventType", t), date: y === null ? { ...fecha(0), dateval: [0, 0, 0, false], sortval: 0 } : fecha(y), place: lugar, description: descripcion, media_list: [] });
  return h;
}
function persona(h: string, gender: number, o: { padres?: string[]; propias?: string[]; nac?: number; def?: number; otros?: string[]; notas?: string[] } = {}) {
  const refs: { ref: string; role: object }[] = [];
  let bi = -1;
  let di = -1;
  if (o.nac !== undefined) { bi = refs.length; refs.push({ ref: evento(12, o.nac, "l1"), role: PRINCIPAL }); }
  if (o.def !== undefined) { di = refs.length; refs.push({ ref: evento(13, o.def), role: PRINCIPAL }); }
  for (const r of o.otros ?? []) refs.push({ ref: r, role: PRINCIPAL });
  personas.push({
    ...base(h, o.notas), gender, alternate_names: [], media_list: [], family_list: o.propias ?? [], parent_family_list: o.padres ?? [],
    event_ref_list: refs, birth_ref_index: bi, death_ref_index: di,
    primary_name: { first_name: h, suffix: "", title: "", call: "", nick: "", type: tipo("NameType", 2), surname_list: [{ surname: "Prueba", prefix: "", primary: true, connector: "" }] },
  });
}
function familia(h: string, padre: string | null, madre: string | null, hijos: string[], boda?: number) {
  familias.push({
    ...base(h), father_handle: padre, mother_handle: madre, type: tipo("FamilyRelType", 0), media_list: [],
    event_ref_list: boda === undefined ? [] : [{ ref: evento(1, boda), role: tipo("EventRoleType", 2) }],
    child_ref_list: hijos.map((ref) => ({ ref, frel: NAC, mrel: NAC })),
  });
}

// gp + gm → pa, tio; pa + ma → yo, hermana; yo + cy → h1, h2.
persona("gp", 1, { propias: ["fg"], nac: 1880, def: 1950 });
persona("gm", 0, { propias: ["fg"], nac: 1885 });
familia("fg", "gp", "gm", ["pa", "tio"], 1905);
persona("pa", 1, { padres: ["fg"], propias: ["fp"], nac: 1910, def: 1990, notas: ["n1"] });
persona("tio", 1, { padres: ["fg"], nac: 1912 });
persona("ma", 0, { propias: ["fp"], nac: 1915 });
familia("fp", "pa", "ma", ["yo", "hermana"], 1935);
persona("yo", 1, { padres: ["fp"], propias: ["fy"], nac: 1940, otros: [evento(37, 1965)] });
persona("hermana", 0, { padres: ["fp"], nac: 1980 });
persona("cy", 0, { propias: ["fy"], nac: 1942 });
familia("fy", "yo", "cy", ["h1", "h2"]);
persona("h1", 1, { padres: ["fy"], nac: 1970 });
persona("h2", 0, { padres: ["fy"], nac: 1972 });
// Repetido: q, hija de a y b, medio hermanos, los dos hijos de c.
persona("q", 0, { padres: ["fq"] });
familia("fq", "a", "b", ["q"]);
persona("a", 1, { padres: ["fa"], propias: ["fq"] });
persona("b", 0, { padres: ["fb"], propias: ["fq"] });
familia("fa", "c", "ma2", ["a"]);
familia("fb", "c", "mb2", ["b"]);
persona("c", 1, { propias: ["fa", "fb"] });
persona("ma2", 0, { propias: ["fa"] });
persona("mb2", 0, { propias: ["fb"] });
// Sin nacimiento pero con bautismo; sin defunción pero con entierro sin datos.
persona("bau", 1, { otros: [evento(15, 1900, "l1"), evento(19, null)] });
// Sexo desconocido, hijo de pa e Inés; incinerado; un evento sin ningún
// dato (no sale en «Más sobre») y otro solo con descripción (sí sale).
persona("Inés", 0, { propias: ["fx"] });
familia("fx", "pa", "Inés", ["dx"]);
persona("dx", 2, { padres: ["fx"], nac: 1960, otros: [evento(24, 2000), evento(37, null), evento(26, null, "", "Bachillerato")] });
persona("solo", 2, { padres: ["fs"], nac: 1961 });
familia("fs", null, "Inés", ["solo"]);
// Tipos de relación de pareja (decisión del 24/10/2026): rr con cinco
// parejas, en este orden en Gramps; la unión civil, con la boda más antigua.
function eventoPropio(nombre: string, y: number, lugar = ""): string {
  const h = evento(0, y, lugar);
  (eventos[eventos.length - 1] as { type: { string: string } }).type.string = nombre;
  return h;
}
function pareja(h: string, conyuge: string, tipoFam: number, refs: string[], hijos: string[] = [], nombreTipo = "") {
  familias.push({
    ...base(h), father_handle: "rr", mother_handle: conyuge, type: { ...tipo("FamilyRelType", tipoFam), string: nombreTipo }, media_list: [],
    event_ref_list: refs.map((ref) => ({ ref, role: tipo("EventRoleType", 2) })),
    child_ref_list: hijos.map((ref) => ({ ref, frel: NAC, mrel: NAC })),
  });
  persona(conyuge, 0, { propias: [h], nac: 1945 });
}
persona("rr", 1, { propias: ["fr1", "fr2", "fr3", "fr4", "fr5"], nac: 1940 });
pareja("fr1", "s1", 0, [evento(1, 1980), evento(7, 1990, "l1")]);
// El «Inicio de la relación» se descartó el 29/10/2026: un evento propio
// más, sin «desde».
pareja("fr2", "s2", 1, [eventoPropio("Inicio de la relación", 1975), eventoPropio("@separacion", 1985, "l1")]);
pareja("fr3", "s3", 4, [], ["hr"], "@sin_relacion");
pareja("fr4", "s4", 3, []);
pareja("fr5", "s5", 2, [evento(1, 1970)]);
persona("hr", 1, { padres: ["fr3"], nac: 1990 });
// Fechas aproximadas y divorcio sin datos (31/10/2026): ap nació «hacia
// 1850»; con s9, un divorcio sin fecha ni lugar.
persona("ap", 1, { propias: ["fap"], nac: 1850, def: 1920 });
(eventos.find((e) => (e as { handle: string }).handle === (personas.at(-1) as { event_ref_list: { ref: string }[] }).event_ref_list[0].ref) as { date: { modifier: number } }).date.modifier = 3;
familias.push({
  ...base("fap"), father_handle: "ap", mother_handle: "s9", type: tipo("FamilyRelType", 0), media_list: [],
  event_ref_list: [{ ref: evento(7, null), role: tipo("EventRoleType", 2) }], child_ref_list: [],
});
persona("s9", 0, { propias: ["fap"], nac: 1855 });

const INSTANTANEA = {
  version_instantanea: 1, generada: "2026-10-22T00:00:00Z", version_gramps: "6.0.5", persona_inicio: "yo",
  objetos: {
    Person: personas, Family: familias, Event: eventos,
    Place: [{ ...base("l1"), title: "", name: { value: "Madrid", date: fecha(0), lang: "" }, alt_names: [], placeref_list: [], place_type: tipo("PlaceType", 1), lat: "", long: "" }],
    Note: [{ ...base("n1"), text: { string: "Fue maestro.\nVivió en Madrid." }, type: tipo("NoteType", 1) }],
    // Fotos con descripciones: ruta, nombre del fichero (con y sin
    // extensión) y una de verdad.
    Media: [
      ["m1", "C:/Users/alguien/Fotos/boda.jpg", "C:/Users/alguien/Fotos/boda.jpg"],
      ["m2", "Fotos/50003.jpg", "50003"],
      ["m3", "Fotos/retrato.png", "retrato.png"],
      ["m4", "Fotos/boda2.jpg", "Boda en Madrid"],
    ].map(([h, path, desc]) => ({ ...base(h), path, desc, mime: "image/jpeg", date: fecha(0), attribute_list: [], tag_list: [], checksum: "" })),
  },
} as unknown as Instantanea;

let arbol: Arbol;
beforeAll(async () => {
  await prepararFechas();
  arbol = new Arbol(INSTANTANEA);
});

const opciones = (h: string, alcance: OpcionesLibro["alcance"], generaciones: number, o: Partial<OpcionesLibro> = {}): OpcionesLibro => ({
  persona: arbol.persona(h)!, alcance, generaciones, eventos: "principales", notas: true, fotos: "ninguna", arboles: false, indiceLugares: true, ...o,
});
const texto = (p: Parrafo) => ("trozos" in p ? p.trozos.map((t) => t.texto).join("") : "texto" in p ? p.texto : "");
/** Las entradas de todo el libro (la página de la persona principal y las
 * partes): número → líneas que siguen a la cabecera. */
function entradas(libro: Libro): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const parte of libro.partes) {
    let actual: string[] | null = null;
    for (const p of parte.parrafos) {
      if (p.tipo === "entrada") out.set(p.numero.replace(/\.$/, ""), (actual = [texto(p)]));
      else if (p.tipo === "texto" && actual) actual.push(texto(p));
      else if (p.tipo !== "fotos") actual = null;
    }
  }
  return out;
}
const parte = (libro: Libro, direccion: TipoParte) => libro.partes.find((p) => p.direccion === direccion)!;
const generaciones = (libro: Libro, direccion: Direccion) => parte(libro, direccion).parrafos.filter((p) => p.tipo === "generacion").map(texto);
/** Los hijos de la página de la persona principal: viñeta y texto. */
const hijosPrincipal = (libro: Libro) => parte(libro, "principal").parrafos
  .flatMap((p) => (p.tipo === "texto" && p.vineta ? [`${p.vineta} ${texto(p)}`] : []));

describe("libro", () => {
  it("estructura (30/10/2026): la página de la persona principal y después las partes, sin ella", () => {
    const libro = construirLibro(arbol, opciones("pa", "ambos", 1), new Set());
    expect(libro.partes.map((p) => p.direccion)).toEqual(["principal", "ascendientes", "descendientes"]);
    // La principal: solo su entrada, sin título de parte ni de generación.
    const principal = parte(libro, "principal").parrafos;
    expect(principal.filter((p) => p.tipo === "entrada").map((p) => p.tipo === "entrada" && p.numero)).toEqual(["1."]);
    expect(principal.some((p) => p.tipo === "parte" || p.tipo === "generacion")).toBe(false);
    // Generación 1 = padres; Generación 1 = hijos; sin la persona principal.
    const entradasDe = (d: Direccion) => parte(libro, d).parrafos.flatMap((p) => (p.tipo === "entrada" ? [p.numero] : []));
    expect(entradasDe("ascendientes")).toEqual(["2.", "3."]);
    expect(entradasDe("descendientes")).toEqual(["1.1.", "1.2."]);
    expect(generaciones(libro, "ascendientes")).toEqual(["Generación 1"]);
    expect(generaciones(libro, "descendientes")).toEqual(["Generación 1"]);
    // Ninguna remisión a la otra parte.
    expect(JSON.stringify(libro)).not.toContain("figuran en la parte");
    expect(personasDelLibro(libro).has("yo")).toBe(true);
  });

  it("generaciones: desde los padres o los hijos (1, 3 y todas)", () => {
    expect(generaciones(construirLibro(arbol, opciones("gp", "descendientes", 1), new Set()), "descendientes")).toEqual(["Generación 1"]);
    const tres = construirLibro(arbol, opciones("gp", "descendientes", 3), new Set());
    expect(generaciones(tres, "descendientes")).toEqual(["Generación 1", "Generación 2", "Generación 3"]);
    // «Todas»: más de las que hay da las que hay.
    expect(entradas(construirLibro(arbol, opciones("gp", "descendientes", 99), new Set()))).toEqual(entradas(tres));
    const asc = construirLibro(arbol, opciones("yo", "ascendientes", 3), new Set());
    expect(generaciones(asc, "ascendientes")).toEqual(["Generación 1", "Generación 2"]);
  });

  it("página principal: los hijos con sus datos principales y su número si hay descendientes; si no, sin número", () => {
    const conNumero = hijosPrincipal(construirLibro(arbol, opciones("pa", "ambos", 1), new Set()));
    expect(conNumero).toEqual(["1.1 yo Prueba. Nació en 1940 en Madrid.", "1.2 hermana Prueba. Nació en 1980 en Madrid."]);
    const sinNumero = hijosPrincipal(construirLibro(arbol, opciones("pa", "ascendientes", 1), new Set()));
    expect(sinNumero).toEqual(["i. yo Prueba. Nació en 1940 en Madrid.", "ii. hermana Prueba. Nació en 1980 en Madrid."]);
    // En «Descendientes», cada hijo con su entrada completa.
    expect(entradas(construirLibro(arbol, opciones("pa", "descendientes", 1), new Set())).get("1.1")![1]).toBe("Nació en 1940 en Madrid. Era hijo de pa Prueba (n.º 1) y de ma Prueba.");
  });

  it("ascendientes con numeración Sosa, por generaciones", () => {
    const libro = construirLibro(arbol, opciones("yo", "ascendientes", 2), new Set());
    expect([...entradas(libro).keys()]).toEqual(["1", "2", "3", "4", "5"]);
    expect(generaciones(libro, "ascendientes")).toEqual(["Generación 1", "Generación 2"]);
    const e = entradas(libro);
    expect(e.get("2")![0]).toBe("pa Prueba");
    expect(e.get("1")).toContain("Nació en 1940 en Madrid. Era hijo de pa Prueba (n.º 2) y de ma Prueba (n.º 3).");
    // Los hijos de una pareja, una sola vez: en la entrada del padre (la
    // primera que sale); la de la madre remite a ella.
    expect(e.get("2")).toContain("Hijos de pa Prueba y ma Prueba:");
    expect(e.get("3")).toContain("Hijos: véase el n.º 2.");
    // Con entrada propia, solo el nombre y el número; sin ella, sus frases.
    expect(e.get("2")).toContain("yo Prueba (n.º 1).");
    expect(e.get("2")).toContain("hermana Prueba. Nació en 1980 en Madrid.");
  });

  it("descendientes con numeración d'Aboville, hijos de todas las familias", () => {
    const libro = construirLibro(arbol, opciones("gp", "descendientes", 3), new Set());
    expect([...entradas(libro).keys()]).toEqual(["1", "1.1", "1.2", "1.1.1", "1.1.2", "1.1.1.1", "1.1.1.2"]);
    // Cónyuge que no es descendiente: con sus frases, sujeto incluido.
    expect(entradas(libro).get("1.1.1")).toContain("Se casó con cy Prueba. cy Prueba nació en 1942 en Madrid.");
  });

  it("tipos de relación de pareja, por fecha de boda", () => {
    const libro = construirLibro(arbol, opciones("rr", "descendientes", 1), new Set());
    const e = entradas(libro).get("1")!;
    const frases = e.filter((l) => / s\d Prueba/.test(l) && !l.startsWith("Hijos"));
    expect(frases).toEqual([
      "Se casó con s5 Prueba en 1970. s5 Prueba nació en 1945 en Madrid.",
      "Se casó con s1 Prueba en 1980. Se divorciaron en 1990 en Madrid. s1 Prueba nació en 1945 en Madrid.",
      "Pareja de s2 Prueba. Se separaron en 1985 en Madrid. s2 Prueba nació en 1945 en Madrid.",
      "También tuvo hijos con s3 Prueba, sin relación de pareja. s3 Prueba nació en 1945 en Madrid.",
      "También mantuvo una relación con s4 Prueba. s4 Prueba nació en 1945 en Madrid.",
    ]);
    expect([...entradas(libro).keys()]).toEqual(["1", "1.1"]);
    // Con todos los eventos, los de las frases no se repiten en la lista.
    const todos = entradas(construirLibro(arbol, opciones("rr", "descendientes", 1, { eventos: "todos" }), new Set())).get("1")!;
    expect(todos.filter((l) => /^(Divorcio|Separación|Matrimonio):/.test(l))).toEqual([]);
    expect(todos.filter((l) => /^Inicio de la relación:/.test(l))).toHaveLength(1);
    // Con la pareja viva omitida, sin fechas ni separación.
    const privada = entradas(construirLibro(arbol, opciones("rr", "descendientes", 1), new Set(["s2"]))).get("1")!;
    expect(privada).toContain("Pareja de s2 Prueba. Persona viva.");
  });

  it("frases con las reglas de la web: nacimiento siempre, defunción solo si la hay, boda con el cónyuge", () => {
    const e = entradas(construirLibro(arbol, opciones("gp", "descendientes", 1), new Set()));
    expect(e.get("1")).toEqual(expect.arrayContaining([
      "Nació en 1880 en Madrid. Falleció en 1950.",
      "Se casó con gm Prueba en 1905. gm Prueba nació en 1885 en Madrid.",
    ]));
    const q = entradas(construirLibro(arbol, opciones("q", "ascendientes", 1), new Set())).get("1")!;
    expect(q).toEqual(["q Prueba", "No constan la fecha ni el lugar de su nacimiento. Era hija de a Prueba (n.º 2) y de b Prueba (n.º 3)."]);
    // Bautismo en lugar del nacimiento; entierro sin datos en lugar de la
    // defunción.
    const bau = entradas(construirLibro(arbol, opciones("bau", "ascendientes", 1), new Set())).get("1")!;
    expect(bau).toEqual(["bau Prueba", "Fue bautizado en 1900 en Madrid. Recibió sepultura; no constan la fecha ni el lugar."]);
    // Sin ascendientes ni descendientes, la parte lo dice (una sola vez).
    const sinAsc = construirLibro(arbol, opciones("bau", "ascendientes", 1), new Set());
    expect(parte(sinAsc, "ascendientes").parrafos.map(texto)).toEqual(["Ascendientes", "No constan ascendientes."]);
    const sinDesc = construirLibro(arbol, opciones("hermana", "ambos", 1), new Set());
    expect(parte(sinDesc, "descendientes").parrafos.map(texto)).toEqual(["Descendientes", "No constan descendientes."]);
    expect(parte(sinDesc, "principal").parrafos.map(texto)).not.toContain("No constan descendientes.");
  });

  it("el tiempo del verbo: «Es hijo» si se considera viva, «Era hijo» si no", () => {
    const e = entradas(construirLibro(arbol, opciones("yo", "ascendientes", 1), new Set(), new Set(["yo"])));
    expect(e.get("1")).toContain("Nació en 1940 en Madrid. Es hijo de pa Prueba (n.º 2) y de ma Prueba (n.º 3).");
  });

  it("quien no se considera viva sale como fallecida aunque no tenga defunción (29/10/2026)", () => {
    const e = entradas(construirLibro(arbol, opciones("yo", "ascendientes", 1), new Set(), new Set(["yo"])));
    // ma no tiene defunción y no está entre las vivas; pa tiene la suya.
    expect(e.get("3")![1]).toBe("Nació en 1915 en Madrid. Falleció; no constan la fecha ni el lugar.");
    expect(e.get("2")![1]).toBe("Nació en 1910 en Madrid. Falleció en 1990. Era hijo de gp Prueba y de gm Prueba.");
    expect(e.get("1")![1]).toBe("Nació en 1940 en Madrid. Es hijo de pa Prueba (n.º 2) y de ma Prueba (n.º 3).");
    // Sin las vivas, solo con evento (como antes).
    const sin = entradas(construirLibro(arbol, opciones("yo", "ascendientes", 1), new Set()));
    expect(sin.get("3")![1]).toBe("Nació en 1915 en Madrid.");
  });

  it("una persona repetida remite a su primera entrada y no repite su rama", () => {
    const e = entradas(construirLibro(arbol, opciones("q", "ascendientes", 3), new Set()));
    // c es el 4 (padre de a) y el 6 (padre de b).
    expect(e.get("4")![0]).toBe("c Prueba");
    expect(e.get("6")).toEqual(["c Prueba", "Es la misma persona que el n.º 4, pág. {pagina}"]);
  });

  it("persona viva omitida: solo el nombre y «Persona viva», también en las listas", () => {
    const privadas = new Set(["hermana", "h1"]);
    const libro = construirLibro(arbol, opciones("pa", "descendientes", 2), privadas);
    const e = entradas(libro);
    expect(e.get("1.2")).toEqual(["hermana Prueba", "Persona viva"]);
    expect(hijosPrincipal(libro)).toContain("1.2 hermana Prueba. Persona viva.");
    expect(e.get("1.1")).toContain("h1 Prueba (n.º 1.1.1). Persona viva.");
    // Ningún lugar ni fecha de las personas omitidas.
    const todo = libro.partes.flatMap((p) => p.parrafos).map(texto).join("\n");
    expect(todo).not.toContain("1980");
    expect(todo).not.toContain("1970");
  });

  it("eventos: solo los principales o todos; notas según la opción", () => {
    const solo = entradas(construirLibro(arbol, opciones("yo", "ascendientes", 1), new Set()));
    expect(solo.get("1")!.some((l) => l.startsWith("Ocupación"))).toBe(false);
    expect(solo.get("2")).toEqual(expect.arrayContaining(["Fue maestro.", "Vivió en Madrid."]));
    const todos = entradas(construirLibro(arbol, opciones("yo", "ascendientes", 1, { eventos: "todos", notas: false }), new Set()));
    expect(todos.get("1")).toEqual(expect.arrayContaining(["Más sobre yo Prueba:", "Ocupación: 1965"]));
    expect(todos.get("2")).not.toContain("Fue maestro.");
  });

  it("sexo desconocido: formas neutras", () => {
    const dx = entradas(construirLibro(arbol, opciones("dx", "ascendientes", 1), new Set())).get("1")!;
    expect(dx).toEqual(["dx Prueba", "Nació en 1960 en Madrid. Su cuerpo fue incinerado en 2000. Sus padres eran pa Prueba (n.º 2) e Inés Prueba (n.º 3)."]);
    const solo = entradas(construirLibro(arbol, opciones("solo", "ascendientes", 1), new Set(), new Set(["solo"]))).get("1")!;
    expect(solo[1]).toBe("Nació en 1961 en Madrid. Su madre es Inés Prueba (n.º 3).");
  });

  it("apodo: «Conocido como “…”.», antes del nacimiento", () => {
    const nombre = arbol.persona("dx")!.primary_name;
    nombre.nick = "Dexi";
    try {
      const dx = entradas(construirLibro(arbol, opciones("dx", "ascendientes", 1), new Set())).get("1")!;
      expect(dx[1]).toMatch(/^Apodo: “Dexi”\. Nació en 1960/);
      arbol.persona("tio")!.primary_name.nick = "Tito";
      const tio = entradas(construirLibro(arbol, opciones("tio", "ascendientes", 1), new Set())).get("1")!;
      expect(tio[1]).toMatch(/^Conocido como “Tito”\. Nació en 1912/);
    } finally {
      nombre.nick = "";
      arbol.persona("tio")!.primary_name.nick = "";
    }
  });

  it("«Más sobre»: sin los eventos que no tienen ningún dato", () => {
    const dx = entradas(construirLibro(arbol, opciones("dx", "ascendientes", 1, { eventos: "todos" }), new Set())).get("1")!;
    expect(dx).toEqual(expect.arrayContaining(["Más sobre dx Prueba:", "Educación: sin datos. Bachillerato"]));
    expect(dx.some((l) => l.startsWith("Ocupación"))).toBe(false);
  });

  it("«y» o «e»", () => {
    expect(["Inés", "Isabel", "Hilda", "Íñigo", "Iolanda", "hielo", "Ana", "  inés"].map(conjuncionY)).toEqual(["e", "e", "e", "e", "y", "y", "y", "e"]);
  });

  it("árbol insertado: cada entrada, también la principal, remite a su página del árbol (uno solo)", () => {
    const libro = construirLibro(arbol, opciones("yo", "ambos", 1, { arboles: true }), new Set());
    const anclas = libro.partes.flatMap((p) => p.parrafos).flatMap((p) => (p.tipo === "entrada" ? p.trozos.flatMap((t) => (t.ancla ? [t.ancla] : [])) : []));
    expect(anclas).toEqual(["arbol:yo", "arbol:pa", "arbol:ma", "arbol:h1", "arbol:h2"]);
  });

  it("identificadores: junto al nombre de cada entrada solo con la opción (30/10/2026)", () => {
    const cabeceras = (ids: boolean) => [...entradas(construirLibro(arbol, opciones("yo", "ambos", 1, { ids }), new Set())).values()].map((l) => l[0]);
    expect(cabeceras(true)).toEqual(["yo Prueba [yo]", "pa Prueba [pa]", "ma Prueba [ma]", "h1 Prueba [h1]", "h2 Prueba [h2]"]);
    expect(cabeceras(false).some((c) => c.includes("["))).toBe(false);
  });

  it("pies de foto: sin la descripción si es una ruta o el nombre del fichero (30/10/2026)", () => {
    const yo = arbol.persona("yo")!;
    const antes = yo.media_list;
    yo.media_list = ["m1", "m2", "m3", "m4"].map((ref) => ({ ref, rect: null }) as never);
    try {
      const fotos = construirLibro(arbol, opciones("yo", "ascendientes", 1, { fotos: "todas" }), new Set()).partes[0].parrafos
        .flatMap((p) => (p.tipo === "fotos" ? p.fotos.map((f) => f.pie) : []));
      expect(fotos).toEqual(["", "", "", "Boda en Madrid"]);
    } finally {
      yo.media_list = antes;
    }
  });

  it("fechas aproximadas (31/10/2026): «hacia» en las frases y «c.» en los árboles y el índice", () => {
    const e = entradas(construirLibro(arbol, opciones("ap", "descendientes", 1), new Set())).get("1")!;
    expect(e[1]).toBe("Nació hacia 1850 en Madrid. Falleció en 1920.");
    // El texto del divorcio sin datos no cambia; en el óvalo, «divorciados».
    expect(e).toContain("Se casó con s9 Prueba. Se divorciaron; no constan la fecha ni el lugar. s9 Prueba nació en 1855 en Madrid.");
    // Los árboles del libro, con el formato abreviado (pdfLibro.ts).
    const g = construirGrafico(arbol, arbol.persona("ap")!, "descendientes", 2, { ...simbolosDe({ juego: "abreviaturas" }), formato: "abreviado" });
    expect(g.descendientes!.person!.birth.text).toBe("n. c. 1850, Madrid");
    expect(g.descendientes!.children![0].family!.lines.map((l) => l.text)).toEqual(["casados", "divorciados"]);
    expect(aniosIndice(arbol, arbol.persona("ap")!, new Set())).toBe(" (c. 1850–1920)");
    expect(aniosIndice(arbol, arbol.persona("pa")!, new Set())).toBe(" (1910–1990)");
    expect(aniosIndice(arbol, arbol.persona("ap")!, new Set(["ap"]))).toBe("");
  });

  it("números romanos de las listas de hijos", () => {
    expect([1, 4, 9, 14, 40].map(romano)).toEqual(["i", "iv", "ix", "xiv", "xl"]);
  });
});
