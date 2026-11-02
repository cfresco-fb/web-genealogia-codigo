/**
 * Revisión de los cambios marcados (adelantado del paso 14 a petición de
 * Carlos, 28/10/2026; diseño en docs/diseno-fase-3.md, apartados 5 y 8):
 * «Aceptar» un cambio marcado lo da por bueno. «Rechazar» es revertirlo
 * (reversion.ts), con el motivo como comentario de la revisión.
 *
 * Aceptan el administrador y los revisores, nunca sus propios cambios
 * (DA-11 a). El estado se cambia dentro de la transacción y solo desde
 * «marcado»: si dos revisan a la vez, el segundo recibe «ya revisado».
 */
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { clave, esMapa, type Tipo } from "../../comun/gramps.ts";
import { ErrorTransaccion, LIMITES, leerInvitacion, type Opciones } from "./transaccion.ts";

export async function aceptarCambio(db: Firestore, correoToken: string, entrada: unknown, opciones: Opciones = {}): Promise<{ cambio: string }> {
  const correo = correoToken.toLowerCase();
  const mal = (m: string) => new ErrorTransaccion("PETICION", m);
  if (!esMapa(entrada)) throw mal("La petición no es un objeto");
  const { cambio, comentario } = entrada;
  if (typeof cambio !== "string" || !/^c\d{7}$/.test(cambio)) throw mal("Cambio no válido");
  if (comentario !== undefined && comentario !== null && (typeof comentario !== "string" || comentario.length > LIMITES.motivo)) throw mal("Comentario no válido");
  const ahora = opciones.ahora ?? (() => new Date());

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`cambios/${cambio}`);
    const [docInvitacion, doc] = await tx.getAll(db.doc(`invitaciones/${correo}`), ref);
    const invitacion = leerInvitacion(docInvitacion.data());
    if (!invitacion) throw new ErrorTransaccion("ACCESO", "Sin invitación activa");
    if (invitacion.rol !== "administrador" && invitacion.rol !== "revisor") {
      throw new ErrorTransaccion("SIN_PERMISO", "Solo el administrador y los revisores revisan cambios");
    }
    if (!doc.exists) throw mal(`No existe el cambio ${cambio}`);
    if (doc.get("estado") !== "marcado") throw mal("Este cambio ya está revisado");
    if (doc.get("autor.correo") === correo) throw new ErrorTransaccion("SIN_PERMISO", "Nadie acepta sus propios cambios");
    const autor = { correo, persona: invitacion.persona, rol: invitacion.rol };
    const texto = typeof comentario === "string" && comentario.trim() ? comentario.trim() : null;
    tx.update(ref, { estado: "aceptado", revision: { por: autor, fecha: Timestamp.fromDate(ahora()), comentario: texto } });
    for (const o of doc.get("objetos") as { tipo: Tipo; handle: string }[]) {
      tx.set(db.doc(`datosWeb/${clave(o.tipo, o.handle)}`), { pendientes: FieldValue.increment(-1) }, { merge: true });
    }
  });
  return { cambio };
}
