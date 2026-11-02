// Filtros del registro de cambios en la administración (Administracion.tsx).
//
// Los desplegables de Mantine no admiten valores repetidos (se rompe la
// página entera): «Todos» lleva un valor que no puede coincidir con uno real,
// y los autores van con «c:» delante, también los que no tienen correo (las
// cargas del árbol anteriores al 29/10/2026).

import type { EntradaRegistro } from "../registro";

export const TODOS = "*";

export interface FiltrosRegistro {
  desde: string;
  hasta: string;
  estado: string;
  origen: string;
  tipo: string;
  autor: string;
  persona: string | null;
}

export const FILTROS_VACIOS: FiltrosRegistro = { desde: "", hasta: "", estado: TODOS, origen: TODOS, tipo: TODOS, autor: TODOS, persona: null };

export const valorAutor = (correo: string) => `c:${correo}`;

/** Una opción por autor de lo cargado, por orden alfabético del nombre. */
export function opcionesAutores(entradas: EntradaRegistro[], nombre: (autor: EntradaRegistro["autor"]) => string) {
  const m = new Map<string, string>();
  for (const e of entradas) m.set(valorAutor(e.autor.correo), nombre(e.autor));
  return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Las entradas que pasan los filtros de estado, origen, tipo y autor (las
 * fechas y la persona van en la consulta). */
export const filtrarRegistro = (entradas: EntradaRegistro[], f: FiltrosRegistro) => entradas.filter((e) =>
  (f.estado === TODOS || e.estado === f.estado)
  && (f.origen === TODOS || e.origen === f.origen)
  && (f.tipo === TODOS || e.objetos.some((o) => o.tipo === f.tipo))
  && (f.autor === TODOS || valorAutor(e.autor.correo) === f.autor));
