// El registro de cambios (paso 13; docs/edicion.md, «Reversión y
// corrección»): leer las entradas de `cambios` que tocan una ficha (el
// historial, DA-12 b) y una entrada concreta. Lo leen el administrador y
// los revisores (las reglas ya lo permitían). Y, para la pantalla de
// administración (paso 14), los cambios marcados y el registro entero por
// páginas.

import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, Timestamp, where, type QueryConstraint,
} from "firebase/firestore/lite";
import type { Tipo } from "../../comun/gramps.ts";
import type { ObjetoPropuesta } from "../../comun/solicitudes.ts";
import type { Operacion } from "../../comun/peticion.ts";
import { db, llamarArbol } from "./firebase";

export type EstadoCambio = "marcado" | "aceptado" | "revertido";

export interface EntradaRegistro {
  id: string;
  secuencia: number;
  fecha: Timestamp;
  autor: { correo: string; persona: string | null; rol: string };
  origen: "edicion" | "solicitud" | "reversion" | "correccion" | "carga" | string;
  accion: string;
  /** La ficha protagonista; ninguna en una carga del árbol. */
  principal: { tipo: Tipo; handle: string } | null;
  motivo: string | null;
  /** Con el antes y el después en JSON, salvo si no cabían (`fuera`). */
  objetos: { tipo: Tipo; handle: string; operacion: Operacion; antes?: string | null; despues?: string | null }[];
  estado: EstadoCambio;
  revision: { por: { correo: string; persona: string | null }; fecha: Timestamp; comentario: string | null } | null;
  revertidoPor: string | null;
  revierte: string | null;
  corrige: string | null;
  corregidoPor: string[];
  /** La solicitud de la que sale (aplicada o modificada y aplicada). */
  solicitud?: string | null;
  fuera: { ruta: string } | null;
  /** Una carga del árbol en el proyecto real (firestore/cargar.ts): el
   * fichero y cuántas fichas de cada tipo, sin los objetos. */
  carga?: { fichero: string; fichas: Partial<Record<Tipo, number>>; versionGramps: string | null; pruebasVaciadas: boolean };
}

/** Los objetos de una entrada como los de una solicitud, para contarlos
 * con cambiosSolicitud.ts. */
export const objetosPropuesta = (e: EntradaRegistro): ObjetoPropuesta[] =>
  e.objetos.map((o) => ({ tipo: o.tipo, handle: o.handle, operacion: o.operacion, base: null, antes: o.antes ?? null, despues: o.despues ?? null }));

const entrada = (id: string, datos: unknown) => ({ ...(datos as Omit<EntradaRegistro, "id">), id });

/** Acepta un cambio marcado (functions/src/revision.ts). */
export async function aceptarCambio(cambio: string, comentario: string | null): Promise<void> {
  await llamarArbol("aceptar", { revision: { cambio, comentario } });
}

export async function leerCambio(id: string): Promise<EntradaRegistro | null> {
  const d = await getDoc(doc(db, "cambios", id));
  return d.exists() ? entrada(d.id, d.data()) : null;
}

/** Los cambios por revisar, del más nuevo al más viejo. */
export async function leerMarcados(): Promise<EntradaRegistro[]> {
  const r = await getDocs(query(collection(db, "cambios"), where("estado", "==", "marcado")));
  return r.docs.map((d) => entrada(d.id, d.data())).sort((a, b) => b.secuencia - a.secuencia);
}

/** Las secuencias de los cambios entre dos fechas (`desde` incluida,
 * `hasta` no; null, sin límite), o null si no hay ninguno. La fecha y la
 * secuencia crecen juntas, así que el registro se recorre por secuencia:
 * solo condiciones de un campo, que no piden índices compuestos. */
export async function secuenciasEntre(desde: Date | null, hasta: Date | null): Promise<{ min: number; max: number } | null> {
  const c = collection(db, "cambios");
  const extremo = async (...condiciones: QueryConstraint[]) => {
    const r = await getDocs(query(c, ...condiciones, limit(1)));
    return r.empty ? null : (r.docs[0].get("secuencia") as number);
  };
  const min = desde ? await extremo(where("fecha", ">=", Timestamp.fromDate(desde)), orderBy("fecha", "asc")) : 1;
  const max = hasta ? await extremo(where("fecha", "<", Timestamp.fromDate(hasta)), orderBy("fecha", "desc")) : Number.MAX_SAFE_INTEGER;
  return min === null || max === null || min > max ? null : { min, max };
}

/** Una página del registro, de la secuencia `max` hacia atrás, sin bajar
 * de `min`. Los demás filtros los aplica la página. */
export async function leerRegistro(min: number, max: number, tamano: number): Promise<EntradaRegistro[]> {
  const r = await getDocs(query(collection(db, "cambios"),
    where("secuencia", ">=", min), where("secuencia", "<=", max), orderBy("secuencia", "desc"), limit(tamano)));
  return r.docs.map((d) => entrada(d.id, d.data()));
}

/** Los cambios que tocaron alguna de estas fichas («Person_X»…), del más
 * nuevo al más viejo. */
export async function leerHistorial(claves: string[]): Promise<EntradaRegistro[]> {
  const vistas = new Map<string, EntradaRegistro>();
  // «array-contains-any» admite 30 valores por consulta.
  for (let i = 0; i < claves.length; i += 30) {
    const r = await getDocs(query(collection(db, "cambios"), where("claves", "array-contains-any", claves.slice(i, i + 30))));
    for (const d of r.docs) vistas.set(d.id, entrada(d.id, d.data()));
  }
  const propias = new Set(claves);
  return [...vistas.values()]
    .filter((e) => e.objetos.some((o) => propias.has(`${o.tipo}_${o.handle}`)))
    .sort((a, b) => b.secuencia - a.secuencia);
}
