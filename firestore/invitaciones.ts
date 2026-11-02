/**
 * Invitaciones: quién puede entrar en la web, vinculado a qué persona del
 * árbol y con qué rol. Cómo funciona el acceso: docs/acceso.md.
 *
 * Uso:
 *   node firestore/invitaciones.ts crear <correo> <persona> <rol>
 *   node firestore/invitaciones.ts listar
 *   node firestore/invitaciones.ts revocar <correo>
 *   node firestore/invitaciones.ts sin-invitacion
 *
 * <persona> es el ID de Gramps (I0044) o el handle. <rol> es administrador,
 * revisor o familiar. «crear» sobre una invitación que ya existe la
 * actualiza (persona y rol) y la reactiva si estaba revocada.
 * «sin-invitacion» es un ensayo: lista las cuentas de Authentication cuyo
 * correo no tiene invitación activa, sin borrar nada (Carlos, 01/11/2026;
 * docs/acceso.md, «Altas solo con invitación»).
 *
 * Con «--produccion», en el proyecto real (pide escribir su identificador;
 * firestore/comun.ts, elegirDestino).
 */
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { conectar, elegirDestino } from "./comun.ts";

export const COLECCION_INVITACIONES = "invitaciones";
export const ROLES = ["administrador", "revisor", "familiar"] as const;
export type Rol = (typeof ROLES)[number];

export interface Invitacion {
  correo: string;
  /** Handle de la persona del árbol vinculada; null, sin persona. */
  persona: string | null;
  rol: Rol;
  estado: "activa" | "revocada";
  creada: Timestamp;
  actualizada: Timestamp;
  revocada: Timestamp | null;
}

/** El identificador del documento es el correo en minúsculas: es lo que
 * buscan las reglas (request.auth.token.email.lower()). */
export function normalizarCorreo(correo: string): string {
  const c = correo.trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(c)) throw new Error(`Correo no válido: «${correo}»`);
  return c;
}

interface PersonaArbol {
  handle: string;
  gramps_id: string;
  primary_name?: { first_name?: string; surname_list?: { prefix?: string; surname?: string }[] };
}

export function nombrePersona(p: PersonaArbol): string {
  const n = p.primary_name;
  const apellidos = (n?.surname_list ?? []).map((s) => [s.prefix, s.surname].filter(Boolean).join(" ")).filter(Boolean).join(" ");
  return `${p.gramps_id} ${[n?.first_name, apellidos].filter(Boolean).join(" ")}`.trim();
}

/** Busca la persona por handle o, si no, por ID de Gramps. */
async function buscarPersona(db: Firestore, persona: string): Promise<PersonaArbol> {
  const porHandle = await db.collection("Person").doc(persona).get();
  if (porHandle.exists) return porHandle.data() as PersonaArbol;
  const porId = await db.collection("Person").where("gramps_id", "==", persona).get();
  if (porId.size === 1) return porId.docs[0].data() as PersonaArbol;
  if (porId.size > 1) throw new Error(`Hay ${porId.size} personas con el ID ${persona}; usa el handle`);
  throw new Error(`No hay ninguna persona con el ID o handle «${persona}» en el árbol cargado`);
}

export async function crear(db: Firestore, correo: string, persona: string, rol: string) {
  const c = normalizarCorreo(correo);
  if (!ROLES.includes(rol as Rol)) throw new Error(`Rol no válido: «${rol}». Opciones: ${ROLES.join(", ")}`);
  const p = await buscarPersona(db, persona);
  const ref = db.collection(COLECCION_INVITACIONES).doc(c);
  const anterior = await ref.get();
  const ahora = Timestamp.now();
  await ref.set({
    correo: c,
    persona: p.handle,
    rol: rol as Rol,
    estado: "activa",
    creada: (anterior.exists && anterior.get("creada")) || ahora,
    actualizada: ahora,
    revocada: null,
  } satisfies Invitacion);
  const accion = !anterior.exists ? "Creada" : anterior.get("estado") === "revocada" ? "Reactivada" : "Actualizada";
  console.log(`${accion} la invitación de ${c}: ${rol}, vinculada a ${nombrePersona(p)}`);
}

export async function revocar(db: Firestore, correo: string) {
  const c = normalizarCorreo(correo);
  const ref = db.collection(COLECCION_INVITACIONES).doc(c);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`No hay ninguna invitación para ${c}`);
  if (doc.get("estado") === "revocada") {
    console.log(`La invitación de ${c} ya estaba revocada`);
    return;
  }
  await ref.update({ estado: "revocada", revocada: FieldValue.serverTimestamp(), actualizada: FieldValue.serverTimestamp() });
  console.log(`Revocada la invitación de ${c}. Pierde el acceso desde su próxima petición.`);
}

/** Estado de la cuenta de Auth con ese correo, si existe. */
async function estadoCuenta(auth: Auth, correo: string): Promise<string> {
  try {
    const u = await auth.getUserByEmail(correo);
    const proveedores = u.providerData.map((p) => (p.providerId === "password" ? "contraseña" : p.providerId === "google.com" ? "Google" : p.providerId));
    return `${u.emailVerified ? "verificada" : "SIN VERIFICAR"} (${proveedores.join(", ")})`;
  } catch (e) {
    if ((e as { code?: string }).code === "auth/user-not-found") return "aún no ha entrado";
    throw e;
  }
}

export async function listar(db: Firestore, auth: Auth) {
  const docs = (await db.collection(COLECCION_INVITACIONES).orderBy("correo").get()).docs;
  if (!docs.length) {
    console.log("No hay invitaciones.");
    return;
  }
  const filas = [["Correo", "Rol", "Estado", "Persona", "Cuenta"]];
  for (const d of docs) {
    const inv = d.data() as Invitacion;
    const p = inv.persona ? await db.collection("Person").doc(inv.persona).get() : null;
    filas.push([
      inv.correo, inv.rol, inv.estado,
      !p ? "sin persona" : p.exists ? nombrePersona(p.data() as PersonaArbol) : `¡${inv.persona} no está en el árbol!`,
      await estadoCuenta(auth, inv.correo),
    ]);
  }
  const anchos = filas[0].map((_, i) => Math.max(...filas.map((f) => f[i].length)));
  for (const [i, f] of filas.entries()) {
    console.log(f.map((v, j) => v.padEnd(anchos[j])).join("  "));
    if (i === 0) console.log(anchos.map((a) => "-".repeat(a)).join("  "));
  }
}

export interface CuentaSinInvitacion {
  uid: string;
  correo: string | null;
  invitacion: "ninguna" | "revocada";
  proveedores: string[];
  creada: string;
  ultimaEntrada: string | null;
}

/** Las cuentas de Authentication cuyo correo no tiene invitación activa
 * (ninguna o revocada). Solo lee. */
export async function cuentasSinInvitacion(db: Firestore, auth: Auth): Promise<CuentaSinInvitacion[]> {
  const estados = new Map((await db.collection(COLECCION_INVITACIONES).get()).docs.map((d) => [d.id, d.get("estado") as string]));
  const salida: CuentaSinInvitacion[] = [];
  let pagina: string | undefined;
  do {
    const r = await auth.listUsers(1000, pagina);
    for (const u of r.users) {
      const estado = u.email ? estados.get(u.email.toLowerCase()) : undefined;
      if (estado === "activa") continue;
      salida.push({
        uid: u.uid,
        correo: u.email ?? null,
        invitacion: estado === "revocada" ? "revocada" : "ninguna",
        proveedores: u.providerData.map((p) => (p.providerId === "password" ? "contraseña" : p.providerId === "google.com" ? "Google" : p.providerId)),
        creada: u.metadata.creationTime,
        ultimaEntrada: u.metadata.lastSignInTime ?? null,
      });
    }
    pagina = r.pageToken;
  } while (pagina);
  return salida.sort((a, b) => (a.correo ?? "").localeCompare(b.correo ?? ""));
}

async function listarSinInvitacion(db: Firestore, auth: Auth) {
  const cuentas = await cuentasSinInvitacion(db, auth);
  if (!cuentas.length) {
    console.log("Todas las cuentas tienen invitación activa.");
    return;
  }
  const fecha = (f: string | null) => (f ? new Date(f).toISOString().slice(0, 16).replace("T", " ") : "nunca");
  const filas = [["Correo", "Invitación", "Entra con", "Creada (UTC)", "Última entrada (UTC)", "Identificador (uid)"]];
  for (const c of cuentas) {
    filas.push([c.correo ?? "(sin correo)", c.invitacion, c.proveedores.join(", ") || "—", fecha(c.creada), fecha(c.ultimaEntrada), c.uid]);
  }
  const anchos = filas[0].map((_, i) => Math.max(...filas.map((f) => f[i].length)));
  for (const [i, f] of filas.entries()) {
    console.log(f.map((v, j) => v.padEnd(anchos[j])).join("  "));
    if (i === 0) console.log(anchos.map((a) => "-".repeat(a)).join("  "));
  }
  console.log(`\n${cuentas.length} cuenta(s) sin invitación activa. No se ha borrado nada.`);
}

if (import.meta.main) {
  const [orden, ...args] = await elegirDestino();
  const { db, auth } = conectar();
  try {
    if (orden === "crear" && args.length === 3) await crear(db, args[0], args[1], args[2]);
    else if (orden === "revocar" && args.length === 1) await revocar(db, args[0]);
    else if (orden === "listar" && args.length === 0) await listar(db, auth);
    else if (orden === "sin-invitacion" && args.length === 0) await listarSinInvitacion(db, auth);
    else {
      console.error("Uso:\n  invitaciones crear <correo> <persona: ID de Gramps o handle> <administrador|revisor|familiar>\n" +
        "  invitaciones listar\n  invitaciones revocar <correo>\n  invitaciones sin-invitacion\n(con «--produccion», en el proyecto real)");
      process.exit(2);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
