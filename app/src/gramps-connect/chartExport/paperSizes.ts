// Tamaños de papel y colocación del gráfico en la página del PDF.
//
// Procede de Gramps Connect (https://github.com/dsblank/gramps-connect,
// app/src/store/chartExport/paperSizes.ts, commit 884ad35),
// AGPL-3.0-or-later. MODIFICADO el 22/10/2026 (detalle en ../ORIGEN.md):
// hueco para el título encima del gráfico (headerMm) y orientación
// automática según cuál deja el gráfico más grande, no según su forma.

/** Paper sizes PDF export offers, portrait width x height in millimeters. */
export const PAPER_SIZES = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  B3: [353, 500],
  B4: [250, 353],
  B5: [176, 250],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8],
  "ANSI C": [431.8, 558.8],
  "ANSI D": [558.8, 863.6],
} as const satisfies Record<string, readonly [number, number]>;

export type PaperSize = keyof typeof PAPER_SIZES;
/** "auto" picks whichever orientation matches the chart's own shape. */
export type PaperOrientation = "auto" | "portrait" | "landscape";

export interface PageLayout {
  /** Page size in mm, already oriented. */
  pageWidth: number;
  pageHeight: number;
  /** Where the chart lands on the page, in mm -- scaled to fit inside the
   * margins, aspect ratio kept, centered. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `headerMm`: alto reservado arriba, dentro del margen, para el título. */
export function layoutOnPage(
  chartWidth: number,
  chartHeight: number,
  paper: PaperSize,
  orientation: PaperOrientation,
  marginMm: number,
  headerMm = 0,
): PageLayout {
  // Automática: la orientación en la que el gráfico sale más grande (con
  // el título, no siempre coincide con la forma del gráfico).
  if (orientation === "auto") {
    const portrait = layoutOnPage(chartWidth, chartHeight, paper, "portrait", marginMm, headerMm);
    const landscape = layoutOnPage(chartWidth, chartHeight, paper, "landscape", marginMm, headerMm);
    return landscape.width > portrait.width ? landscape : portrait;
  }
  const [short, long] = PAPER_SIZES[paper];
  const landscape = orientation === "landscape";
  const pageWidth = landscape ? long : short;
  const pageHeight = landscape ? short : long;
  const margin = Math.max(0, Math.min(marginMm, Math.min(pageWidth, pageHeight) / 2 - 1));
  const availW = pageWidth - 2 * margin;
  const availH = pageHeight - 2 * margin - headerMm;
  const scale = Math.min(availW / chartWidth, availH / chartHeight);
  const width = chartWidth * scale;
  const height = chartHeight * scale;
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: margin + headerMm + (availH - height) / 2, width, height };
}
