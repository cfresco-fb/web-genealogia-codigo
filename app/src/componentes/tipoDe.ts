import { nombreTipo, valoresTipo, valorPersonalizado, type TipoGramps } from "../i18n";
import { codigoDe } from "../../../comun/tipos.ts";
import { normalizar } from "../arbol/arbol";

/** El tipo de Gramps de un nombre: el mismo de antes si no ha cambiado, uno
 * de los de serie si coincide con su nombre, uno del catálogo de tipos
 * propios (su texto en cualquier idioma o un sinónimo: se guarda el código,
 * «@separacion»; decisión del 31/10/2026) o uno propio, con el texto tal
 * cual (sin una «@» delante, que lo confundiría con un código). */
export function tipoDe(clase: string, texto: string, anterior: TipoGramps): TipoGramps {
  const n = texto.trim().replace(/^@+/, "").trim();
  if (n === nombreTipo(anterior)) return anterior;
  const deSerie = valoresTipo(clase).find((x) => normalizar(x.nombre) === normalizar(n));
  if (deSerie) return { _class: clase, value: deSerie.value, string: "" };
  return { _class: clase, value: valorPersonalizado(clase), string: codigoDe(clase, n) ?? n };
}
