// Fuentes que se incrustan en el PDF (Noto Sans recortada; licencia OFL
// en fuentes/OFL.txt).
//
// Procede de Gramps Connect (https://github.com/dsblank/gramps-connect,
// app/src/store/chartExport/pdfFonts.ts, commit 884ad35),
// AGPL-3.0-or-later. MODIFICADO el 22/10/2026 (detalle en ../ORIGEN.md):
// rutas de las fuentes, rangos de caracteres corregidos a los que tienen
// de verdad los ficheros recortados, y loadBrowserFonts (la misma letra en
// pantalla que en el PDF).

import type { jsPDF } from "jspdf";
import notoRegularUrl from "./fuentes/NotoSans-Regular-subset.ttf?url";
import notoBoldUrl from "./fuentes/NotoSans-Bold-subset.ttf?url";

/** The family name PDF export registers the embedded fonts under, and
 * rewrites every chart text element's own font-family to. */
export const PDF_FONT_FAMILY = "NotoSans";

/** Code point ranges the subsetted Noto Sans TTFs cover. Leídos de la
 * tabla cmap de los dos ficheros (son iguales): Noto Sans no tiene flechas,
 * signo menos, círculos numerados, formas geométricas ni símbolos varios,
 * aunque el script de Gramps Connect los pida al recortarla, así que esos
 * bloques no se cuentan como cubiertos (saldrían como cuadraditos). */
const PDF_FONT_RANGES: [number, number][] = [
  [0x0020, 0x007e],
  [0x00a0, 0x0377],
  [0x037a, 0x037f],
  [0x0384, 0x038a],
  [0x038c, 0x038c],
  [0x038e, 0x03a1],
  [0x03a3, 0x03e1],
  [0x03f0, 0x052f],
  [0x1e00, 0x1eff],
  [0x2000, 0x2064],
  [0x2066, 0x206f],
  [0x20a0, 0x20bf],
  [0x2100, 0x214f],
];

/** Whether every character of `text` can be drawn by the embedded fonts --
 * when not (CJK, Arabic, Hebrew, Indic, ...), PDF export embeds an image of
 * the chart instead of vector text, since jsPDF would otherwise draw those
 * characters as garbage (and does no complex-script shaping either way). */
export function pdfFontsCover(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20) continue;
    if (!PDF_FONT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) return false;
  }
  return true;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

interface FontData {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

let fontData: Promise<FontData> | null = null;

/** Fetched once per session, on the first PDF export only -- never part of
 * the main bundle. */
function loadFontData(): Promise<FontData> {
  fontData ??= Promise.all(
    [notoRegularUrl, notoBoldUrl].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Couldn't load the PDF font (${response.status})`);
      return response.arrayBuffer();
    }),
  ).then(([regular, bold]) => ({ regular, bold }));
  fontData.catch(() => {
    fontData = null;
  });
  return fontData;
}

let browserFontsAdded = false;

/** svg2pdf measures each label's width in the *browser* (an offscreen
 * `<text>`'s getBBox) to apply `text-anchor="middle"`, but draws it with
 * jsPDF's embedded font -- so unless the browser knows PDF_FONT_FAMILY too,
 * it measures with some fallback font and every centered label lands a
 * little off. Registering the very same TTFs as a FontFace makes the two
 * agree exactly. Best effort: no FontFace support just means slightly
 * looser centering. */
async function addBrowserFonts({ regular, bold }: FontData): Promise<void> {
  if (browserFontsAdded || typeof FontFace === "undefined" || !document.fonts) return;
  const faces = [
    new FontFace(PDF_FONT_FAMILY, regular.slice(0), { weight: "400" }),
    new FontFace(PDF_FONT_FAMILY, bold.slice(0), { weight: "700" }),
  ];
  await Promise.all(faces.map((face) => face.load()));
  faces.forEach((face) => document.fonts.add(face));
  browserFontsAdded = true;
}

/** Da a conocer al navegador las fuentes del PDF, para que el gráfico se
 * dibuje en pantalla con la misma letra que tendrá en el PDF (y lo que se
 * recorta para caber en una caja, quepa igual en el papel). Si falla, el
 * gráfico usa la letra de la web. */
export async function loadBrowserFonts(): Promise<void> {
  try {
    await addBrowserFonts(await loadFontData());
  } catch {
    // sin las fuentes: la letra de la web
  }
}

export async function registerPdfFonts(doc: jsPDF): Promise<void> {
  const data = await loadFontData();
  await addBrowserFonts(data).catch(() => undefined);
  doc.addFileToVFS("NotoSans-Regular.ttf", arrayBufferToBase64(data.regular));
  doc.addFont("NotoSans-Regular.ttf", PDF_FONT_FAMILY, "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", arrayBufferToBase64(data.bold));
  doc.addFont("NotoSans-Bold.ttf", PDF_FONT_FAMILY, "bold");
}
