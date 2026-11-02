// Tipos del JSON de Gramps 6 (gramps.gen.lib.json_utils), solo con los
// campos que usa la web. Los objetos traen más campos; se conservan tal
// cual en la instantánea. Estructura de la instantánea: docs/instantanea.md.

import type { GrampsDate } from "../gramps-connect/gramps-date";
import type { TipoGramps } from "../i18n";

export type { GrampsDate, TipoGramps };

export interface Base {
  handle: string;
  gramps_id: string;
  change: number;
  private: boolean;
  note_list: string[];
}

export interface Ref {
  ref: string;
}

export interface EventRef extends Ref {
  role: TipoGramps;
}

export interface MediaRef extends Ref {
  /** Recorte [x1, y1, x2, y2] en porcentajes, o null para la imagen entera. */
  rect: [number, number, number, number] | null;
}

export interface Apellido {
  surname: string;
  prefix: string;
  primary: boolean;
  connector: string;
}

export interface Nombre {
  first_name: string;
  surname_list: Apellido[];
  suffix: string;
  title: string;
  call: string;
  nick: string;
  type: TipoGramps;
}

export interface Persona extends Base {
  /** 0 mujer, 1 hombre, 2 desconocido, 3 otro. */
  gender: number;
  primary_name: Nombre;
  alternate_names: Nombre[];
  event_ref_list: EventRef[];
  birth_ref_index: number;
  death_ref_index: number;
  family_list: string[];
  parent_family_list: string[];
  media_list: MediaRef[];
}

export interface ChildRef extends Ref {
  frel: TipoGramps;
  mrel: TipoGramps;
}

export interface Familia extends Base {
  father_handle: string | null;
  mother_handle: string | null;
  child_ref_list: ChildRef[];
  event_ref_list: EventRef[];
  type: TipoGramps;
  media_list: MediaRef[];
}

export interface Evento extends Base {
  type: TipoGramps;
  date: GrampsDate;
  /** Handle del lugar, o "" si no tiene. */
  place: string;
  description: string;
  media_list: MediaRef[];
}

export interface NombreLugar {
  value: string;
  date: GrampsDate;
  lang: string;
}

export interface Lugar extends Base {
  title: string;
  name: NombreLugar;
  alt_names: NombreLugar[];
  placeref_list: Ref[];
  place_type: TipoGramps;
  lat: string;
  long: string;
}

export interface Multimedia extends Base {
  path: string;
  mime: string;
  desc: string;
  date: GrampsDate;
}

export interface Nota extends Base {
  text: { string: string };
  type: TipoGramps;
}

/** Un cambio reciente, para la página de inicio (instantánea v2). */
export interface Reciente {
  cambio: string;
  secuencia: number;
  fecha: string;
  accion: string;
  principal: { tipo: string; handle: string };
  /** Persona vinculada del autor. */
  autor: string | null;
}

/** La instantánea del árbol (docs/instantanea.md), versiones 1 y 2. */
export interface Instantanea {
  version_instantanea: number;
  generada: string;
  version_gramps: string;
  persona_inicio: string | null;
  /** v2: último cambio del registro incluido. */
  secuencia?: number;
  /** v2: datos propios de la web. */
  web?: {
    /** De cada objeto creado en la web, la persona de quien lo creó. */
    creadoPor: Record<string, string | null>;
    recientes: Reciente[];
  };
  objetos: {
    Person?: Persona[];
    Family?: Familia[];
    Event?: Evento[];
    Place?: Lugar[];
    Media?: Multimedia[];
    Note?: Nota[];
    [tipo: string]: Base[] | undefined;
  };
}
