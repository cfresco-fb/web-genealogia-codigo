// Reparto del árbol en páginas del PDF, con árboles inventados generados
// por programa: una ascendencia completa de 8 generaciones, un antepasado
// repetido y una familia de 30 hijos. Las pruebas de siempre, con la
// disposición horizontal; las de la vertical, al final.

import { beforeAll, describe, expect, it } from "vitest";
import { measureTreeChart, treeChartShapes, type TreeNode } from "../gramps-connect/graficos/charts/treeChart";
import { Arbol } from "./arbol";
import { prepararFechas } from "./fechas";
import { construirGrafico } from "./grafico";
import {
  avisoPapel, CABECERA_PRIMERA_MM, CABECERA_PRIMERA_SIN_SUBTITULO_MM, componer, conUnaPagina, dondeCabeUnaPagina, modoAlCambiarPapel, PAPELES,
  PAPELES_UNA_PAGINA_Y_ROLLO, ESCALA_MAXIMA, ESPACIO_COMPLETO,
  MARGEN_MM, PIE_MM, type Espacio, geometria, letraMinima, LETRA_MINIMA_PT, LETRA_MINIMA_UNA_PAGINA_PT, LETRAS_UNA_PAGINA_PT,
  planificarMosaico, planificarPaginas, planificarUnaPagina, rangoDonde, ROLLO, ROLLO_ANCHO_MM, ROLLO_LARGO_MAXIMO_MM, textosPlan, type Bloque, type Plan,
} from "./paginasPdf";
import { simbolosDe } from "./simbolos";
import type { Instantanea } from "./tipos";

const tipo = (_class: string, value: number) => ({ _class, value, string: "" });
const base = (handle: string) => ({ handle, gramps_id: handle, change: 0, private: false, note_list: [] });
const NACIMIENTO = tipo("ChildRefType", 1);
const personas: object[] = [];
const familias: object[] = [];
function persona(h: string, gender: number, padres: string[] = [], propias: string[] = []) {
  personas.push({
    ...base(h), gender, alternate_names: [], media_list: [], family_list: propias, parent_family_list: padres,
    event_ref_list: [], birth_ref_index: -1, death_ref_index: -1,
    primary_name: { first_name: h, suffix: "", title: "", call: "", nick: "", type: tipo("NameType", 2), surname_list: [{ surname: "Prueba", prefix: "", primary: true, connector: "" }] },
  });
}
function familia(h: string, padre: string | null, madre: string | null, hijos: string[]) {
  familias.push({
    ...base(h), father_handle: padre, mother_handle: madre, type: tipo("FamilyRelType", 0), media_list: [], event_ref_list: [],
    child_ref_list: hijos.map((ref) => ({ ref, frel: NACIMIENTO, mrel: NACIMIENTO })),
  });
}

// Ascendencia completa: «r» y, por cada persona «x» de menos de 8
// generaciones, padre «x0» y madre «x1».
const GENERACIONES = 8;
function ascendencia(h: string, nivel: number, propias: string[]) {
  const tienePadres = nivel < GENERACIONES - 1;
  persona(h, h.endsWith("1") ? 0 : 1, tienePadres ? [`f${h}`] : [], propias);
  if (!tienePadres) return;
  familia(`f${h}`, `${h}0`, `${h}1`, [h]);
  ascendencia(`${h}0`, nivel + 1, [`f${h}`]);
  ascendencia(`${h}1`, nivel + 1, [`f${h}`]);
}
ascendencia("r", 0, []);
// Un antepasado repetido: q es hija de a y b, medio hermanos, los dos hijos
// de c (con madres distintas). c, abuelo de q por los dos lados, tiene una
// ascendencia completa hasta la octava generación de q.
persona("q", 0, ["fq"]);
familia("fq", "a", "b", ["q"]);
persona("a", 1, ["fa"], ["fq"]);
persona("b", 0, ["fb"], ["fq"]);
familia("fa", "c", "ma", ["a"]);
familia("fb", "c", "mb", ["b"]);
persona("ma", 0, [], ["fa"]);
persona("mb", 0, [], ["fb"]);
ascendencia("c", 2, ["fa", "fb"]);
// Una familia de 30 hijos.
const hijos = Array.from({ length: 30 }, (_, i) => `h${i}`);
persona("m", 1, [], ["fm"]);
familia("fm", "m", null, hijos);
for (const h of hijos) persona(h, 0, ["fm"]);
// Dos matrimonios, con un hijo cada uno.
persona("pablo", 1, [], ["fp1", "fp2"]);
persona("px", 0, [], ["fp1"]);
persona("pw", 0, [], ["fp2"]);
familia("fp1", "pablo", "px", ["pc1"]);
familia("fp2", "pablo", "pw", ["pc3"]);
persona("pc1", 0, ["fp1"]);
persona("pc3", 0, ["fp2"]);
// Una pareja con el cónyuge desconocido, con un hijo.
persona("ana", 0, [], ["fa1"]);
familia("fa1", null, "ana", ["ac1"]);
persona("ac1", 1, ["fa1"]);
// Tres matrimonios, con un hijo cada uno.
persona("tres", 1, [], ["ft1", "ft2", "ft3"]);
for (const i of [1, 2, 3]) {
  persona(`tx${i}`, 0, [], [`ft${i}`]);
  familia(`ft${i}`, "tres", `tx${i}`, [`tc${i}`]);
  persona(`tc${i}`, 0, [`ft${i}`]);
}

const INSTANTANEA = {
  version_instantanea: 1, generada: "2026-10-22T00:00:00Z", version_gramps: "6.0.5", persona_inicio: "r",
  objetos: { Person: personas, Family: familias, Event: [], Place: [] },
} as unknown as Instantanea;

let arbol: Arbol;
beforeAll(async () => {
  await prepararFechas();
  arbol = new Arbol(INSTANTANEA);
});

const ABREV = simbolosDe({ juego: "abreviaturas" });
const plan = (
  h: string, tipo: "ascendientes" | "descendientes" | "ambos", generaciones: number,
  papel: "A4" | "A3" = "A4", orientacion: "auto" | "portrait" | "landscape" = "auto",
  disposicion: "vertical" | "horizontal" = "horizontal",
) =>
  planificarPaginas({
    arbol, persona: arbol.persona(h)!, tipo, generaciones, simbolos: ABREV, papel, orientacion, disposicion,
    continua: (n) => `continúa en la pág. ${n}`,
  });
const cajas = (n: TreeNode | null): TreeNode[] => (n ? [n, ...(n.children ?? []).flatMap(cajas)] : []);
const personasDe = (b: Bloque) => [...cajas(b.datos.ascendientes), ...cajas(b.datos.descendientes)].filter((n) => n.person);
const bloquesDe = (p: Plan) => p.paginas.flatMap((x) => x.bloques.map((b) => ({ pagina: x.numero, b })));
/** La página de «continúa en la pág. N» o, con «continúa en esta página», la
 * misma. */
const paginaDestino = (texto: string, pagina: number) => (texto === "continúa en esta página" ? pagina : Number(texto.match(/\d+$/)![0]));

describe("PDF en páginas de continuación", () => {
  it("si cabe, una sola página, sin «continúa»", () => {
    const p = plan("r", "ascendientes", 3);
    expect(p.paginas).toHaveLength(1);
    expect(p.paginas[0].bloques).toHaveLength(1);
    expect(p.paginas[0].bloques[0].generaciones).toBe(3);
    expect(p.paginas[0].composicion.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
    expect(personasDe(p.paginas[0].bloques[0]).some((n) => n.person!.continuation)).toBe(false);
  });

  it("8 generaciones en A4: todo a 8 puntos o más, y cada rama sigue donde dice", () => {
    const p = plan("r", "ascendientes", GENERACIONES);
    expect(p.paginas.length).toBeGreaterThan(1);
    expect(p.paginas.map((x) => x.numero)).toEqual(p.paginas.map((_, i) => i + 1));
    for (const x of p.paginas) expect(x.composicion.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
    // Cada «continúa en la pág. N» lleva a una página con un bloque centrado
    // en esa persona, que dice venir de esta.
    for (const { pagina, b } of bloquesDe(p)) {
      for (const n of personasDe(b).filter((x) => x.person!.continuation)) {
        const destino = paginaDestino(n.person!.continuation!, pagina);
        const alli = p.paginas[destino - 1].bloques.find((x) => x.persona.handle === n.person!.handle);
        expect(alli).toBeDefined();
        expect(alli!.tipo).toBe("ascendientes");
        expect(alli!.vieneDe).toBe(pagina);
      }
    }
    // Entre todos, las 2^7 personas de la última generación (handles de 8
    // letras) y ninguna de más; y ninguna de ellas lleva «continúa».
    const ultimas = new Set(bloquesDe(p).flatMap(({ b }) => personasDe(b).map((n) => n.person!.handle)).filter((h) => h.length === GENERACIONES));
    expect(ultimas.size).toBe(2 ** (GENERACIONES - 1));
    for (const { b } of bloquesDe(p)) {
      expect(personasDe(b).filter((n) => n.person!.handle.length === GENERACIONES && n.person!.continuation)).toHaveLength(0);
    }
  });

  it("las ramas pequeñas comparten página (también la primera, desde el 27/10/2026)", () => {
    const p = plan("r", "ascendientes", GENERACIONES);
    const bloques = bloquesDe(p).length;
    expect(p.paginas.length).toBeLessThan(bloques);
    expect(p.paginas[0].bloques[0].id).toBe(0);
    for (const x of p.paginas) expect(x.composicion.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
    expect(p.paginas.some((x) => x.bloques.length > 1)).toBe(true);
    // Antes de agrupar eran 85 páginas.
    expect(p.paginas.length).toBeLessThan(85);
  });

  it("una sola orientación; con automática, la que da menos páginas", () => {
    const auto = plan("r", "ascendientes", GENERACIONES);
    const vertical = plan("r", "ascendientes", GENERACIONES, "A4", "portrait");
    const horizontal = plan("r", "ascendientes", GENERACIONES, "A4", "landscape");
    expect(vertical.orientacion).toBe("portrait");
    expect(horizontal.orientacion).toBe("landscape");
    // En vertical, la primera página no llega a la letra mínima (el óvalo de
    // los padres y «continúa en la pág.» no caben a lo ancho): se prefiere la
    // que sí llega, aunque dé más páginas.
    expect(letraMinima(vertical)!.pt).toBeLessThan(LETRA_MINIMA_PT);
    expect(letraMinima(horizontal)!.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
    expect(auto.orientacion).toBe("landscape");
    expect(auto.paginas.length).toBe(horizontal.paginas.length);
    // Si llegan las dos, la que da menos páginas.
    const m = plan("q", "ascendientes", GENERACIONES);
    const mV = plan("q", "ascendientes", GENERACIONES, "A4", "portrait");
    const mH = plan("q", "ascendientes", GENERACIONES, "A4", "landscape");
    if (letraMinima(mV)!.pt >= LETRA_MINIMA_PT && letraMinima(mH)!.pt >= LETRA_MINIMA_PT) {
      expect(m.paginas.length).toBe(Math.min(mV.paginas.length, mH.paginas.length));
    }
  });

  it("con automática, si alguna orientación deja todo a 8 puntos, se usa una de esas", () => {
    for (const [h, tipo, g] of [["r", "ascendientes", 8], ["q", "ascendientes", 8], ["m", "descendientes", 2], ["m", "descendientes", 3]] as const) {
      for (const papel of ["A4", "A3"] as const) {
        const fijas = (["portrait", "landscape"] as const).map((o) => plan(h, tipo, g, papel, o));
        if (fijas.some((f) => letraMinima(f)!.pt >= LETRA_MINIMA_PT)) {
          expect(letraMinima(plan(h, tipo, g, papel))!.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
        }
      }
    }
  });

  it("en A3 caben más generaciones por página, y hacen falta menos páginas", () => {
    const a4 = plan("r", "ascendientes", GENERACIONES, "A4", "landscape");
    const a3 = plan("r", "ascendientes", GENERACIONES, "A3", "landscape");
    expect(a3.paginas[0].bloques[0].generaciones).toBeGreaterThan(a4.paginas[0].bloques[0].generaciones);
    expect(a3.paginas.length).toBeLessThan(a4.paginas.length);
  });

  it("el óvalo de los padres, solo en el bloque de la persona principal (05/11/2026)", () => {
    const p = plan("r", "ascendientes", GENERACIONES);
    const conOvalo = bloquesDe(p).filter(({ b }) => b.datos.ascendientes!.children?.[0]?.family);
    expect(conOvalo.map(({ b }) => b.persona.handle)).toEqual(["r"]);
    expect(bloquesDe(p).length).toBeGreaterThan(1);
  });

  it("una rama que llega por dos caminos es un solo bloque", () => {
    const p = plan("q", "ascendientes", GENERACIONES);
    // c (o sus antepasados, según cuántas generaciones quepan) llega al
    // borde por a y por b: todas sus marcas «continúa» llevan a la misma
    // página.
    const marcas = new Map<string, string[]>();
    for (const { b } of bloquesDe(p)) {
      for (const n of personasDe(b).filter((x) => x.person!.continuation)) {
        marcas.set(n.person!.handle, [...(marcas.get(n.person!.handle) ?? []), n.person!.continuation!]);
      }
    }
    const dobles = [...marcas.values()].filter((m) => m.length >= 2);
    expect(dobles.length).toBeGreaterThanOrEqual(1);
    for (const m of dobles) expect(new Set(m).size).toBe(1);
    const ramas = bloquesDe(p).map(({ b }) => `${b.tipo}:${b.persona.handle}`);
    expect(new Set(ramas).size).toBe(ramas.length);
    expect(bloquesDe(p).some(({ b }) => personasDe(b).some((n) => n.person!.handle === "c00000"))).toBe(true);
  });

  it("«Ambos» que no cabe ni con dos generaciones: ascendientes en la pág. 1 y descendientes en la 2", () => {
    // c tiene ascendencia completa y descendientes (a, b y q): con las dos
    // mitades y sus marcas «continúa», en A4 no cabe a lo ancho; cada mitad
    // por separado, en horizontal, sí.
    const p = plan("c", "ambos", GENERACIONES, "A4", "landscape");
    const [uno, dos] = p.paginas;
    expect(uno.bloques).toHaveLength(1);
    expect(uno.bloques[0]).toMatchObject({ tipo: "ascendientes", persona: { handle: "c" } });
    expect(dos.bloques).toHaveLength(1);
    expect(dos.bloques[0]).toMatchObject({ tipo: "descendientes", persona: { handle: "c" }, mitad: true, vieneDe: null });
    expect(p.descendientesEn).toBe(2);
    for (const x of p.paginas) expect(x.composicion.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
    // Cuando sí cabe (A3 horizontal), no se parte.
    const a3 = plan("c", "ambos", 3, "A3", "landscape");
    expect(a3.paginas[0].bloques[0].tipo).toBe("ambos");
    expect(a3.descendientesEn).toBeNull();
  });

  it("los tramos de hijos van seguidos, y no se parte si no cabe a lo ancho", () => {
    const p = plan("m", "descendientes", 3);
    const paginas = bloquesDe(p).filter(({ b }) => b.persona.handle === "m").map(({ pagina }) => pagina);
    expect(paginas.length).toBeGreaterThan(1);
    expect(paginas).toEqual(paginas.map((_, i) => paginas[0] + i));
    // c en A4 vertical: sus descendientes no caben a lo ancho ni con un hijo;
    // no se parten en tramos que tampoco cabrían.
    const v = plan("c", "ambos", GENERACIONES, "A4", "portrait");
    expect(bloquesDe(v).filter(({ b }) => b.hijos)).toHaveLength(0);
  });

  it("30 hijos: se reparten en tramos que caben, cada hijo una vez, enlazados", () => {
    const p = plan("m", "descendientes", 2);
    const tramos = bloquesDe(p).filter(({ b }) => b.persona.handle === "m");
    expect(tramos.length).toBeGreaterThan(1);
    for (const x of p.paginas) expect(x.composicion.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
    // Tramos seguidos del 1 al 30.
    let esperado = 1;
    for (const [i, { b }] of tramos.entries()) {
      expect(b.hijos!.desde).toBe(esperado);
      expect(b.hijos!.total).toBe(30);
      esperado = b.hijos!.hasta + 1;
      // «más hijos en la pág. N»: el tramo siguiente está en esa página.
      if (i + 1 < tramos.length) expect(b.hijos!.siguenEn).toBe(tramos[i + 1].pagina);
      else expect(b.hijos!.siguenEn).toBeNull();
    }
    expect(esperado).toBe(31);
    const hijos = tramos.flatMap(({ b }) => personasDe(b).map((n) => n.person!.handle)).filter((h) => h !== "m");
    expect(hijos.sort()).toEqual(Array.from({ length: 30 }, (_, i) => `h${i}`).sort());
    expect(letraMinima(p)!.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
  });
});

describe("disposición vertical", () => {
  it("medidas: en vertical las generaciones se apilan; en horizontal, en columnas", () => {
    const g = construirGrafico(arbol, arbol.persona("r")!, "ascendientes", 3, ABREV);
    // 4 cajas de 190 × 84 en la última generación (sin fotos, sin su hueco;
    // en horizontal, de 230 × 90); 16 entre cajas vecinas y 40 entre
    // generaciones (vertical); 5 y 60 en horizontal. Más 4 a la izquierda: la
    // franja del sexo.
    // Entre la persona central y sus padres, la fila de su óvalo (46 de alto
    // en vertical, 170 de ancho en horizontal; 05/11/2026).
    expect(measureTreeChart(g.ascendientes, null, "vertical")).toMatchObject({ width: 4 * 190 + 3 * 16 + 4, height: 3 * 84 + 46 + 3 * 40 });
    expect(measureTreeChart(g.ascendientes, null, "horizontal")).toMatchObject({ width: 3 * 230 + 170 + 3 * 60 + 4, height: 4 * 90 + 3 * 5 });
    // La esquina: la persona central, en (0, 0), abajo en el centro.
    expect(measureTreeChart(g.ascendientes, null, "vertical")).toMatchObject({ x0: -(4 * 190 + 3 * 16) / 2 - 4, y0: -(2 * 84 + 46 + 3 * 40 + 42) });
    // «Ambos»: los descendientes, debajo (óvalos de la boda de 46 de alto).
    const a = construirGrafico(arbol, arbol.persona("m")!, "ambos", 2, ABREV);
    expect(measureTreeChart(a.ascendientes, a.descendientes, "vertical").height).toBe(84 + 40 + 46 + 40 + 84);
  });

  it("hueco de la foto: solo en las filas en las que alguna caja tiene foto", () => {
    const g = construirGrafico(arbol, arbol.persona("r")!, "ascendientes", 3, ABREV);
    // Una foto en la fila de los padres: sus dos cajas, de 146 de alto; las
    // demás filas, sin fotos, de 84.
    const asc = structuredClone(g.ascendientes!);
    asc.children![0].children![0].person!.photo = { handle: "foto", rect: null };
    expect(measureTreeChart(asc, null, "vertical").height).toBe(84 + 146 + 46 + 84 + 3 * 40);
    const altos = (t: TreeNode | null, d: TreeNode | null) => {
      const filas = new Map<number, Set<number>>();
      for (const r of treeChartShapes(t, d, "vertical", false).rects) {
        const y = (r.y0 + r.y1) / 2;
        filas.set(y, (filas.get(y) ?? new Set()).add(r.y1 - r.y0));
      }
      return filas;
    };
    const filas = altos(asc, null);
    expect([...filas.values()].map((x) => [...x])).toEqual([[84], [146], [84], [46]]);
    // La foto de un cónyuge cuenta en la fila de la persona; la fila de la
    // persona central, en las dos mitades.
    const p = construirGrafico(arbol, arbol.persona("pablo")!, "descendientes", 2, ABREV);
    const desc = structuredClone(p.descendientes!);
    desc.children![1].family!.spouse!.photo = { handle: "foto", rect: null };
    expect([...altos(g.ascendientes, desc).get(0)!]).toEqual([146]);
    expect(measureTreeChart(g.ascendientes, desc, "vertical").height).toBe(2 * 84 + 146 + 2 * 46 + 84 + 5 * 40);
  });

  /** Centros, a lo ancho, de las cajas de la fila de la persona, de los
   * óvalos y de las cajas de los hijos. */
  const parejas = (h: string) => {
    const g = construirGrafico(arbol, arbol.persona(h)!, "descendientes", 2, ABREV);
    const { rects } = treeChartShapes(null, g.descendientes, "vertical", false);
    const centro = (r: { x0: number; x1: number }) => (r.x0 + 4 + r.x1) / 2;
    const orden = (xs: number[]) => xs.sort((m, n) => m - n);
    const cajas = rects.filter((r) => r.y1 - r.y0 === 84);
    return {
      fila: orden(cajas.filter((r) => r.y0 < 0).map(centro)),
      ovalos: orden(rects.filter((r) => r.y1 - r.y0 !== 84).map((r) => (r.x0 + r.x1) / 2)),
      hijos: orden(cajas.filter((r) => r.y0 > 0).map(centro)),
    };
  };

  it("parejas: un cónyuge a cada lado, cada óvalo entre la persona y su cónyuge, y los hijos debajo", () => {
    // pablo en 0; px (primer matrimonio) a su izquierda y pw a su derecha;
    // los óvalos, entre ellos, y pc1 y pc3, cada uno bajo el suyo.
    const g = construirGrafico(arbol, arbol.persona("pablo")!, "descendientes", 2, ABREV);
    expect(measureTreeChart(null, g.descendientes, "vertical")).toMatchObject({ width: 3 * 190 + 2 * 16 + 4, x0: -206 - 95 - 4 });
    expect(parejas("pablo")).toEqual({ fila: [-206, 0, 206], ovalos: [-103, 103], hijos: [-103, 103] });
  });

  it("parejas: con tres matrimonios, el primero a la izquierda y los otros dos a la derecha", () => {
    expect(parejas("tres")).toEqual({ fila: [-206, 0, 206, 412], ovalos: [-103, 103, 309], hijos: [-103, 103, 309] });
  });

  it("parejas: el cónyuge desconocido tiene su caja, con el óvalo entre los dos", () => {
    expect(parejas("ana")).toEqual({ fila: [0, 206], ovalos: [103], hijos: [103] });
  });

  it("8 generaciones en A4: todo a 8 puntos o más, cada rama sigue donde dice y nadie falta", () => {
    const p = plan("r", "ascendientes", GENERACIONES, "A4", "auto", "vertical");
    expect(p.paginas.length).toBeGreaterThan(1);
    for (const x of p.paginas) expect(x.composicion.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
    for (const { pagina, b } of bloquesDe(p)) {
      for (const n of personasDe(b).filter((x) => x.person!.continuation)) {
        const destino = paginaDestino(n.person!.continuation!, pagina);
        const alli = p.paginas[destino - 1].bloques.find((x) => x.persona.handle === n.person!.handle);
        expect(alli?.vieneDe).toBe(pagina);
      }
    }
    const ultimas = new Set(bloquesDe(p).flatMap(({ b }) => personasDe(b).map((n) => n.person!.handle)).filter((h) => h.length === GENERACIONES));
    expect(ultimas.size).toBe(2 ** (GENERACIONES - 1));
  });

  it("30 hijos (a lo ancho, en vertical): tramos que caben, cada hijo una vez", () => {
    const p = plan("m", "descendientes", 2, "A4", "auto", "vertical");
    const tramos = bloquesDe(p).filter(({ b }) => b.persona.handle === "m");
    expect(tramos.length).toBeGreaterThan(1);
    expect(letraMinima(p)!.pt).toBeGreaterThanOrEqual(LETRA_MINIMA_PT);
    const hijos = tramos.flatMap(({ b }) => personasDe(b).map((n) => n.person!.handle)).filter((h) => h !== "m");
    expect(hijos.sort()).toEqual(Array.from({ length: 30 }, (_, i) => `h${i}`).sort());
  });

  it("tramos repartidos por igual y sin referencias a la misma página", () => {
    const p = plan("m", "descendientes", 2, "A4", "auto", "vertical");
    const tramos = bloquesDe(p).filter(({ b }) => b.persona.handle === "m");
    const tamanos = tramos.map(({ b }) => b.hijos!.hasta - b.hijos!.desde + 1);
    expect(Math.max(...tamanos) - Math.min(...tamanos)).toBeLessThanOrEqual(1);
    const textos = textosPlan(arbol, p, arbol.persona("m")!, "descendientes", "");
    textos.forEach((x, i) => {
      for (const t of [x.subtitulo, ...x.bloques]) expect(t).not.toContain(`pág. ${i + 1}`);
    });
    // Un tramo que sigue al anterior en la misma página: sin repetir el título.
    for (const [i, pagina] of p.paginas.entries()) {
      pagina.bloques.forEach((b, j) => {
        if (j > 0 && pagina.bloques[j - 1].persona === b.persona) expect(textos[i].bloques[j]).toMatch(/^Hijos? \d/);
      });
    }
  });
});

describe("PDF en mosaico", () => {
  /** Un árbol de mentira: su tamaño y lo que lleva dibujado. */
  const lleno = (width: number, height: number) => ({
    tamano: { width, height, x0: 0, y0: 0 },
    formas: { rects: [{ x0: 0, y0: 0, x1: width, y1: height }], points: [] as [number, number][] },
  });

  it("el árbol entero a la letra mínima, en filas y columnas de hojas", () => {
    const g = lleno(3000, 12000);
    const m = planificarMosaico(g, "A4", "auto");
    expect(m.filas * m.columnas).toBeGreaterThan(1);
    expect(m.hojas).toHaveLength(m.filas * m.columnas);
    // Automática: no peor que ninguna de las dos fijas.
    for (const o of ["portrait", "landscape"] as const) {
      const fija = planificarMosaico(g, "A4", o);
      expect(m.hojas.length).toBeLessThanOrEqual(fija.hojas.length);
    }
  });

  it("sin las hojas en blanco: solo las que llevan una caja o un trozo de línea", () => {
    // Dos cajas en esquinas opuestas y una línea horizontal por la mitad.
    const g = {
      tamano: { width: 4000, height: 4000, x0: 0, y0: 0 },
      formas: {
        rects: [{ x0: 10, y0: 10, x1: 200, y1: 100 }, { x0: 3800, y0: 3800, x1: 3990, y1: 3890 }],
        points: Array.from({ length: 41 }, (_, i) => [i * 100, 2000] as [number, number]),
      },
    };
    const m = planificarMosaico(g, "A4", "portrait");
    const enBlanco = m.filas * m.columnas - m.hojas.length;
    expect(enBlanco).toBeGreaterThan(0);
    const hay = (fila: number, columna: number) => m.hojas.some((h) => h.fila === fila && h.columna === columna);
    expect(hay(0, 0)).toBe(true);
    expect(hay(m.filas - 1, m.columnas - 1)).toBe(true);
    // La fila de la línea, entera; la esquina de arriba a la derecha, no.
    const filaLinea = m.hojas.find((h) => h.columna === 1 && h.fila > 0 && h.fila < m.filas - 1)!.fila;
    expect(m.hojas.filter((h) => h.fila === filaLinea)).toHaveLength(m.columnas);
    expect(hay(0, m.columnas - 1)).toBe(false);
  });

  it("un árbol de verdad en vertical tiene esquinas en blanco", () => {
    const datos = construirGrafico(arbol, arbol.persona("r")!, "ascendientes", GENERACIONES, ABREV);
    const m = planificarMosaico(geometria(datos, "vertical"), "A4", "landscape");
    // Cada generación ocupa la mitad de ancho que la de encima: abajo, a
    // los lados, no hay nada.
    expect(m.hojas.length).toBeLessThan(m.filas * m.columnas);
    expect(m.hojas.some((h) => h.fila === m.filas - 1 && h.columna === 0)).toBe(false);
  });

  it("las cajas no salen más grandes que en la pantalla", () => {
    const pequeno = componer([{ width: 100, height: 100 }], false, "A3", "portrait");
    expect(pequeno.escala).toBe(ESCALA_MAXIMA);
  });

  it("avisos del papel", () => {
    expect(avisoPapel("A5")).toBe("pequeno");
    expect(avisoPapel("A4")).toBeNull();
    expect(avisoPapel("Letter")).toBeNull();
    expect(avisoPapel("A2")).toBe("grande");
    expect(avisoPapel("A0")).toBe("grande");
    expect(avisoPapel("ANSI D")).toBe("grande");
    expect(avisoPapel("A3")).toBeNull();
  });

  it("componer: sin subtítulo o sin pie, su alto es para el árbol (decisión del 02/11/2026)", () => {
    // Un árbol muy alto: la escala la decide el alto útil.
    const alto = { width: 100, height: 3000 };
    const util = (e: Espacio) => componer([alto], false, "A4", "portrait", e).escala * (3000 + 32);
    expect(util({ subtitulo: true, pie: true })).toBeCloseTo(297 - 2 * MARGEN_MM - CABECERA_PRIMERA_MM - PIE_MM, 6);
    expect(componer([alto], false, "A4", "portrait").escala).toBe(componer([alto], false, "A4", "portrait", ESPACIO_COMPLETO).escala);
    expect(util({ subtitulo: false, pie: true })).toBeCloseTo(297 - 2 * MARGEN_MM - CABECERA_PRIMERA_SIN_SUBTITULO_MM - PIE_MM, 6);
    expect(util({ subtitulo: true, pie: false })).toBeCloseTo(297 - 2 * MARGEN_MM - CABECERA_PRIMERA_MM, 6);
    expect(util({ subtitulo: false, pie: false })).toBeCloseTo(297 - 2 * MARGEN_MM - CABECERA_PRIMERA_SIN_SUBTITULO_MM, 6);
    // Sin subtítulo, el árbol empieza más arriba.
    const sin = componer([alto], false, "A4", "portrait", { subtitulo: false, pie: false });
    expect(sin.posiciones[0].y).toBeCloseTo(MARGEN_MM + CABECERA_PRIMERA_SIN_SUBTITULO_MM, 6);
    // En las de continuación, el subtítulo no cuenta (la cabecera es la línea
    // del título); el pie, sí.
    const cont = (e: Espacio) => componer([alto], true, "A4", "portrait", e).escala;
    expect(cont({ subtitulo: false, pie: true })).toBe(cont(ESPACIO_COMPLETO));
    expect(cont({ subtitulo: true, pie: false })).toBeGreaterThan(cont(ESPACIO_COMPLETO));
  });

  it("componer: la letra crece con el papel, y varios bloques comparten escala", () => {
    const t = { width: 1500, height: 1500 };
    expect(componer([t], false, "A3", "portrait").pt).toBeGreaterThan(componer([t], false, "A4", "portrait").pt);
    const dos = componer([t, { width: 800, height: 300 }], true, "A4", "portrait");
    expect(dos.posiciones).toHaveLength(2);
    expect(dos.posiciones[1].y).toBeGreaterThan(dos.posiciones[0].y + dos.posiciones[0].alto);
    expect(dos.posiciones.every((x) => x.cabeceraY !== null)).toBe(true);
  });
});

describe("PDF en una sola página (decisión del 25/10/2026)", () => {
  const una = (h: string, tipo: "ascendientes" | "descendientes" | "ambos", g: number, papel: "A3" | "A2" | "A1" | "A0", minimo?: number) => {
    const datos = construirGrafico(arbol, arbol.persona(h)!, tipo, g, ABREV);
    return { datos, ...planificarUnaPagina(datos, arbol.persona(h)!, tipo, g, "horizontal", papel, "auto", minimo) };
  };

  it("el árbol entero en una página, sin «continúa», con la orientación que da la letra más grande", () => {
    const r = una("r", "ascendientes", 8, "A2");
    expect(r.plan.paginas).toHaveLength(1);
    expect(r.plan.paginas[0].bloques[0].generaciones).toBe(8);
    expect(personasDe(r.plan.paginas[0].bloques[0]).some((n) => n.person!.continuation)).toBe(false);
    const otra = r.plan.orientacion === "portrait" ? "landscape" : "portrait";
    const pt = r.plan.paginas[0].composicion.pt;
    const datos = construirGrafico(arbol, arbol.persona("r")!, "ascendientes", 8, ABREV);
    expect(planificarUnaPagina(datos, arbol.persona("r")!, "ascendientes", 8, "horizontal", "A2", otra).plan.paginas[0].composicion.pt).toBeLessThanOrEqual(pt);
  });

  it("cabe si llega a la letra mínima de este modo (más baja que la de 8 puntos)", () => {
    expect(LETRA_MINIMA_UNA_PAGINA_PT).toBeLessThan(LETRA_MINIMA_PT);
    const r = una("r", "ascendientes", 8, "A0");
    expect(r.cabe).toBe(r.plan.paginas[0].composicion.pt >= LETRA_MINIMA_UNA_PAGINA_PT);
    expect(una("r", "ascendientes", 8, "A3", 1000).cabe).toBe(false);
  });

  it("un árbol pequeño, a su tamaño (sin agrandar) y en el centro", () => {
    const r = una("pablo", "descendientes", 2, "A0");
    const c = r.plan.paginas[0].composicion;
    expect(c.escala).toBe(ESCALA_MAXIMA);
    const ancho = r.plan.orientacion === "landscape" ? 1189 : 841;
    expect(c.posiciones[0].x * 2 + c.posiciones[0].ancho).toBeCloseTo(ancho, 6);
  });

  it("si no cabe en el papel, dice en cuál cabe (también el rollo); si ni en el rollo, con cuántas generaciones", () => {
    const o = { arbol, persona: arbol.persona("r")!, tipo: "ascendientes" as const, simbolos: ABREV, disposicion: "horizontal" as const, orientacion: "auto" as const };
    const ocho = construirGrafico(arbol, o.persona, "ascendientes", 8, ABREV);
    const d = dondeCabeUnaPagina({ ...o, generaciones: 8 }, ocho);
    const cabeEnRollo = planificarUnaPagina(ocho, o.persona, "ascendientes", 8, "horizontal", ROLLO, "auto").cabe;
    if (cabeEnRollo) {
      expect(d.papel).not.toBeNull();
      expect(planificarUnaPagina(ocho, o.persona, "ascendientes", 8, "horizontal", d.papel!, "auto").cabe).toBe(true);
    } else {
      expect(d.papel).toBeNull();
      expect(d.generaciones).toBeLessThan(8);
      const menos = construirGrafico(arbol, o.persona, "ascendientes", d.generaciones!, ABREV);
      expect(planificarUnaPagina(menos, o.persona, "ascendientes", d.generaciones!, "horizontal", ROLLO, "auto").cabe).toBe(true);
    }
    // 30 hijos en A3 y A4 de ancho: cabe en algún papel o con menos generaciones.
    const treinta = construirGrafico(arbol, arbol.persona("m")!, "descendientes", 2, ABREV);
    expect(dondeCabeUnaPagina({ ...o, persona: arbol.persona("m")!, tipo: "descendientes", generaciones: 2 }, treinta).papel).not.toBeUndefined();
  });

  it("rollo de 91,4 cm: ese ancho, el largo justo (hasta el máximo) y la escala más grande de las dos orientaciones", () => {
    for (const disp of ["vertical", "horizontal"] as const) {
      const datos = construirGrafico(arbol, arbol.persona("r")!, "ascendientes", 8, ABREV);
      const { plan: p } = planificarUnaPagina(datos, arbol.persona("r")!, "ascendientes", 8, disp, ROLLO, "auto");
      const h = p.hoja!;
      expect([h.ancho, h.alto]).toContain(ROLLO_ANCHO_MM);
      expect(Math.max(h.ancho, h.alto)).toBeLessThanOrEqual(ROLLO_LARGO_MAXIMO_MM + 1e-6);
      expect(p.orientacion).toBe(h.ancho > h.alto ? "landscape" : "portrait");
      for (const o of ["portrait", "landscape"] as const) {
        const otra = planificarUnaPagina(datos, arbol.persona("r")!, "ascendientes", 8, disp, ROLLO, o).plan;
        expect(otra.paginas[0].composicion.pt).toBeLessThanOrEqual(p.paginas[0].composicion.pt + 1e-9);
      }
      // El árbol llena el ancho del rollo o llega a la escala de la pantalla.
      const c = p.paginas[0].composicion;
      const lleno = c.posiciones[0].ancho >= h.ancho - 2 * 10 - 1e-6 || c.posiciones[0].alto >= h.alto - 2 * 10 - 20 - 8 - 1e-6;
      expect(lleno || c.escala === ESCALA_MAXIMA).toBe(true);
      // Más grande que en A0.
      expect(c.pt).toBeGreaterThanOrEqual(planificarUnaPagina(datos, arbol.persona("r")!, "ascendientes", 8, disp, "A0", "auto").plan.paginas[0].composicion.pt - 1e-9);
    }
  });

  it("cajas pequeñas: sin foto ni lugar, solo años, y el árbol ocupa menos", () => {
    const normal = construirGrafico(arbol, arbol.persona("r")!, "ascendientes", 6, ABREV);
    const pequenas = construirGrafico(arbol, arbol.persona("r")!, "ascendientes", 6, { ...ABREV, sencillas: true });
    expect(pequenas.sencillas).toBe(true);
    for (const disp of ["vertical", "horizontal"] as const) {
      const a = measureTreeChart(normal.ascendientes, null, disp);
      const b = measureTreeChart(pequenas.ascendientes, null, disp, true);
      expect(b.width * b.height).toBeLessThan(a.width * a.height);
    }
    const cajas = personasDe({ datos: pequenas } as Bloque);
    expect(cajas.every((n) => n.person!.photo === null)).toBe(true);
    for (const n of cajas) {
      for (const l of [n.person!.birth.text, n.person!.death.text]) expect(l).not.toContain(",");
    }
  });

  it("rangoDonde: un papel más pequeño es mejor; sin papel, más generaciones", () => {
    expect(rangoDonde({ papel: "A3", generaciones: 8 })).toBeLessThan(rangoDonde({ papel: "A0", generaciones: 8 }));
    expect(rangoDonde({ papel: "A0", generaciones: 8 })).toBeLessThan(rangoDonde({ papel: ROLLO, generaciones: 8 }));
    expect(rangoDonde({ papel: ROLLO, generaciones: 8 })).toBeLessThan(rangoDonde({ papel: null, generaciones: 7 }));
    expect(rangoDonde({ papel: null, generaciones: 7 })).toBeLessThan(rangoDonde({ papel: null, generaciones: 5 }));
    expect(rangoDonde({ papel: null, generaciones: 5 })).toBeLessThan(rangoDonde({ papel: null, generaciones: null }));
  });

  it("la letra mínima elegida (4, 5 o 6 puntos) cuenta también al buscar el papel", () => {
    expect([...LETRAS_UNA_PAGINA_PT]).toEqual([4, 5, 6]);
    const o = { arbol, persona: arbol.persona("r")!, tipo: "ascendientes" as const, generaciones: 8, simbolos: ABREV, disposicion: "horizontal" as const, orientacion: "auto" as const };
    const ocho = construirGrafico(arbol, o.persona, "ascendientes", 8, ABREV);
    const orden = (p: string | null) => (p ? PAPELES_UNA_PAGINA_Y_ROLLO.indexOf(p as never) : 99);
    expect(orden(dondeCabeUnaPagina(o, ocho, 4).papel)).toBeLessThanOrEqual(orden(dondeCabeUnaPagina(o, ocho, 5).papel));
    expect(orden(dondeCabeUnaPagina(o, ocho, 5).papel)).toBeLessThanOrEqual(orden(dondeCabeUnaPagina(o, ocho, 6).papel));
    expect(dondeCabeUnaPagina(o, ocho, 1000)).toEqual({ papel: null, generaciones: null });
  });
});

describe("«Una sola página» también con A4 y Letter (decisión del 08/11/2026)", () => {
  // El árbol se prepara en beforeAll: se lee al usarlo.
  const opciones = () => ({ arbol, persona: arbol.persona("r")!, tipo: "ascendientes" as const, simbolos: ABREV, orientacion: "auto" as const });
  type Caso = { g: number; disposicion: "horizontal" | "vertical"; datos: ReturnType<typeof construirGrafico> };
  const casos = (): Caso[] => [2, 3, 4, 5, 6, 7, 8].flatMap((g) => (["horizontal", "vertical"] as const).map((disposicion) => ({
    g, disposicion, datos: construirGrafico(arbol, arbol.persona("r")!, "ascendientes", g, ABREV),
  })));
  const cabe = (c: Caso, papel: "A4" | "Letter" | "A3", minimo: number) =>
    planificarUnaPagina(c.datos, arbol.persona("r")!, "ascendientes", c.g, c.disposicion, papel, "auto", minimo).cabe;

  it("A4 y Letter la admiten, como de A3 a A0 y el rollo; A5, Legal y los demás, no", () => {
    for (const p of ["A4", "Letter", "A3", "A2", "A1", "A0", ROLLO] as const) expect(conUnaPagina(p)).toBe(true);
    for (const p of ["A5", "Legal"] as const) expect(conUnaPagina(p)).toBe(false);
    expect(PAPELES.filter(conUnaPagina)).toEqual(["A0", "A1", "A2", "A3", "A4", "Letter"].filter((p) => PAPELES.includes(p as never)).sort((a, b) => PAPELES.indexOf(a as never) - PAPELES.indexOf(b as never)));
  });

  it("al elegir A4 o Letter, «Una sola página» por defecto, como con A3; con A5 o Legal, continuación", () => {
    for (const p of ["A4", "Letter", "A3"] as const) expect(modoAlCambiarPapel("A5", p, "continuacion")).toBe("unaPagina");
    for (const p of ["A5", "Legal"] as const) {
      expect(modoAlCambiarPapel("A4", p, "unaPagina")).toBe("continuacion");
      expect(modoAlCambiarPapel("Letter", p, "unaPagina")).toBe("continuacion");
    }
    expect(modoAlCambiarPapel("A5", "Legal", "continuacion")).toBe("continuacion");
    // Lo recordado se respeta: sin cambiar de papel, o entre dos que lo tienen.
    expect(modoAlCambiarPapel("A4", "A4", "continuacion")).toBe("continuacion");
    expect(modoAlCambiarPapel("A4", "A4", "mosaico")).toBe("mosaico");
    expect(modoAlCambiarPapel("A4", "A3", "mosaico")).toBe("mosaico");
    expect(modoAlCambiarPapel("A3", "A2", "continuacion")).toBe("continuacion");
  });

  it("un árbol que no cabe a 8 puntos en A4 cabe a 6 en una sola página A4", () => {
    expect(casos().some((c) => !cabe(c, "A4", 8) && cabe(c, "A4", 6))).toBe(true);
  });

  it("si no cabe en A4, el papel propuesto es A3, nunca Letter; y desde Letter, nunca A4", () => {
    const o = opciones();
    const todos = casos();
    const saltan = todos.filter((c) => !cabe(c, "A4", 6) && cabe(c, "A3", 6));
    expect(saltan.length).toBeGreaterThan(0);
    for (const c of saltan) {
      expect(dondeCabeUnaPagina({ ...o, generaciones: c.g, disposicion: c.disposicion, papel: "A4" }, c.datos, 6).papel).toBe("A3");
    }
    for (const c of todos) {
      if (!cabe(c, "A4", 6)) expect(dondeCabeUnaPagina({ ...o, generaciones: c.g, disposicion: c.disposicion, papel: "A4" }, c.datos, 6).papel).not.toBe("Letter");
      if (!cabe(c, "Letter", 6)) expect(dondeCabeUnaPagina({ ...o, generaciones: c.g, disposicion: c.disposicion, papel: "Letter" }, c.datos, 6).papel).not.toBe("A4");
    }
  });
});

describe("PDF sin subtítulo o sin pie: su sitio es para el árbol (decisión del 02/11/2026)", () => {
  const NADA: Espacio = { subtitulo: false, pie: false };
  const conEspacio = (
    h: string, tipo: "ascendientes" | "descendientes" | "ambos", generaciones: number, espacio: Espacio,
    orientacion: "auto" | "portrait" | "landscape" = "auto", disposicion: "vertical" | "horizontal" = "horizontal",
  ) =>
    planificarPaginas({
      arbol, persona: arbol.persona(h)!, tipo, generaciones, simbolos: ABREV, papel: "A4", orientacion, disposicion,
      continua: (n) => `continúa en la pág. ${n}`, espacio,
    });

  it("en una página, la composición es la de la página sin esos textos", () => {
    const p = conEspacio("r", "ascendientes", 3, NADA, "landscape");
    expect(p.paginas).toHaveLength(1);
    expect(p.paginas[0].composicion).toEqual(componer(p.paginas[0].bloques.map((b) => b.tamano), false, "A4", "landscape", NADA));
    expect(p.paginas[0].composicion.pt).toBeGreaterThanOrEqual(conEspacio("r", "ascendientes", 3, ESPACIO_COMPLETO, "landscape").paginas[0].composicion.pt);
    // Y sin pie escrito, la página no lleva pie.
    expect(textosPlan(arbol, p, arbol.persona("r")!, "ascendientes", "", 0, true, "Título", "")[0].pie).toBe("");
  });

  it("con varias páginas, el pie se reserva igual («Pág. 1 de N»)", () => {
    const sin = conEspacio("r", "ascendientes", GENERACIONES, NADA, "portrait");
    const soloPie = conEspacio("r", "ascendientes", GENERACIONES, { subtitulo: false, pie: true }, "portrait");
    expect(sin.paginas.length).toBeGreaterThan(1);
    expect(sin.paginas.map((x) => x.composicion)).toEqual(soloPie.paginas.map((x) => x.composicion));
    expect(sin.paginas.length).toBeLessThanOrEqual(conEspacio("r", "ascendientes", GENERACIONES, ESPACIO_COMPLETO, "portrait").paginas.length);
    expect(textosPlan(arbol, sin, arbol.persona("r")!, "ascendientes", "", 0, true, "Título", "")[0].pie).toMatch(/^Pág\. 1 de/);
  });

  it("si la primera página dice qué hijos van, el subtítulo se reserva igual", () => {
    const sin = conEspacio("m", "descendientes", 2, NADA, "auto", "vertical");
    expect(sin.paginas[0].bloques[0].hijos).toBeDefined();
    const todo = conEspacio("m", "descendientes", 2, ESPACIO_COMPLETO, "auto", "vertical");
    expect(sin.paginas.map((x) => x.composicion)).toEqual(todo.paginas.map((x) => x.composicion));
  });

  it("una sola página: el alto que no usan es para el árbol, también en el rollo", () => {
    const datos = construirGrafico(arbol, arbol.persona("r")!, "ascendientes", 8, ABREV);
    const una = (papel: "A3" | typeof ROLLO, disp: "vertical" | "horizontal", e: Espacio) =>
      planificarUnaPagina(datos, arbol.persona("r")!, "ascendientes", 8, disp, papel, "portrait", undefined, e).plan;
    // 8 generaciones en horizontal, en A3 vertical: la escala la decide el alto.
    const pt = (e: Espacio) => una("A3", "horizontal", e).paginas[0].composicion.pt;
    const alto = (cabecera: number, pie: number) => 420 - 2 * MARGEN_MM - cabecera - pie;
    expect(pt(NADA) / pt(ESPACIO_COMPLETO)).toBeCloseTo(alto(CABECERA_PRIMERA_SIN_SUBTITULO_MM, 0) / alto(CABECERA_PRIMERA_MM, PIE_MM), 6);
    expect(pt({ subtitulo: true, pie: false }) / pt(ESPACIO_COMPLETO)).toBeCloseTo(alto(CABECERA_PRIMERA_MM, 0) / alto(CABECERA_PRIMERA_MM, PIE_MM), 6);
    // En el rollo, en vertical, el ancho manda: la misma letra en una hoja
    // más corta.
    const con = una(ROLLO, "vertical", ESPACIO_COMPLETO);
    const sin = una(ROLLO, "vertical", NADA);
    expect(sin.paginas[0].composicion.pt).toBeCloseTo(con.paginas[0].composicion.pt, 6);
    expect(con.hoja!.alto - sin.hoja!.alto).toBeCloseTo(CABECERA_PRIMERA_MM + PIE_MM - CABECERA_PRIMERA_SIN_SUBTITULO_MM, 6);
  });

  it("dónde cabe en una sola página: sin subtítulo ni pie, nunca en un papel mayor", () => {
    const o = { arbol, persona: arbol.persona("r")!, tipo: "ascendientes" as const, generaciones: 8, simbolos: ABREV, disposicion: "horizontal" as const, orientacion: "auto" as const };
    const ocho = construirGrafico(arbol, o.persona, "ascendientes", 8, ABREV);
    expect(rangoDonde(dondeCabeUnaPagina({ ...o, espacio: NADA }, ocho))).toBeLessThanOrEqual(rangoDonde(dondeCabeUnaPagina(o, ocho)));
  });
});
