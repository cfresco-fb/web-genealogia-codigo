// Componente del gráfico de árbol: mide su hueco, dibuja con treeChart.ts
// y conserva la ampliación entre dibujos.
//
// Procede de Gramps Connect (https://github.com/dsblank/gramps-connect,
// app/src/components/visuals/TreeChart.tsx, commit 884ad35),
// AGPL-3.0-or-later. MODIFICADO el 22/10/2026 para esta web (detalle en
// ../../ORIGEN.md): sin ampliación perezosa por ramas (ni su observador de
// visibilidad) ni miniaturas con token de gramps-web-api; las fotos llegan
// de Storage (fillThumbnails); al cambiar de persona central, esta vuelve
// al centro; espera a la letra del PDF y recorta los textos midiéndolos
// (fitTexts); expone ampliar, reducir y ver todo; disposición vertical u
// horizontal (layout). MODIFICADO el 24/10/2026: no vuelve a dibujar al
// cambiar el modo de color (todos los colores son variables del tema).
// MODIFICADO el 12/11/2026: cajas completas (full).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { zoomTransform, type ZoomTransform } from "d3-zoom";
import { loadBrowserFonts } from "../../chartExport/pdfFonts";
import { cargarSimbolosNavegador } from "../../../fuentes/simbolos";
import {
  fillThumbnails, fitAll, fitTexts, renderTreeChart, zoomBy, type ChartLayout, type TreeChartLabels, type TreeNode,
} from "../charts/treeChart";

interface TreeChartProps {
  ancestorTree: TreeNode | null;
  descendantTree: TreeNode | null;
  /** Vertical (ascendientes arriba) u horizontal (a la izquierda). */
  layout: ChartLayout;
  /** La persona central: se rodea su caja y, cuando cambia, vuelve al
   * centro de la vista. */
  selectedHandle: string;
  onSelectPerson: (handle: string) => void;
  onOpenPerson: (handle: string) => void;
  /** Dirección (blob:) de una foto, o null si no está disponible. */
  photoUrl: (handle: string) => Promise<string | null>;
  labels: TreeChartLabels;
  /** Cajas completas: nada se recorta (12/11/2026). */
  full?: boolean;
}

/** The live `<svg>` (para exportarlo) y los mandos de ampliación. */
export interface TreeChartHandle {
  getSvg: () => SVGSVGElement | null;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

/** Ampliación inicial: entera en pantallas anchas, menor en el móvil para
 * que se vea algo más que la persona central. */
function initialScale(width: number): number {
  return Math.max(0.5, Math.min(1, width / 900));
}

/** Owns a plain `div` and hands its DOM to the d3 renderer, sized off its
 * own ResizeObserver. A color-scheme flip needs no re-render: every color
 * is a `var(--tema-...)` and swaps live. */
export const TreeChart = forwardRef<TreeChartHandle, TreeChartProps>(function TreeChart({
  ancestorTree, descendantTree, layout, selectedHandle, onSelectPerson, onOpenPerson, photoUrl, labels, full = false,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgOf = () => containerRef.current?.querySelector("svg") ?? null;
  useImperativeHandle(ref, () => ({
    getSvg: svgOf,
    zoomIn: () => { const s = svgOf(); if (s) zoomBy(s, 1.4); },
    zoomOut: () => { const s = svgOf(); if (s) zoomBy(s, 1 / 1.4); },
    fit: () => { const s = svgOf(); if (s) fitAll(s); },
  }), []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // La letra del PDF, cargada antes del primer dibujo: los textos se miden
  // con ella para recortarlos.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let current = true;
    Promise.all([loadBrowserFonts(), cargarSimbolosNavegador()]).then(() => current && setFontsReady(true));
    return () => {
      current = false;
    };
  }, []);
  const zoomRef = useRef<ZoomTransform | null>(null);
  // The previous render's central person, so a *new* one can be told apart
  // from an unrelated rebuild (a resize, otro número de generaciones) --
  // only the former should re-center the view.
  const prevSelectedHandleRef = useRef<string | null>(null);
  const prevLayoutRef = useRef(layout);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !fontsReady || size.width <= 0 || size.height <= 0) return;
    // Capture the outgoing SVG's zoom transform before replacing it, so
    // panning/zooming survives a data change or a resize instead of
    // resetting to identity each render.
    const existing = container.querySelector("svg");
    zoomRef.current = existing ? zoomTransform(existing) : null;

    const justSelected = prevSelectedHandleRef.current !== null && selectedHandle !== prevSelectedHandleRef.current;
    prevSelectedHandleRef.current = selectedHandle;
    // Con otra disposición, la vista vuelve a la persona central.
    if (prevLayoutRef.current !== layout) zoomRef.current = null;
    prevLayoutRef.current = layout;

    const svg = renderTreeChart(ancestorTree, descendantTree, {
      bboxWidth: size.width,
      bboxHeight: size.height,
      layout,
      initialZoom: zoomRef.current,
      initialScale: initialScale(size.width),
      selectedHandle,
      onSelectPerson,
      onOpenPerson,
      labels,
      full,
      recenter: justSelected,
    });
    container.replaceChildren(svg);
    fitTexts(svg);
    fillThumbnails(svg, photoUrl);
  }, [ancestorTree, descendantTree, layout, size.width, size.height, selectedHandle, onSelectPerson, onOpenPerson, photoUrl, labels, full, fontsReady]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />;
});
