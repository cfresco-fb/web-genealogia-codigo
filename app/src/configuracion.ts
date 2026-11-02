// Datos de la web que cambian con la puesta en marcha.

import { DEPOSITO_PRODUCCION, PROYECTO_PRODUCCION } from "../../comun/proyectos.ts";

/** Configuración de la app web del proyecto real (`firebase apps:sdkconfig`
 * de la app «web» de arbol-freswer, 29/10/2026). No es secreta: va en la web
 * que descarga cualquiera; lo que protege los datos son las reglas. */
export const CONFIG_PRODUCCION = {
  projectId: PROYECTO_PRODUCCION,
  appId: "1:765709250464:web:d0c8fff344ce07fc4efec5",
  storageBucket: DEPOSITO_PRODUCCION,
  apiKey: "AIzaSyDFuzgcSpKqwo8PQoKdDCACZl8dl42XYuM",
  // El dominio propio, para que la pantalla de Google diga arbol.freswer.org
  // (Carlos, 01/11/2026). Exige su dirección de vuelta en el cliente web de
  // OAuth antes de desplegar (docs/puesta-en-marcha.md, «Entrar con Google
  // con el dominio propio»).
  authDomain: "arbol.freswer.org",
  messagingSenderId: "765709250464",
};

/** Clave de sitio de reCAPTCHA Enterprise para App Check (decisión D5 del
 * 31/10/2026; docs/puesta-en-marcha.md, «App Check»). No es secreta. Vacía:
 * sin App Check (la web no pide permisos y nada los exige). */
export const CLAVE_RECAPTCHA = "6Lec8wouAAAAAFK2yIR9cUs-mlVLC_KibPFrhRt5";

/** Correo de contacto de la nota de privacidad (Carlos, 31/10/2026): un
 * reenvío del dominio a su Gmail (docs/puesta-en-marcha.md, apartado 2). */
export const CORREO_CONTACTO = "contacto@freswer.org";

/** Fecha de la última revisión de la nota de privacidad (AAAA-MM-DD): se
 * cambia cada vez que cambie el texto. */
export const FECHA_PRIVACIDAD = "2026-10-31";

/** Dirección pública del código fuente de la web, para la página de
 * créditos (`/creditos`). La licencia AGPL-3.0 obliga a ofrecerlo a quien
 * usa la web por internet. Es el repositorio público (decisión C1 del
 * 01/11/2026, docs/codigo-fuente-publico.md), con una instantánea por
 * versión desplegada. */
export const URL_CODIGO_FUENTE = "https://github.com/cfresco-fb/web-genealogia-codigo";

/** La versión que se ejecuta: el commit de git con que se compiló, su fecha,
 * si había cambios sin confirmar y la etiqueta de la versión publicada
 * (app/vite.config.ts). */
export const VERSION_CODIGO = __VERSION_CODIGO__;

/** El código de esta versión exacta, que es el que pide la AGPL: la
 * etiqueta en el repositorio público (`/tree/{etiqueta}`). Sin etiqueta (una
 * compilación fuera del flujo de despliegue), la página del repositorio: el
 * commit del privado no existe en el público. */
export const URL_VERSION = VERSION_CODIGO.etiqueta ? `${URL_CODIGO_FUENTE}/tree/${VERSION_CODIGO.etiqueta}` : URL_CODIGO_FUENTE;
