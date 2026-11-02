// Forma de bibliotecas.json, la lista de las bibliotecas que van en la web
// (la genera scripts/creditos.ts con `npm run creditos`; docs/creditos.md).

export interface Paquete {
  nombre: string;
  version: string;
  /** Identificador SPDX, como lo da el paquete («MIT», «(MPL-2.0 OR Apache-2.0)»). */
  licencia: string;
  enlace: string;
  /** Dependencia de app/package.json (las demás llegan con ellas). */
  directa: boolean;
  /** Posición del texto de su licencia en `textos`. */
  texto: number;
  /** De dónde se ha leído, desde la raíz del repositorio
   * («node_modules/firebase/node_modules/@firebase/auth»). */
  carpeta: string;
}

export interface TextoLicencia {
  texto: string;
  /** Texto oficial de la licencia: el paquete no trae fichero propio. */
  estandar: boolean;
}

export interface Bibliotecas {
  paquetes: Paquete[];
  textos: TextoLicencia[];
  /** Dependencias de app/package.json que no llegan a la web compilada. */
  sinUsar: string[];
}
