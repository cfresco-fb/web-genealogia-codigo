// Solicitudes (paso 12; docs/edicion.md, «Solicitudes»): enviarlas y
// retirarlas por la función del servidor, y leerlas de Firestore (las
// reglas dejan leer a cada uno las suyas y al administrador todas).

import { collection, doc, getDoc, getDocs, query, where, type Timestamp } from "firebase/firestore/lite";
import type { Tipo } from "../../comun/gramps.ts";
import type { Peticion } from "../../comun/peticion.ts";
import type { ClaseSolicitud, Solicitud } from "../../comun/solicitudes.ts";
import type { Arbol } from "./arbol/arbol";
import { db, llamarArbol } from "./firebase";

export type SolicitudWeb = Solicitud<Timestamp> & { id: string };

/** Manda una solicitud; devuelve su identificador («s0000012»). */
export async function enviarSolicitud(clase: ClaseSolicitud, peticion: Peticion): Promise<string> {
  const r = await llamarArbol<{ solicitud: string }>("solicitar", { solicitud: { clase, peticion } });
  return r.solicitud;
}

export async function retirarSolicitud(id: string): Promise<void> {
  await llamarArbol("retirarSolicitud", { id });
}

/** El administrador la rechaza, con un comentario opcional. */
export async function rechazarSolicitud(solicitud: string, comentario: string | null): Promise<void> {
  await llamarArbol("rechazarSolicitud", { resolucion: { solicitud, comentario } });
}

/** Las solicitudes de `correo`, o todas (el administrador), de la más
 * nueva a la más vieja. */
export async function leerSolicitudes(correo: string | null): Promise<SolicitudWeb[]> {
  const c = collection(db, "solicitudes");
  const r = await getDocs(correo ? query(c, where("autor.correo", "==", correo)) : c);
  return r.docs.map((d) => ({ ...(d.data() as Solicitud<Timestamp>), id: d.id })).sort((a, b) => b.secuencia - a.secuencia);
}

/** Las pendientes de `correo`, o todas las pendientes (el administrador),
 * de la más nueva a la más vieja. */
export async function leerPendientes(correo: string | null): Promise<SolicitudWeb[]> {
  const c = collection(db, "solicitudes");
  const pendientes = where("estado", "==", "pendiente");
  const r = await getDocs(correo ? query(c, where("autor.correo", "==", correo), pendientes) : query(c, pendientes));
  return r.docs.map((d) => ({ ...(d.data() as Solicitud<Timestamp>), id: d.id })).sort((a, b) => b.secuencia - a.secuencia);
}

/** Las fichas de la solicitud que han cambiado en el árbol desde que se
 * pidió (su versión ya no es la de entonces, o ya no están): por ellas no se
 * puede aplicar tal cual (CONFLICTO, DA-20 a). Si la web tiene el árbol
 * atrasado, puede no verlas todas; nunca ve de más. */
export function fichasCambiadas(arbol: Arbol, s: SolicitudWeb): { tipo: Tipo; handle: string }[] {
  return s.objetos
    .filter((o) => o.operacion !== "crear" && arbol.obtener(o.tipo, o.handle)?.change !== o.base)
    .map(({ tipo, handle }) => ({ tipo, handle }));
}

export async function leerSolicitud(id: string): Promise<SolicitudWeb | null> {
  const d = await getDoc(doc(db, "solicitudes", id));
  return d.exists() ? { ...(d.data() as Solicitud<Timestamp>), id: d.id } : null;
}
