// Colores por sexo de las cajas del gráfico.
//
// Procede de Gramps Connect (https://github.com/dsblank/gramps-connect,
// app/src/charts/genderColors.ts, commit 884ad35), AGPL-3.0-or-later.
// MODIFICADO el 24/10/2026 (detalle en ../../ORIGEN.md): los colores salen
// del tema de la web (app/src/tema/colores.ts) como variables CSS, que
// cambian solas con el modo de color, en lugar de una pareja fija por modo;
// y el sexo desconocido u otro lleva también franja, gris (decisión del
// 24/10/2026, «Diseño visual»).

import { color } from "../../../tema/colores";

/** Franja de la caja: mujer (0), hombre (1) y, para los demás (2
 * desconocido, 3 otro), «sexo-desconocido». El sexo se dice también con
 * palabras en el texto emergente de la caja: la franja no es lo único que
 * lo distingue. */
export function genderAccent(gender: number | undefined): string {
  if (gender === 0) return color("mujer");
  if (gender === 1) return color("hombre");
  return color("sexo-desconocido");
}
