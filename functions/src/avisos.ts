/**
 * Aviso por correo de cada solicitud nueva a los administradores (fase 3,
 * paso 12; decisión: correo solo para solicitudes, desde Gmail con
 * contraseña de aplicación; DA-19 a: a todos los administradores, sin
 * correo al solicitante). Lo manda el disparador alCrearSolicitud
 * (index.ts) y anota en la solicitud `aviso.enviado` o `aviso.error`: si
 * falla, la solicitud sigue en la web.
 *
 * El correo se arma aquí (`mensajeSolicitud`) y lo envía quien llame
 * (`Enviar`): en la nube, nodemailer por SMTP de Gmail con el usuario y la
 * contraseña de aplicación en Secret Manager; en el emulador, nada sale: el
 * mensaje se escribe en el registro de la función.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { deFirestore, esMapa, type ObjetoGramps, type Tipo } from "../../comun/gramps.ts";
import type { Solicitud } from "../../comun/solicitudes.ts";

export interface Mensaje {
  para: string[];
  asunto: string;
  texto: string;
}

export type Enviar = (m: Mensaje) => Promise<void>;

/** Dirección de la web, para el enlace del correo (en la nube, variable de
 * entorno URL_WEB de las funciones; docs/puesta-en-marcha.md). */
export const urlWeb = () => (process.env.URL_WEB ?? "http://localhost:5173").replace(/\/$/, "");

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** «Nombre Apellidos» de una persona de Gramps. */
export function nombrePersona(p: ObjetoGramps | null): string {
  const n = p && esMapa(p.primary_name) ? p.primary_name : null;
  if (!n) return "";
  const apellidos = (Array.isArray(n.surname_list) ? n.surname_list : [])
    .filter(esMapa)
    .flatMap((a) => [texto(a.prefix), texto(a.surname), texto(a.connector)])
    .filter(Boolean);
  return [texto(n.first_name), ...apellidos].filter(Boolean).join(" ");
}

async function leer(db: Firestore, tipo: Tipo, handle: string | null | undefined): Promise<ObjetoGramps | null> {
  if (!handle) return null;
  const d = await db.collection(tipo).doc(handle).get();
  return d.exists ? (deFirestore(d.data()) as ObjetoGramps) : null;
}

/** Cómo llamar a la ficha protagonista en el correo. */
async function nombreFicha(db: Firestore, tipo: Tipo, handle: string): Promise<string> {
  const o = await leer(db, tipo, handle);
  const sinNombre = "(sin nombre)";
  if (tipo === "Person") return `la persona ${nombrePersona(o) || sinNombre}`;
  if (tipo === "Family") {
    const nombres = await Promise.all([leer(db, "Person", o?.father_handle as string), leer(db, "Person", o?.mother_handle as string)]);
    const n = nombres.map(nombrePersona).filter(Boolean);
    return n.length ? `la familia de ${n.join(" y ")}` : "una familia";
  }
  if (tipo === "Place") {
    const nombre = esMapa(o?.name) ? texto(o.name.value) : "";
    return `el lugar ${nombre || sinNombre}`;
  }
  if (tipo === "Event") return "un evento";
  if (tipo === "Note") return "una nota";
  return "una ficha";
}

/** El correo de una solicitud. */
export async function mensajeSolicitud(db: Firestore, id: string, s: Solicitud, para: string[]): Promise<Mensaje> {
  const autor = nombrePersona(await leer(db, "Person", s.autor.persona)) || s.autor.correo;
  const ficha = await nombreFicha(db, s.principal.tipo, s.principal.handle);
  const que = s.clase === "borrado" ? `pide borrar ${ficha}` : `propone un cambio en ${ficha}`;
  return {
    para,
    asunto: `Solicitud de ${autor}: ${s.clase === "borrado" ? "borrado" : "cambio"}`,
    texto: [
      `${autor} (${s.autor.correo}) ${que}.`,
      "",
      `Motivo: ${s.motivo}`,
      "",
      `Ver la solicitud: ${urlWeb()}/solicitudes/${id}`,
    ].join("\n"),
  };
}

/** Manda el aviso de la solicitud `id` a los administradores con invitación
 * activa y lo anota en la solicitud. */
export async function avisarSolicitud(db: Firestore, id: string, enviar: Enviar, ahora = () => new Date()): Promise<{ enviado: boolean; destinatarios: number }> {
  const ref = db.doc(`solicitudes/${id}`);
  const doc = await ref.get();
  if (!doc.exists) return { enviado: false, destinatarios: 0 };
  const s = doc.data() as Solicitud;
  const admins = await db.collection("invitaciones").where("rol", "==", "administrador").where("estado", "==", "activa").get();
  const para = admins.docs.map((d) => d.id);
  try {
    if (!para.length) throw new Error("No hay administradores con invitación activa");
    await enviar(await mensajeSolicitud(db, id, s, para));
    await ref.update({ aviso: { enviado: Timestamp.fromDate(ahora()), error: null, destinatarios: para.length } });
    return { enviado: true, destinatarios: para.length };
  } catch (e) {
    await ref.update({ aviso: { enviado: null, error: e instanceof Error ? e.message : String(e), destinatarios: para.length } });
    return { enviado: false, destinatarios: para.length };
  }
}
