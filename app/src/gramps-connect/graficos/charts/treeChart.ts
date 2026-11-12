// Gráfico de árbol (ascendientes arriba y descendientes abajo, o a la
// izquierda y a la derecha, con la persona central en medio): dibujo en SVG
// con d3.
//
// Procede de Gramps Connect (https://github.com/dsblank/gramps-connect,
// app/src/charts/treeChart.ts, commit 884ad35), AGPL-3.0-or-later.
// MODIFICADO el 22/10/2026 para esta web (detalle en ../../ORIGEN.md):
// - los datos llegan ya preparados (TreeNode, construido desde la
//   instantánea en memoria por app/src/arbol/grafico.ts) en lugar de las
//   personas de gramps-web-api; nombres, fechas y textos emergentes vienen
//   ya traducidos;
// - del lado de descendientes, como en Gramps, los cónyuges en su propia
//   caja al lado de la persona y, debajo de cada pareja (a la derecha, en
//   horizontal), un óvalo con la fecha y el lugar de la boda del que cuelgan
//   sus hijos; así se ve de qué pareja es cada hijo;
// - sin ampliación perezosa por ramas: la marca «+» del borde solo indica
//   que hay más generaciones, y pulsarla centra el gráfico en esa persona;
// - fotos desde Storage (urlMultimedia), recortadas en el navegador según
//   el recorte de la referencia, en lugar de miniaturas del servidor;
// - los textos se recortan midiéndolos en el navegador (fitTexts), con
//   versión corta de las fechas, en lugar de estimar el ancho por letra; y
//   con las letras del PDF (Noto Sans y las de símbolos) también en
//   pantalla;
// - en las cajas, como en Gramps, la fecha y el lugar de nacimiento y de
//   defunción (si no cabe, se recorta el lugar) y, para el administrador,
//   el ID de Gramps junto al nombre; en la de familia, la boda solo si se
//   conoce, y el tipo de relación de pareja (divorcio, separación, pareja
//   sin casar; los padres sin relación de pareja, sin óvalo);
// - cajas como en Gramps: en vertical, la foto arriba y centrada y, debajo,
//   el nombre y los apellidos en negrita, cada uno en su línea (05/11/2026),
//   el nacimiento y la defunción; en horizontal, la foto (algo más pequeña) a la izquierda;
//   todas las cajas del mismo tamaño;
// - «continúa en la pág. N» junto a las cajas del borde, en los PDF de
//   varias páginas;
// - un botón de ficha en cada caja, marca para las personas que aparecen
//   más de una vez, y ampliar, reducir y ver todo desde fuera
//   (zoomBy/fitAll);
// - dos disposiciones (ChartLayout): vertical, con los ascendientes arriba,
//   y horizontal, con los ascendientes a la izquierda (en Gramps Connect,
//   solo horizontal y con los ascendientes a la derecha); la persona
//   central, siempre en (0, 0);
// - MODIFICADO el 24/10/2026 («Diseño visual»): todos los colores, los del
//   sexo incluidos, son variables del tema de la web (color(), de
//   app/src/tema/colores.ts), que cambian solas con el modo de color, sin
//   volver a dibujar; franja de sexo de 6 px por dentro de la caja (gris
//   para el sexo desconocido); persona central con borde teja y sombra;
//   líneas de 1,5 px; datos de las cajas a 12, sin nada por debajo;
// - MODIFICADO el 05/11/2026: también en la mitad de ascendientes, el óvalo de
//   los padres de la persona central (TreeFamily.parents), en una fila propia;
//   tercera línea del nombre solo en las filas que la necesitan
//   (needsThirdLine);
// - MODIFICADO el 12/11/2026: cajas completas (Medidas.full; decisión
//   «Cajas completas y ayuda del PDF»): nada se recorta; el nombre, la fecha
//   y el lugar, partidos en las líneas que hagan falta, con el alto de cada
//   generación decidido antes de dibujar (fullText, con DATA_WIDTHS y
//   NAME_WIDTHS); los óvalos, más altos, todos los de una fila iguales.

// Port of gramps-web's ../../../gramps-web/src/charts/TreeChart.js
// (TreeChartCore/TreeChart) -- d3-hierarchy for layout, d3-shape for the
// connecting links, d3-zoom for pan/zoom, raw d3-selection to build the SVG,
// the same "imperative lib in a ref" shape components/visuals/MapCanvas.tsx
// already uses for maplibre-gl. Colors are `var(--tema-...)` strings passed
// straight into `.attr()` -- SVG presentation attributes resolve CSS custom
// properties, so light/dark just works with no re-render needed on theme
// toggle (and the PDF export bakes the light theme's values in).
import { hierarchy } from "d3-hierarchy";
import { create, select, type Selection } from "d3-selection";
import { curveBumpX, curveBumpY, link } from "d3-shape";
// Side-effect only: patches Selection.prototype with `.transition()` (and
// its own type augmentation), which the animated re-center below needs --
// `svg.transition().call(zoomBehavior.transform, ...)`, the standard d3-zoom
// pattern for animating to a computed transform while keeping its own
// internal gesture state in sync throughout, not just at the end.
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { PDF_FONT_FAMILY } from "../../chartExport/pdfFonts";
import { FAMILIA_HEBREA, FAMILIA_SIMBOLOS, FAMILIA_SIMBOLOS2 } from "../../../fuentes/simbolos";
import { color } from "../../../tema/colores";
import { genderAccent } from "./genderColors";

/** Una línea de fecha y lugar de una caja, con lo que se puede recortar
 * si no cabe (fitTexts). */
export interface TreeLine {
  /** El texto entero («n. 03/05/1950, Madrid»); vacío si no hay línea. */
  text: string;
  /** Caracteres del principio que no se recortan (el símbolo y la fecha):
   * si no cabe, se recorta lo demás («n. 03/05/1950, Mad…»). */
  keep: number;
  /** Si ni así cabe, esta otra («n. 1950, Madrid»), o "". */
  short: string;
  keepShort: number;
  /** En un óvalo, las dos líneas en que se parte si no cabe en una («matr.
   * 12/05/1980» y el lugar; 31/10/2026). La segunda, si tampoco cabe, se
   * recorta con «…». */
  wrap?: [string, string];
  /** Cajas completas (12/11/2026): la primera parte, en su línea (el símbolo
   * y la fecha: «n. 03/05/1950»), y el lugar, que va debajo, partido por las
   * comas. Sin ellas, el texto entero, partido por palabras. */
  head?: string;
  place?: string;
}

/** Persona de una caja, con los textos ya preparados. */
export interface TreePerson {
  handle: string;
  /** Sexo con los valores de Gramps (0 mujer, 1 hombre, 2 desconocido, 3 otro). */
  gender: number;
  nameSurname: string;
  /** Nombre de pila, con el apodo y el sufijo (decisión del 05/11/2026). */
  nameGiven: string;
  /** ID de Gramps, detrás del nombre (solo para el administrador). */
  grampsId?: string;
  /** ID de Gramps en su propia línea, bajo el nombre (PDF con
   * «Incluir identificadores», decisión del 30/10/2026). */
  idLine?: string;
  /** Líneas de fecha y lugar ya formateadas, con su símbolo («n.», «*»…).
   * La de nacimiento siempre tiene algo; la de defunción, vacía si no hay. */
  birth: TreeLine;
  death: TreeLine;
  /** Texto emergente completo de la caja. */
  title: string;
  /** Foto principal: handle del objeto multimedia y recorte de la
   * referencia en porcentajes [x1, y1, x2, y2], si lo tiene. */
  photo: { handle: string; rect: [number, number, number, number] | null } | null;
  /** Aparece más de una vez en el gráfico (p. ej. primos casados entre sí). */
  repeated: boolean;
  /** Solo en los PDF de varias páginas: «continúa en la pág. N», que se
   * escribe fuera de la caja, por el lado de las generaciones que siguen. */
  continuation?: string;
}

/** Familia del lado de descendientes, como en Gramps: el cónyuge en su
 * propia caja, al lado de la persona, y debajo de los dos (a la derecha, en
 * horizontal) un óvalo con la boda, del que cuelgan los hijos. Del lado de
 * ascendientes (`parents`), los padres de la persona central: el óvalo
 * entre ella y ellos. */
export interface TreeFamily {
  handle: string;
  /** Cónyuge, o null si no se conoce (se dibuja una caja de «Cónyuge
   * desconocido», salvo con `parents`). */
  spouse: TreePerson | null;
  /** El óvalo de los padres: sin caja de cónyuge, y sus `children` son el
   * padre y la madre, los que se conozcan (05/11/2026). */
  parents?: boolean;
  /** Líneas del óvalo, ya preparadas («matr. …», «casados», «Pareja»,
   * «div. …»…); sin ninguna, un óvalo pequeño que solo une. */
  lines: TreeLine[];
  /** Padres sin relación de pareja (31/10/2026): óvalo con el borde
   * discontinuo; su única línea («sin relación de pareja») se parte en dos
   * si no cabe. */
  dashed?: boolean;
  title: string;
}

/** The nested shape d3-hierarchy wants. Una caja es de persona (con, en la
 * mitad de descendientes, los cónyuges de sus familias al lado) o un óvalo
 * de familia. */
export interface TreeNode {
  /** Identificador único dentro de su mitad del gráfico («p», «pf», «pm»,
   * «pf0c1»…): sirve para los id de los recortes de las fotos. */
  id: string;
  person?: TreePerson | null;
  family?: TreeFamily;
  children?: TreeNode[];
  /** La persona tiene más ascendientes o descendientes de los que se
   * dibujan (borde del gráfico). */
  hasMore?: boolean;
}

/** Cajas de persona (decisión del 23/10/2026, «Respuestas a la tercera
 * tanda de dudas»): en vertical, la foto arriba y centrada y, debajo, el
 * nombre (hasta dos líneas), el nacimiento y la defunción; en horizontal, la
 * foto a la izquierda y el texto a su lado. En vertical, el hueco de la foto
 * solo se reserva en las generaciones (filas) donde alguna caja tiene foto
 * («Correcciones tras probar las cajas nuevas»): sin foto, su hueco queda
 * vacío; en una fila sin ninguna, las cajas son más bajas (PHOTO_ROOM).
 * Dentro de una fila, todas iguales. */
interface Medidas {
  box: Record<ChartLayout, { w: number; h: number }>;
  oval: { w: number; h: number };
  /** Hueco entre generaciones, en vertical (gapV) y en horizontal (gapX). */
  gapV: number;
  gapX: number;
  compact: boolean;
  /** Cajas completas: nada se recorta, y las cajas y los óvalos crecen en
   * alto (12/11/2026). */
  full: boolean;
}
const NORMALES: Medidas = {
  box: { vertical: { w: 190, h: 146 }, horizontal: { w: 230, h: 90 } },
  oval: { w: 170, h: 46 },
  gapV: 40,
  gapX: 60,
  compact: false,
  full: false,
};
/** Cajas completas (12/11/2026): las medidas de las normales; crece el alto. */
const COMPLETAS: Medidas = { ...NORMALES, full: true };
/** Cajas pequeñas (PDF del árbol, respuesta del 25/10/2026): sin foto, con
 * solo los años y sin lugares (lo pone quien hace los datos), más estrechas
 * y más bajas, con las líneas más juntas; óvalos más estrechos y menos hueco
 * entre generaciones (aún cabe «continúa en la pág. N»). */
const PEQUENAS: Medidas = {
  box: { vertical: { w: 130, h: 66 }, horizontal: { w: 150, h: 72 } },
  oval: { w: 100, h: 40 },
  gapV: 28,
  gapX: 40,
  compact: true,
  full: false,
};
/** Las medidas del dibujo o la medición en curso: las fijan, mientras
 * trabajan, las funciones exportadas (conMedidas); todas son síncronas. */
let M: Medidas = NORMALES;
function conMedidas<T>(compact: boolean | undefined, full: boolean | undefined, fn: () => T): T {
  const antes = M;
  M = compact ? PEQUENAS : full ? COMPLETAS : NORMALES;
  try {
    return fn();
  } finally {
    M = antes;
  }
}
/** En vertical, lo que ocupa la foto por encima del nombre. */
const PHOTO_ROOM = 62;
/** Lo que ocupa cada línea de más en una caja: la tercera del nombre
 * (05/11/2026) o la del ID bajo el nombre (30/10/2026). */
const lineRoom = () => (M.compact ? 15 : 16);
/** Medidas de las cajas de una fila, con foto o sin ninguna, y con líneas de
 * más o sin ellas. */
/** Lo que ocupan las líneas de nacimiento y defunción: en una fila en la
 * que ninguna caja las lleva (las de la pareja que se repite encima de cada
 * tramo de hijos en el PDF, solo con el nombre), las cajas son más bajas
 * (decisión del 27/10/2026). */
const dataRoom = () => (M.compact ? 29 : 34);
function boxSize(layout: ChartLayout, photoRow: boolean, extraLines = 0, bareRow = false): { w: number; h: number } {
  const base = M.compact ? M.box[layout] : layout === "vertical" && !photoRow ? { w: M.box.vertical.w, h: M.box.vertical.h - PHOTO_ROOM } : M.box[layout];
  return { w: base.w, h: base.h + extraLines * lineRoom() - (bareRow ? dataRoom() : 0) };
}
/** Óvalo de la pareja: con una o dos líneas, OVAL; más alto con más
 * (OVAL_LINE cada una); sin ninguna, uno pequeño que solo une. */
const OVAL_EMPTY = { w: 22, h: 14 };
const OVAL_LINE = 15;
/** Ancho aproximado de un carácter de los óvalos (Noto Sans de 12 px), para
 * partir en dos el texto de un óvalo discontinuo antes de medirlo en el
 * dibujo; y el margen que dejan los bordes de la elipse. */
const OVAL_CHAR = 6.6;
const OVAL_MARGIN = 40;
/** Las líneas de un óvalo, partidas en dos las que no caben en su ancho
 * (con el ancho de carácter aproximado): la de la boda, por donde dice
 * `wrap` («matr. fecha» y el lugar debajo); en el discontinuo («sin relación
 * de pareja»), la única, por el espacio más cercano al centro. */
function ovalLinesOf(f: TreeFamily): TreeLine[] {
  const cabe = (text: string) => text.length * OVAL_CHAR <= M.oval.w - OVAL_MARGIN;
  const parte = (text: string): TreeLine => ({ text, keep: 0, short: "", keepShort: 0 });
  return f.lines.flatMap((line) => {
    if (cabe(line.text)) return [line];
    if (line.wrap) return line.wrap.map(parte);
    if (!f.dashed || f.lines.length !== 1) return [line];
    const mid = line.text.length / 2;
    let cut = -1;
    for (let i = line.text.indexOf(" "); i >= 0; i = line.text.indexOf(" ", i + 1)) {
      if (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid)) cut = i;
    }
    return cut < 0 ? [line] : [parte(line.text.slice(0, cut)), parte(line.text.slice(cut + 1))];
  });
}
/** Altura, respecto al centro del óvalo, de la línea `i` de `n`. */
const ovalLineY = (i: number, n: number) => (i - (n - 1) / 2) * OVAL_LINE + 4.5;
/** Lo que la elipse deja de ancho a una línea: el borde, a la altura de la
 * línea (de 9 por encima a 3 por debajo de la base), con 14 de margen. */
const ovalLineMax = (w: number, h: number, y: number) =>
  Math.min(w - OVAL_MARGIN, w * Math.sqrt(1 - Math.min(1, Math.max(Math.abs(y - 9), Math.abs(y + 3)) / (h / 2)) ** 2) - 14);
/** Con cajas completas (12/11/2026), las líneas del óvalo enteras: la
 * primera parte de cada una (la fecha) y el lugar debajo, partido por las
 * comas; lo demás («casados», «sin relación de pareja»), por palabras. */
function fullOvalLines(f: TreeFamily): string[] {
  const max = M.oval.w - OVAL_MARGIN;
  return f.lines.flatMap((line) => [
    ...wrapTokens([line.head ?? line.text], max, max, dataWidth),
    ...(line.place ? wrapTokens(placeTokens(line.place), max, max, dataWidth) : []),
  ]);
}
/** El óvalo de las cajas completas: del ancho de siempre y tan alto como
 * haga falta para que la elipse deje a cada línea su ancho. */
function fullOvalSize(f: TreeFamily): { w: number; h: number } {
  const lines = fullOvalLines(f);
  const n = lines.length;
  if (!n) return OVAL_EMPTY;
  const w = M.oval.w;
  let h = Math.max(M.oval.h, 16 + OVAL_LINE * n);
  lines.forEach((text, i) => {
    const y = ovalLineY(i, n);
    const edge = Math.max(Math.abs(y - 9), Math.abs(y + 3));
    const room = (dataWidth(text) + 14) / w;
    if (room < 1) h = Math.max(h, (2 * edge) / Math.sqrt(1 - room ** 2));
  });
  return { w, h: Math.ceil(h) };
}
const ovalSize = (f: TreeFamily) => {
  if (M.full) return fullOvalSize(f);
  const lines = ovalLinesOf(f);
  const n = lines.length;
  if (!n) return OVAL_EMPTY;
  // El discontinuo, más ancho si su texto lo pide (con las cajas pequeñas).
  const w = f.dashed ? Math.max(M.oval.w, Math.max(...lines.map((l) => l.text.length)) * OVAL_CHAR + OVAL_MARGIN) : M.oval.w;
  return { w, h: Math.max(M.oval.h, 16 + OVAL_LINE * n) };
};
// gramps-web's own default (charts/TreeChart.js) -- the vertical gap
// between sibling boxes in the same generation/column, which is what
// nodeSize's x-step below controls.
const GAP_Y = 5;
const TEXT_PADDING = 12;
const IMG_PADDING = 10;
/** Más pequeña que en Gramps Connect (BOX_HEIGHT - 2 * IMG_PADDING = 70):
 * así cabe una fecha entera al lado. */
const IMG_SIZE = 60;
/** A rounded-*rect* crop, not gramps-web's circle -- a scanned document or
 * a landscape/group photo doesn't survive being cropped to a circle the way
 * a portrait does. Smaller than the box's own corner (BOX_R) so the
 * thumbnail still reads as nested inside it. */
const IMG_CORNER = 6;
/** Botón de ficha, en la esquina superior derecha de cada caja de persona. */
const LINK_R = 9;
/** Esquinas de las cajas y ancho de la franja del sexo. */
const BOX_R = 10;
const STRIPE = 6;
/** Letra del nombre y de los datos (nacimiento, defunción, óvalo). */
const FONT_SIZE = 13;
const DATA_FONT_SIZE = 12;

/** Tamaño de letra del gráfico, en unidades del SVG (para calcular si un
 * PDF sale legible). */
export const CHART_FONT_SIZE = FONT_SIZE;

/** El texto recortado más largo que cabe, con «…», sin bajar de `min`
 * caracteres de `base`; null si ninguno. */
function longestCut(base: string, min: number, fits: (text: string) => boolean): string | null {
  let lo = min;
  let hi = base.length - 1;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const text = mid > 0 ? `${base.slice(0, mid).trimEnd()}…` : "";
    if (fits(text)) {
      best = text;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Las palabras de un nombre; el apodo, entre comillas, es una sola aunque
 * tenga varias: no se parte. */
const nameWords = (text: string) => text.match(/“[^”]*”|\S+/g) ?? [];

/** ¿Cabe este texto en esta línea? Lo deja escrito en ella. */
function fitsLine(el: SVGTextElement, text: string): boolean {
  el.textContent = text;
  return el.getComputedTextLength() <= Number(el.getAttribute("data-max"));
}

/** Un texto en una o más líneas: entero en la primera si cabe; si no, partido
 * por palabras (o, con una palabra más larga que la línea, por letras) y, si
 * ni así cabe, la última recortada con «…». `suffix` (el ID de Gramps) va
 * siempre entero al final. */
function fillLines(lines: SVGTextElement[], full: string, suffix: string): void {
  let rest = full;
  for (const [i, el] of lines.entries()) {
    if (fitsLine(el, (rest + suffix).trim())) return;
    if (i === lines.length - 1) {
      const best = longestCut(rest, 0, (text) => fitsLine(el, text + suffix));
      el.textContent = (best ?? "…") + suffix;
      return;
    }
    if (fitsLine(el, rest)) {
      rest = "";
      continue;
    }
    const words = nameWords(rest);
    let k = words.length - 1;
    while (k > 0 && !fitsLine(el, words.slice(0, k).join(" "))) k--;
    let n: number;
    if (k === 0 && words[0]?.startsWith("“")) {
      // Ni el apodo solo cabe en la línea: recortado, no partido.
      el.textContent = longestCut(rest, 0, (text) => fitsLine(el, text)) ?? "…";
      return;
    }
    if (k > 0) {
      n = words.slice(0, k).join(" ").length;
    } else {
      let lo = 1;
      let hi = rest.length - 1;
      n = 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (fitsLine(el, rest.slice(0, mid))) {
          n = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }
    el.textContent = rest.slice(0, n);
    rest = rest.slice(n).trim();
  }
}

/** El nombre de una caja (data-wrap="1", "2"… en la misma caja; dos líneas o,
 * con un nombre de pila largo o en horizontal con foto, tres). Nombre de pila
 * (data-full) y apellidos (data-full2), con salto forzado entre los dos. Con
 * tres líneas, el nombre de pila que no cabe ocupa dos, por palabras
 * (05/11/2026). Lo que ni así cabe, recortado con «…». Los apellidos, en su
 * línea; con foto en horizontal (data-surname-wrap), si el nombre de pila ocupa
 * solo una, pueden ocupar dos. El ID (data-suffix), detrás de los apellidos.
 * Sin apellidos separados («Cónyuge desconocido»), el texto en todas las
 * líneas. */
export function fitName(lines: SVGTextElement[]): void {
  const full = lines[0].getAttribute("data-full") ?? "";
  const second = lines[0].getAttribute("data-full2");
  const suffix = lines[0].getAttribute("data-suffix") ?? "";
  for (const el of lines) el.textContent = "";
  if (second === null) {
    fillLines(lines, full, suffix);
    return;
  }
  const firstLines = lines.length > 2 && !fitsLine(lines[0], full) ? 2 : 1;
  lines[0].textContent = "";
  fillLines(lines.slice(0, firstLines), full, "");
  const wrapSurname = firstLines === 1 && lines[0].getAttribute("data-surname-wrap") !== null;
  fillLines(lines.slice(firstLines, wrapSurname ? undefined : firstLines + 1), second, suffix);
}

/** Recorta los textos que no caben en su caja (atributo data-max, en
 * unidades del SVG), midiéndolos de verdad. Prueba el texto entero y, si no
 * cabe, lo recorta con «…» sin tocar sus primeros data-keep caracteres (la
 * fecha: se recorta el lugar); si ni así, lo mismo con la versión corta
 * (data-short, data-keep-short), y si tampoco, la última recortada por
 * donde haga falta. data-suffix (el ID de Gramps) va siempre entero al
 * final. El SVG tiene que estar ya en el documento: solo ahí se puede
 * medir. Entre el texto recortado y la versión corta va el texto sin lo
 * recortable (la fecha entera sin el lugar: «n. 03/05/1950»). El nombre, en
 * varias líneas (fitName). Con cajas completas no hay nada que recortar: solo
 * se comprueba que todo cabe (overflowingTexts). */
export function fitTexts(svg: SVGSVGElement): void {
  for (const el of overflowingTexts(svg)) {
    el.setAttribute("data-overflow", "");
    console.warn("Cajas completas: una línea no cabe en su hueco", el.textContent);
  }
  for (const el of Array.from(svg.querySelectorAll<SVGTextElement>('text[data-wrap="1"]'))) {
    const lines = Array.from(el.parentNode?.querySelectorAll<SVGTextElement>("text[data-wrap]") ?? [])
      .sort((a, b) => Number(a.getAttribute("data-wrap")) - Number(b.getAttribute("data-wrap")));
    fitName(lines);
  }
  for (const el of Array.from(svg.querySelectorAll<SVGTextElement>("text[data-max]:not([data-wrap])"))) {
    const max = Number(el.getAttribute("data-max"));
    const suffix = el.getAttribute("data-suffix") ?? "";
    const full = el.getAttribute("data-full") ?? (el.textContent ?? "").slice(0, (el.textContent ?? "").length - suffix.length);
    el.setAttribute("data-full", full);
    const fits = (text: string) => {
      el.textContent = text + suffix;
      return el.getComputedTextLength() <= max;
    };
    const short = el.getAttribute("data-short") ?? "";
    const keepFull = Number(el.getAttribute("data-keep") ?? 0);
    const candidates: [string, number][] = [[full, keepFull]];
    if (keepFull > 0 && keepFull < full.length) candidates.push([full.slice(0, keepFull), 0]);
    if (short) candidates.push([short, Number(el.getAttribute("data-keep-short") ?? 0)]);
    let done = false;
    for (const [text, keep] of candidates) {
      if (fits(text)) {
        done = true;
        break;
      }
      // Que quede algo de lo recortable («, Ma…»), no solo la coma.
      if (keep > 0 && keep < text.length) {
        const best = longestCut(text, Math.min(text.length - 1, keep + 3), fits);
        if (best !== null) {
          fits(best);
          done = true;
          break;
        }
      }
    }
    if (!done) {
      const base = candidates[candidates.length - 1][0];
      const best = longestCut(base, 0, fits);
      fits(best ?? "");
    }
  }
}

/** Con cajas completas, las líneas que miden más de lo calculado antes de
 * dibujar (data-check): no deberían salir nunca; los recorridos en el
 * navegador las buscan (data-overflow). Con medio punto de holgura. */
export function overflowingTexts(svg: SVGSVGElement): SVGTextElement[] {
  return Array.from(svg.querySelectorAll<SVGTextElement>("text[data-check]"))
    .filter((el) => el.getComputedTextLength() > Number(el.getAttribute("data-check")) + 0.5);
}

/** Disposición del árbol (decisión del 22/10/2026, «Disposición de los
 * árboles»): vertical, con los ascendientes arriba y los descendientes
 * abajo; u horizontal, con los ascendientes a la izquierda y los
 * descendientes a la derecha (orden cronológico). Las cajas son siempre del
 * mismo tamaño: con muchas generaciones, el gráfico se desplaza. */
export type ChartLayout = "vertical" | "horizontal";
export const CHART_LAYOUTS: ChartLayout[] = ["vertical", "horizontal"];

/** Las dos mitades del gráfico: los ascendientes van hacia arriba (o a la
 * izquierda), por el lado negativo; los descendientes hacia abajo (o a la
 * derecha), por el positivo. La persona central, en (0, 0). */
type Half = "ancestors" | "descendants";
const sideSign = (half: Half) => (half === "ancestors" ? -1 : 1);

/** Separación entre cajas vecinas de una misma generación en la disposición
 * vertical (en la horizontal, GAP_Y; entre generaciones, Medidas.gapV y
 * gapX). Entre una persona y sus cónyuges, la misma que entre hermanos. */
const GAP_B = 16;

/** Medidas a lo largo del eje de las generaciones («along»: el alto en
 * vertical, el ancho en horizontal) y a lo ancho de cada generación
 * («across»). */
const along = (s: { w: number; h: number }, layout: ChartLayout) => (layout === "horizontal" ? s.w : s.h);
const across = (s: { w: number; h: number }, layout: ChartLayout) => (layout === "horizontal" ? s.h : s.w);

/** Generaciones (profundidades) de una mitad en las que alguna caja tiene
 * foto, la de un cónyuge incluida (va en la fila de la persona, una por
 * encima de la de su óvalo). */
function photoDepths(data: TreeNode | null): Set<number> {
  const out = new Set<number>();
  if (!data) return out;
  hierarchy(data, (d) => d.children).each((d) => {
    if (d.data.person?.photo) out.add(d.depth);
    if (d.data.family?.spouse?.photo) out.add(d.depth - 1);
  });
  return out;
}

/** Ancho del texto de una caja: en horizontal, a la derecha de la foto si la
 * hay. */
const textWidthOf = (layout: ChartLayout, image: boolean) => (layout === "horizontal"
  ? M.box[layout].w - (image ? IMG_SIZE + 2 * IMG_PADDING : 2 * TEXT_PADDING) - 8
  : M.box[layout].w - 2 * TEXT_PADDING);
/** Lo que la primera línea deja al botón de ficha, de la esquina superior
 * derecha: en horizontal, por la derecha; en vertical, en una fila sin fotos
 * (el nombre arriba del todo, centrado), por los dos lados. */
const linkRoomOf = (layout: ChartLayout, photoRow: boolean) =>
  (layout === "horizontal" ? 2 * LINK_R : photoRow ? 0 : 2 * (2 * LINK_R + 8) - 2 * TEXT_PADDING);

/** Ancho de cada letra del nombre (Noto Sans de 13 px, en negrita de 600,
 * medido en el navegador el 05/11/2026): el alto de las filas se decide antes
 * de dibujar y sin el navegador, también al repartir las páginas del PDF. Las
 * letras con acento, como la suya sin él. */
const NAME_WIDTHS = new Map<string, number>(([
  [2.1, "’"], [2.7, "'"], [3.4, " "], [3.6, ".,"], [3.7, "ijl"], [4, "J"], [4.2, "()-"],
  [4.3, "[]"], [4.8, "fI”"], [5, "“"], [5.3, "t"], [5.4, "\""], [5.6, "r"], [6.3, "z"], [6.4, "s"],
  [6.5, "c"], [6.8, "T"], [7, "F"], [7.1, "vyL"], [7.2, "S"], [7.3, "xE"], [7.4, "0123456789"],
  [7.5, "YZ"], [7.6, "aek"], [8, "oP"], [8.1, "bdgpqV"], [8.3, "hnuCX"], [8.4, "KR"], [8.6, "B"],
  [8.7, "A"], [9.4, "G"], [9.5, "D"], [9.7, "U"], [9.8, "H"], [10.2, "OQ"], [10.3, "N"],
  [10.8, "w"], [12.1, "M"], [12.3, "W"], [12.5, "m"],
] as [number, string][]).flatMap(([w, letters]) => [...letters].map((c): [string, number] => [c, w])));
/** Otras letras, sin medir: las de otras escrituras y las de los ideogramas. */
const NAME_WIDTH_OTHER = 9;
const NAME_WIDTH_IDEOGRAM = 13;
/** Un 3 % de más (sumar letra a letra se queda hasta un 2,7 % corto en los dos
 * árboles, de ejemplo y real): mejor una línea en blanco que el apodo
 * recortado. Al dibujar, fitName mide de verdad. */
const NAME_WIDTH_MARGIN = 1.03;
const nameWidth = (text: string) => NAME_WIDTH_MARGIN * [...text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")].reduce(
  (sum, c) => sum + (NAME_WIDTHS.get(c) ?? (c.codePointAt(0)! >= 0x2e80 ? NAME_WIDTH_IDEOGRAM : NAME_WIDTH_OTHER)), 0,
);

// ---- Cajas completas (12/11/2026, «Cajas completas y ayuda del PDF») ----

/** Ancho de cada letra de las fechas, los lugares y los óvalos (Noto Sans de
 * 12 px, medido en el navegador el 12/11/2026), para partir las líneas de las
 * cajas completas sin el navegador. Con el mismo 3 % de más que los nombres. */
const DATA_WIDTHS = new Map<string, number>(([
  [2.1, "’"], [2.7, "'"], [3.1, " ijl"], [3.2, ".,;:!"], [3.3, "J"], [3.6, "()"], [3.9, "-[]"], [4.1, "fI"],
  [4.3, "t“”ª"], [4.5, "/º"], [4.9, "\""], [5, "r"], [5.1, "°"], [5.2, "?"], [5.6, "z"], [5.7, "cs"], [6, "–"],
  [6.1, "vy«»†"], [6.2, "F"], [6.3, "xL"], [6.4, "k"], [6.6, "S*"], [6.7, "aeE"], [6.8, "Y"], [6.9, "TZ0123456789+"],
  [7, "X"], [7.2, "oV"], [7.3, "P✝"], [7.4, "bdghnpquCK"], [7.5, "R"], [7.7, "A"], [7.8, "B#"], [8.3, "✡"], [8.7, "G"],
  [8.8, "DU&"], [8.9, "H"], [9.1, "N"], [9.4, "wOQ"], [10.9, "M"], [11.2, "mW"], [12, "—"],
] as [number, string][]).flatMap(([w, letters]) => [...letters].map((c): [string, number] => [c, w])));
const DATA_WIDTH_OTHER = 8.5;
const DATA_WIDTH_IDEOGRAM = 12;
// Sin los acentos (como la letra sin ellos) ni los selectores de variante (✡︎).
const dataWidth = (text: string) => NAME_WIDTH_MARGIN * [...text.normalize("NFD").replace(/[̀-ͯ︎️]/g, "")].reduce(
  (sum, c) => sum + (DATA_WIDTHS.get(c) ?? (c.codePointAt(0)! >= 0x2e80 ? DATA_WIDTH_IDEOGRAM : DATA_WIDTH_OTHER)), 0,
);

/** Parte en líneas un texto hecho de trozos (`tokens`): en cada línea, los
 * que quepan, separados por un espacio (la primera, de `first` de ancho; las
 * demás, de `max`). Un trozo que no cabe solo en una línea se parte por sus
 * espacios (un apodo de varias palabras, un trozo de lugar) y, si es una sola
 * palabra, por letras. Nada se recorta. */
export function wrapTokens(tokens: string[], first: number, max: number, width: (text: string) => number): string[] {
  const lines: string[] = [];
  const queue = tokens.filter(Boolean);
  let current = "";
  const limit = () => (lines.length ? max : first);
  while (queue.length) {
    const token = queue.shift()!;
    const candidate = current ? `${current} ${token}` : token;
    if (width(candidate) <= limit()) {
      current = candidate;
    } else if (current) {
      lines.push(current);
      current = "";
      queue.unshift(token);
    } else if (token.includes(" ")) {
      queue.unshift(...token.split(" "));
    } else {
      const letters = [...token];
      let n = 1;
      while (n < letters.length && width(letters.slice(0, n + 1).join("")) <= limit()) n++;
      lines.push(letters.slice(0, n).join(""));
      if (n < letters.length) queue.unshift(letters.slice(n).join(""));
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Los trozos de un lugar, por las comas, cada uno con la suya («Great
 * Falls,», «MT,», «USA»). */
const placeTokens = (place: string) => place.split(/,\s*/).map((part, i, all) => (i < all.length - 1 ? `${part},` : part));

/** El texto de una caja completa, ya partido en líneas: el nombre (el de pila
 * y, desde una línea nueva, los apellidos con el ID del administrador
 * detrás), el ID en su línea (PDF con «Incluir identificadores») y, por cada
 * dato (nacimiento, defunción), la fecha y debajo el lugar. `unknown`: el
 * texto de «Cónyuge desconocido», sin datos. */
export interface FullText {
  name: string[];
  id: string | null;
  data: string[][];
}
export function fullText(p: TreePerson, layout: ChartLayout, photoRow: boolean, unknown?: string): FullText {
  const max = textWidthOf(layout, !!p.photo);
  const first = max - linkRoomOf(layout, photoRow);
  if (unknown !== undefined) return { name: wrapTokens(nameWords(unknown), first, max, nameWidth), id: null, data: [] };
  const given = wrapTokens(nameWords(p.nameGiven), first, max, nameWidth);
  const surname = wrapTokens([...nameWords(p.nameSurname), ...(p.grampsId ? [`[${p.grampsId}]`] : [])], given.length ? max : first, max, nameWidth);
  const data = [p.birth, p.death].filter((line) => line.text).map((line) => [
    ...wrapTokens([line.head ?? line.text], max, max, dataWidth),
    ...(line.place ? wrapTokens(placeTokens(line.place), max, max, dataWidth) : []),
  ]);
  return { name: [...given, ...surname], id: p.idLine ?? null, data };
}

/** Dónde va cada línea de una caja completa (la línea base, desde el borde
 * de arriba) y el alto que necesita. Con los mismos huecos que las cajas
 * normales: con dos líneas de nombre, nacimiento y defunción, miden lo mismo. */
export function fullRows(text: FullText, layout: ChartLayout, photoRow: boolean): { name: number[]; id: number | null; data: number[][]; height: number } {
  const vertical = layout === "vertical";
  const nameStep = vertical ? 16 : photoRow ? 15 : 17;
  const toData = vertical ? 18 : photoRow ? 16 : 17;
  const betweenData = vertical ? 16 : photoRow ? 15 : 17;
  let y = vertical ? 25 + (photoRow ? PHOTO_ROOM : 0) : photoRow ? 19 : 25;
  const name = text.name.map((_, i) => (i ? (y += nameStep) : y));
  const id = text.id === null ? null : (y += vertical ? 17 : nameStep);
  const data = text.data.map((lines, j) => lines.map((_, i) => (y += i ? 15 : j ? betweenData : id === null ? toData : vertical ? 17 : toData)));
  return { name, id, data, height: y + (vertical ? 9 : 10) };
}

/** El nombre de pila de esta caja necesita dos líneas (con más de una palabra:
 * una sola no se parte), y por tanto los apellidos, la tercera. En horizontal
 * con foto, ya tiene tres. */
function needsThirdLine(p: TreePerson, layout: ChartLayout, photoRow: boolean): boolean {
  if (layout === "horizontal" && p.photo) return false;
  const room = textWidthOf(layout, false) - linkRoomOf(layout, photoRow);
  return nameWidth(p.nameGiven) > room && nameWords(p.nameGiven).length > 1;
}

/** Líneas de más de una caja: la tercera del nombre y el ID. En horizontal,
 * una columna con fotos ya tiene el hueco de la tercera. */
const extraLinesOf = (p: TreePerson | null | undefined, layout: ChartLayout, photoRow: boolean) => {
  if (!p) return 0;
  const third = needsThirdLine(p, layout, photoRow) && !(layout === "horizontal" && photoRow);
  return (third ? 1 : 0) + (p.idLine ? 1 : 0);
};

/** Generaciones de una mitad en las que alguna caja lleva líneas de más, con
 * las que lleva la que más. */
function extraDepths(data: TreeNode | null, layout: ChartLayout, photos: Set<number>): Map<number, number> {
  const out = new Map<number, number>();
  if (!data) return out;
  const add = (depth: number, n: number) => { if (n) out.set(depth, Math.max(out.get(depth) ?? 0, n)); };
  hierarchy(data, (d) => d.children).each((d) => {
    add(d.depth, extraLinesOf(d.data.person, layout, photos.has(d.depth)));
    add(d.depth - 1, extraLinesOf(d.data.family?.spouse, layout, photos.has(d.depth - 1)));
  });
  return out;
}

/** Generaciones de una mitad en las que alguna caja lleva nacimiento o
 * defunción. */
function dataDepths(data: TreeNode | null): Set<number> {
  const out = new Set<number>();
  if (!data) return out;
  const hasData = (p: TreePerson) => !!(p.birth.text || p.death.text);
  hierarchy(data, (d) => d.children).each((d) => {
    if (d.data.person && hasData(d.data.person)) out.add(d.depth);
    if (d.data.family?.spouse && hasData(d.data.family.spouse)) out.add(d.depth - 1);
  });
  return out;
}

/** Filas de cada mitad: las que tienen foto, las líneas de más (la tercera
 * del nombre, el ID) y las que tienen datos (sin ellos, cajas más bajas). La de la persona central es la misma en las dos (en la de
 * descendientes, con sus cónyuges). En horizontal, las cajas de una
 * generación van una encima de otra con un paso fijo: todas llevan las
 * líneas de la que más lleva. */
interface Rows {
  photos: Set<number>;
  extras: Map<number, number>;
  allExtras: number;
  data: Set<number>;
  /** Con cajas completas, el alto de la caja más llena de cada fila. */
  full: Map<number, number>;
}
/** Con cajas completas, el alto de la caja más llena de cada generación (los
 * cónyuges, en la de la persona). */
function fullDepths(data: TreeNode | null, layout: ChartLayout, photos: Set<number>): Map<number, number> {
  const out = new Map<number, number>();
  if (!data || !M.full) return out;
  const add = (depth: number, p: TreePerson | null | undefined) => {
    if (!p) return;
    const photoRow = photos.has(depth);
    out.set(depth, Math.max(out.get(depth) ?? 0, fullRows(fullText(p, layout, photoRow), layout, photoRow).height));
  };
  hierarchy(data, (d) => d.children).each((d) => {
    add(d.depth, d.data.person);
    add(d.depth - 1, d.data.family?.spouse);
  });
  return out;
}
function chartRows(ancestorTree: TreeNode | null, descendantTree: TreeNode | null, layout: ChartLayout): Record<Half, Rows> {
  const shared = (a: Set<number>, d: Set<number>) => {
    if (a.has(0) || d.has(0)) {
      a.add(0);
      d.add(0);
    }
  };
  const photos = { ancestors: photoDepths(ancestorTree), descendants: photoDepths(descendantTree) };
  shared(photos.ancestors, photos.descendants);
  const extras = {
    ancestors: extraDepths(ancestorTree, layout, photos.ancestors),
    descendants: extraDepths(descendantTree, layout, photos.descendants),
  };
  const central = Math.max(extras.ancestors.get(0) ?? 0, extras.descendants.get(0) ?? 0);
  if (central) {
    extras.ancestors.set(0, central);
    extras.descendants.set(0, central);
  }
  const data = { ancestors: dataDepths(ancestorTree), descendants: dataDepths(descendantTree) };
  shared(data.ancestors, data.descendants);
  const allExtras = layout === "horizontal" ? Math.max(0, ...extras.ancestors.values(), ...extras.descendants.values()) : 0;
  const full = { ancestors: fullDepths(ancestorTree, layout, photos.ancestors), descendants: fullDepths(descendantTree, layout, photos.descendants) };
  const centralFull = Math.max(full.ancestors.get(0) ?? 0, full.descendants.get(0) ?? 0);
  if (centralFull) {
    full.ancestors.set(0, centralFull);
    full.descendants.set(0, centralFull);
  }
  return {
    ancestors: { photos: photos.ancestors, extras: extras.ancestors, allExtras, data: data.ancestors, full: full.ancestors },
    descendants: { photos: photos.descendants, extras: extras.descendants, allExtras, data: data.descendants, full: full.descendants },
  };
}
const extraRows = (rows: Rows, depth: number) => Math.max(rows.allExtras, rows.extras.get(depth) ?? 0);
/** Con cajas completas, el alto de la más llena, sin bajar del de las
 * normales (las líneas de más ya van en él). */
function rowSize(layout: ChartLayout, rows: Rows, depth: number): { w: number; h: number } {
  if (!M.full) return boxSize(layout, rows.photos.has(depth), extraRows(rows, depth), !rows.data.has(depth));
  const base = boxSize(layout, rows.photos.has(depth), 0, !rows.data.has(depth));
  return { w: base.w, h: Math.max(base.h, rows.full.get(depth) ?? 0) };
}

/** Lo que ocupan las generaciones de óvalos a lo largo del eje de las
 * generaciones: el más grande de cada una, y nunca menos que OVAL. */
function ovalRows(data: TreeNode, layout: ChartLayout): Map<number, number> {
  const out = new Map<number, number>();
  hierarchy(data, (d) => d.children).each((d) => {
    if (d.data.family) out.set(d.depth, Math.max(out.get(d.depth) ?? along(M.oval, layout), along(ovalSize(d.data.family), layout)));
  });
  return out;
}

/** Tamaño de la generación `depth` a lo largo del eje de las generaciones:
 * el de sus óvalos, si es una fila de óvalos (en la mitad de descendientes se
 * alternan con las personas; en la de ascendientes, solo el de los padres de
 * la persona central), o el de sus cajas. */
function columnExtent(depth: number, layout: ChartLayout, rows: Rows, ovals: Map<number, number>): number {
  return ovals.get(depth) ?? along(rowSize(layout, rows, depth), layout);
}

/** Distancia, por el eje de las generaciones, entre el centro de la caja
 * central y el de la generación `depth`. */
function columnCenter(depth: number, layout: ChartLayout, rows: Rows, ovals: Map<number, number>): number {
  const gap = layout === "horizontal" ? M.gapX : M.gapV;
  let c = 0;
  for (let i = 0; i < depth; i++) {
    c += columnExtent(i, layout, rows, ovals) / 2 + gap + columnExtent(i + 1, layout, rows, ovals) / 2;
  }
  return c;
}

/** Caja de persona colocada: centro (px, py) en el SVG, con la persona
 * central en (0, 0). `key`, único en su mitad (recortes de las fotos). Alto
 * `h`, el de su fila; `photoRow`, si la fila lleva hueco para la foto, y
 * `extraLines`, cuántas líneas de más lleva su fila (tercera del nombre, ID). */
interface PlacedBox {
  key: string;
  person: TreePerson;
  px: number;
  py: number;
  h: number;
  photoRow: boolean;
  extraLines: number;
  /** Cónyuge desconocido: caja gris con «Cónyuge desconocido», que no
   * lleva a ninguna persona. */
  unknown: boolean;
  hasMore: boolean;
  central: boolean;
}

interface PlacedOval {
  key: string;
  family: TreeFamily;
  px: number;
  py: number;
  w: number;
  h: number;
  /** Lo que ocupa, con el texto de «sin relación de pareja». */
  bounds: Bounds;
}

/** Línea entre dos generaciones: de un borde de caja (u óvalo) al de la
 * siguiente. */
interface Connector {
  source: [number, number];
  target: [number, number];
}

interface HalfLayout {
  boxes: PlacedBox[];
  ovals: PlacedOval[];
  links: Connector[];
}

/** Perfil de un subárbol a lo ancho: por cada fila (0, la de su primera
 * caja), sus bordes izquierdo y derecho, relativos a su ancla. */
interface Contour {
  l: number[];
  r: number[];
}

/** Añade a `target`, desde su fila `row0`, el perfil `c` desplazado `dx`. */
function mergeContour(target: Contour, c: Contour, dx: number, row0: number): void {
  c.l.forEach((l, i) => {
    target.l[row0 + i] = Math.min(target.l[row0 + i] ?? Infinity, dx + l);
    target.r[row0 + i] = Math.max(target.r[row0 + i] ?? -Infinity, dx + c.r[i]);
  });
}

/** Caja de un cónyuge que no se conoce (decisiones del 23/10/2026, «Parejas
 * y cajas: respuestas», y del 24/10/2026, «Cajas y cónyuges: más
 * respuestas»): «Cónyuge desconocido», sin fechas, en una caja gris. */
const EMPTY_LINE: TreeLine = { text: "", keep: 0, short: "", keepShort: 0 };
const unknownSpouse = (f: TreeFamily): TreePerson => ({
  handle: "", gender: 2, nameSurname: "", nameGiven: "", birth: EMPTY_LINE, death: EMPTY_LINE,
  title: f.title, photo: null, repeated: false,
});

/** Calcula las posiciones de una mitad (sin dibujar nada), con un trazado
 * propio por perfiles (como el de d3-hierarchy, Reingold-Tilford): los
 * subárboles hermanos, juntos sin tocarse, y la persona centrada sobre sus
 * hijos. En la mitad de descendientes (decisión del 23/10/2026, «Parejas y
 * cajas: respuestas»), los cónyuges van al lado de la persona, por orden:
 * la primera mitad a su izquierda y los demás a su derecha (con dos, uno a
 * cada lado), para que se crucen las menos líneas posible; el óvalo de cada
 * familia, debajo (a la derecha, en horizontal), entre la persona y ese
 * cónyuge, y los hijos de la pareja, centrados bajo su óvalo si caben (si
 * no, apartados lo justo). En la de ascendientes, el óvalo de los padres de
 * la persona central, en línea con ella, y sus padres centrados sobre él. */
function layoutHalf(data: TreeNode, half: Half, layout: ChartLayout, rows: Rows): HalfLayout {
  const horizontal = layout === "horizontal";
  const sign = sideSign(half);
  const boxAcrossAll = across(boxSize(layout, false, rows.allExtras), layout);
  const rowBox = (depth: number) => rowSize(layout, rows, depth);
  /** Lo que ocupa una caja a lo ancho de su generación: con cajas completas
   * en horizontal, el alto de su columna (12/11/2026); si no, el mismo en
   * todas. */
  const boxAcross = (depth: number) => (M.full ? across(rowBox(depth), layout) : boxAcrossAll);
  const gapAcross = horizontal ? GAP_Y : GAP_B;
  const step = (depth: number) => boxAcross(depth) + gapAcross;
  const ovals = ovalRows(data, layout);
  const center = (depth: number) => columnCenter(depth, layout, rows, ovals);
  /** Con cajas completas, los óvalos con texto de una generación, todos del
   * alto del más alto (12/11/2026); los que solo unen, pequeños. */
  const ovalHeights = new Map<number, number>();
  if (M.full) {
    hierarchy(data, (d) => d.children).each((d) => {
      const f = d.data.family;
      if (f?.lines.length) ovalHeights.set(d.depth, Math.max(ovalHeights.get(d.depth) ?? 0, ovalSize(f).h));
    });
  }
  const ovalAt = (f: TreeFamily, depth: number) => {
    const size = ovalSize(f);
    const h = ovalHeights.get(depth);
    return h && f.lines.length ? { w: size.w, h } : size;
  };
  const ovalAcrossAt = (f: TreeFamily, depth: number): [number, number] => {
    const w = across(ovalAt(f, depth), layout) / 2;
    return [-w, w];
  };

  /** Posición a lo ancho de cada nodo respecto a la de su padre en el
   * árbol (una familia, respecto a la persona; un hijo, respecto al óvalo de
   * su familia; en ascendientes, un padre respecto a su hijo). */
  const rel = new Map<TreeNode, number>();
  /** Cónyuge de cada familia, respecto a la persona. */
  const spouseRel = new Map<TreeFamily, number>();

  /** Pone en fila, de izquierda a derecha, perfiles que quieren estar en
   * `want`, empujando hacia la derecha los que no caben. */
  const pack = (subs: { c: Contour; want: number }[]): number[] => {
    const right: number[] = [];
    return subs.map(({ c, want }) => {
      let x = want;
      for (let i = 0; i < Math.min(right.length, c.l.length); i++) x = Math.max(x, right[i] + gapAcross - c.l[i]);
      c.r.forEach((r, i) => {
        right[i] = Math.max(right[i] ?? -Infinity, x + r);
      });
      return x;
    });
  };

  /** Hermanos en fila, centrados sobre el primero y el último. */
  const siblings = (nodes: TreeNode[], depth: number): { c: Contour; off: number[] } => {
    const subs = nodes.map((n) => person(n, depth));
    const pos = pack(subs.map((c) => ({ c, want: 0 })));
    const mid = (pos[0] + pos[pos.length - 1]) / 2;
    const off = pos.map((x) => x - mid);
    const c: Contour = { l: [], r: [] };
    subs.forEach((sub, j) => mergeContour(c, sub, off[j], 0));
    return { c, off };
  };

  /** Perfil del subárbol de una persona (de la generación `depth`), con su
   * caja en 0. */
  function person(n: TreeNode, depth: number): Contour {
    const boxW = boxAcross(depth);
    const c: Contour = { l: [-boxW / 2], r: [boxW / 2] };
    const children = n.children ?? [];
    const families = children.filter((ch) => ch.family);
    const parentsOval = families.find((ch) => ch.family!.parents);
    if (parentsOval) {
      const [l, r] = ovalAcrossAt(parentsOval.family!, depth + 1);
      rel.set(parentsOval, 0);
      mergeContour(c, { l: [l], r: [r] }, 0, 1);
      const parents = parentsOval.children ?? [];
      const row = siblings(parents, depth + 2);
      mergeContour(c, row.c, 0, 2);
      parents.forEach((ch, j) => rel.set(ch, row.off[j]));
      return c;
    }
    if (!families.length) {
      const parents = children.filter((ch) => ch.person);
      if (parents.length) {
        const row = siblings(parents, depth + 1);
        mergeContour(c, row.c, 0, 1);
        parents.forEach((ch, j) => rel.set(ch, row.off[j]));
      }
      return c;
    }
    const left = Math.floor(families.length / 2);
    const blocks: { c: Contour; off: number[]; nodes: TreeNode[]; oval: number }[] = [];
    families.forEach((f, i) => {
      const slot = i < left ? i - left : i - left + 1;
      const spouse = slot * step(depth);
      const oval = spouse - (Math.sign(slot) * step(depth)) / 2;
      spouseRel.set(f.family!, spouse);
      rel.set(f, oval);
      c.l[0] = Math.min(c.l[0], spouse - boxW / 2);
      c.r[0] = Math.max(c.r[0], spouse + boxW / 2);
      const [l, r] = ovalAcrossAt(f.family!, depth + 1);
      mergeContour(c, { l: [l], r: [r] }, oval, 1);
      const kids = (f.children ?? []).filter((ch) => ch.person);
      if (kids.length) blocks.push({ ...siblings(kids, depth + 2), nodes: kids, oval });
    });
    if (blocks.length) {
      const pos = pack(blocks.map((b) => ({ c: b.c, want: b.oval })));
      // Lo que se ha apartado el último, repartido a los dos lados.
      const shift = -(pos[pos.length - 1] - blocks[blocks.length - 1].oval) / 2;
      blocks.forEach((b, i) => {
        const x = pos[i] + shift;
        mergeContour(c, b.c, x, 2);
        b.nodes.forEach((ch, j) => rel.set(ch, x + b.off[j] - b.oval));
      });
    }
    return c;
  }

  person(data, 0);
  const root = hierarchy(data, (d) => d.children);
  /** Posición a lo ancho de cada nodo, con la persona central en 0. */
  const acrossOf = new Map<TreeNode, number>();
  for (const d of root.descendants()) acrossOf.set(d.data, d.parent ? acrossOf.get(d.parent.data)! + rel.get(d.data)! : 0);

  /** Un punto, dado por su posición a lo largo y a lo ancho. */
  const point = (al: number, ac: number): [number, number] => (horizontal ? [al, ac] : [ac, al]);
  // Las líneas empiezan y acaban un poco dentro de las cajas (redondeadas),
  // que se dibujan encima.
  const inset = horizontal ? 10 : 4;

  const out: HalfLayout = { boxes: [], ovals: [], links: [] };
  for (const d of root.descendants()) {
    const al = sign * center(d.depth);
    const ac = acrossOf.get(d.data)!;
    if (d.data.family) {
      const family = d.data.family;
      const size = ovalAt(family, d.depth);
      const [px, py] = point(al, ac);
      const [l, r] = ovalAcrossAt(family, d.depth);
      const alongHalf = along(size, layout) / 2;
      const bounds = horizontal
        ? { x0: px - alongHalf, x1: px + alongHalf, y0: py + l, y1: py + r }
        : { x0: px + l, x1: px + r, y0: py - alongHalf, y1: py + alongHalf };
      out.ovals.push({ key: d.data.id, family, px, py, w: size.w, h: size.h, bounds });
      if (family.parents) continue;
      // El cónyuge, en la fila de la persona.
      const parent = d.parent!;
      const [sx, sy] = point(sign * center(parent.depth), acrossOf.get(parent.data)! + spouseRel.get(family)!);
      out.boxes.push({
        key: `${d.data.id}s`, person: family.spouse ?? unknownSpouse(family), unknown: !family.spouse, px: sx, py: sy,
        h: rowBox(parent.depth).h, photoRow: rows.photos.has(parent.depth), extraLines: extraRows(rows, parent.depth),
        hasMore: false, central: false,
      });
      continue;
    }
    if (!d.data.person) continue;
    const [px, py] = point(al, ac);
    out.boxes.push({
      key: d.data.id, person: d.data.person, unknown: false, px, py, h: rowBox(d.depth).h, photoRow: rows.photos.has(d.depth),
      extraLines: extraRows(rows, d.depth),
      hasMore: !!d.data.hasMore, central: d.depth === 0,
    });
  }
  /** Punto del borde de una caja de la fila `depth`, hacia `toward`. */
  const boxEdge = (depth: number, al: number, ac: number, toward: number): [number, number] =>
    point(al + toward * (along(rowBox(depth), layout) / 2 - inset), ac);
  for (const d of root.descendants()) {
    const parent = d.parent;
    if (!parent) continue;
    const pal = sign * center(parent.depth);
    const dal = sign * center(d.depth);
    const pac = acrossOf.get(parent.data)!;
    const family = d.data.family;
    if (family) {
      // De la persona y de su cónyuge al óvalo de su familia.
      const target = point(dal - sign * (along(ovalAt(family, d.depth), layout) / 2 - 1), acrossOf.get(d.data)!);
      out.links.push({ source: boxEdge(parent.depth, pal, pac, sign), target });
      if (!family.parents) out.links.push({ source: boxEdge(parent.depth, pal, pac + spouseRel.get(family)!, sign), target });
      continue;
    }
    const target = boxEdge(d.depth, dal, acrossOf.get(d.data)!, -sign);
    const parentFamily = parent.data.family;
    if (parentFamily) {
      out.links.push({ source: point(pal + sign * (along(ovalAt(parentFamily, parent.depth), layout) / 2 - 1), pac), target });
    } else {
      out.links.push({ source: boxEdge(parent.depth, pal, pac, sign), target });
    }
  }
  return out;
}

/** Hueco y tamaño reservados para «continúa en la pág. N» (unidades del
 * SVG): al lado de la caja en horizontal, encima o debajo en vertical. */
const CONTINUATION_GAP = 8;
const CONTINUATION_WIDTH = 150;
const CONTINUATION_HEIGHT = 16;

type Bounds = { x0: number; x1: number; y0: number; y1: number };

/** Rectángulo que ocupa una caja de persona, con su «continúa en la pág. N»
 * y la franja del sexo, que asoma por la izquierda. */
function boxBounds(d: PlacedBox, half: Half, layout: ChartLayout): Bounds {
  const w = M.box[layout].w / 2;
  const h = d.h / 2;
  // 4 de margen por la izquierda, donde asomaba la franja del sexo en
  // Gramps Connect: ahora va por dentro, pero así no cambia la disposición.
  const b = { x0: d.px - w - 4, x1: d.px + w, y0: d.py - h, y1: d.py + h };
  if (d.person.continuation) {
    const s = sideSign(half);
    if (layout === "horizontal") {
      if (s < 0) b.x0 -= CONTINUATION_GAP + CONTINUATION_WIDTH;
      else b.x1 += CONTINUATION_GAP + CONTINUATION_WIDTH;
    } else if (s < 0) {
      b.y0 -= CONTINUATION_GAP + CONTINUATION_HEIGHT;
    } else {
      b.y1 += CONTINUATION_GAP + CONTINUATION_HEIGHT;
    }
  }
  return b;
}


interface CoreOptions {
  /** Pulsar en una caja de persona (también la de un cónyuge). */
  onSelectPerson?: (handle: string) => void;
  /** Pulsar el botón de ficha de una caja. */
  onOpenPerson?: (handle: string) => void;
  selectedHandle?: string | null;
  /** Textos de los botones, ya traducidos. */
  labels: TreeChartLabels;
}

/** Textos fijos del gráfico, ya traducidos. */
export interface TreeChartLabels {
  openPerson: string;
  more: string;
  unknownSpouse: string;
  noSurname: string;
  noGivenName: string;
}

/** Atributos de una línea de fecha y lugar (TreeLine) para fitTexts. */
function lineAttrs(
  sel: Selection<SVGTextElement, PlacedBox, SVGGElement, undefined>, line: (d: PlacedBox) => TreeLine, max: (d: PlacedBox) => number,
): void {
  sel
    .attr("data-max", max)
    .attr("data-keep", (d) => line(d).keep)
    .attr("data-short", (d) => line(d).short || null)
    .attr("data-keep-short", (d) => (line(d).short ? line(d).keepShort : null))
    .text((d) => line(d).text);
}

/** Dibuja una mitad del gráfico (ascendientes o descendientes) en
 * `svgParent`, con la persona central en (0, 0). */
function treeChartCore(
  svgParent: Selection<SVGGElement, undefined, null, undefined>,
  data: TreeNode,
  half: Half,
  layout: ChartLayout,
  halfRows: Rows,
  { onSelectPerson, onOpenPerson, selectedHandle, labels }: CoreOptions,
): void {
  const { boxes, ovals, links } = layoutHalf(data, half, layout, halfRows);
  const sign = sideSign(half);
  const horizontal = layout === "horizontal";
  const BOX_WIDTH = M.box[layout].w;
  /** Alto de la caja, el de su fila. */
  const bh = (d: PlacedBox) => d.h;

  const chart = svgParent.append("g");

  // Las líneas, de una generación a la siguiente: de la persona y su
  // cónyuge al óvalo de la familia, y del óvalo a los hijos.
  chart
    .append("g")
    .attr("fill", "none")
    .attr("stroke", color("linea-fuerte"))
    .attr("stroke-width", 1.5)
    .selectAll("path")
    .data(links)
    .join("path")
    .attr("d", (l) => link(horizontal ? curveBumpX : curveBumpY)(l));

  // ---- Óvalos de familia ----

  const oval = chart
    .append("g")
    .selectAll("g")
    .data(ovals)
    .join("g")
    .attr("transform", (d) => `translate(${d.px},${d.py})`);

  oval.append("title").text((d) => d.family.title);

  // Padres sin relación de pareja, con el borde discontinuo (31/10/2026).
  oval
    .append("ellipse")
    .attr("rx", (d) => d.w / 2)
    .attr("ry", (d) => d.h / 2)
    .attr("fill", color("superficie-hundida"))
    .attr("stroke", color("linea-fuerte"))
    .attr("stroke-dasharray", (d) => (d.family.dashed ? "6 3" : null));

  // Las líneas del óvalo, sin rótulo, centradas en alto (la fecha y el
  // lugar de la boda, «div. …»…). Cada una, del ancho que deja la elipse a
  // su altura.
  // Con cajas completas, enteras y ya partidas (data-check: lo que cabe, para
  // ver si algo se sale; nada se recorta).
  const ovalLines = (d: PlacedOval) => {
    if (M.full) {
      return fullOvalLines(d.family).map((text, i, all) => {
        const y = ovalLineY(i, all.length);
        return { line: { text, keep: 0, short: "", keepShort: 0 } as TreeLine, y, max: ovalLineMax(d.w, d.h, y) };
      });
    }
    return ovalLinesOf(d.family).map((line, i, all) => {
      const y = ovalLineY(i, all.length);
      return { line, y, max: ovalLineMax(d.w, d.h, y) };
    });
  };
  oval
    .selectAll("text")
    .data(ovalLines)
    .join("text")
    .attr("y", (l) => l.y)
    .attr("text-anchor", "middle")
    .attr("font-size", DATA_FONT_SIZE)
    .attr("fill", color("tinta-suave"))
    .attr(M.full ? "data-check" : "data-max", (l) => l.max)
    .attr("data-keep", (l) => (M.full ? null : l.line.keep))
    .attr("data-short", (l) => l.line.short || null)
    .attr("data-keep-short", (l) => (l.line.short ? l.line.keepShort : null))
    .text((l) => l.line.text);

  // ---- Cajas de persona ----

  const node = chart
    .append("g")
    .selectAll("g")
    .data(boxes)
    .join("g")
    .attr("transform", (d) => `translate(${d.px},${d.py})`)
    .style("filter", (d) => (d.central ? "drop-shadow(var(--tema-sombra))" : null))
    .style("cursor", (d) => (d.unknown ? null : "pointer"))
    .on("click", (_event, d) => {
      if (!d.unknown) onSelectPerson?.(d.person.handle);
    });

  // El fondo de la caja; un cónyuge desconocido, en una caja gris (se
  // distingue también impresa en blanco y negro).
  const boxRect = (sel: typeof node) => sel
    .append("rect")
    .attr("width", BOX_WIDTH)
    .attr("height", bh)
    .attr("rx", BOX_R)
    .attr("ry", BOX_R)
    .attr("transform", (d) => `translate(${-BOX_WIDTH / 2},${-bh(d) / 2})`);
  boxRect(node).attr("fill", (d) => color(d.unknown ? "desconocido" : "superficie"));

  // La franja del sexo, de STRIPE px por dentro del borde izquierdo y con
  // sus esquinas redondeadas; el cónyuge desconocido no lleva.
  const cut = BOX_R - Math.sqrt(BOX_R ** 2 - (BOX_R - STRIPE) ** 2);
  node
    .filter((d) => !d.unknown)
    .append("path")
    .attr("d", (d) => {
      const x0 = -BOX_WIDTH / 2;
      const y0 = -bh(d) / 2;
      const y1 = bh(d) / 2;
      return `M${x0 + STRIPE},${y0 + cut} A${BOX_R},${BOX_R} 0 0 0 ${x0},${y0 + BOX_R} V${y1 - BOX_R}`
        + ` A${BOX_R},${BOX_R} 0 0 0 ${x0 + STRIPE},${y1 - cut} Z`;
    })
    .attr("fill", (d) => genderAccent(d.person.gender));

  // El borde, encima de la franja: la persona central, de 2 px en teja (y
  // con sombra); otra caja de la persona seleccionada, de 2 px en tinta; el
  // cónyuge desconocido, en «linea». Las personas repetidas, con borde
  // discontinuo.
  const selected = (d: PlacedBox) => !d.unknown && !d.central && d.person.handle === selectedHandle;
  boxRect(node)
    .attr("fill", "none")
    .attr("stroke", (d) => color(d.central ? "teja" : selected(d) ? "tinta" : d.unknown ? "linea" : "linea-fuerte"))
    .attr("stroke-width", (d) => (d.central || selected(d) ? 2 : 1))
    .attr("stroke-dasharray", (d) => (d.person.repeated ? "6 3" : null));

  node.append("title").text((d) => d.person.title);

  // Thumbnail: a plain <image> clipped to a rounded rect via a per-node
  // <clipPath>. IDs are namespaced per half: the ancestor and descendant
  // trees are two separate hierarchies that both start their own node-id
  // sequence at "p" (the shared root), so an unprefixed id would collide
  // between them in this one shared <svg> document. La imagen se coloca
  // después, cuando llega de Storage (fillThumbnails). En vertical, arriba
  // y centrada; en horizontal, a la izquierda y centrada en alto.
  const withImage = node.filter((d) => !!d.person.photo);
  const imgX = horizontal ? -BOX_WIDTH / 2 + IMG_PADDING : -IMG_SIZE / 2;
  // Con cajas completas en horizontal, a la misma distancia del borde de
  // arriba que en las normales, junto a la primera línea.
  const imgY = (d: PlacedBox) => (horizontal ? (M.full ? -bh(d) / 2 + (NORMALES.box.horizontal.h - IMG_SIZE) / 2 : -IMG_SIZE / 2) : -bh(d) / 2 + 8);

  const defs = svgParent.append("defs");
  defs
    .selectAll(".imgclip")
    .data(withImage.data())
    .enter()
    .append("clipPath")
    .attr("id", (d) => `imgclip-${half}-${d.key}`)
    .append("rect")
    .attr("x", imgX)
    .attr("y", imgY)
    .attr("width", IMG_SIZE)
    .attr("height", IMG_SIZE)
    .attr("rx", IMG_CORNER)
    .attr("ry", IMG_CORNER);

  withImage
    .append("rect")
    .attr("x", imgX)
    .attr("y", imgY)
    .attr("width", IMG_SIZE)
    .attr("height", IMG_SIZE)
    .attr("rx", IMG_CORNER)
    .attr("ry", IMG_CORNER)
    .attr("fill", color("superficie-hundida"));

  withImage
    .append("image")
    .attr("data-photo", (d) => d.person.photo!.handle)
    .attr("data-rect", (d) => d.person.photo!.rect?.join(",") ?? null)
    .attr("data-x", imgX)
    .attr("data-y", imgY)
    .attr("preserveAspectRatio", "none")
    .attr("clip-path", (d) => `url(#imgclip-${half}-${d.key})`);

  // El texto: en vertical, centrado bajo la foto (o su hueco), a todo el
  // ancho; en horizontal, a la derecha de la foto si la hay (per-node, since
  // only some boxes in a tree have one). La primera línea no llega al botón
  // de ficha (linkRoomOf).
  const hasImage = (d: PlacedBox) => !!d.person.photo;
  const textPadding = (d: PlacedBox) => (hasImage(d) ? IMG_SIZE + 2 * IMG_PADDING : 2 * TEXT_PADDING);
  const textWidth = (d: PlacedBox) => textWidthOf(layout, hasImage(d));
  const textX = (d: PlacedBox) => (horizontal ? -BOX_WIDTH / 2 + textPadding(d) : 0);
  const anchor = horizontal ? "start" : "middle";
  const linkRoom = (d: PlacedBox) => linkRoomOf(layout, d.photoRow);
  // Líneas de base, en huecos fijos: el nombre (dos líneas y la tercera, en
  // las filas que la necesitan o, en horizontal, en las columnas con alguna
  // foto, aunque solo la usan las cajas que la necesitan y las de foto, más
  // estrechas), el ID (en las filas con alguno), el nacimiento y la defunción. En vertical, debajo de la foto, o arriba
  // del todo en una fila sin fotos.
  const rows = (d: PlacedBox) => {
    const room = d.extraLines * lineRoom();
    // El ID, justo encima del nacimiento: debajo de la tercera línea, si la hay.
    const linea = (name: number[], id: number, birth: number, death: number) =>
      ({ name, id: id + Math.max(0, room - lineRoom()), birth: birth + room, death: death + room });
    if (horizontal) {
      const top = -bh(d) / 2;
      if (M.compact) return linea([top + 18, top + 33, top + 48], top + 48, top + 48, top + 63);
      return d.photoRow
        ? linea([top + 19, top + 34, top + 49], top + 64, top + 65, top + 80)
        : linea([top + 25, top + 42, top + 59], top + 59, top + 59, top + 76);
    }
    if (M.compact) {
      const top = -bh(d) / 2 + 17;
      return linea([top, top + 14, top + 28], top + 29, top + 29, top + 43);
    }
    const top = -bh(d) / 2 + (d.photoRow ? 25 + PHOTO_ROOM : 25);
    return linea([top, top + 16, top + 32], top + 33, top + 34, top + 50);
  };

  // El nombre de pila (con el apodo) y los apellidos en negrita, cada uno en
  // su línea; si el de pila no cabe, en dos, y los apellidos en la tercera
  // (05/11/2026; fitTexts), con el ID detrás para el administrador.
  // Sin apellidos o sin nombre de pila, el rótulo de que falta (en Gramps
  // Connect, «…», que parece un texto cortado). Un cónyuge desconocido,
  // «Cónyuge desconocido», sin negrita.
  const givenLine = (d: PlacedBox) => (d.unknown ? labels.unknownSpouse : d.person.nameGiven || labels.noGivenName);
  const surnameLine = (d: PlacedBox) => (d.unknown ? null : d.person.nameSurname || labels.noSurname);
  const suffix = (d: PlacedBox) => (d.person.grampsId ? ` [${d.person.grampsId}]` : "");
  const nameLines = (d: PlacedBox) => ((horizontal && hasImage(d)) || needsThirdLine(d.person, layout, d.photoRow) ? 3 : 2);
  if (M.full) {
    // Cajas completas (12/11/2026): las líneas ya partidas (fullText), en
    // los huecos de fullRows; data-check, lo que cabe, para ver si algo se
    // sale (fitTexts lo avisa).
    node.each(function (d) {
      const g = select(this);
      const text = fullText(d.person, layout, d.photoRow, d.unknown ? labels.unknownSpouse : undefined);
      const at = fullRows(text, layout, d.photoRow);
      const top = -bh(d) / 2;
      const put = (line: string, y: number, max: number, name: boolean) => g
        .append("text")
        .attr("y", top + y)
        .attr("x", textX(d))
        .attr("text-anchor", anchor)
        .attr("font-size", name ? null : DATA_FONT_SIZE)
        .attr("font-weight", name && !d.unknown ? 600 : null)
        .attr("fill", color(name && !d.unknown ? "tinta" : "tinta-suave"))
        .attr("data-check", max)
        .text(line);
      text.name.forEach((line, i) => put(line, at.name[i], i ? textWidth(d) : textWidth(d) - linkRoom(d), true));
      if (text.id !== null && at.id !== null) put(text.id, at.id, textWidth(d), false);
      text.data.forEach((lines, j) => lines.forEach((line, i) => put(line, at.data[j][i], textWidth(d), false)));
    });
  }
  for (const i of M.full ? [] : [0, 1, 2]) {
    node
      .filter((d) => i < nameLines(d))
      .append("text")
      .attr("y", (d) => rows(d).name[i])
      .attr("x", textX)
      .attr("text-anchor", anchor)
      .attr("font-weight", (d) => (d.unknown ? null : 600))
      .attr("fill", (d) => color(d.unknown ? "tinta-suave" : "tinta"))
      .attr("data-wrap", String(i + 1))
      .attr("data-max", (d) => (i === 0 ? textWidth(d) - linkRoom(d) : textWidth(d)))
      .attr("data-full", (d) => (i === 0 ? givenLine(d) : null))
      .attr("data-full2", (d) => (i === 0 ? surnameLine(d) : null))
      .attr("data-surname-wrap", (d) => (i === 0 && horizontal && hasImage(d) ? "" : null))
      .attr("data-suffix", (d) => (i === 0 ? suffix(d) || null : null))
      .text((d) => (i === 0 ? givenLine(d) + suffix(d) : ""));
  }

  // El ID, si va en su línea (PDF con «Incluir identificadores»).
  node
    .filter((d) => !M.full && !!d.person.idLine)
    .append("text")
    .attr("y", (d) => rows(d).id)
    .attr("x", textX)
    .attr("text-anchor", anchor)
    .attr("font-size", DATA_FONT_SIZE)
    .attr("fill", color("tinta-suave"))
    .call(lineAttrs, (d: PlacedBox) => ({ text: d.person.idLine!, keep: 0, short: "", keepShort: 0 }), textWidth);

  // Nacimiento: la línea sale siempre («n. sin datos»).
  node
    .filter(() => !M.full)
    .append("text")
    .attr("y", (d) => rows(d).birth)
    .attr("x", textX)
    .attr("text-anchor", anchor)
    .attr("font-size", DATA_FONT_SIZE)
    .attr("fill", color("tinta-suave"))
    .call(lineAttrs, (d: PlacedBox) => d.person.birth, textWidth);

  // Sin defunción (ni entierro ni incineración), no hay línea.
  node
    .filter((d) => !M.full && !!d.person.death.text)
    .append("text")
    .attr("y", (d) => rows(d).death)
    .attr("x", textX)
    .attr("text-anchor", anchor)
    .attr("font-size", DATA_FONT_SIZE)
    .attr("fill", color("tinta-suave"))
    .call(lineAttrs, (d: PlacedBox) => d.person.death, textWidth);

  // Botón de ficha: un círculo con una flecha; zona de pulsación mayor que
  // el dibujo, para el dedo. Fuera de la exportación.
  const openButton = node
    .filter((d) => !d.unknown)
    .append("g")
    .attr("data-export-exclude", "")
    .attr("transform", (d) => `translate(${BOX_WIDTH / 2 - LINK_R - 5},${-bh(d) / 2 + LINK_R + 5})`)
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      event.stopPropagation();
      onOpenPerson?.(d.person.handle);
    });
  openButton.append("title").text(labels.openPerson);
  openButton.append("rect").attr("x", -16).attr("y", -14).attr("width", 32).attr("height", 30).attr("fill", "transparent");
  openButton
    .append("circle")
    .attr("r", LINK_R)
    .attr("fill", color("superficie-hundida"))
    .attr("stroke", color("linea-fuerte"));
  openButton
    .append("path")
    .attr("d", "M-3.5,3.5 L3.5,-3.5 M-1,-3.5 L3.5,-3.5 L3.5,1")
    .attr("fill", "none")
    .attr("stroke", color("tinta"))
    .attr("stroke-width", 1.6)
    .attr("stroke-linecap", "round")
    .style("pointer-events", "none");

  // Boundary marker on any box at the edge of the drawn tree with further
  // known ancestors/descendants (TreeNode.hasMore). Aquí no amplía esa
  // rama: pulsarlo centra el gráfico en esa persona, que es la forma de
  // seguir subiendo o bajando. Va por el lado de fuera: a la izquierda o
  // arriba los ascendientes, a la derecha o abajo los descendientes.
  const HIT = 60;
  const MARKER_R = 9;
  // Centering the visible dot a few px clear of the edge keeps the whole
  // glyph inside the hit-rect and off the box.
  const markerCenter = sign * (4 + MARKER_R);

  // data-export-exclude: interactive chrome, not chart -- left out of an
  // image export (chartExport/prepareSvg.ts).
  const marker = node
    .filter((d) => d.hasMore)
    .append("g")
    .attr("data-export-exclude", "")
    .attr("transform", (d) => (horizontal ? `translate(${(sign * BOX_WIDTH) / 2},0)` : `translate(0,${(sign * bh(d)) / 2})`));

  marker.append("title").text(labels.more);

  // `stopPropagation` keeps a click here from also firing the parent
  // node `<g>`'s own click handler it sits inside of (same result today,
  // but the marker is its own target).
  marker
    .append("rect")
    .attr("x", horizontal ? (sign > 0 ? 0 : -HIT) : -BOX_WIDTH / 2)
    .attr("y", (d) => (horizontal ? -bh(d) / 2 : sign > 0 ? 0 : -HIT / 2))
    .attr("width", horizontal ? HIT : BOX_WIDTH)
    .attr("height", (d) => (horizontal ? bh(d) : HIT / 2))
    .attr("fill", "transparent")
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      event.stopPropagation();
      onSelectPerson?.(d.person.handle);
    });

  marker
    .append("circle")
    .attr("cx", horizontal ? markerCenter : 0)
    .attr("cy", horizontal ? 0 : markerCenter)
    .attr("r", MARKER_R)
    .attr("fill", color("azul"))
    .attr("stroke", color("superficie"))
    .attr("stroke-width", 2)
    .style("pointer-events", "none");

  marker
    .append("text")
    .attr("x", horizontal ? markerCenter : 0)
    .attr("y", horizontal ? 0 : markerCenter)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("fill", color("sobre-azul"))
    .attr("font-size", 13)
    .attr("font-weight", 700)
    .style("pointer-events", "none")
    .text("+");

  // «continúa en la pág. N» (PDF de varias páginas), junto al borde
  // exterior de la caja: al lado en horizontal, encima o debajo en vertical.
  const continuation = node
    .filter((d) => !!d.person.continuation)
    .append("text")
    .attr("font-size", DATA_FONT_SIZE)
    .attr("font-weight", 600)
    .attr("fill", color("tinta"))
    .text((d) => d.person.continuation!);
  if (horizontal) {
    continuation
      .attr("x", sign * (BOX_WIDTH / 2 + CONTINUATION_GAP))
      .attr("y", 4)
      .attr("text-anchor", sign > 0 ? "start" : "end");
  } else {
    continuation
      .attr("x", 0)
      // La línea base: encima, a CONTINUATION_GAP de la caja; debajo, con
      // el alto de la letra (unos 12) más ese hueco.
      .attr("y", (d) => (sign > 0 ? bh(d) / 2 + CONTINUATION_GAP + 11 : -bh(d) / 2 - CONTINUATION_GAP))
      .attr("text-anchor", "middle");
  }
}

/** Lo que se dibuja, sin dibujarlo (unidades del SVG, persona central en
 * (0, 0)): el rectángulo de cada caja (con 4 de margen por la izquierda) y
 * de cada óvalo, y puntos a lo largo de cada línea. Para saber qué hojas de un mosaico quedarían en blanco. */
export interface ChartShapes {
  rects: Bounds[];
  points: [number, number][];
}

export function treeChartShapes(
  ancestorTree: TreeNode | null, descendantTree: TreeNode | null, layout: ChartLayout = "vertical", withPoints = true, compact = false,
  full = false,
): ChartShapes {
  return conMedidas(compact, full, () => shapes(ancestorTree, descendantTree, layout, withPoints));
}

function shapes(ancestorTree: TreeNode | null, descendantTree: TreeNode | null, layout: ChartLayout, withPoints: boolean): ChartShapes {
  const rects: Bounds[] = [];
  const points: [number, number][] = [];
  const horizontal = layout === "horizontal";
  const halves: [TreeNode | null, Half][] = [[ancestorTree, "ancestors"], [descendantTree, "descendants"]];
  const rows = chartRows(ancestorTree, descendantTree, layout);
  for (const [data, half] of halves) {
    if (!data) continue;
    const { boxes, ovals, links } = layoutHalf(data, half, layout, rows[half]);
    for (const b of boxes) rects.push(boxBounds(b, half, layout));
    for (const o of ovals) rects.push(o.bounds);
    if (!withPoints) continue;
    // Las curvas de d3 (curveBumpX/Y): una bézier cúbica con los puntos de
    // control a medio camino, por el eje de las generaciones.
    for (const { source: [sx, sy], target: [tx, ty] } of links) {
      const [c1, c2]: [number, number][] = horizontal
        ? [[(sx + tx) / 2, sy], [(sx + tx) / 2, ty]]
        : [[sx, (sy + ty) / 2], [tx, (sy + ty) / 2]];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        const a = (1 - u) ** 3;
        const b = 3 * (1 - u) ** 2 * u;
        const c = 3 * (1 - u) * u ** 2;
        const e = u ** 3;
        points.push([a * sx + b * c1[0] + c * c2[0] + e * tx, a * sy + b * c1[1] + c * c2[1] + e * ty]);
      }
    }
  }
  return { rects, points };
}

/** Ancho y alto (en unidades del SVG) del gráfico completo, sin dibujarlo:
 * para repartirlo en las páginas del PDF a la letra mínima. También la
 * esquina de arriba a la izquierda (x0, y0), con la persona central en (0, 0).
 * `compact`: con las cajas pequeñas; `full`, con las completas. */
export function measureTreeChart(
  ancestorTree: TreeNode | null, descendantTree: TreeNode | null, layout: ChartLayout = "vertical", compact = false, full = false,
): { width: number; height: number; x0: number; y0: number } {
  const { rects } = treeChartShapes(ancestorTree, descendantTree, layout, false, compact, full);
  if (!rects.length) return { width: 0, height: 0, x0: 0, y0: 0 };
  const x0 = Math.min(...rects.map((r) => r.x0));
  const x1 = Math.max(...rects.map((r) => r.x1));
  const y0 = Math.min(...rects.map((r) => r.y0));
  const y1 = Math.max(...rects.map((r) => r.y1));
  return { width: x1 - x0, height: y1 - y0, x0, y0 };
}

export interface TreeChartOptions {
  bboxWidth: number;
  bboxHeight: number;
  /** Disposición: vertical (por defecto) u horizontal. */
  layout?: ChartLayout;
  /** Read off the previous render's SVG (d3-zoom's `zoomTransform`) and
   * handed back in, so panning/zooming survives a size or theme change
   * instead of resetting to identity each time. */
  initialZoom?: ZoomTransform | null;
  /** Sin `initialZoom` (primer dibujo): ampliación inicial, con la persona
   * central en el centro. */
  initialScale?: number;
  /** Pulsar una persona: quien llama decide (aquí, centrar el gráfico en
   * ella). */
  onSelectPerson?: (handle: string) => void;
  /** Pulsar el botón de ficha de una persona. */
  onOpenPerson?: (handle: string) => void;
  /** Rings the matching box (la persona central). */
  selectedHandle?: string | null;
  labels: TreeChartLabels;
  /** Cajas pequeñas (PDF del árbol). */
  compact?: boolean;
  /** Cajas completas (PDF del árbol y pantalla; 12/11/2026). */
  full?: boolean;
  /** Con un gráfico nuevo (otra persona central), true: se mantiene la
   * ampliación de `initialZoom` pero la persona central vuelve al centro,
   * con una transición. */
  recenter?: boolean;
}

const zoomBehaviors = new WeakMap<SVGSVGElement, ZoomBehavior<SVGSVGElement, undefined>>();
const ZOOM_EXTENT: [number, number] = [0.05, 4];

/** Dibuja las dos mitades (que comparten la caja de la persona central, en
 * (0, 0)) en un SVG nuevo de bboxWidth × bboxHeight, y lo devuelve: quien
 * llama lo pone en la página y lo quita. */
export function renderTreeChart(ancestorTree: TreeNode | null, descendantTree: TreeNode | null, options: TreeChartOptions): SVGSVGElement {
  return conMedidas(options.compact, options.full, () => render(ancestorTree, descendantTree, options));
}

function render(
  ancestorTree: TreeNode | null,
  descendantTree: TreeNode | null,
  {
    bboxWidth, bboxHeight, layout = "vertical", initialZoom, initialScale = 1, onSelectPerson, onOpenPerson, selectedHandle,
    labels, recenter,
  }: TreeChartOptions,
): SVGSVGElement {
  const svg = create("svg")
    // Las letras del PDF, por orden: la principal y, para los símbolos que
    // no tiene (✡, ✝…, hebreo), las de símbolos y la hebrea
    // (app/src/fuentes/simbolos.ts).
    .attr("font-family", `${PDF_FONT_FAMILY}, ${FAMILIA_SIMBOLOS}, ${FAMILIA_SIMBOLOS2}, ${FAMILIA_HEBREA}, var(--mantine-font-family)`)
    .attr("font-size", FONT_SIZE)
    // Sin esto, el navegador del móvil se queda los gestos de los dedos
    // (desplazar la página, ampliarla) en lugar de dárselos a d3-zoom.
    .style("touch-action", "none")
    .style("display", "block");
  // data-export-content: chartExport/prepareSvg.ts's own opt-in for
  // whole-chart export (pan/zoom dropped, own bounding box framed).
  const chartContent = svg.append("g").attr("id", "tree-chart-content").attr("data-export-content", "");

  // Kept as its own binding so a re-center below can animate through it
  // via `.call(zoomBehavior.transform, ...)`. El doble clic no amplía: el
  // primer clic ya ha cambiado de persona central.
  const zoomBehavior = zoom<SVGSVGElement, undefined>()
    .scaleExtent(ZOOM_EXTENT)
    .on("zoom", (e) => {
      chartContent.attr("transform", e.transform.toString());
    });
  svg.call(zoomBehavior).on("dblclick.zoom", null);
  zoomBehaviors.set(svg.node()!, zoomBehavior);

  const coreOptions: CoreOptions = { onSelectPerson, onOpenPerson, selectedHandle, labels };
  // Las dos mitades, con la persona central en (0, 0): su caja se dibuja
  // dos veces, una encima de otra.
  const rows = chartRows(ancestorTree, descendantTree, layout);
  if (descendantTree) treeChartCore(chartContent.append("g"), descendantTree, "descendants", layout, rows.descendants, coreOptions);
  if (ancestorTree) treeChartCore(chartContent.append("g"), ancestorTree, "ancestors", layout, rows.ancestors, coreOptions);

  // La vista, centrada en la persona central (no en todo el gráfico: unas
  // pocas generaciones ya no caben, y lo primero que se quiere ver es ella).
  svg.attr("viewBox", `${-bboxWidth / 2} ${-bboxHeight / 2} ${bboxWidth} ${bboxHeight}`);
  svg.attr("width", bboxWidth).attr("height", bboxHeight);
  // Centro de la vista en coordenadas del contenido, para fitAll.
  svg.attr("data-center", "0,0");

  // Con otra persona central, se conserva la ampliación pero no el
  // desplazamiento: la nueva persona vuelve al centro, deslizándose desde
  // donde estaba la vista.
  const centered = (k: number) => zoomIdentity.scale(k);
  const apply = (transform: ZoomTransform) => {
    (svg.node() as unknown as { __zoom: ZoomTransform }).__zoom = transform;
    chartContent.attr("transform", transform.toString());
  };
  if (!initialZoom) {
    apply(centered(initialScale));
  } else if (recenter) {
    apply(initialZoom);
    svg.transition().duration(300).call(zoomBehavior.transform, centered(initialZoom.k));
  } else {
    apply(initialZoom);
  }

  return svg.node()!;
}

/** Amplía (factor > 1) o reduce el gráfico sobre el centro de la vista. */
export function zoomBy(svg: SVGSVGElement, factor: number): void {
  const behavior = zoomBehaviors.get(svg);
  if (behavior) select<SVGSVGElement, undefined>(svg).transition().duration(200).call(behavior.scaleBy, factor);
}

/** Encaja todo el gráfico en la vista. */
export function fitAll(svg: SVGSVGElement): void {
  const behavior = zoomBehaviors.get(svg);
  const content = svg.querySelector<SVGGElement>("[data-export-content]");
  const [cx, cy] = (svg.getAttribute("data-center") ?? "0,0").split(",").map(Number);
  const viewBox = svg.viewBox.baseVal;
  if (!behavior || !content || !viewBox.width) return;
  const box = content.getBBox();
  if (!box.width || !box.height) return;
  const k = Math.min(ZOOM_EXTENT[1], Math.max(ZOOM_EXTENT[0], 0.95 * Math.min(viewBox.width / box.width, viewBox.height / box.height)));
  const target = zoomIdentity
    .translate(cx, cy)
    .scale(k)
    .translate(-(box.x + box.width / 2), -(box.y + box.height / 2));
  select<SVGSVGElement, undefined>(svg).transition().duration(300).call(behavior.transform, target);
}

/** Pone las fotos en las cajas que tienen, a medida que `urlOf` las
 * devuelve. Cada foto se recorta (si la referencia tiene recorte) y se
 * escala para cubrir el cuadro de la miniatura, sin deformarla. La promesa
 * se cumple cuando están todas (para exportar). */
export function fillThumbnails(svg: SVGSVGElement, urlOf: (handle: string) => Promise<string | null>): Promise<void> {
  return Promise.all(Array.from(svg.querySelectorAll<SVGImageElement>("image[data-photo]")).map((image) => {
    const handle = image.getAttribute("data-photo")!;
    return urlOf(handle).then(async (url) => {
      if (!url) {
        image.remove();
        return;
      }
      const size = await naturalSize(url);
      if (!size || !image.isConnected) return;
      const region = image.getAttribute("data-rect");
      const [x1, y1, x2, y2] = (region?.split(",").map(Number) ?? [0, 0, 100, 100]);
      const cropW = ((x2 - x1) / 100) * size.width;
      const cropH = ((y2 - y1) / 100) * size.height;
      if (cropW <= 0 || cropH <= 0) return;
      const scale = IMG_SIZE / Math.min(cropW, cropH);
      // Sin región, una foto vertical cubre el cuadro anclada arriba (se
      // pierde la parte de abajo, no la cabeza); las demás, centradas
      // (decisión del 29/10/2026).
      const arriba = !region && cropH > cropW;
      const x = Number(image.getAttribute("data-x")) - (x1 / 100) * size.width * scale - (cropW * scale - IMG_SIZE) / 2;
      const y = Number(image.getAttribute("data-y")) - (y1 / 100) * size.height * scale - (arriba ? 0 : (cropH * scale - IMG_SIZE) / 2);
      image.setAttribute("x", String(x));
      image.setAttribute("y", String(y));
      image.setAttribute("width", String(size.width * scale));
      image.setAttribute("height", String(size.height * scale));
      image.setAttribute("href", url);
    });
  })).then(() => undefined);
}

const sizes = new Map<string, Promise<{ width: number; height: number } | null>>();

function naturalSize(url: string): Promise<{ width: number; height: number } | null> {
  let size = sizes.get(url);
  if (!size) {
    size = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
    });
    sizes.set(url, size);
  }
  return size;
}
