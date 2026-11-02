// Símbolos de nacimiento y defunción de las cajas del árbol (y del PDF).
// Decisión del 22/10/2026 (docs/decisiones-web-familiar.md, «Presentación»):
// por defecto, abreviaturas neutras; el administrador fija el valor por
// defecto del árbol (configuracion/presentacion) y cada usuario puede
// elegir el suyo (preferencias/{correo}). Las reglas de Firestore validan
// lo mismo que validarPreferencia.

import { t } from "../i18n";

export type JuegoSimbolos = "abreviaturas" | "asterisco" | "david" | "personalizado";
export const JUEGOS_SIMBOLOS: JuegoSimbolos[] = ["abreviaturas", "asterisco", "david", "personalizado"];

/** Lo que se guarda: el juego y, si es personalizado, los dos símbolos. */
export interface PreferenciaSimbolos {
  juego: JuegoSimbolos;
  nacimiento?: string;
  defuncion?: string;
}

/** Los dos símbolos que se escriben delante de las fechas. */
export interface Simbolos {
  nacimiento: string;
  defuncion: string;
}

export const PREFERENCIA_POR_DEFECTO: PreferenciaSimbolos = { juego: "abreviaturas" };

/** Largo máximo de cada símbolo personalizado, en caracteres (también en
 * firestore.rules; decisión de Carlos del 22/10/2026). */
export const MAX_SIMBOLO = 4;

/** Símbolos de cada juego. Las abreviaturas dependen del idioma. */
export function simbolosDe(p: PreferenciaSimbolos): Simbolos {
  switch (p.juego) {
    case "abreviaturas":
      return { nacimiento: t("simbolos.abreviaturas.nacimiento"), defuncion: t("simbolos.abreviaturas.defuncion") };
    case "asterisco":
      return { nacimiento: "*", defuncion: "†" };
    case "david":
      // U+FE0E: que se dibuje como símbolo de texto, no como emoji de color.
      return { nacimiento: "*", defuncion: "\u2721\uFE0E" };
    case "personalizado":
      return { nacimiento: p.nacimiento ?? "", defuncion: p.defuncion ?? "" };
  }
}

/** La preferencia si es válida (las mismas condiciones que las reglas de
 * Firestore), o null. Para leer documentos guardados y para el formulario. */
export function validarPreferencia(v: unknown): PreferenciaSimbolos | null {
  if (!v || typeof v !== "object") return null;
  const { juego, nacimiento, defuncion } = v as Record<string, unknown>;
  if (!JUEGOS_SIMBOLOS.includes(juego as JuegoSimbolos)) return null;
  if (juego !== "personalizado") return { juego: juego as JuegoSimbolos };
  // En unidades de UTF-16, como cuentan las reglas de Firestore (size()):
  // los caracteres raros que ocupan dos (p. ej. 𝄞) cuentan por dos.
  const valido = (s: unknown) => typeof s === "string" && s.length >= 1 && s.length <= MAX_SIMBOLO;
  if (!valido(nacimiento) || !valido(defuncion)) return null;
  return { juego: "personalizado", nacimiento: nacimiento as string, defuncion: defuncion as string };
}
