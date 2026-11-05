// Tabla virtualizada de los listados.
//
// Procede de Gramps Connect (https://github.com/dsblank/gramps-connect,
// app/src/components/DataTable.tsx, commit e00c517), AGPL-3.0-or-later.
// MODIFICADO el 21/10/2026 para esta web (detalle en ../ORIGEN.md): recibe
// las filas ya ordenadas y filtradas por propiedades en lugar de leerlas de
// un ViewStore con caché SQLite; sin selección múltiple ni navegación con
// flechas; un clic en una fila llama a alPulsar; anchos de columna por
// clave en localStorage; textos traducidos fuera de aquí. MODIFICADO el
// 24/10/2026: filas de 34 px («Diseño visual»). MODIFICADO el 05/11/2026: línea
// visible en el asa de cambiar el ancho, con su texto emergente.

import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { t } from "../../i18n";
import classes from "./DataTable.module.css";

const ROW_HEIGHT = 34;
const BUFFER_ROWS = 6;
const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 60;

export interface ColumnaTabla<T> {
  clave: string;
  /** Texto ya traducido de la cabecera. */
  etiqueta: string;
  ordenable: boolean;
  /** Ancho inicial en píxeles. */
  ancho?: number;
  celda: (fila: T) => ReactNode;
  /** Texto emergente de la celda (p. ej. el valor completo si se corta). */
  titulo?: (fila: T) => string | undefined;
}

export interface OrdenTabla {
  columna: string;
  direccion: "asc" | "desc";
}

interface DataTableProps<T> {
  /** Identifica la lista para recordar los anchos de columna. */
  claveVista: string;
  columnas: ColumnaTabla<T>[];
  filas: T[];
  claveFila: (fila: T) => string;
  orden: OrdenTabla | null;
  alOrdenar: (columna: string) => void;
  alPulsar?: (fila: T) => void;
  /** Alto de fila distinto del estándar (p. ej. con miniaturas). */
  altoFila?: number;
}

// Anchos guardados por lista y columna (en Gramps Connect,
// store/columnWidths.ts). Si el navegador no deja usar localStorage, la
// tabla funciona igual, sin recordarlos.
function leerAnchos(vista: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(`anchos:${vista}`) ?? "{}");
  } catch {
    return {};
  }
}

function guardarAnchos(vista: string, anchos: Record<string, number>) {
  try {
    localStorage.setItem(`anchos:${vista}`, JSON.stringify(anchos));
  } catch {
    // sin almacenamiento local: no se recuerdan
  }
}

export function DataTable<T>({ claveVista, columnas, filas, claveFila, orden, alOrdenar, alPulsar, altoFila = ROW_HEIGHT }: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [anchos, setAnchos] = useState<Record<string, number>>(() => leerAnchos(claveVista));
  const colWidths = columnas.map((c) => anchos[c.clave] ?? c.ancho ?? DEFAULT_COLUMN_WIDTH);

  // The sticky header is a normal-flow sibling *inside* the same scroll
  // container as the virtualized rows; the virtualizer has to be told about
  // its height (scrollMargin) or align:"auto" scrolls undershoot by it.
  const [headerHeight, setHeaderHeight] = useState(ROW_HEIGHT);
  useLayoutEffect(() => {
    const height = headerRef.current?.getBoundingClientRect().height;
    if (height) setHeaderHeight(height);
  }, []);

  const virtualizer = useVirtualizer({
    count: filas.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => altoFila,
    overscan: BUFFER_ROWS,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
  });

  // A new sort or filter means the old scroll offset points at unrelated
  // rows -- jump back to the top. (Original: keyed on whereExpr/orderBy;
  // aquí, en el orden y en el número de filas.)
  useLayoutEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [orden?.columna, orden?.direccion, filas]);

  const virtualItems = virtualizer.getVirtualItems();

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  // The last column is a minmax track, so it absorbs whatever space is left
  // over between the columns and the scrollbar instead of leaving it blank.
  const gridColumns = colWidths.map((w, i) => (i === colWidths.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`)).join(" ");
  const gridStyle = { "--grid-columns": gridColumns, "--row-height": `${altoFila}px` } as CSSProperties;
  const rowWidth = `max(100%, ${totalWidth}px)`;

  function startResize(e: ReactPointerEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[index];
    const clave = columnas[index].clave;
    let finalWidth = startWidth;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      finalWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + (ev.clientX - startX));
      setAnchos((prev) => (prev[clave] === finalWidth ? prev : { ...prev, [clave]: finalWidth }));
    }
    function onUp(ev: PointerEvent) {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      // Persist on drag end, not per onMove frame.
      guardarAnchos(claveVista, { ...leerAnchos(claveVista), [clave]: finalWidth });
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  return (
    // A single scrolling element owning both axes, so the vertical scrollbar
    // stays at the visible viewport's right edge however wide the columns
    // are; the header stays pinned via position:sticky.
    <div className={classes.tableWrapper} ref={scrollRef}>
      <div ref={headerRef} className={`${classes.row} ${classes.header}`} style={{ ...gridStyle, width: rowWidth }}>
        {columnas.map((col, index) => {
          const isSorted = orden?.columna === col.clave;
          return (
            <div
              key={col.clave}
              className={`${classes.cell} ${classes.headerCell} ${col.ordenable ? classes.sortable : ""}`}
              onClick={col.ordenable ? () => alOrdenar(col.clave) : undefined}
            >
              <span>{col.etiqueta}</span>
              {isSorted && <span className={classes.sortArrow}>{orden.direccion === "asc" ? "▲" : "▼"}</span>}
              <div
                className={classes.resizeHandle}
                title={t("lista.cambiarAncho")}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => startResize(e, index)}
              />
            </div>
          );
        })}
      </div>
      <div style={{ height: virtualizer.getTotalSize(), width: rowWidth, position: "relative" }}>
        {virtualItems.map((item) => {
          const fila = filas[item.index];
          return (
            <div
              key={claveFila(fila)}
              className={`${classes.row} ${alPulsar ? classes.clickable : ""}`}
              data-par={item.index % 2 === 1 || undefined}
              onClick={alPulsar ? () => alPulsar(fila) : undefined}
              style={{
                ...gridStyle,
                position: "absolute",
                top: 0,
                left: 0,
                width: rowWidth,
                height: item.size,
                // item.start includes scrollMargin; this sizer div already
                // sits header-height below the container's top, so subtract
                // it back out or the header would be counted twice.
                transform: `translateY(${item.start - headerHeight}px)`,
              }}
            >
              {columnas.map((col) => (
                <div key={col.clave} className={classes.cell} title={col.titulo?.(fila)}>
                  {col.celda(fila)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
