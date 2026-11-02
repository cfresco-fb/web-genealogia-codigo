// Iconos sencillos en SVG, del color del texto. Decorativos: el botón que
// los lleva tiene siempre su texto.

const BASE = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Flecha hacia la izquierda («volver»). */
export function IconoAtras() {
  return <svg {...BASE}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>;
}

/** Casa («inicio»). */
export function IconoInicio() {
  return <svg {...BASE}><path d="M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5" /></svg>;
}

/** Flecha hacia abajo sobre una bandeja («descargar»). */
export function IconoDescargar() {
  return <svg {...BASE}><path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3" /></svg>;
}

/** Árbol de cajas: una arriba y dos debajo («árbol en PDF»). */
export function IconoArbol() {
  return <svg {...BASE}><path d="M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4" /></svg>;
}

/** Flecha pequeña hacia abajo: el botón abre un menú. */
export function IconoDesplegar() {
  return <svg {...BASE} width={14} height={14}><path d="M6 9l6 6 6-6" /></svg>;
}

/** Libro abierto («libro en PDF»). */
export function IconoLibro() {
  return <svg {...BASE}><path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z" /></svg>;
}

/** Calendario («elegir la fecha en el calendario»). */
export function IconoCalendario() {
  return <svg {...BASE}><path d="M4 5h16v16H4zM4 10h16M9 3v4M15 3v4" /></svg>;
}

/** Tres barras con mandos («todos los detalles»). */
export function IconoDetalle() {
  return <svg {...BASE}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
}

/** Una «i» en un círculo («qué es esto»). */
export function IconoInfo() {
  return <svg {...BASE} width={14} height={14}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>;
}

/** Lápiz («editar»). */
export function IconoEditar() {
  return <svg {...BASE}><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>;
}
