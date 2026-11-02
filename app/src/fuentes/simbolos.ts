// Letras de símbolos y hebrea para el árbol, su PDF y el libro: Noto Sans
// Symbols y Noto Sans Symbols 2, recortadas a los bloques de símbolos, y
// Noto Sans Hebrew, normal y negrita (origen y cómo se han hecho en
// LEEME.md; licencia SIL Open Font License 1.1 en OFL.txt y
// OFL-hebrew.txt).
//
// Hebreo (decisión del 22/10/2026): jsPDF da la vuelta a cada texto de
// derecha a izquierda que escribe (su motor bidireccional), así que basta
// con que cada tramo en hebreo vaya entero en un solo texto: los espacios,
// cifras y signos entre dos letras hebreas van con la letra hebrea
// (familiasDe). jsPDF no coloca los signos vocálicos (niqud) como lo haría
// un navegador: el hebreo sin niqud, que es el habitual, sale bien.
//
// La letra principal del PDF (Noto Sans, en gramps-connect/chartExport)
// no tiene ✡, ✝, ⚭, ⚰… Con estas dos, los símbolos de nacimiento y
// defunción (también los personalizados) siguen siendo texto en el PDF en
// lugar de pasar el árbol a imagen. En pantalla, el navegador elige la
// letra de cada carácter por orden (font-family); en el PDF, svg2pdf usa
// una sola letra por trozo de texto, así que separarSimbolos parte cada
// texto en trozos con la letra que tiene cada carácter, en el mismo orden.

import type { jsPDF } from "jspdf";
import { pdfFontsCover } from "../gramps-connect/chartExport/pdfFonts";
import urlSimbolos from "./NotoSansSymbols-subset.ttf?url";
import urlSimbolos2 from "./NotoSansSymbols2-subset.ttf?url";
import urlHebrea from "./NotoSansHebrew-Regular-subset.ttf?url";
import urlHebreaNegrita from "./NotoSansHebrew-Bold-subset.ttf?url";

export const FAMILIA_SIMBOLOS = "NotoSansSymbols";
export const FAMILIA_SIMBOLOS2 = "NotoSansSymbols2";
export const FAMILIA_HEBREA = "NotoSansHebrew";

/** Letras que tienen negrita propia (las de símbolos, no). */
export const CON_NEGRITA = new Set([FAMILIA_HEBREA]);

// Caracteres de cada fichero, leídos de su tabla cmap al recortarlos.
const RANGOS: [string, [number, number][]][] = [
  [FAMILIA_SIMBOLOS, [
    [0x2190, 0x2199], [0x260a, 0x260d], [0x2613, 0x2613], [0x2624, 0x262f], [0x2638, 0x263b], [0x263d, 0x2653],
    [0x2669, 0x267e], [0x2690, 0x269d], [0x26a2, 0x26a9], [0x26ad, 0x26bc], [0x26ce, 0x26ce], [0x26e2, 0x26ff],
    [0x271d, 0x2721], [0x2776, 0x2793],
  ]],
  [FAMILIA_SIMBOLOS2, [
    [0x21af, 0x21af], [0x21e6, 0x21f0], [0x21f3, 0x21f3], [0x2212, 0x2212], [0x2218, 0x2219], [0x2299, 0x2299],
    [0x22c4, 0x22c6], [0x25a0, 0x2609], [0x260e, 0x2612], [0x2614, 0x2623], [0x2630, 0x2637], [0x263c, 0x263c],
    [0x2654, 0x2668], [0x267f, 0x268f], [0x269e, 0x26a1], [0x26aa, 0x26ac], [0x26bd, 0x26cd], [0x26cf, 0x26e1],
    [0x2700, 0x2704], [0x2706, 0x2709], [0x270b, 0x271c], [0x2722, 0x2727], [0x2729, 0x274b], [0x274d, 0x274d],
    [0x274f, 0x2753], [0x2756, 0x2775], [0x2794, 0x2794], [0x2798, 0x27af], [0x27b1, 0x27be], [0x2b00, 0x2b0d],
    [0x2b12, 0x2b2f], [0x2b4d, 0x2b73], [0x2b76, 0x2b95], [0x2b97, 0x2bfd], [0x2bff, 0x2bff],
  ]],
  // Solo las letras y signos hebreos; el fichero tiene también espacios,
  // cifras y signos de puntuación (NEUTROS_HEBREA).
  [FAMILIA_HEBREA, [
    [0x0591, 0x05c7], [0x05d0, 0x05ea], [0x05ef, 0x05f4], [0x20aa, 0x20aa], [0xfb1d, 0xfb36], [0xfb38, 0xfb3c],
    [0xfb3e, 0xfb3e], [0xfb40, 0xfb41], [0xfb43, 0xfb44], [0xfb46, 0xfb4f],
  ]],
];

/** Caracteres sin dirección propia (espacios, cifras, puntuación) que
 * también tiene la letra hebrea: entre dos letras hebreas, van con ella. */
const NEUTROS_HEBREA: [number, number][] = [
  [0x0020, 0x0040], [0x005b, 0x0060], [0x007b, 0x007e], [0x00a0, 0x00a0], [0x2010, 0x2010], [0x2013, 0x2014],
  [0x2018, 0x201a], [0x201c, 0x201e], [0x2026, 0x2026],
];
const enRangos = (cp: number, rangos: [number, number][]) => rangos.some(([a, b]) => cp >= a && cp <= b);

/** Selectores de variante (U+FE0E y U+FE0F): no se dibujan, solo eligen
 * entre texto y emoji en pantalla. En el PDF se quitan. */
const SELECTOR = /[︎️]/g;

/** "" si lo tiene la letra principal; el nombre de la letra de símbolos
 * que lo tiene; o null si no lo tiene ninguna. */
export function letraDe(caracter: string): string | null {
  if (pdfFontsCover(caracter)) return "";
  const cp = caracter.codePointAt(0)!;
  for (const [familia, rangos] of RANGOS) {
    if (rangos.some(([a, b]) => cp >= a && cp <= b)) return familia;
  }
  return null;
}

/** La letra de cada carácter (como letraDe), con los neutros que quedan
 * entre dos letras hebreas pasados a la letra hebrea, para que cada tramo
 * en hebreo se escriba de una vez (y jsPDF lo ponga de derecha a
 * izquierda). Un carácter por elemento (puntos de código, no unidades de
 * UTF-16). */
export function familiasDe(texto: string): { caracter: string; letra: string | null }[] {
  const out = Array.from(texto, (caracter) => ({ caracter, letra: letraDe(caracter) }));
  let ultimaHebrea = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].letra !== FAMILIA_HEBREA) continue;
    if (ultimaHebrea >= 0 && ultimaHebrea < i - 1) {
      const entre = out.slice(ultimaHebrea + 1, i);
      if (entre.every((c) => enRangos(c.caracter.codePointAt(0)!, NEUTROS_HEBREA))) {
        for (const c of entre) c.letra = FAMILIA_HEBREA;
      }
    }
    ultimaHebrea = i;
  }
  return out;
}

/** ¿Tienen las letras del PDF (la principal, las de símbolos y la
 * hebrea) todos los caracteres del texto? */
export function cubreTodo(texto: string): boolean {
  for (const c of texto.replace(SELECTOR, "")) if (letraDe(c) === null) return false;
  return true;
}

let datos: Promise<ArrayBuffer[]> | null = null;
function cargar(): Promise<ArrayBuffer[]> {
  datos ??= Promise.all([urlSimbolos, urlSimbolos2, urlHebrea, urlHebreaNegrita].map(async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se ha podido cargar la letra de símbolos (${r.status})`);
    return r.arrayBuffer();
  }));
  datos.catch(() => {
    datos = null;
  });
  return datos;
}

let enNavegador = false;
/** Da a conocer las letras de símbolos al navegador (para dibujar y medir
 * igual que en el PDF). Si falla, el navegador usa las suyas. */
export async function cargarSimbolosNavegador(): Promise<void> {
  if (enNavegador || typeof FontFace === "undefined" || !document.fonts) return;
  try {
    const [a, b, h, hn] = await cargar();
    const caras = [
      new FontFace(FAMILIA_SIMBOLOS, a.slice(0)), new FontFace(FAMILIA_SIMBOLOS2, b.slice(0)),
      new FontFace(FAMILIA_HEBREA, h.slice(0), { weight: "400" }), new FontFace(FAMILIA_HEBREA, hn.slice(0), { weight: "700" }),
    ];
    await Promise.all(caras.map((c) => c.load()));
    caras.forEach((c) => document.fonts.add(c));
    enNavegador = true;
  } catch {
    // sin las letras de símbolos: las del navegador
  }
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Incrusta las letras de símbolos y la hebrea en el PDF (de cada una, solo
 * los caracteres que aparecen). */
export async function registrarSimbolosPdf(doc: jsPDF): Promise<void> {
  const [a, b, h, hn] = await cargar();
  doc.addFileToVFS("NotoSansSymbols.ttf", base64(a));
  doc.addFont("NotoSansSymbols.ttf", FAMILIA_SIMBOLOS, "normal");
  doc.addFileToVFS("NotoSansSymbols2.ttf", base64(b));
  doc.addFont("NotoSansSymbols2.ttf", FAMILIA_SIMBOLOS2, "normal");
  doc.addFileToVFS("NotoSansHebrew-Regular.ttf", base64(h));
  doc.addFont("NotoSansHebrew-Regular.ttf", FAMILIA_HEBREA, "normal");
  doc.addFileToVFS("NotoSansHebrew-Bold.ttf", base64(hn));
  doc.addFont("NotoSansHebrew-Bold.ttf", FAMILIA_HEBREA, "bold");
}

/** Para svg2pdf: parte cada texto del SVG en trozos (tspan) según la letra
 * que tiene cada carácter (familiasDe), y quita los selectores de variante.
 * Los trozos de símbolos van en normal (las letras de símbolos no tienen
 * negrita). */
export function separarSimbolos(svg: SVGSVGElement): void {
  const NS = "http://www.w3.org/2000/svg";
  for (const texto of Array.from(svg.querySelectorAll("text"))) {
    if (texto.children.length) continue;
    const contenido = (texto.textContent ?? "").replace(SELECTOR, "");
    const trozos: { letra: string; texto: string }[] = [];
    for (const { caracter: c, letra: l } of familiasDe(contenido)) {
      const letra = l ?? "";
      const ultimo = trozos.at(-1);
      if (ultimo && ultimo.letra === letra) ultimo.texto += c;
      else trozos.push({ letra, texto: c });
    }
    if (!trozos.some((t) => t.letra)) {
      texto.textContent = contenido;
      continue;
    }
    texto.textContent = "";
    for (const t of trozos) {
      const tspan = document.createElementNS(NS, "tspan");
      if (t.letra) {
        tspan.setAttribute("font-family", t.letra);
        if (!CON_NEGRITA.has(t.letra)) tspan.setAttribute("font-weight", "normal");
      }
      tspan.textContent = t.texto;
      texto.appendChild(tspan);
    }
  }
}
