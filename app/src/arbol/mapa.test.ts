// Pruebas del mapa de lugares: lectura de coordenadas (contra Gramps),
// tipos de lugar y qué lugares salen, dónde y con qué eventos.

import { describe, expect, it } from "vitest";
import referencia from "./datos-prueba/coordenadas-gramps.json";
import { claseLugar, datosMapa, leerCoordenadas } from "./mapa";
import type { Evento, Lugar } from "./tipos";

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
const evento = (handle: string, place: string, anio = 0): Evento => ({
  handle, gramps_id: handle.toUpperCase(), change: 0, private: false, note_list: [],
  type: { _class: "EventType", value: 12, string: "" }, description: "", place, media_list: [],
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
