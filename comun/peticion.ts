/**
 * Lo que la web manda a la función del servidor al guardar y lo que recibe
 * (docs/edicion.md, «La transacción»): los mismos tipos en los dos lados.
 */
import type { ObjetoGramps, Tipo } from "./gramps.ts";

export type Operacion = "crear" | "modificar" | "borrar";

export interface ObjetoPeticion {
  tipo: Tipo;
  handle: string;
  operacion: Operacion;
  /** «change» del objeto cuando la web lo leyó (null al crear). */
  base: number | null;
  /** El objeto completo después del cambio (null al borrar). */
  despues: ObjetoGramps | null;
}

/** Una foto subida desde la web (comun/fotos.ts): el objeto Media nuevo
 * que la lleva y la carpeta de paso donde la ha dejado el navegador. */
export interface FicheroPeticion {
  handle: string;
  subida: string;
}

export interface Peticion {
  /** Qué ha hecho el usuario («editarEvento», «anadirHijo»…), para el
   * resumen del registro. */
  accion: string;
  /** Opcional en los cambios, obligatorio en las solicitudes (DA-18 a). */
  motivo: string | null;
  objetos: ObjetoPeticion[];
  /** Fotos subidas: una por cada Media que se crea (paso 11 b). */
  ficheros?: FicheroPeticion[];
  /** Corrección del administrador (paso 13; diseño, 5.4): el cambio del
   * registro que corrige («c0000123»). */
  corrige?: string | null;
  /** «Modificar y aplicar» (paso 14): la solicitud («s0000012») que el
   * administrador resuelve con este guardado, hecho a mano con la
   * propuesta a la vista (DA-20 a). */
  resuelve?: string | null;
}

export interface Resultado {
  cambio: string;
  secuencia: number;
  estado: "marcado" | "aceptado";
  /** Los objetos tal como han quedado (con ID y «change»), para que la web
   * los aplique a su árbol en memoria. */
  objetos: { tipo: Tipo; handle: string; operacion: Operacion; despues: ObjetoGramps | null }[];
}

/** Revertir un cambio del registro (paso 13; functions/src/reversion.ts):
 * sin `cadena`, solo se pide qué habría que revertir; con ella (la que se
 * enseñó), se revierte. */
export interface PeticionReversion {
  cambio: string;
  motivo: string | null;
  cadena?: string[];
}

/** Un cambio de la cadena que se revierte. */
export interface Eslabon {
  cambio: string;
  secuencia: number;
  fecha: string;
  accion: string;
  principal: { tipo: Tipo; handle: string };
  autor: { persona: string | null; correo: string };
  estado: string;
}

export interface ResultadoReversion {
  /** Los cambios que se deshacen, en el orden en que se deshacen (el
   * pedido, normalmente el último). */
  cadena: Eslabon[];
  /** Las reversiones escritas (vacío si solo se ha pedido la cadena). */
  cambios: string[];
  /** Cómo quedan las fichas (para que la web las ponga en su árbol), y la
   * secuencia de la última reversión. Sin «operacion»: lo que vuelve no
   * cambia de creador. */
  objetos: { tipo: Tipo; handle: string; despues: ObjetoGramps | null }[];
  secuencia: number;
}

/** Por qué se rechaza un cambio (detalles.codigo en el error de la
 * función). */
export type CodigoError = "ACCESO" | "PETICION" | "ESQUEMA" | "CONFLICTO" | "SIN_PERMISO" | "INTEGRIDAD" | "LIMITE";
