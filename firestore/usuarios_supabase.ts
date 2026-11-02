/**
 * Migración de los usuarios de Supabase (docs/puesta-en-marcha.md,
 * apartado 4; decisiones del 30/10/2026: D3 y D8).
 *
 * Entradas, las dos en datos/ (fuera de git):
 * - la exportación de Supabase en CSV: id, email, encrypted_password,
 *   email_confirmed_at, created_at (las contraseñas, cifradas con bcrypt);
 * - la lista de correspondencias, hecha con Excel (separador «;» o «,»,
 *   UTF-8 con o sin BOM): correo, persona (ID del árbol, como I0001, o
 *   vacío: sin persona) y rol (administrador, revisor o familiar).
 *
 * Por cada correo de la lista:
 * - si está en Supabase, crea su cuenta en Firebase Auth con su contraseña
 *   bcrypt (podrá entrar con la de siempre), un identificador nuevo de
 *   Firebase (D3) y el correo verificado, también si no lo confirmó en
 *   Supabase (Carlos, 30/10/2026);
 * - crea su invitación, y cada una queda en el registro de las invitaciones
 *   (`registroUsuarios`, como las de la pantalla de administración), con
 *   quien lanza el programa como autor (un administrador, como la carga).
 * Los correos de la lista que no están en Supabase, solo con la invitación
 * (podrán crear la cuenta o entrar con Google). Los usuarios de Supabase que
 * no están en la lista no se crean: se listan al final (D8, caso a caso).
 * Las cuentas y las invitaciones que ya existen no se tocan.
 *
 * Si la lista tiene personas que no están en el árbol, roles desconocidos,
 * correos repetidos o mal escritos, se para antes de escribir nada.
 * Nunca escribe las contraseñas cifradas en la consola.
 *
 * Uso:
 *   node firestore/usuarios_supabase.ts <supabase.csv> <lista.csv> [--escribir] [--produccion]
 * Sin «--escribir», solo un ensayo: dice qué haría, sin escribir nada. Con
 * «--produccion», en el proyecto real (pide escribir su identificador y,
 * para escribir, una segunda confirmación).
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Auth, UserImportRecord } from "firebase-admin/auth";
import { confirmar, conectar, elegirDestino, enProduccion, preguntar } from "./comun.ts";
import { autorCarga, correoDeLaCuenta } from "./cargar.ts";
import { COLECCION_INVITACIONES, ROLES, nombrePersona, normalizarCorreo, type Rol } from "./invitaciones.ts";

/** Lee un CSV: separador «;» o «,» (el que tenga la cabecera), BOM,
 * campos entre comillas (con "" dentro) y saltos de línea de Windows. Las
 * filas vacías se saltan. Devuelve las filas como objetos con los nombres
 * de la cabecera en minúsculas, y la línea de cada una. */
export function leerCsv(texto: string): { linea: number; campos: Record<string, string> }[] {
  texto = texto.replace(/^﻿/, "");
  const primera = texto.split(/\r?\n/, 1)[0];
  const separador = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: { linea: number; valores: string[] }[] = [];
  let valores: string[] = [];
  let valor = "";
  let comillas = false;
  let linea = 1;
  let inicio = 1;
  const cerrarFila = () => {
    valores.push(valor);
    if (valores.some((v) => v.trim())) filas.push({ linea: inicio, valores });
    valores = [];
    valor = "";
    inicio = linea;
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { valor += '"'; i++; }
      else if (c === '"') comillas = false;
      else { if (c === "\n") linea++; valor += c; }
    } else if (c === '"') comillas = true;
    else if (c === separador) { valores.push(valor); valor = ""; }
    else if (c === "\n") { linea++; cerrarFila(); }
    else if (c !== "\r") valor += c;
  }
  if (comillas) throw new Error("El CSV tiene unas comillas sin cerrar");
  cerrarFila();
  const [cabecera, ...resto] = filas;
  if (!cabecera) return [];
  const nombres = cabecera.valores.map((v) => v.trim().toLowerCase());
  return resto.map((f) => ({ linea: f.linea, campos: Object.fromEntries(nombres.map((n, j) => [n, (f.valores[j] ?? "").trim()])) }));
}

function columnas(filas: ReturnType<typeof leerCsv>, nombres: string[], fichero: string) {
  const faltan = nombres.filter((n) => filas.length && !(n in filas[0].campos));
  if (faltan.length) throw new Error(`A ${fichero} le faltan las columnas ${faltan.join(", ")}`);
}

export interface UsuarioSupabase {
  correo: string;
  /** El cifrado bcrypt de la contraseña; null si no tiene. */
  hash: string | null;
  confirmado: boolean;
}

const BCRYPT = /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/;

/** La exportación de Supabase, por correo en minúsculas. */
export function leerSupabase(texto: string): Map<string, UsuarioSupabase> {
  const filas = leerCsv(texto);
  columnas(filas, ["email", "encrypted_password", "email_confirmed_at"], "la exportación de Supabase");
  const usuarios = new Map<string, UsuarioSupabase>();
  const errores: string[] = [];
  for (const { linea, campos } of filas) {
    let correo: string;
    try {
      correo = normalizarCorreo(campos.email);
    } catch (e) {
      errores.push(`línea ${linea}: ${(e as Error).message}`);
      continue;
    }
    const hash = campos.encrypted_password || null;
    // Sin mostrar el cifrado.
    if (hash && !BCRYPT.test(hash)) errores.push(`línea ${linea} (${correo}): la contraseña no está cifrada con bcrypt`);
    if (usuarios.has(correo)) errores.push(`línea ${linea}: ${correo}, repetido`);
    usuarios.set(correo, { correo, hash, confirmado: !!campos.email_confirmed_at });
  }
  if (errores.length) throw new Error(`La exportación de Supabase tiene errores:\n  ${errores.join("\n  ")}`);
  return usuarios;
}

export interface Correspondencia {
  correo: string;
  /** ID del árbol (I0001), o null: sin persona. */
  persona: string | null;
  rol: Rol;
  linea: number;
}

/** La lista de correspondencias. Los errores de forma (correos mal
 * escritos o repetidos, roles desconocidos), todos juntos. */
export function leerCorrespondencias(texto: string): Correspondencia[] {
  const filas = leerCsv(texto);
  columnas(filas, ["correo", "persona", "rol"], "la lista de correspondencias");
  const lista: Correspondencia[] = [];
  const errores: string[] = [];
  const vistos = new Map<string, number>();
  for (const { linea, campos } of filas) {
    let correo: string;
    try {
      correo = normalizarCorreo(campos.correo);
    } catch (e) {
      errores.push(`línea ${linea}: ${(e as Error).message}`);
      continue;
    }
    const rol = campos.rol.toLowerCase();
    if (!ROLES.includes(rol as Rol)) errores.push(`línea ${linea} (${correo}): rol desconocido «${campos.rol}» (${ROLES.join(", ")})`);
    if (vistos.has(correo)) errores.push(`línea ${linea}: ${correo}, repetido (ya está en la línea ${vistos.get(correo)})`);
    vistos.set(correo, linea);
    lista.push({ correo, persona: campos.persona.toUpperCase() || null, rol: rol as Rol, linea });
  }
  if (errores.length) throw new Error(`La lista de correspondencias tiene errores:\n  ${errores.join("\n  ")}`);
  return lista;
}

export interface Alta extends Correspondencia {
  /** Handle de la persona, o null. */
  handle: string | null;
  /** Nombre para mostrarlo («I0001 Nombre Apellidos»). */
  nombre: string;
  /** La cuenta que se crea (si está en Supabase con contraseña y no existe). */
  cuenta: UsuarioSupabase | null;
  /** Por qué no se crea la cuenta, si no se crea. */
  sinCuenta: "existe" | "noEnSupabase" | "sinContrasena" | null;
  /** Si se crea la invitación (false: ya existe). */
  invitacion: boolean;
  /** La invitación que ya existe, si no coincide con la lista. */
  invitacionDistinta: string | null;
}

export interface Plan {
  altas: Alta[];
  /** Correos de Supabase que no están en la lista (no se crean). */
  fuera: UsuarioSupabase[];
}

/** Lo que hay que hacer, comprobado contra el árbol, las cuentas y las
 * invitaciones. Se para (lanza un error) si alguna persona de la lista no
 * está en el árbol. No escribe nada. */
export async function planificar(db: Firestore, auth: Auth, supabase: Map<string, UsuarioSupabase>, lista: Correspondencia[]): Promise<Plan> {
  const personas = new Map<string, { handle: string; nombre: string }>();
  for (const d of (await db.collection("Person").select("gramps_id", "primary_name").get()).docs) {
    const id = String(d.get("gramps_id"));
    personas.set(id.toUpperCase(), { handle: d.id, nombre: nombrePersona({ handle: d.id, gramps_id: id, primary_name: d.get("primary_name") }) });
  }
  const noEstan = lista.filter((c) => c.persona && !personas.has(c.persona));
  if (noEstan.length) {
    throw new Error(`Personas de la lista que no están en el árbol:\n  ${noEstan.map((c) => `línea ${c.linea} (${c.correo}): ${c.persona}`).join("\n  ")}`);
  }

  const cuentas = new Set<string>();
  for (let i = 0; i < lista.length; i += 100) {
    const r = await auth.getUsers(lista.slice(i, i + 100).map((c) => ({ email: c.correo })));
    for (const u of r.users) if (u.email) cuentas.add(u.email.toLowerCase());
  }
  const refs = lista.map((c) => db.collection(COLECCION_INVITACIONES).doc(c.correo));
  const invitaciones = refs.length ? await db.getAll(...refs) : [];

  const altas = lista.map((c, i): Alta => {
    const s = supabase.get(c.correo) ?? null;
    const sinCuenta = cuentas.has(c.correo) ? "existe" : !s ? "noEnSupabase" : !s.hash ? "sinContrasena" : null;
    const inv = invitaciones[i];
    const persona = c.persona ? personas.get(c.persona)! : null;
    let invitacionDistinta: string | null = null;
    if (inv.exists && ((inv.get("persona") ?? null) !== (persona?.handle ?? null) || inv.get("rol") !== c.rol || inv.get("estado") !== "activa")) {
      const otra = [...personas.values()].find((p) => p.handle === inv.get("persona"));
      invitacionDistinta = `${inv.get("rol")}, ${inv.get("estado")}, ${otra?.nombre ?? (inv.get("persona") ? inv.get("persona") : "sin persona")}`;
    }
    return {
      ...c, handle: persona?.handle ?? null, nombre: persona?.nombre ?? "sin persona",
      cuenta: sinCuenta ? null : s, sinCuenta, invitacion: !inv.exists, invitacionDistinta,
    };
  });
  const enLista = new Set(lista.map((c) => c.correo));
  return { altas, fuera: [...supabase.values()].filter((s) => !enLista.has(s.correo)) };
}

/** El plan, en palabras. Sin las contraseñas cifradas. */
export function describirPlan(plan: Plan): string[] {
  const l: string[] = [];
  const cuentas = plan.altas.filter((a) => a.cuenta);
  const invitaciones = plan.altas.filter((a) => a.invitacion);
  l.push(`Cuentas que se crean (con su contraseña de Supabase y el correo verificado): ${cuentas.length}`);
  for (const a of cuentas) l.push(`  ${a.correo}${a.cuenta!.confirmado ? "" : "  (no lo confirmó en Supabase: revisa que esté bien escrito)"}`);
  l.push(`Invitaciones que se crean: ${invitaciones.length}`);
  for (const a of invitaciones) {
    const nota = a.sinCuenta === "noEnSupabase" ? "  (no está en Supabase: solo la invitación)"
      : a.sinCuenta === "sinContrasena" ? "  (en Supabase sin contraseña: solo la invitación)" : "";
    l.push(`  ${a.correo}: ${a.rol}, ${a.nombre}${nota}`);
  }
  const existen = plan.altas.filter((a) => a.sinCuenta === "existe" || !a.invitacion);
  if (existen.length) {
    l.push(`Ya existen (no se tocan): ${existen.length}`);
    for (const a of existen) {
      const que = [a.sinCuenta === "existe" && "la cuenta", !a.invitacion && "la invitación"].filter(Boolean).join(" y ");
      const distinta = a.invitacionDistinta ? `; la invitación es distinta de la lista (${a.invitacionDistinta}), cámbiala en Administración si hace falta` : "";
      l.push(`  ${a.correo}: ${que}${distinta}`);
    }
  }
  if (plan.fuera.length) {
    l.push(`Usuarios de Supabase que no están en la lista (no se crean; decide caso a caso): ${plan.fuera.length}`);
    for (const s of plan.fuera) l.push(`  ${s.correo}${s.confirmado ? "" : "  (sin confirmar en Supabase)"}`);
  }
  return l;
}

/** Identificador nuevo para Firebase Auth (D3), como los suyos: 28
 * caracteres. */
function uidNuevo(): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(28)].map((b) => letras[b % letras.length]).join("");
}

/** Los registros de la importación de Auth (BCRYPT, sin sal aparte: va
 * dentro del cifrado). */
export function registrosImportacion(plan: Plan): UserImportRecord[] {
  return plan.altas.filter((a) => a.cuenta).map((a) => ({
    uid: uidNuevo(),
    email: a.correo,
    emailVerified: true,
    passwordHash: Buffer.from(a.cuenta!.hash!, "utf8"),
  }));
}

/** Crea las cuentas y las invitaciones del plan. `autor`: el correo de quien
 * lo lanza, que debe ser administrador. Si alguna cuenta falla, se para
 * antes de las invitaciones; las invitaciones van todas juntas (si alguna ya
 * existiera para entonces, no se crea ninguna). */
export async function migrar(db: Firestore, auth: Auth, plan: Plan, { autor: correoAutor, ahora = new Date() }: { autor: string; ahora?: Date }) {
  const autor = await autorCarga(db, correoAutor);
  const registros = registrosImportacion(plan);
  for (let i = 0; i < registros.length; i += 1000) {
    const r = await auth.importUsers(registros.slice(i, i + 1000), { hash: { algorithm: "BCRYPT" } });
    if (r.errors.length) {
      const detalle = r.errors.map((e) => `${registros[i + e.index].email}: ${e.error.message}`);
      throw new Error(`No se han podido crear ${r.errors.length} cuentas (las demás, sí; las invitaciones, ninguna):\n  ${detalle.join("\n  ")}`);
    }
  }
  const fecha = Timestamp.fromDate(ahora);
  const por = { correo: autor.correo, persona: autor.persona };
  const lote = db.batch();
  for (const a of plan.altas.filter((x) => x.invitacion)) {
    const despues = { persona: a.handle, rol: a.rol, estado: "activa" as const };
    lote.create(db.collection(COLECCION_INVITACIONES).doc(a.correo), {
      correo: a.correo, ...despues, creada: fecha, actualizada: fecha, revocada: null, actualizadaPor: por,
    });
    lote.set(db.collection("registroUsuarios").doc(), { fecha, por, correo: a.correo, antes: null, despues });
  }
  await lote.commit();
  return { cuentas: registros.length, invitaciones: plan.altas.filter((x) => x.invitacion).length };
}

if (import.meta.main) {
  const args = await elegirDestino();
  const escribir = args.includes("--escribir");
  const [rutaSupabase, rutaLista, ...otros] = args.filter((a) => !a.startsWith("--"));
  if (!rutaSupabase || !rutaLista || otros.length || args.some((a) => a.startsWith("--") && a !== "--escribir")) {
    console.error("Uso: node firestore/usuarios_supabase.ts <supabase.csv> <lista.csv> [--escribir] [--produccion]");
    process.exit(2);
  }
  let escribiendo = false;
  try {
    const supabase = leerSupabase(readFileSync(rutaSupabase, "utf8"));
    const lista = leerCorrespondencias(readFileSync(rutaLista, "utf8"));
    const { db, auth } = conectar();
    const plan = await planificar(db, auth, supabase, lista);
    console.log(`\n${enProduccion() ? "Proyecto REAL" : "Emuladores"}. ${supabase.size} usuarios en Supabase, ${lista.length} en la lista.\n`);
    for (const l of describirPlan(plan)) console.log(l);
    const nada = !plan.altas.some((a) => a.cuenta || a.invitacion);
    if (!escribir) {
      console.log("\nEnsayo: no se ha escrito nada. Para hacerlo, añade «--escribir».");
    } else if (nada) {
      console.log("\nNo hay nada que crear.");
    } else {
      const correo = enProduccion() ? await correoDeLaCuenta() : await preguntar("Tu correo de administrador (el autor de las invitaciones): ");
      await autorCarga(db, correo);
      if (enProduccion()) await confirmar("\nPara crear las cuentas y las invitaciones, escribe MIGRAR LOS USUARIOS: ", "MIGRAR LOS USUARIOS");
      escribiendo = true;
      const r = await migrar(db, auth, plan, { autor: correo });
      console.log(`\nHecho: ${r.cuentas} cuentas y ${r.invitaciones} invitaciones.`);
    }
    console.log("Recuerda borrar de datos/ la exportación de Supabase cuando ya no la necesites: tiene las contraseñas cifradas.");
  } catch (e) {
    console.error(`\nError: ${e instanceof Error ? e.message : e}${escribiendo ? "" : "\nNo se ha escrito nada."}`);
    process.exit(1);
  }
  process.exit(0);
}
