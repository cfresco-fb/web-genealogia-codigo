// Tema de la web (decisión del 24/10/2026, «Diseño visual» en
// docs/decisiones-web-familiar.md): colores en claro y en oscuro, letras,
// tamaños, espacios, radios y sombra. Todos los colores salen de COLORES,
// como variables --tema-… (tema.css y el gráfico del árbol las usan), y
// las variables de Mantine apuntan a ellas: así cada pantalla, el gráfico y
// la exportación a PDF (que lee las del modo claro) cambian de modo sin
// tocar nada más.

import {
  Alert, Autocomplete, Button, createTheme, defaultVariantColorsResolver, Input, Modal, Paper, Popover, Menu, Select, Table, Tooltip,
  type CSSVariablesResolver, type MantineColorsTuple, type VariantColorsResolver,
} from "@mantine/core";
import { color, COLORES, type Color } from "./colores";

/** Sombra (solo menús, diálogos y la persona central del árbol). */
const SOMBRA = ["0 2px 8px rgba(36,33,29,.12)", "0 2px 8px rgba(0,0,0,.45)"] as const;

/** Letras, servidas desde la propia web (main.tsx). */
export const LETRA_TEXTO = '"Noto Sans", "Noto Sans Hebrew", system-ui, sans-serif';
export const LETRA_TITULOS = 'Literata, "Noto Serif Hebrew", Georgia, serif';

// Tonos del azul para Mantine (los usa poco: las variables que importan se
// fijan abajo con los colores del tema).
const AZUL: MantineColorsTuple = [
  "#e1eaf4", "#c9d8ea", "#a9c6e8", "#8fb4de", "#5f8bbd", "#4372a3", "#365f8f", "#2c5a8a", "#23486f", "#1a3655",
];

/** El botón principal (relleno) lleva el texto en «sobre-azul», también en
 * oscuro, donde el azul es claro. */
const variantes: VariantColorsResolver = (entrada) => {
  const v = defaultVariantColorsResolver(entrada);
  const nombre = entrada.color ?? entrada.theme.primaryColor;
  if (entrada.variant === "filled" && (nombre === "azul" || nombre === "blue")) return { ...v, color: color("sobre-azul") };
  return v;
};

/** Alto de los botones y casillas: 40 px (44 en el móvil, tema.css). */
const ALTO_CONTROL = "var(--tema-alto-control)";
const tamanoNormal = (size: unknown) => size === undefined || size === "sm" || size === "md";

export const tema = createTheme({
  primaryColor: "azul",
  colors: { azul: AZUL },
  primaryShade: { light: 7, dark: 3 },
  variantColorResolver: variantes,
  fontFamily: LETRA_TEXTO,
  fontFamilyMonospace: "ui-monospace, Consolas, monospace",
  // Nada por debajo de 14 px fuera del árbol (las ayudas, 14/20).
  fontSizes: { xs: "0.875rem", sm: "0.875rem", md: "1rem", lg: "1.125rem", xl: "1.375rem" },
  lineHeights: { xs: "1.4286", sm: "1.4286", md: "1.5", lg: "1.4444", xl: "1.3636" },
  // Títulos: el de la página 32/40, las secciones 22/30 (con serifa); los
  // subtítulos 18/26, en la letra del texto (tema.css).
  headings: {
    fontFamily: LETRA_TITULOS,
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "2rem", lineHeight: "1.25" },
      h2: { fontSize: "1.375rem", lineHeight: "1.3636" },
      h3: { fontSize: "1.125rem", lineHeight: "1.4444" },
      h4: { fontSize: "1rem", lineHeight: "1.5" },
    },
  },
  spacing: { xs: "0.5rem", sm: "0.75rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
  radius: { xs: "0.375rem", sm: "0.375rem", md: "0.625rem", lg: "0.625rem", xl: "62.5rem" },
  defaultRadius: "sm",
  shadows: { xs: "var(--tema-sombra)", sm: "var(--tema-sombra)", md: "var(--tema-sombra)", lg: "var(--tema-sombra)", xl: "var(--tema-sombra)" },
  // Anillo de foco: 2 px en azul, separado 2 px (el de Mantine, con el azul
  // del tema), siempre que se llega con el teclado.
  focusRing: "auto",
  cursorType: "pointer",
  components: {
    Button: Button.extend({
      vars: (_theme, props) => (tamanoNormal(props.size)
        ? { root: { "--button-height": ALTO_CONTROL, "--button-fz": "var(--mantine-font-size-md)", "--button-padding-x": "var(--mantine-spacing-md)" } }
        : { root: {} }),
    }),
    Input: Input.extend({
      vars: (_theme, props) => (tamanoNormal(props.size)
        ? { wrapper: { "--input-height": ALTO_CONTROL, "--input-fz": "var(--mantine-font-size-md)" } }
        : { wrapper: {} }),
    }),
    Paper: Paper.extend({ defaultProps: { radius: "md" } }),
    Alert: Alert.extend({ defaultProps: { radius: "md" } }),
    Modal: Modal.extend({ defaultProps: { radius: "md" } }),
    Menu: Menu.extend({ defaultProps: { radius: "md", shadow: "md" } }),
    Popover: Popover.extend({ defaultProps: { radius: "md", shadow: "md" } }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: "sm" } }),
    Table: Table.extend({ defaultProps: { fz: "0.9375rem" } }),
    // Las listas desplegables, por encima de cualquier ventana, también de
    // las que se abren encima de otra (lugar o nota desde el evento).
    Select: Select.extend({ defaultProps: { comboboxProps: { zIndex: 1000 } } }),
    Autocomplete: Autocomplete.extend({ defaultProps: { comboboxProps: { zIndex: 1000 } } }),
  },
});

/** Las variables de los dos modos: las del tema (--tema-…) y las de Mantine
 * que apuntan a ellas. */
function variables(modo: 0 | 1): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [nombre, valores] of Object.entries(COLORES)) v[`--tema-${nombre}`] = valores[modo];
  v["--tema-sombra"] = SOMBRA[modo];
  const c = color;
  Object.assign(v, {
    "--mantine-color-body": c("superficie"),
    "--mantine-color-text": c("tinta"),
    "--mantine-color-bright": c("tinta"),
    "--mantine-color-dimmed": c("tinta-suave"),
    "--mantine-color-placeholder": c("tinta-suave"),
    "--mantine-color-anchor": c("azul"),
    "--mantine-color-error": c("error"),
    "--mantine-color-default": c("superficie"),
    "--mantine-color-default-hover": c("superficie-hundida"),
    "--mantine-color-default-color": c("tinta"),
    "--mantine-color-default-border": c("linea-fuerte"),
    "--mantine-color-disabled": c("superficie-hundida"),
    "--mantine-color-disabled-color": c("tinta-suave"),
    "--mantine-color-disabled-border": c("linea"),
    "--mantine-primary-color-contrast": c("sobre-azul"),
  });
  // El azul principal (y «blue», que usan los avisos informativos).
  for (const n of ["azul", "blue"]) {
    Object.assign(v, {
      [`--mantine-color-${n}-text`]: c("azul"),
      [`--mantine-color-${n}-filled`]: c("azul"),
      [`--mantine-color-${n}-filled-hover`]: c("azul-oscuro"),
      [`--mantine-color-${n}-light`]: c("azul-claro"),
      [`--mantine-color-${n}-light-hover`]: c("azul-claro"),
      [`--mantine-color-${n}-light-color`]: c("azul"),
      [`--mantine-color-${n}-outline`]: c("azul"),
      [`--mantine-color-${n}-outline-hover`]: c("azul-claro"),
    });
  }
  // Errores y avisos; las confirmaciones («Guardado»), en tinta.
  const familia = (n: string, texto: Color, fondo: Color) => Object.assign(v, {
    [`--mantine-color-${n}-text`]: c(texto),
    [`--mantine-color-${n}-filled`]: c(texto),
    [`--mantine-color-${n}-filled-hover`]: c(texto),
    [`--mantine-color-${n}-light`]: c(fondo),
    [`--mantine-color-${n}-light-hover`]: c(fondo),
    [`--mantine-color-${n}-light-color`]: c(texto),
    [`--mantine-color-${n}-outline`]: c(texto),
    [`--mantine-color-${n}-outline-hover`]: c(fondo),
  });
  familia("red", "error", "error-claro");
  familia("orange", "aviso", "aviso-claro");
  familia("yellow", "aviso", "aviso-claro");
  familia("green", "tinta", "superficie-hundida");
  // Los grises fijos que Mantine usa por dentro (menús, desplegables,
  // casillas de marcar, divisores…), cada uno con el color del tema de su
  // uso: fondos al pasar el ratón, separadores, bordes de control y texto.
  const grises: Color[] = [
    "superficie-hundida", "superficie-hundida", "linea", "linea", "linea-fuerte",
    "linea-fuerte", "tinta-suave", "tinta-suave", "tinta", "tinta",
  ];
  grises.forEach((g, i) => { v[`--mantine-color-gray-${i}`] = c(g); });
  if (modo === 1) {
    // En oscuro, la escala «dark»: textos claros y fondos oscuros.
    const oscuros: Color[] = [
      "tinta", "tinta", "tinta-suave", "tinta-suave", "linea-fuerte",
      "superficie-hundida", "superficie", "papel", "papel", "papel",
    ];
    oscuros.forEach((g, i) => { v[`--mantine-color-dark-${i}`] = c(g); });
  }
  return v;
}

export const resolverVariables: CSSVariablesResolver = () => ({
  variables: {},
  light: variables(0),
  dark: variables(1),
});
