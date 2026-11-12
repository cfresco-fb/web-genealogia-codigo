// Pruebas del árbol en memoria con un árbol mínimo inventado.

import { beforeAll, describe, expect, it } from "vitest";
import { nombreTipo } from "../i18n";
import { Arbol, descripcionFoto } from "./arbol";
import { lineaCaja } from "./grafico";
import { simbolosDe } from "./simbolos";
import { prepararFechas } from "./fechas";
import type { Instantanea } from "./tipos";

const SIN_FECHA = { modifier: 0, quality: 0, calendar: 0, dateval: [0, 0, 0, false], text: "", sortval: 0, newyear: 0 };
const tipo = (_class: string, value: number) => ({ _class, value, string: "" });
const base = (handle: string, gramps_id: string) => ({ handle, gramps_id, change: 0, private: false, note_list: [] });
const nombre = (first_name: string, ...apellidos: string[]) => ({
  first_name, suffix: "", title: "", call: "", nick: "", type: tipo("NameType", 2),
  surname_list: apellidos.map((surname, i) => ({ surname, prefix: "", primary: i === 0, connector: "" })),
});
const persona = (h: string, id: string, gender: number, n: ReturnType<typeof nombre>, eventos: [string, number][], extra = {}) => ({
  ...base(h, id), gender, primary_name: n, alternate_names: [], media_list: [], family_list: [], parent_family_list: [],
  event_ref_list: eventos.map(([ref, rol]) => ({ ref, role: tipo("EventRoleType", rol) })),
  birth_ref_index: -1, death_ref_index: -1, ...extra,
});
const evento = (h: string, id: string, valorTipo: number, anio: number, place = "") => ({
  ...base(h, id), type: tipo("EventType", valorTipo), description: "", place, media_list: [],
  date: anio ? { ...SIN_FECHA, dateval: [0, 0, anio, false], sortval: anio * 365 } : SIN_FECHA,
});

const INSTANTANEA = {
  version_instantanea: 1, generada: "2026-10-21T00:00:00Z", version_gramps: "6.0.5", persona_inicio: "p1",
  objetos: {
    Person: [
      // Nacimiento normal y defunción sustituida por el entierro.
      persona("p1", "I1", 1, nombre("José", "Pérez", "Núñez"), [["e1", 1], ["e2", 1]], { birth_ref_index: 0, family_list: ["f1"] }),
      // Sin nacimiento: se toma el bautismo.
      persona("p2", "I2", 0, nombre("María", "López"), [["e3", 1]], { family_list: ["f1"] }),
      persona("p3", "I3", 2, nombre("", ""), [], { parent_family_list: ["f1"] }),
      // Nacimiento solo con fecha; defunción con fecha y lugar.
      persona("p4", "I4", 1, nombre("Ana", "Ruiz"), [["e6", 1], ["e5", 1]], { birth_ref_index: 0, death_ref_index: 1 }),
      // Nacimiento sin fecha ni lugar; defunción solo con lugar.
      persona("p5", "I5", 1, nombre("Luis", "Ruiz"), [["e8", 1], ["e7", 1]], { birth_ref_index: 0, death_ref_index: 1 }),
      // Defunción sin fecha ni lugar.
      persona("p6", "I6", 0, nombre("Eva", "Ruiz"), [["e9", 1]], { death_ref_index: 0 }),
      // Sin defunción, con incineración solo con lugar.
      persona("p7", "I7", 0, nombre("Rosa", "Ruiz"), [["e10", 1]]),
      // Sin defunción, solo con causa de muerte.
      persona("p8", "I8", 1, nombre("Juan", "Ruiz"), [["e11", 1]]),
    ],
    Family: [{
      ...base("f1", "F1"), father_handle: "p1", mother_handle: "p2", type: tipo("FamilyRelType", 0), media_list: [],
      event_ref_list: [{ ref: "e4", role: tipo("EventRoleType", 8) }],
      child_ref_list: [{ ref: "p3", frel: tipo("ChildRefType", 1), mrel: tipo("ChildRefType", 1) }],
    }],
    Event: [
      evento("e1", "E1", 12, 1850, "l2"),
      evento("e2", "E2", 19, 1920),
      evento("e3", "E3", 15, 1855),
      evento("e4", "E4", 1, 0),
      evento("e5", "E5", 13, 1950, "l2"),
      evento("e6", "E6", 12, 1900),
      evento("e7", "E7", 13, 0, "l2"),
      evento("e8", "E8", 12, 0),
      evento("e9", "E9", 13, 0),
      evento("e10", "E10", 24, 0, "l2"),
      evento("e11", "E11", 20, 1940),
    ],
    Place: [
      { ...base("l1", "P1"), title: "", name: { value: "España", date: SIN_FECHA, lang: "" }, alt_names: [], placeref_list: [], place_type: tipo("PlaceType", 1), lat: "", long: "" },
      { ...base("l2", "P2"), title: "", name: { value: "Cádiz", date: SIN_FECHA, lang: "" }, alt_names: [], placeref_list: [{ ref: "l1" }], place_type: tipo("PlaceType", 4), lat: "", long: "" },
    ],
  },
} as unknown as Instantanea;

let arbol: Arbol;
beforeAll(async () => {
  await prepararFechas();
  arbol = new Arbol(INSTANTANEA);
});

describe("Arbol", () => {
  it("persona de inicio", () => {
    expect(arbol.personaInicioGramps?.gramps_id).toBe("I1");
  });

  it("nombres", () => {
    const p1 = arbol.personas.get("p1")!;
    expect(arbol.nombre(p1)).toBe("José Pérez Núñez");
    expect(arbol.nombreOrden(p1)).toBe("Pérez Núñez, José");
    expect(arbol.nombre(arbol.personas.get("p3"))).toBe("[sin nombre]");
    expect(arbol.nombreFamilia(arbol.familias.get("f1")!)).toBe("José Pérez Núñez y María López");
  });

  it("el apodo, dentro del nombre, detrás del de pila (05/11/2026)", () => {
    const p1 = arbol.personas.get("p1")!;
    const n = p1.primary_name;
    n.nick = " Pepe ";
    try {
      expect(arbol.nombre(p1)).toBe("José “Pepe” Pérez Núñez");
      expect(arbol.nombreOrden(p1)).toBe("Pérez Núñez, José “Pepe”");
      expect(arbol.nombrePila(n)).toBe("José “Pepe”");
      expect(arbol.nombreFamilia(arbol.familias.get("f1")!)).toBe("José “Pepe” Pérez Núñez y María López");
      n.suffix = "Jr.";
      expect(arbol.nombre(p1)).toBe("José “Pepe” Pérez Núñez Jr.");
      expect(arbol.nombreOrden(p1)).toBe("Pérez Núñez, José “Pepe” Jr.");
      expect(arbol.nombrePila(n)).toBe("José “Pepe” Jr.");
      n.nick = "";
      expect(arbol.nombre(p1)).toBe("José Pérez Núñez Jr.");
      expect(arbol.nombreOrden(p1)).toBe("Pérez Núñez, José Jr.");
    } finally {
      n.nick = "";
      n.suffix = "";
    }
  });

  it("nacimiento y defunción, con sustitutos como en Gramps", () => {
    const p1 = arbol.personas.get("p1")!;
    expect(arbol.nacimiento(p1)).toMatchObject({ sustituto: false, evento: { gramps_id: "E1" } });
    expect(arbol.defuncion(p1)).toMatchObject({ sustituto: true, evento: { gramps_id: "E2" } });
    expect(arbol.nacimiento(arbol.personas.get("p2")!)).toMatchObject({ sustituto: true, evento: { gramps_id: "E3" } });
    expect(arbol.nacimiento(arbol.personas.get("p3")!)).toBeNull();
  });

  // Reglas de presentación (docs/decisiones-web-familiar.md, «Presentación»).
  describe("nacimiento y defunción en fichas y cajas", () => {
    const p = (h: string) => arbol.personas.get(h)!;
    const nac = (h: string) => arbol.lineaNacimiento(p(h));
    const def = (h: string) => arbol.lineaDefuncion(p(h));
    const ENTIERRO = nombreTipo(tipo("EventType", 19));
    const CREMACION = nombreTipo(tipo("EventType", 24));
    const BAUTISMO = nombreTipo(tipo("EventType", 15));

    it("fecha y lugar", () => {
      expect(nac("p1")).toMatchObject({ rotulo: "Nacimiento", texto: "1850, Cádiz, España", falta: false });
      expect(def("p4")).toMatchObject({ rotulo: "Defunción", texto: "1950, Cádiz, España", falta: false });
    });
    it("solo fecha", () => {
      expect(nac("p4")).toMatchObject({ rotulo: "Nacimiento", texto: "1900", falta: false });
    });
    it("solo lugar: «sin fecha, lugar»", () => {
      expect(def("p5")).toMatchObject({ rotulo: "Defunción", texto: "sin fecha, Cádiz, España", falta: false });
    });
    it("evento sin fecha ni lugar: «sin datos» (la defunción dice que ha fallecido)", () => {
      expect(nac("p5")).toMatchObject({ rotulo: "Nacimiento", texto: "sin datos", falta: true });
      expect(def("p6")).toMatchObject({ rotulo: "Defunción", texto: "sin datos", falta: true });
    });
    it("sin evento: nacimiento «sin datos» y defunción nada", () => {
      expect(nac("p3")).toMatchObject({ rotulo: "Nacimiento", texto: "sin datos", falta: true });
      expect(def("p3")).toBeNull();
    });
    it("sin defunción pero con entierro o incineración: ese evento, con su rótulo", () => {
      expect(def("p1")).toMatchObject({ rotulo: ENTIERRO, texto: "1920", falta: false });
      expect(def("p7")).toMatchObject({ rotulo: CREMACION, texto: "sin fecha, Cádiz, España", falta: false });
      expect(ENTIERRO).not.toBe("Defunción");
    });
    it("la causa de muerte no sustituye a la defunción", () => {
      expect(def("p8")).toBeNull();
    });
    it("sin evento, si no se considera viva (vivos.ts): «Defunción: sin datos», también en las cajas (29/10/2026)", () => {
      const vivas = new Set(["p3"]);
      expect(arbol.lineaDefuncion(p("p8"), "largo", vivas)).toMatchObject({ rotulo: "Defunción", texto: "sin datos", falta: true });
      expect(arbol.lineaDefuncion(p("p3"), "largo", vivas)).toBeNull();
      // Con evento, el suyo, aunque se considerara viva.
      expect(arbol.lineaDefuncion(p("p1"), "largo", new Set(["p1"]))).toMatchObject({ rotulo: ENTIERRO, texto: "1920" });
      expect(lineaCaja(arbol.lineaDefuncion(p("p8"), "corto", vivas), simbolosDe({ juego: "abreviaturas" }).defuncion, false).text).toBe("f. sin datos");
    });
    it("sin nacimiento pero con bautismo: el bautismo, con su rótulo (como Gramps)", () => {
      expect(nac("p2")).toMatchObject({ rotulo: BAUTISMO, texto: "1855", falta: false });
    });

    describe("líneas de las cajas: fecha corta y lugar, como en Gramps", () => {
      const abrev = simbolosDe({ juego: "abreviaturas" });
      // [texto, versión corta]
      const caja = (h: string) => [
        lineaCaja(arbol.lineaNacimiento(p(h), "corto"), abrev.nacimiento, !!arbol.nacimiento(p(h))?.sustituto),
        lineaCaja(arbol.lineaDefuncion(p(h), "corto"), abrev.defuncion, !!arbol.defuncion(p(h))?.sustituto),
      ].map((l) => [l.text, l.short]);
      it("con fecha (aquí, solo el año) y lugar", () => {
        expect(caja("p4")).toEqual([["n. 1900", ""], ["f. 1950, Cádiz, España", ""]]);
      });
      it("con fecha completa y lugar: si no cabe, se recorta el lugar y, si ni así, va el año", () => {
        const fecha = { modifier: 0, quality: 0, calendar: 0, dateval: [3, 5, 1950, false], text: "", sortval: 1, newyear: 0 };
        const dato = { rotulo: "Nacimiento", texto: "", falta: false, fecha: "03/05/1950", lugar: "Madrid", evento: { date: fecha } as never };
        expect(lineaCaja(dato, "n.", false)).toEqual({
          text: "n. 03/05/1950, Madrid", keep: 13, short: "n. 1950, Madrid", keepShort: 7, head: "n. 03/05/1950", place: "Madrid",
        });
      });
      it("solo lugar y sin nada", () => {
        expect(caja("p5")).toEqual([["n. sin datos", ""], ["f. sin fecha, Cádiz, España", ""]]);
        expect(caja("p6")[1]).toEqual(["f. sin datos", ""]);
      });
      it("sin evento: «n. sin datos» y la defunción vacía", () => {
        expect(caja("p3")).toEqual([["n. sin datos", ""], ["", ""]]);
        expect(caja("p8")[1]).toEqual(["", ""]);
      });
      it("sustitutos, con su rótulo en lugar del símbolo", () => {
        expect(caja("p1")[1]).toEqual([`${ENTIERRO}: 1920`, ""]);
        expect(caja("p2")[0]).toEqual([`${BAUTISMO}: 1855`, ""]);
        expect(caja("p7")[1]).toEqual([`${CREMACION}: sin fecha, Cádiz, España`, ""]);
      });
      it("con cada juego de símbolos", () => {
        const linea = (juego: "abreviaturas" | "asterisco" | "david") => lineaCaja(nac("p4"), simbolosDe({ juego }).nacimiento, false).text;
        expect(linea("abreviaturas")).toBe("n. 1900");
        expect(linea("asterisco")).toBe("* 1900");
        expect(lineaCaja(def("p4"), simbolosDe({ juego: "asterisco" }).defuncion, false).text).toBe("† 1950, Cádiz, España");
        expect(lineaCaja(def("p4"), simbolosDe({ juego: "david" }).defuncion, false).text).toBe("\u2721\uFE0E 1950, Cádiz, España");
        const propios = simbolosDe({ juego: "personalizado", nacimiento: "nac.", defuncion: "def." });
        expect(lineaCaja(def("p4"), propios.defuncion, false).text).toBe("def. 1950, Cádiz, España");
      });
    });
  });

  it("relaciones", () => {
    const f1 = arbol.familias.get("f1")!;
    const p1 = arbol.personas.get("p1")!;
    expect(arbol.conyuge(f1, p1)?.gramps_id).toBe("I2");
    expect(arbol.hijos(f1).map((h) => h.persona.gramps_id)).toEqual(["I3"]);
    expect(arbol.familiasPadres(arbol.personas.get("p3")!).map((f) => f.gramps_id)).toEqual(["F1"]);
    // Guardados: propios y después los de la familia. Al mostrarlos,
    // mezclados por fecha, y los que no tienen (E4, la boda), al final.
    expect(arbol.eventosPersonaGuardados(p1).map((e) => e.evento.gramps_id)).toEqual(["E1", "E2", "E4"]);
    expect(arbol.eventosPersona(p1).map((e) => e.evento.gramps_id)).toEqual(["E1", "E2", "E4"]);
    const o = INSTANTANEA.objetos as unknown as { Event: ReturnType<typeof evento>[] };
    const conBoda = new Arbol({ ...INSTANTANEA, objetos: { ...INSTANTANEA.objetos, Event: o.Event.map((e) => (e.handle === "e4" ? evento("e4", "E4", 1, 1880) : e)) } } as unknown as Instantanea);
    expect(conBoda.eventosPersona(conBoda.personas.get("p1")!).map((e) => e.evento.gramps_id)).toEqual(["E1", "E4", "E2"]);
  });

  it("lugares con su jerarquía", () => {
    expect(arbol.tituloLugar("l2")).toBe("Cádiz, España");
    expect(arbol.tituloLugar("")).toBe("");
  });

  it("descripción de una foto: vacía si es una ruta o el nombre del fichero (30/10/2026)", () => {
    const d = (desc: string, path = "Fotos/50003.jpg") => descripcionFoto({ desc, path });
    expect(d("C:/Users/alguien/Fotos/50003.jpg")).toBe("");
    expect(d("C:\\Users\\alguien\\boda")).toBe("");
    expect(d("retrato.JPG")).toBe("");
    expect(d("foto.png")).toBe("");
    expect(d("50003")).toBe("");
    expect(d("50003.jpg")).toBe("");
    expect(d("  Boda en Madrid ")).toBe("Boda en Madrid");
    expect(d("Boda 1950", "C:/Users/alguien/boda.jpg")).toBe("Boda 1950");
    expect(d("")).toBe("");
    // La búsqueda no las encuentra por la ruta ni por esa descripción.
    const conFotos = new Arbol({
      ...INSTANTANEA,
      objetos: {
        ...INSTANTANEA.objetos,
        Media: [
          { ...base("m1", "O1"), path: "C:/Users/alguien/Fotos/abuela.jpg", desc: "C:/Users/alguien/Fotos/abuela.jpg", mime: "image/jpeg", date: SIN_FECHA },
          { ...base("m2", "O2"), path: "Fotos/abuela2.jpg", desc: "La abuela en Cádiz", mime: "image/jpeg", date: SIN_FECHA },
        ],
      },
    } as unknown as Instantanea);
    const encontradas = (q: string) => conFotos.buscar(q, ["Media"], 10).get("Media")?.objetos.map((o) => o.gramps_id) ?? [];
    expect(encontradas("alguien")).toEqual([]);
    expect(encontradas("abuela")).toEqual(["O2"]);
  });

  it("referencias inversas", () => {
    expect(arbol.participantes(arbol.eventos.get("e4")!).map((r) => r.objeto.gramps_id)).toEqual(["F1"]);
    expect(arbol.referentes("l1").map((r) => r.objeto.gramps_id)).toEqual(["P2"]);
  });

  it("búsqueda sin mayúsculas ni acentos, con todas las palabras", () => {
    const r = arbol.buscar("jose NUNEZ", ["Person", "Place"], 10);
    expect(r.get("Person")?.objetos.map((o) => o.gramps_id)).toEqual(["I1"]);
    expect(r.has("Place")).toBe(false);
    expect(arbol.buscar("cadiz", ["Place", "Event"], 10).get("Place")?.total).toBe(1);
    // Los eventos en Cádiz: el lugar forma parte de su texto.
    expect(arbol.buscar("cadiz", ["Event"], 10).get("Event")?.objetos.map((o) => o.gramps_id)).toEqual(["E1", "E5", "E7", "E10"]);
    expect(arbol.buscar("jose garcia", ["Person"], 10).size).toBe(0);
    expect(arbol.buscar("   ", ["Person"], 10).size).toBe(0);
  });

  it("búsqueda por ID: solo para el administrador (conIds)", () => {
    expect(arbol.buscar("i1", ["Person"], 10).size).toBe(0);
    expect(arbol.buscar("i1", ["Person"], 10, true).get("Person")?.objetos.map((o) => o.gramps_id)).toContain("I1");
    expect(arbol.buscar("jose i1", ["Person"], 10, true).get("Person")?.objetos.map((o) => o.gramps_id)).toEqual(["I1"]);
  });
});
