// Colores de la web (decisión del 24/10/2026, «Diseño visual» en
// docs/decisiones-web-familiar.md), en claro y en oscuro. Cada uno es una
// variable CSS --tema-… (las define el tema, tema.ts); fuera del tema, los
// colores se nombran solo así, con color(): también el gráfico del árbol.

/** [claro, oscuro] de cada color. */
export const COLORES = {
  /** Fondo de la página; filas alternas de las listas. */
  papel: ["#f7f4ee", "#1c1a17"],
  /** Tarjetas, tablas, casillas, cabecera, cajas del árbol. */
  superficie: ["#ffffff", "#26231f"],
  /** Paneles de controles, cabecera de tablas, óvalo de la pareja. */
  "superficie-hundida": ["#efeae1", "#2f2b26"],
  /** Texto y títulos. */
  tinta: ["#24211d", "#ede7dd"],
  /** Texto secundario («sin datos», ayudas, fechas de las cajas). */
  "tinta-suave": ["#5f574d", "#b3aa9c"],
  /** Separadores y bordes de tarjeta. */
  linea: ["#ddd5c8", "#3d3832"],
  /** Bordes de casillas y botones secundarios; líneas del árbol. */
  "linea-fuerte": ["#968a78", "#7d7366"],
  /** Color principal: botón principal, enlaces, menú activo, foco. */
  azul: ["#2c5a8a", "#8fb4de"],
  /** Botón principal y enlaces al pasar el ratón. */
  "azul-oscuro": ["#23486f", "#a9c6e8"],
  /** Fondo del menú activo, selección marcada, fila bajo el ratón. */
  "azul-claro": ["#e1eaf4", "#233548"],
  /** Texto sobre el botón principal. */
  "sobre-azul": ["#ffffff", "#10202f"],
  /** Acento: borde de la persona central y de la píldora «Persona de inicio». */
  teja: ["#b5652b", "#d98b52"],
  /** Fondo de la píldora «Persona de inicio». */
  "teja-claro": ["#f6e6d8", "#3d2c20"],
  /** Franjas de las cajas del árbol. */
  hombre: ["#2a78d6", "#3987e5"],
  mujer: ["#e87ba4", "#d55181"],
  "sexo-desconocido": ["#8a8175", "#8b8378"],
  /** Fondo de la caja «Cónyuge desconocido». */
  desconocido: ["#ebe6dd", "#34302a"],
  /** Errores: texto y borde, y fondo de los avisos. */
  error: ["#a8322b", "#f08a80"],
  "error-claro": ["#f8e5e2", "#3d211e"],
  /** Avisos no graves: texto y fondo. */
  aviso: ["#7a5200", "#e8c072"],
  "aviso-claro": ["#fbefd5", "#3a2f17"],
} as const satisfies Record<string, readonly [string, string]>;

export type Color = keyof typeof COLORES;

/** La variable CSS de un color del tema. */
export const color = (nombre: Color) => `var(--tema-${nombre})`;
