// Ancho inicial de las columnas de nombres de persona en las listas (Carlos,
// 05/11/2026): con el apodo en el nombre, el de siempre se quedaba corto.

/** Ancho aproximado de un carácter (Noto Sans de 15 px, la letra de la tabla):
 * medidos los dos árboles, de ejemplo y real, la media es 7,4 y el 99 % de los
 * nombres largos no pasa de 8,6. */
const ANCHO_CARACTER = 8;
/** El relleno de la celda, a los dos lados (0,6 rem), con un poco de margen. */
const RELLENO_CELDA = 22;
const ANCHO_MAXIMO = 420;

/** El ancho para el texto más largo, entre `minimo` y el tope. */
export function anchoPorTexto(textos: string[], minimo: number): number {
  const caracteres = textos.reduce((max, texto) => Math.max(max, texto.length), 0);
  return Math.max(minimo, Math.min(ANCHO_MAXIMO, caracteres * ANCHO_CARACTER + RELLENO_CELDA));
}
