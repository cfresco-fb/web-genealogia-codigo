// Largo del texto de una nota (Carlos, 02/11/2026), aparte del formulario
// para probarlo sin Firebase.

import { MAXIMO_TEXTO_NOTA } from "../../../comun/esquema.ts";
import { formatoNumero, t } from "../i18n";

/** El aviso del largo del texto (Carlos, 02/11/2026: 50.000 caracteres como
 * mucho, el mismo límite que comprueba el servidor). No se corta lo que se
 * pega: se avisa y no se deja guardar, para no perder texto sin decirlo.
 * Desde el 90 %, la cuenta bajo el texto; justo en el máximo, un aviso
 * aparte; por encima, el error del campo. */
export function avisoLargo(n: number, maximo = MAXIMO_TEXTO_NOTA): { error?: string; ayuda?: string; aviso?: string } {
  const valores = { n: formatoNumero(n), maximo: formatoNumero(maximo) };
  if (n > maximo) return { error: t("nota.demasiadoLarga", valores) };
  if (n === maximo) return { aviso: t("nota.alLimite", valores) };
  if (n >= maximo * 0.9) return { ayuda: t("nota.caracteres", valores) };
  return {};
}
