// Invitaciones desde la pantalla de administración (paso 14; DA-22 a): se
// leen de Firestore (las reglas dejan al administrador leerlas todas, y su
// registro) y se guardan por la función del servidor
// (functions/src/usuarios.ts), que deja cada cambio en `registroUsuarios`.

import { collection, getDocs, type Timestamp } from "firebase/firestore/lite";
import { db, llamarArbol } from "./firebase";

export type Rol = "administrador" | "revisor" | "familiar";
export const ROLES: Rol[] = ["administrador", "revisor", "familiar"];
export type EstadoInvitacion = "activa" | "revocada";

export interface DatosInvitacion {
  persona: string | null;
  rol: Rol;
  estado: EstadoInvitacion;
}

export interface InvitacionWeb extends DatosInvitacion {
  correo: string;
  creada?: Timestamp;
  actualizada?: Timestamp;
}

export interface EntradaUsuarios {
  id: string;
  fecha: Timestamp;
  por: { correo: string; persona: string | null };
  correo: string;
  antes: DatosInvitacion | null;
  despues: DatosInvitacion;
}

export async function leerInvitaciones(): Promise<InvitacionWeb[]> {
  const r = await getDocs(collection(db, "invitaciones"));
  return r.docs.map((d) => ({ ...(d.data() as InvitacionWeb), correo: d.id })).sort((a, b) => a.correo.localeCompare(b.correo));
}

/** El registro de las invitaciones, del más nuevo al más viejo. */
export async function leerRegistroUsuarios(): Promise<EntradaUsuarios[]> {
  const r = await getDocs(collection(db, "registroUsuarios"));
  return r.docs.map((d) => ({ ...(d.data() as Omit<EntradaUsuarios, "id">), id: d.id })).sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis());
}

/** Alta o cambio (persona, rol, revocar, reactivar). `cambiada`: false si
 * ya estaba así. */
export async function guardarInvitacion(correo: string, datos: DatosInvitacion): Promise<{ correo: string; cambiada: boolean }> {
  return llamarArbol("invitacion", { invitacion: { correo, ...datos } });
}
