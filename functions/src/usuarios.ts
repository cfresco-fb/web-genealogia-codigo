/**
 * Invitaciones desde la pantalla de administración (paso 14; DA-22 a): el
 * administrador da de alta, cambia (persona y rol), revoca y reactiva
 * invitaciones a través de la función, y cada cambio queda en el registro
 * de usuarios (`registroUsuarios/{id}`, DA-12 b), en la misma transacción.
 *
 * Varios administradores, sí; pero tiene que quedar al menos uno con la
 * invitación activa: nadie quita el rol (ni revoca) al último. Sin correo
 * de invitación: se comunican en persona.
 *
 * La línea de órdenes (firestore/invitaciones.ts) sigue sirviendo para el
 * primer administrador y para la puesta en marcha; esa no deja registro.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { esMapa, HANDLE } from "../../comun/gramps.ts";
import type { Rol } from "../../comun/permisos.ts";
import { ErrorTransaccion, leerInvitacion, type Opciones } from "./transaccion.ts";

const ROLES: Rol[] = ["administrador", "revisor", "familiar"];
const ESTADOS = ["activa", "revocada"] as const;
type EstadoInvitacion = (typeof ESTADOS)[number];

export interface DatosInvitacion {
  persona: string | null;
  rol: Rol;
  estado: EstadoInvitacion;
}

const CORREO = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

function leerPeticion(entrada: unknown): DatosInvitacion & { correo: string } {
  const mal = (m: string) => new ErrorTransaccion("PETICION", m);
  if (!esMapa(entrada)) throw mal("La petición no es un objeto");
  const { correo, persona, rol, estado } = entrada;
  if (typeof correo !== "string" || correo.length > 320 || !CORREO.test(correo.trim())) throw mal("Correo no válido");
  if (persona !== null && (typeof persona !== "string" || !HANDLE.test(persona))) throw mal("Persona no válida");
  if (!ROLES.includes(rol as Rol)) throw mal("Rol no válido");
  if (!ESTADOS.includes(estado as EstadoInvitacion)) throw mal("Estado no válido");
  return { correo: correo.trim().toLowerCase(), persona: persona as string | null, rol: rol as Rol, estado: estado as EstadoInvitacion };
}

const datos = (d: Record<string, unknown> | undefined): DatosInvitacion | null =>
  d ? { persona: (d.persona as string | null) ?? null, rol: d.rol as Rol, estado: d.estado as EstadoInvitacion } : null;

export async function guardarInvitacion(
  db: Firestore, correoToken: string, entrada: unknown, opciones: Opciones = {},
): Promise<{ correo: string; cambiada: boolean }> {
  const quien = correoToken.toLowerCase();
  const p = leerPeticion(entrada);
  const ahora = opciones.ahora ?? (() => new Date());

  return db.runTransaction(async (tx) => {
    const refInvitacion = db.doc(`invitaciones/${p.correo}`);
    const [docPropia, docAntes] = await tx.getAll(db.doc(`invitaciones/${quien}`), refInvitacion);
    const propia = leerInvitacion(docPropia.data());
    if (!propia) throw new ErrorTransaccion("ACCESO", "Sin invitación activa");
    if (propia.rol !== "administrador") throw new ErrorTransaccion("SIN_PERMISO", "Solo el administrador gestiona las invitaciones");
    if (p.persona && !(await tx.get(db.doc(`Person/${p.persona}`))).exists) {
      throw new ErrorTransaccion("PETICION", "Esa persona no está en el árbol", { motivo: "persona" });
    }
    const antes = datos(docAntes.data());
    // El último administrador activo no pierde el rol ni el acceso.
    const eraAdministrador = antes?.rol === "administrador" && antes.estado === "activa";
    const sigue = p.rol === "administrador" && p.estado === "activa";
    if (eraAdministrador && !sigue) {
      const activos = await tx.get(db.collection("invitaciones").where("rol", "==", "administrador").where("estado", "==", "activa"));
      if (activos.size <= 1) throw new ErrorTransaccion("PETICION", "Tiene que quedar al menos un administrador", { motivo: "ultimoAdministrador" });
    }
    const despues: DatosInvitacion = { persona: p.persona, rol: p.rol, estado: p.estado };
    if (antes && antes.persona === despues.persona && antes.rol === despues.rol && antes.estado === despues.estado) {
      return { correo: p.correo, cambiada: false };
    }

    const fecha = Timestamp.fromDate(ahora());
    const por = { correo: quien, persona: propia.persona };
    tx.set(refInvitacion, {
      correo: p.correo,
      ...despues,
      creada: docAntes.get("creada") ?? fecha,
      actualizada: fecha,
      revocada: p.estado === "revocada" ? (antes?.estado === "revocada" ? docAntes.get("revocada") ?? fecha : fecha) : null,
      actualizadaPor: por,
    });
    tx.set(db.collection("registroUsuarios").doc(), { fecha, por, correo: p.correo, antes, despues });
    return { correo: p.correo, cambiada: true };
  });
}
