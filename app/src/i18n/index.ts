// Traducciones. Toda la interfaz pasa por t(); los nombres de los tipos de
// Gramps (evento, parentesco, lugar…) por nombreTipo(), con los textos de
// las traducciones oficiales de Gramps (gramps/*.generated.ts).
//
// Para añadir un idioma: crear <idioma>.ts con un objeto de tipo Textos,
// generar gramps/<idioma>.generated.ts (migracion/generar_textos_gramps.py)
// y añadirlo a IDIOMAS.

import { es, type Clave, type Textos } from "./es";
import { tipos as tiposEs } from "./gramps/es.generated";
import { personalizados } from "./gramps/personalizados.generated";
import { entradaCodigo, esCodigo, MARCA_CODIGO, textoEntrada } from "../../../comun/tipos.ts";

export type { Clave };

interface Idioma {
  textos: Textos;
  tiposGramps: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Código de idioma de gramps-date para las fechas. */
  fechas: string;
  /** Para Intl (números, fechas de la propia web, orden alfabético). */
  intl: string;
}

const IDIOMAS = {
  es: { textos: es, tiposGramps: tiposEs, fechas: "es", intl: "es-ES" },
} satisfies Record<string, Idioma>;

export type CodigoIdioma = keyof typeof IDIOMAS;

let actual: CodigoIdioma = "es";

export function idioma(): Idioma & { codigo: CodigoIdioma } {
  return { ...IDIOMAS[actual], codigo: actual };
}

export function t(clave: Clave, valores?: Record<string, string | number>): string {
  let texto: string = IDIOMAS[actual].textos[clave] ?? clave;
  if (valores) {
    for (const [k, v] of Object.entries(valores)) {
      texto = texto.replaceAll(`{${k}}`, typeof v === "number" ? formatoNumero(v) : v);
    }
  }
  return texto;
}

export function formatoNumero(n: number): string {
  return n.toLocaleString(IDIOMAS[actual].intl);
}

/** Un tipo de Gramps tal como viene en el JSON. */
export interface TipoGramps {
  _class: string;
  value: number;
  string: string;
}

/** Nombre de un tipo de Gramps en el idioma actual. Los tipos
 * personalizados del catálogo llevan su código en «string» («@separacion»,
 * comun/tipos-propios.json) y salen en el idioma actual; los demás, su
 * propio texto. */
export function nombreTipo(tipo: TipoGramps | null | undefined): string {
  if (!tipo) return "";
  if (esCodigo(tipo.string)) {
    const e = entradaCodigo(tipo._class, tipo.string);
    // Un código que no está en el catálogo no debería llegar (el servidor
    // lo rechaza): sin la «@».
    return e ? textoEntrada(e, actual) : tipo.string.slice(MARCA_CODIGO.length);
  }
  if (tipo.string) return tipo.string;
  return IDIOMAS[actual].tiposGramps[tipo._class]?.[String(tipo.value)] ?? String(tipo.value);
}

/** Los valores de un tipo de Gramps (EventType…) con su nombre en el
 * idioma actual, sin «Personalizado» ni el «Desconocido» de valor -1 (para
 * elegir uno en los formularios). */
export function valoresTipo(clase: string): { value: number; nombre: string }[] {
  return Object.entries(IDIOMAS[actual].tiposGramps[clase] ?? {})
    .map(([v, nombre]) => ({ value: Number(v), nombre }))
    .filter((x) => x.value >= 0 && x.value !== valorPersonalizado(clase));
}

/** El valor de «personalizado» de una clase de tipo de Gramps (0 en casi
 * todas; 4 en FamilyRelType, 7 en ChildRefType). */
export function valorPersonalizado(clase: string): number {
  return personalizados[clase] ?? 0;
}

/** Comparación alfabética del idioma actual (acentos, ñ…). */
export const comparador = new Intl.Collator(IDIOMAS[actual].intl, { sensitivity: "base", numeric: true });
