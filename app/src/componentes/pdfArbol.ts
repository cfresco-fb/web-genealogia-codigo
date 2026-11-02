// PDF del árbol: páginas de continuación, una sola página o mosaico (el reparto lo decide
// app/src/arbol/paginasPdf.ts). Cada página se dibuja fuera de la pantalla
// con el mismo gráfico que se ve (renderTreeChart) y se pasa al PDF con las
// piezas de exportación de Gramps Connect (chartExport/).

import type { jsPDF } from "jspdf";
import {
  adaptForSvg2pdf, chartText, PDF_IMAGE_DPI, rasterize, rasterSize, SAFE_CANVAS_AREA, saveBlob, withAttached,
} from "../gramps-connect/chartExport/exportChart";
import { loadBrowserFonts, PDF_FONT_FAMILY, pdfFontsCover, registerPdfFonts } from "../gramps-connect/chartExport/pdfFonts";
import { cargarSimbolosNavegador, cubreTodo, registrarSimbolosPdf, separarSimbolos } from "../fuentes/simbolos";
import { prepareExportSvg, type PreparedSvg } from "../gramps-connect/chartExport/prepareSvg";
import {
  fillThumbnails, fitTexts, renderTreeChart, type ChartLayout, type TreeChartLabels,
} from "../gramps-connect/graficos/charts/treeChart";
import {
  CABECERA_MOSAICO_MM, ESCALA_MINIMA, hojaDe, hojasConContenido, MARGEN_MM, PIE_MM, type PaginaPlan, type PapelArbol, type Plan,
  type PlanMosaico,
} from "../arbol/paginasPdf";
import type { ChartShapes } from "../gramps-connect/graficos/charts/treeChart";
import type { DatosGrafico } from "../arbol/grafico";

/** Lo que hace falta para dibujar cualquier página. */
export interface Dibujo {
  labels: TreeChartLabels;
  photoUrl: (handle: string) => Promise<string | null>;
  /** Vertical u horizontal: la misma con la que se ha hecho el reparto en
   * páginas (paginasPdf.ts). */
  layout: ChartLayout;
}

export interface Textos {
  titulo: string;
  subtitulo: string;
  pie: string;
}

/** Dibuja un árbol fuera de la pantalla y lo deja listo para el PDF. */
async function prepararArbol(datos: DatosGrafico, central: string, dibujo: Dibujo): Promise<PreparedSvg> {
  await Promise.all([loadBrowserFonts(), cargarSimbolosNavegador()]);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:1000px;height:800px;visibility:hidden";
  document.body.appendChild(host);
  try {
    const svg = renderTreeChart(datos.ascendientes, datos.descendientes, {
      bboxWidth: 1000, bboxHeight: 800, layout: dibujo.layout, initialScale: 1, selectedHandle: central, labels: dibujo.labels,
      compact: datos.sencillas,
    });
    host.appendChild(svg);
    fitTexts(svg);
    await fillThumbnails(svg, dibujo.photoUrl);
    return await prepareExportSvg(svg, { area: "whole", colors: "light", keepRotation: false, background: true });
  } finally {
    host.remove();
  }
}

/** Una línea centrada; si no cabe a lo ancho, con letra más pequeña (sin
 * bajar de `minimo` puntos). */
function lineaCentrada(doc: jsPDF, texto: string, ancho: number, y: number, pt: number, minimo: number) {
  doc.setFontSize(pt);
  const util = ancho - 2 * MARGEN_MM;
  const w = doc.getTextWidth(texto);
  if (w > util) doc.setFontSize(Math.max(minimo, (pt * util) / w));
  doc.text(texto, ancho / 2, y, { align: "center", baseline: "middle" });
}

/** Título, subtítulo y pie de página, con la letra incrustada si la cubre.
 * En la primera página, el título grande y el subtítulo debajo; en las de
 * continuación, una línea pequeña: «Título · Continuación» (decisión del
 * 23/10/2026, «Opciones de los PDF»). */
function cabeceraYPie(doc: jsPDF, ancho: number, alto: number, textos: Textos, fuente: string, primera: boolean) {
  doc.setTextColor("#000000");
  if (primera) {
    doc.setFont(fuente, "bold");
    lineaCentrada(doc, textos.titulo, ancho, MARGEN_MM + 6, 18, 11);
    doc.setFont(fuente, "normal");
    if (textos.subtitulo) lineaCentrada(doc, textos.subtitulo, ancho, MARGEN_MM + 14, 11, 8);
  } else {
    doc.setFont(fuente, "normal");
    lineaCentrada(doc, [textos.titulo, textos.subtitulo].filter(Boolean).join(" · "), ancho, MARGEN_MM + 3, 10, 8);
  }
  doc.setFont(fuente, "normal");
  doc.setFontSize(9);
  if (textos.pie) doc.text(textos.pie, ancho / 2, alto - MARGEN_MM / 2 - PIE_MM / 4, { align: "center", baseline: "middle" });
}

/** Las letras de símbolos, incrustadas una vez por documento. */
const conSimbolos = new WeakSet<jsPDF>();

/** Para svg2pdf: la letra principal en todo el SVG y, en los caracteres
 * que no tiene, las de símbolos (incrustadas en el documento). */
async function prepararLetras(doc: jsPDF, svg: SVGSVGElement): Promise<void> {
  if (!conSimbolos.has(doc)) {
    await registrarSimbolosPdf(doc);
    conSimbolos.add(doc);
  }
  adaptForSvg2pdf(svg);
  separarSimbolos(svg);
}

/** Pone el árbol en la página: vectorial si las letras incrustadas (la
 * principal y las de símbolos) cubren todo su texto; si no, como imagen.
 * Devuelve true si fue como imagen. */
async function ponerArbol(
  doc: jsPDF, svg2pdf: typeof import("svg2pdf.js").svg2pdf, preparado: PreparedSvg,
  zona: { x: number; y: number; width: number; height: number },
): Promise<boolean> {
  const { svg, width, height, backgroundColor } = preparado;
  if (cubreTodo(chartText(svg))) {
    await prepararLetras(doc, svg);
    await withAttached(svg, () => svg2pdf(svg, doc, zona));
    return false;
  }
  const ideal = rasterSize(width, height, (Math.max(zona.width, zona.height) / 25.4) * PDF_IMAGE_DPI);
  const reducir = Math.min(1, Math.sqrt(SAFE_CANVAS_AREA / (ideal.width * ideal.height)));
  const png = await rasterize(svg, Math.max(1, Math.floor(ideal.width * reducir)), Math.max(1, Math.floor(ideal.height * reducir)), "image/png", backgroundColor);
  doc.addImage(new Uint8Array(await png.arrayBuffer()), "PNG", zona.x, zona.y, zona.width, zona.height, undefined, "FAST");
  return true;
}

export async function nuevoDocumento(): Promise<{ crear: (w: number, h: number) => jsPDF; svg2pdf: typeof import("svg2pdf.js").svg2pdf }> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  return {
    crear: (w, h) => new jsPDF({ unit: "mm", format: [w, h], orientation: w > h ? "landscape" : "portrait" }),
    svg2pdf,
  };
}

/** Fuente para títulos y pies: la incrustada si cubre los textos. */
export async function fuenteTextos(doc: jsPDF, textos: string): Promise<string> {
  if (!pdfFontsCover(textos)) return "helvetica";
  await registerPdfFonts(doc);
  return PDF_FONT_FAMILY;
}

export interface Resultado {
  /** Alguna página fue como imagen (letras que la fuente no tiene). */
  comoImagen: boolean;
}

/** PDF con las páginas del plan. `textos(p)` da el título, el subtítulo,
 * el pie y el encabezado de cada bloque de la página. `progreso(i, n)`
 * avisa de cómo va (por bloques). */
export async function exportarPaginas(
  plan: Plan, papel: PapelArbol, textos: (p: PaginaPlan) => Textos & { bloques: string[] }, dibujo: Dibujo, fichero: string,
  progreso: (hecho: number, total: number) => void,
): Promise<Resultado> {
  const { crear, svg2pdf } = await nuevoDocumento();
  const { ancho, alto } = hojaDe(plan, papel);
  const doc = crear(ancho, alto);
  const todos = plan.paginas.map((p) => textos(p));
  const fuente = await fuenteTextos(doc, todos.map((x) => [x.titulo, x.subtitulo, x.pie, ...x.bloques].join("")).join(""));
  const comoImagen = await dibujarPaginasArbol(doc, svg2pdf, plan, papel, todos, fuente, dibujo, progreso, false);
  doc.setProperties({ title: todos[0].titulo });
  saveBlob(doc.output("blob"), `${fichero}.pdf`);
  return { comoImagen };
}

/** Dibuja las páginas del plan en `doc`: la primera en la página actual
 * o, con `nuevaPrimera`, en una página nueva (como las demás). Devuelve
 * true si alguna fue como imagen. */
export async function dibujarPaginasArbol(
  doc: jsPDF, svg2pdf: typeof import("svg2pdf.js").svg2pdf, plan: Plan, papel: PapelArbol,
  todos: (Textos & { bloques: string[] })[], fuente: string, dibujo: Dibujo,
  progreso: (hecho: number, total: number) => void, nuevaPrimera: boolean,
): Promise<boolean> {
  const { ancho, alto } = hojaDe(plan, papel);
  const total = plan.paginas.reduce((n, p) => n + p.bloques.length, 0);
  let hechos = 0;
  let comoImagen = false;
  for (const [i, p] of plan.paginas.entries()) {
    if (i > 0 || nuevaPrimera) doc.addPage([ancho, alto], plan.orientacion);
    cabeceraYPie(doc, ancho, alto, todos[i], fuente, p.numero === 1);
    const { escala, posiciones } = p.composicion;
    for (const [j, b] of p.bloques.entries()) {
      progreso(hechos++, total);
      const pos = posiciones[j];
      if (pos.cabeceraY !== null) {
        doc.setTextColor("#000000");
        doc.setFont(fuente, "bold");
        doc.setFontSize(10);
        doc.text(todos[i].bloques[j], ancho / 2, pos.cabeceraY, { align: "center", baseline: "middle" });
        // svg2pdf hereda la letra actual en los textos sin grosor propio: si
        // se queda en negrita, las fechas saldrían en negrita.
        doc.setFont(fuente, "normal");
      }
      const preparado = await prepararArbol(b.datos, b.persona.handle, dibujo);
      // A la escala de la página (la misma para todos sus bloques). El árbol
      // de verdad mide algo menos que lo calculado: se centra en su hueco.
      const w = preparado.width * escala;
      const h = preparado.height * escala;
      const zona = { x: (ancho - w) / 2, y: pos.y + (pos.alto - h) / 2, width: w, height: h };
      if (await ponerArbol(doc, svg2pdf, preparado, zona)) comoImagen = true;
    }
  }
  progreso(total, total);
  return comoImagen;
}

/** PDF en mosaico: el árbol entero a la escala de la letra mínima, partido
 * en hojas, con marcas de corte en las esquinas de cada trozo y, arriba,
 * qué hoja es y en qué fila y columna va. Sin las hojas que quedarían en
 * blanco. `formas`: lo que se dibuja (treeChartShapes), para saber cuáles. */
export async function exportarMosaico(
  datos: DatosGrafico, formas: ChartShapes, central: string, plan: PlanMosaico,
  textos: {
    titulo: string;
    /** Al pie de la primera hoja. */
    pie: string;
    hoja: (n: number, total: number, fila: number, columna: number, filas: number, columnas: number) => string;
  },
  dibujo: Dibujo, fichero: string,
): Promise<Resultado> {
  const { crear, svg2pdf } = await nuevoDocumento();
  const preparado = await prepararArbol(datos, central, dibujo);
  const ancho = preparado.width * ESCALA_MINIMA;
  const alto = preparado.height * ESCALA_MINIMA;
  // Con el árbol de verdad (algo menor que el calculado) pueden sobrar
  // filas o columnas.
  const filas = Math.max(1, Math.min(plan.filas, Math.ceil(alto / plan.utilAlto - 1e-9)));
  const columnas = Math.max(1, Math.min(plan.columnas, Math.ceil(ancho / plan.utilAncho - 1e-9)));
  // Las hojas con algo, con el encuadre de verdad (el viewBox del SVG
  // preparado: dónde empieza el árbol).
  const [vx, vy] = (preparado.svg.getAttribute("viewBox") ?? "0 0").split(/[\s,]+/).map(Number);
  const hojas = hojasConContenido(formas, { x: vx, y: vy }, filas, columnas, plan.utilAncho, plan.utilAlto);
  const total = hojas.length;
  const doc = crear(plan.pageWidth, plan.pageHeight);
  const todas = hojas.map((h, i) => textos.hoja(i + 1, total, h.fila + 1, h.columna + 1, filas, columnas));
  const fuente = await fuenteTextos(doc, textos.titulo + textos.pie + todas.join(""));
  // Si va como imagen, una sola imagen para todas las hojas.
  const vectorial = cubreTodo(chartText(preparado.svg));
  if (vectorial) await prepararLetras(doc, preparado.svg);
  let imagen: Uint8Array | null = null;
  if (!vectorial) {
    const ideal = rasterSize(preparado.width, preparado.height, (Math.max(ancho, alto) / 25.4) * PDF_IMAGE_DPI);
    const reducir = Math.min(1, Math.sqrt(SAFE_CANVAS_AREA / (ideal.width * ideal.height)));
    const png = await rasterize(preparado.svg, Math.max(1, Math.floor(ideal.width * reducir)), Math.max(1, Math.floor(ideal.height * reducir)), "image/png", preparado.backgroundColor);
    imagen = new Uint8Array(await png.arrayBuffer());
  }
  const x0 = MARGEN_MM;
  const y0 = MARGEN_MM + CABECERA_MOSAICO_MM;
  const MARCA = 5;
  for (const [i, { fila, columna }] of hojas.entries()) {
    if (i > 0) doc.addPage([plan.pageWidth, plan.pageHeight], plan.orientacion);
    doc.setTextColor("#000000");
    doc.setFont(fuente, "bold");
    doc.setFontSize(11);
    doc.text(textos.titulo, plan.pageWidth / 2, MARGEN_MM + 3, { align: "center", baseline: "middle" });
    doc.setFont(fuente, "normal");
    doc.setFontSize(9);
    doc.text(todas[i], plan.pageWidth / 2, MARGEN_MM + 9, { align: "center", baseline: "middle" });
    if (i === 0 && textos.pie) {
      doc.text(textos.pie, plan.pageWidth / 2, plan.pageHeight - MARGEN_MM / 2, { align: "center", baseline: "middle" });
    }
    // El trozo de árbol de esta hoja: todo el árbol, desplazado y recortado.
    const zona = { x: x0 - columna * plan.utilAncho, y: y0 - fila * plan.utilAlto, width: ancho, height: alto };
    doc.saveGraphicsState();
    doc.rect(x0, y0, plan.utilAncho, plan.utilAlto, null);
    doc.clip();
    doc.discardPath();
    if (imagen) doc.addImage(imagen, "PNG", zona.x, zona.y, zona.width, zona.height, "arbol", "FAST");
    else await withAttached(preparado.svg, () => svg2pdf(preparado.svg, doc, zona));
    doc.restoreGraphicsState();
    // Marcas de corte: en las cuatro esquinas del trozo, por fuera.
    doc.setDrawColor("#000000");
    doc.setLineWidth(0.2);
    for (const [x, y, dx, dy] of [
      [x0, y0, -1, -1], [x0 + plan.utilAncho, y0, 1, -1],
      [x0, y0 + plan.utilAlto, -1, 1], [x0 + plan.utilAncho, y0 + plan.utilAlto, 1, 1],
    ]) {
      doc.line(x, y, x + dx * MARCA, y);
      doc.line(x, y, x, y + dy * MARCA);
    }
  }
  doc.setProperties({ title: textos.titulo });
  saveBlob(doc.output("blob"), `${fichero}.pdf`);
  return { comoImagen: !vectorial };
}
