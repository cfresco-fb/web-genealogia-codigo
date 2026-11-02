/**
 * Solicitudes (fase 3, paso 12; docs/edicion.md, «Solicitudes»; diseño en
 * docs/diseno-fase-3.md, apartados 1.2 y 7): lo que un usuario pide al
 * administrador porque no lo puede guardar él (un cambio fuera de su rama,
 * quitar vínculos, un tipo nuevo, borrar una ficha). Se guardan en
 * `solicitudes/{id}`; las escribe solo la función del servidor.
 */
import type { Tipo } from "./gramps.ts";
import type { NoPermitido, Rol } from "./permisos.ts";
import type { Operacion, Peticion } from "./peticion.ts";
import type { TipoFoto } from "./fotos.ts";

/** «cambio»: lo que no ha podido guardar; «borrado»: borrar una ficha
 * entera (con lo que arrastra, comun/borrado.ts). */
export type ClaseSolicitud = "cambio" | "borrado";
export const CLASES_SOLICITUD: ClaseSolicitud[] = ["cambio", "borrado"];

export type EstadoSolicitud = "pendiente" | "aplicada" | "rechazada" | "retirada";

/** Lo que manda la web para pedir algo: la misma petición que al guardar,
 * con el motivo obligatorio (DA-18 a). */
export interface PeticionSolicitud {
  clase: ClaseSolicitud;
  peticion: Peticion;
}

/** Un objeto de la propuesta: como en la petición, con el «después» en
 * texto JSON (como el registro, DA-24 a), y el «antes» (cómo estaba al
 * pedirlo, también en JSON; null si se crea), para enseñar qué cambia
 * aunque el árbol cambie después (desde el 28/10/2026; las anteriores no
 * lo tienen). */
export interface ObjetoPropuesta {
  tipo: Tipo;
  handle: string;
  operacion: Operacion;
  base: number | null;
  antes?: string | null;
  despues: string | null;
}

/** Una foto subida con la solicitud, apartada por el servidor
 * (comun/fotos.ts, `rutaApartada`). */
export interface FotoPropuesta {
  handle: string;
  subida: string;
  mime: TipoFoto;
  bytes: number;
}

export interface Autor {
  correo: string;
  persona: string | null;
  rol: Rol;
}

/** El documento `solicitudes/{id}` (la fecha, Timestamp de Firestore). */
export interface Solicitud<Fecha = unknown> {
  secuencia: number;
  fecha: Fecha;
  autor: Autor;
  clase: ClaseSolicitud;
  accion: string;
  motivo: string;
  /** La ficha protagonista (la primera de la petición). */
  principal: { tipo: Tipo; handle: string };
  objetos: ObjetoPropuesta[];
  ficheros: FotoPropuesta[];
  /** Por qué no se pudo guardar directamente (vacío si la web estaba
   * atrasada y sí se podía). */
  noPermitidos: NoPermitido[];
  /** Las fichas que toca («Person_H»…), para buscar. */
  claves: string[];
  estado: EstadoSolicitud;
  /** `modificada`: aplicada con «Modificar y aplicar» (rehecha por el
   * administrador, paso 14). */
  resolucion: { por: Autor; fecha: Fecha; comentario: string | null; cambio: string | null; modificada?: boolean } | null;
  /** El correo a los administradores (alCrearSolicitud). */
  aviso: { enviado: Fecha | null; error: string | null; destinatarios?: number };
}

export const idSolicitud = (secuencia: number) => `s${String(secuencia).padStart(7, "0")}`;
export const ID_SOLICITUD = /^s\d{7}$/;
