// Pruebas del mapa de lugares: lectura de coordenadas (contra Gramps),
// tipos de lugar y qué lugares salen, dónde y con qué eventos.

import { beforeAll, describe, expect, it } from "vitest";
import { Arbol } from "./arbol";
import referencia from "./datos-prueba/coordenadas-gramps.json";
import { prepararFechas } from "./fechas";
import {
  claseLugar, datosMapa, eventosDePersonas, filtrarEventos, GRUPOS_EVENTO, grupoEvento, leerCoordenadas, personasRama, recorrido,
  situarLugar, type GrupoEvento,
} from "./mapa";
import { Limitador, leerResultados, urlBusqueda } from "./nominatim";
import type { Evento, Instantanea, Lugar } from "./tipos";

/** Como el formato «D.D8» de Gramps: 8 decimales y 180 → -180. */
function d8(c: [number, number] | null): [string, string] | null {
  if (!c) return null;
  const lon = c[1].toFixed(8);
  return [c[0].toFixed(8), lon === "180.00000000" ? "-180.00000000" : lon];
}

describe("coordenadas", () => {
  it(`${referencia.casos.length} formas de escribirlas, leídas como Gramps ${referencia.version_gramps}`, () => {
    for (const c of referencia.casos) expect(d8(leerCoordenadas(c.lat, c.long)), JSON.stringify([c.lat, c.long])).toEqual(c.gramps);
  });
  it("«O» vale por oeste, como en Gramps en castellano", () => {
    expect(d8(leerCoordenadas("40.4168N", "3.7038O"))).toEqual(["40.41680000", "-3.70380000"]);
    expect(d8(leerCoordenadas("40°25'0.5\"N", "3°42'13.7\"O"))).toEqual(["40.41680556", "-3.70380556"]);
  });
  it("las de este árbol, en decimal", () => {
    expect(leerCoordenadas("41.006381", "28.9758715")).toEqual([41.006381, 28.9758715]);
  });
});

const tipo = (value: number, string = "") => ({ _class: "PlaceType", value, string });

describe("tipos de lugar", () => {
  it("país, ciudad (y parecidos), cementerio (tipo propio) y resto", () => {
    expect(claseLugar(tipo(1))).toBe("pais");
    for (const v of [4, 6, 14, 15, 16, 17]) expect(claseLugar(tipo(v))).toBe("ciudad");
    expect(claseLugar(tipo(0, "@cementerio"))).toBe("cementerio");
    for (const t of [tipo(2), tipo(7), tipo(8), tipo(19), tipo(0, "@direccion"), tipo(-1)]) expect(claseLugar(t)).toBe("resto");
  });
});

const SIN_FECHA = { modifier: 0, quality: 0, calendar: 0, dateval: [0, 0, 0, false], text: "", sortval: 0, newyear: 0 };
const lugar = (handle: string, nombre: string, lat: string, long: string, superior = "", valorTipo = 4): Lugar => ({
  handle, gramps_id: handle.toUpperCase(), change: 0, private: false, note_list: [],
  title: "", name: { value: nombre, date: SIN_FECHA, lang: "" }, alt_names: [],
  placeref_list: superior ? [{ ref: superior }] : [], place_type: tipo(valorTipo), lat, long,
} as unknown as Lugar);
const evento = (handle: string, place: string, anio = 0, valorTipo = 12): Evento => ({
  handle, gramps_id: handle.toUpperCase(), change: 0, private: false, note_list: [],
  type: { _class: "EventType", value: valorTipo, string: "" }, description: "", place, media_list: [],
  date: anio ? { ...SIN_FECHA, dateval: [0, 0, anio, false], sortval: anio * 365 } : SIN_FECHA,
} as unknown as Evento);
const mapaDe = (...ls: Lugar[]) => new Map(ls.map((l) => [l.handle, l]));

describe("puntos del mapa", () => {
  const LUGARES = mapaDe(
    lugar("pais", "Turquía", "39", "35", "", 1),
    // Las mismas coordenadas con dos nombres.
    lugar("cons", "Constantinopla", "41.006381", "28.9758715", "pais"),
    lugar("estam", "Estambul", "41.006381", "28.9758715", "pais"),
    // Sin coordenadas: las del lugar que lo contiene.
    lugar("calle", "Calle Mayor", "", "", "estam", 7),
    // Sin coordenadas en ninguna parte de la jerarquía.
    lugar("sin", "Sin sitio", "", "", "nada"),
    lugar("sin2", "Coordenadas raras", "norte", "sur"),
    // Con coordenadas, pero sin eventos.
    lugar("vacio", "Sin eventos", "40", "-3"),
  );
  const EVENTOS = [
    evento("e1", "estam", 1950),
    evento("e2", "cons", 1890),
    evento("e3", "calle", 1920),
    evento("e4", "cons"),
    evento("e5", "sin", 1900),
    evento("e6", "sin2", 1900),
    evento("e7", "", 1900),
    evento("e8", "noexiste", 1900),
  ];
  const datos = datosMapa(LUGARES, EVENTOS);

  it("mismas coordenadas, un solo punto con todos los nombres y todos los eventos, por fecha", () => {
    expect(datos.puntos).toHaveLength(1);
    const [p] = datos.puntos;
    expect(p.lugares.map((x) => x.lugar.handle)).toEqual(["cons", "estam", "calle"]);
    expect(p.eventos.map((e) => e.handle)).toEqual(["e2", "e3", "e1", "e4"]);
    expect([p.lat, p.lon]).toEqual([41.006381, 28.9758715]);
    expect(p.clase).toBe("ciudad");
    expect(p.aproximado).toBe(false);
  });

  it("sin coordenadas, las del lugar que lo contiene, marcado como aproximado", () => {
    const calle = datos.puntos[0].lugares.find((x) => x.lugar.handle === "calle")!;
    expect(calle.aproximadoDe?.handle).toBe("estam");
  });

  it("sin coordenadas en ninguna parte (o ilegibles): fuera del mapa, en la lista del administrador", () => {
    expect(datos.sinCoordenadas.map((l) => l.handle)).toEqual(["sin2", "sin"]);
  });

  it("sin eventos propios no salen, aunque contengan lugares con eventos", () => {
    const todos = datos.puntos.flatMap((p) => p.lugares.map((x) => x.lugar.handle));
    expect(todos).not.toContain("vacio");
    expect(todos).not.toContain("pais");
  });

  it("un punto solo con lugares aproximados lo es; el símbolo, el del lugar más concreto", () => {
    const solo = datosMapa(mapaDe(lugar("c", "Ciudad", "1", "2"), lugar("cem", "Cementerio", "", "", "c", 0)), [evento("e", "cem")]);
    expect(solo.puntos[0].aproximado).toBe(true);
    const cem = datosMapa(
      mapaDe({ ...lugar("c", "Ciudad", "1", "2"), place_type: tipo(4) }, { ...lugar("cem", "Cementerio", "1", "2"), place_type: tipo(0, "@cementerio") }),
      [evento("e1", "c"), evento("e2", "cem")],
    );
    expect(cem.puntos[0].clase).toBe("cementerio");
  });

  it("una jerarquía con ciclo no se queda colgada", () => {
    const ciclo = datosMapa(mapaDe(lugar("a", "A", "", "", "b"), lugar("b", "B", "", "", "a")), [evento("e", "a")]);
    expect(ciclo.puntos).toHaveLength(0);
    expect(ciclo.sinCoordenadas.map((l) => l.handle)).toEqual(["a"]);
  });
});

describe("filtros", () => {
  it("grupos de eventos", () => {
    const g = (v: number, string = "") => grupoEvento({ _class: "EventType", value: v, string });
    for (const v of [12, 15, 22, 14]) expect(g(v)).toBe("nacimientos");
    for (const v of [13, 19, 24]) expect(g(v)).toBe("defunciones");
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(g(v)).toBe("bodas");
    for (const v of [11, 20, 21, 37, 42, 45, -1]) expect(g(v)).toBe("otros");
    expect(g(0, "@algo")).toBe("otros");
  });

  const EVENTOS = [
    evento("nac", "a", 1850, 12),
    evento("boda", "a", 1875, 1),
    evento("def", "b", 1920, 13),
    evento("res", "b", 0, 42),
    evento("bau", "b", 0, 15),
    evento("sinLugar", "", 1900, 12),
  ];
  const todos = new Set<GrupoEvento>(GRUPOS_EVENTO);
  const handles = (x: { eventos: Evento[] }) => x.eventos.map((e) => e.handle);

  it("sin filtros, todos los que tienen lugar", () => {
    expect(handles(filtrarEventos(EVENTOS, { grupos: todos, desde: null, hasta: null }))).toEqual(["nac", "boda", "def", "res", "bau"]);
  });
  it("al desmarcar un grupo se quitan sus eventos (y los lugares que solo tenían esos)", () => {
    const f = filtrarEventos(EVENTOS, { grupos: new Set<GrupoEvento>(["nacimientos", "bodas"]), desde: null, hasta: null });
    expect(handles(f)).toEqual(["nac", "boda", "bau"]);
    const lugares = mapaDe(lugar("a", "A", "1", "1"), lugar("b", "B", "2", "2"));
    const solo = filtrarEventos(EVENTOS, { grupos: new Set<GrupoEvento>(["bodas"]), desde: null, hasta: null });
    expect(datosMapa(lugares, solo.eventos).puntos.map((p) => p.lugares[0].lugar.handle)).toEqual(["a"]);
  });
  it("años desde y hasta: los que no tienen fecha se quitan y se cuentan", () => {
    expect(filtrarEventos(EVENTOS, { grupos: todos, desde: 1860, hasta: null }).sinFecha).toBe(2);
    expect(handles(filtrarEventos(EVENTOS, { grupos: todos, desde: 1860, hasta: null }))).toEqual(["boda", "def"]);
    expect(handles(filtrarEventos(EVENTOS, { grupos: todos, desde: null, hasta: 1875 }))).toEqual(["nac", "boda"]);
    // Sin años, nada se quita por no tener fecha.
    expect(filtrarEventos(EVENTOS, { grupos: todos, desde: null, hasta: null }).sinFecha).toBe(0);
    // Solo cuentan los de los grupos marcados.
    expect(filtrarEventos(EVENTOS, { grupos: new Set<GrupoEvento>(["otros"]), desde: 1900, hasta: null }).sinFecha).toBe(1);
  });
  it("las fechas aproximadas cuentan por su año, como en las listas", () => {
    const e = evento("c", "a", 1850);
    const c = { ...e, date: { ...e.date, modifier: 3 } } as Evento;
    expect(handles(filtrarEventos([c], { grupos: todos, desde: 1850, hasta: 1850 }))).toEqual(["c"]);
  });
});

// Un árbol pequeño: abuelos (a1, a2) → padres (p, m) → hijos (h1, h2);
// h1 casado con c1, y su hija n.
const base = (handle: string) => ({ handle, gramps_id: handle.toUpperCase(), change: 0, private: false, note_list: [] });
const tipoG = (_class: string, value: number) => ({ _class, value, string: "" });
const persona = (h: string, familias: string[], padres: string[], eventos: string[] = []) => ({
  ...base(h), gender: 1, alternate_names: [], media_list: [], family_list: familias, parent_family_list: padres,
  primary_name: { first_name: h, suffix: "", title: "", call: "", nick: "", type: tipoG("NameType", 2), surname_list: [] },
  event_ref_list: eventos.map((ref) => ({ ref, role: tipoG("EventRoleType", 1) })), birth_ref_index: -1, death_ref_index: -1,
});
const familia = (h: string, padre: string, madre: string, hijos: string[], eventos: string[] = []) => ({
  ...base(h), father_handle: padre, mother_handle: madre, type: tipoG("FamilyRelType", 0), media_list: [],
  event_ref_list: eventos.map((ref) => ({ ref, role: tipoG("EventRoleType", 8) })),
  child_ref_list: hijos.map((ref) => ({ ref, frel: tipoG("ChildRefType", 1), mrel: tipoG("ChildRefType", 1) })),
});
const ARBOL = {
  version_instantanea: 1, generada: "2026-11-02T00:00:00Z", version_gramps: "6.0.5", persona_inicio: "p",
  objetos: {
    Person: [
      persona("a1", ["fa"], []), persona("a2", ["fa"], []),
      persona("p", ["fp"], ["fa"], ["ep1", "ep2", "ep3", "ep4"]), persona("m", ["fp"], []),
      persona("h1", ["fh"], ["fp"]), persona("h2", [], ["fp"]),
      persona("c1", ["fh"], []), persona("n", [], ["fh"]),
    ],
    Family: [familia("fa", "a1", "a2", ["p"]), familia("fp", "p", "m", ["h1", "h2"], ["eboda"]), familia("fh", "h1", "c1", ["n"])],
    Event: [
      evento("ep1", "madrid", 1900, 12), evento("ep2", "paris", 1950, 13), evento("ep3", "sinsitio", 1930, 42),
      evento("ep4", "roma", 0, 42), evento("eboda", "roma", 1925, 1),
    ],
    Place: [
      lugar("madrid", "Madrid", "40.4", "-3.7"), lugar("paris", "París", "48.9", "2.3"), lugar("roma", "Roma", "41.9", "12.5"),
      lugar("sinsitio", "Sin sitio", "", ""),
    ],
  },
} as unknown as Instantanea;

describe("una persona y su rama", () => {
  let arbol: Arbol;
  beforeAll(async () => {
    await prepararFechas();
    arbol = new Arbol(ARBOL);
  });
  const nombres = (ps: { handle: string }[]) => ps.map((p) => p.handle).sort();

  it("sus eventos: los propios y los de sus familias", () => {
    expect(nombres(eventosDePersonas(arbol, [arbol.personas.get("p")!]))).toEqual(["eboda", "ep1", "ep2", "ep3", "ep4"]);
  });

  it("recorrido por fecha, sin los eventos sin fecha ni los lugares sin coordenadas", () => {
    const evs = eventosDePersonas(arbol, [arbol.personas.get("p")!]);
    // Madrid 1900, Roma 1925 (boda), [sin sitio 1930], París 1950; Roma sin fecha, fuera.
    expect(recorrido(arbol.lugares, evs)).toEqual([[40.4, -3.7], [41.9, 12.5], [48.9, 2.3]]);
  });

  it("ascendientes: por generaciones, contando la suya", () => {
    const p = arbol.personas.get("p")!;
    expect(nombres(personasRama(arbol, p, "ascendientes", 1))).toEqual(["p"]);
    expect(nombres(personasRama(arbol, p, "ascendientes", 2))).toEqual(["a1", "a2", "p"]);
    expect(nombres(personasRama(arbol, arbol.personas.get("n")!, "ascendientes", 9))).toEqual(["a1", "a2", "c1", "h1", "m", "n", "p"]);
  });

  it("descendientes: con los cónyuges de cada uno, como en el árbol", () => {
    const p = arbol.personas.get("p")!;
    expect(nombres(personasRama(arbol, p, "descendientes", 2))).toEqual(["c1", "h1", "h2", "m", "p"]);
    expect(nombres(personasRama(arbol, p, "descendientes", 3))).toEqual(["c1", "h1", "h2", "m", "n", "p"]);
  });

  it("ambos: ascendientes y descendientes, sin repetir la persona", () => {
    const p = arbol.personas.get("p")!;
    expect(nombres(personasRama(arbol, p, "ambos", 2))).toEqual(["a1", "a2", "c1", "h1", "h2", "m", "p"]);
  });

  it("situar un lugar: sus coordenadas, las heredadas o ninguna", () => {
    expect(situarLugar(arbol.lugares, "madrid")).toEqual({ coordenadas: [40.4, -3.7], de: null });
    expect(situarLugar(arbol.lugares, "sinsitio")).toBeNull();
  });
});

describe("Nominatim", () => {
  it("como mucho una consulta por segundo", () => {
    let ahora = 1000;
    const l = new Limitador(1000, () => ahora);
    expect(l.pasar()).toBe(true);
    expect(l.pasar()).toBe(false);
    ahora += 400;
    expect(l.espera()).toBe(600);
    expect(l.pasar()).toBe(false);
    ahora += 600;
    expect(l.espera()).toBe(0);
    expect(l.pasar()).toBe(true);
  });
  it("la consulta y sus resultados", () => {
    const u = new URL(urlBusqueda(" Cádiz, España ", "es"));
    expect(u.origin + u.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "Cádiz, España", format: "jsonv2", limit: "5", "accept-language": "es" });
    const r = leerResultados([
      { display_name: "Cádiz, Andalucía, España", lat: "36.5297438", lon: "-6.2928976" },
      { display_name: "sin coordenadas" },
      ...Array.from({ length: 6 }, (_, i) => ({ display_name: `L${i}`, lat: "1", lon: "2" })),
    ]);
    expect(r[0]).toEqual({ nombre: "Cádiz, Andalucía, España", lat: "36.5297438", long: "-6.2928976" });
    expect(r).toHaveLength(5);
    expect(leerResultados({ error: "x" })).toEqual([]);
  });
});
