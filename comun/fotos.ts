/**
 * Fotos subidas desde la web (fase 3, paso 11 b; docs/diseno-fase-3.md,
 * apartado 8 bis, y las respuestas de Carlos del 27/10/2026 a DF-1 a DF-6).
 * Lo comparten la web (que prepara y sube la foto), la función del servidor
 * (que la comprueba y la pasa a su sitio) y las pruebas. Las reglas de
 * Storage (storage.rules) repiten los tamaños y los tipos: si cambian aquí,
 * también allí.
 *
 * Cada foto tiene dos ficheros: la grande (`multimedia/{handle}`, la que se
 * ve al pinchar; el original si no pasa de LADO_GRANDE, o reducida) y la
 * pequeña (`miniaturas/{handle}`, para la web). Antes de guardar, el
 * navegador los sube a una carpeta de paso, `subidas/{correo}/{id}/`.
 */

/** Lado mayor de la copia pequeña, en píxeles. */
export const LADO_PEQUENA = 1600;
/** Lado mayor de la grande: el original, si no lo pasa. */
export const LADO_GRANDE = 4000;

/** Tamaño máximo de cada fichero (como en storage.rules). */
export const BYTES_MAXIMO_GRANDE = 20 * 1024 * 1024;
export const BYTES_MAXIMO_PEQUENA = 2 * 1024 * 1024;

/** Tipos admitidos (DF-5 a: solo imágenes). */
export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];
export const EXTENSION: Record<TipoFoto, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Espacio por usuario, contando las dos copias (DF-6): 200 MB; los
 * administradores, 1 GB. */
export const CUOTA_FOTOS = { administrador: 1024 * 1024 * 1024, otros: 200 * 1024 * 1024 };
export const cuotaFotos = (rol: string) => (rol === "administrador" ? CUOTA_FOTOS.administrador : CUOTA_FOTOS.otros);

/** Carpetas de Storage. */
export const CARPETA_SUBIDAS = "subidas/";
export const CARPETA_MINIATURAS = "miniaturas/";
export const rutaSubida = (correo: string, id: string, copia: "grande" | "pequena") =>
  `${CARPETA_SUBIDAS}${correo.toLowerCase()}/${id}/${copia}`;

/** Fotos de las solicitudes (paso 12): el servidor aparta aquí las subidas
 * de una solicitud de cambio hasta que se aplica, se rechaza o se retira. */
export const CARPETA_SOLICITUDES = "solicitudes/";
export const rutaApartada = (correo: string, id: string, copia: "grande" | "pequena") =>
  `${CARPETA_SOLICITUDES}${correo.toLowerCase()}/${id}/${copia}`;

/** Días que se guardan los ficheros de una foto borrada del árbol, para
 * poder revertir el borrado (Carlos, 29/10/2026); después los borra la
 * regeneración nocturna. */
export const DIAS_FOTOS_BORRADAS = 30;

/** Identificador de una subida (lo pone la web). */
export const ID_SUBIDA = /^[a-z0-9]{8,40}$/;

/** Ruta de Gramps (`Media.path`) de una foto subida desde la web: las
 * nuevas, juntas en la carpeta «web» de la carpeta base de multimedia. Por
 * ella sabe la web que la foto tiene copia pequeña. */
export const CARPETA_GRAMPS_WEB = "web/";
export const rutaGrampsWeb = (grampsId: string, mime: TipoFoto) => `${CARPETA_GRAMPS_WEB}${grampsId}.${EXTENSION[mime]}`;
export const subidaDesdeLaWeb = (path: unknown) => typeof path === "string" && path.startsWith(CARPETA_GRAMPS_WEB);

/** El tipo de imagen por sus primeros bytes («bytes mágicos»), o null si no
 * es ninguno de los admitidos. El servidor no se fía del tipo que declara
 * el navegador al subir (revisión del 02/11/2026, B1). */
export function tipoPorCabecera(bytes: Uint8Array): TipoFoto | null {
  const empieza = (firma: number[], desde = 0) => bytes.length >= desde + firma.length && firma.every((b, i) => bytes[desde + i] === b);
  if (empieza([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empieza([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (empieza([0x52, 0x49, 0x46, 0x46]) && empieza([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}
