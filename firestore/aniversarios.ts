/**
 * Ensayo de los aniversarios por correo (docs/calendario.md, «Probarlo
 * cualquier día»; Carlos, 07/11/2026): el correo que recibiría un usuario,
 * para la semana o el mes que se elija, sin esperar al domingo o al último
 * día del mes. El cálculo y el texto, los mismos de la función programada
 * (functions/src/aniversarios.ts).
 *
 * Uso:
 *   node firestore/aniversarios.ts ver <correo> [semanal|mensual] [AAAA-MM-DD] [--produccion]
 *   node firestore/aniversarios.ts enviar <correo> [semanal|mensual] [AAAA-MM-DD] --produccion
 *
 * - «ver» escribe el correo en la pantalla y no envía nada.
 * - «enviar» lo manda de verdad, solo a <correo>, tras pedir confirmación.
 *   Solo con «--produccion»: la cuenta de Gmail y su contraseña de aplicación
 *   se leen de Secret Manager (GMAIL_USUARIO y GMAIL_CONTRASENA) con
 *   «npx firebase functions:secrets:access»; se quedan en memoria, nunca en
 *   un fichero.
 * - Sin «semanal» ni «mensual», el de las preferencias del usuario (y, si no
 *   tiene ninguno, semanal).
 * - Sin fecha, la próxima semana (de lunes a domingo) o el próximo mes; con
 *   fecha, la semana o el mes que la contiene.
 * - Los tipos y la región, los de sus Ajustes, como en el correo de verdad.
 *   Si no tiene invitación activa, avisa (la función no le enviaría nada),
 *   pero sigue.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createTransport } from "nodemailer";
import {
  diaSemana, hoyEn, leerTiposCorreo, periodosDelDia, sumarDias, SUSCRIPCIONES, aniversarios, type Dia, type Suscripcion,
} from "../comun/aniversarios.ts";
import { invitacionActiva } from "../comun/altas.ts";
import { PROYECTO_PRODUCCION } from "../comun/proyectos.ts";
import { leerDatosAniversarios, leerNombreArbol, mensajeAniversarios, REGION_POR_DEFECTO } from "../functions/src/aniversarios.ts";
import { confirmar, conectar, elegirDestino, enProduccion } from "./comun.ts";
import { normalizarCorreo } from "./invitaciones.ts";

const RAIZ = new URL("../", import.meta.url);

/** El periodo (semana de lunes a domingo, o mes) que contiene `dia`; se
 * saca con periodosDelDia del día anterior, como lo haría la función. */
export function periodoDe(suscripcion: Suscripcion, dia: Dia) {
  const inicio = suscripcion === "semanal" ? sumarDias(dia, -diaSemana(dia)) : ([dia[0], dia[1], 1] as Dia);
  const p = periodosDelDia(sumarDias(inicio, -1)).find((x) => x.suscripcion === suscripcion);
  if (!p) throw new Error("No se ha podido calcular el periodo");
  return p;
}

function leerFecha(texto: string): Dia {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  const d = m ? ([Number(m[1]), Number(m[2]), Number(m[3])] as Dia) : null;
  const valida = d && d[1] >= 1 && d[1] <= 12 && d[2] >= 1 && new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDate() === d[2];
  if (!d || !valida) throw new Error(`Fecha no válida: «${texto}» (AAAA-MM-DD)`);
  return d;
}

/** Un secreto de las funciones del proyecto real, con la CLI del proyecto.
 * La orden entera en una cadena (con «shell», que npx necesita en Windows,
 * Node avisa si se pasan los argumentos aparte); son nombres fijos, sin nada
 * que venga del usuario. */
function secreto(nombre: "GMAIL_USUARIO" | "GMAIL_CONTRASENA"): string {
  const r = spawnSync(`npx firebase functions:secrets:access ${nombre} --project ${PROYECTO_PRODUCCION}`,
    { cwd: RAIZ, encoding: "utf8", shell: true });
  const valor = (r.stdout ?? "").trim();
  if (r.status !== 0 || !valor) throw new Error(`No se ha podido leer el secreto ${nombre}: ${(r.stderr ?? "").trim() || "vacío"}`);
  return valor;
}

/** La dirección de la web del proyecto real (la misma variable que usan las
 * funciones), para los enlaces del correo. */
function urlWebProduccion(): string {
  const env = readFileSync(new URL("functions/.env.arbol-freswer", RAIZ), "utf8");
  const url = /^URL_WEB=(.*)$/m.exec(env)?.[1]?.trim();
  if (!url) throw new Error("Falta URL_WEB en functions/.env.arbol-freswer");
  return url;
}

async function principal() {
  const args = await elegirDestino();
  const [orden, correoArg, ...resto] = args;
  if (!["ver", "enviar"].includes(orden ?? "") || !correoArg || resto.length > 2) {
    console.error("Uso:\n  aniversarios ver <correo> [semanal|mensual] [AAAA-MM-DD] [--produccion]\n" +
      "  aniversarios enviar <correo> [semanal|mensual] [AAAA-MM-DD] --produccion");
    process.exit(2);
  }
  if (orden === "enviar" && !enProduccion()) throw new Error("«enviar» solo con «--produccion» (con los emuladores no hay Gmail)");
  const correo = normalizarCorreo(correoArg);
  const suscripcionArg = resto.find((x) => !/^\d/.test(x));
  if (suscripcionArg && !SUSCRIPCIONES.includes(suscripcionArg as Suscripcion)) throw new Error(`«${suscripcionArg}»: semanal o mensual`);
  const fechaArg = resto.find((x) => /^\d/.test(x));
  if (enProduccion()) process.env.URL_WEB = urlWebProduccion();

  const { db, cubo } = conectar();
  const prefs = (await db.doc(`preferencias/${correo}`).get()).data() ?? {};
  const invitacion = (await db.doc(`invitaciones/${correo}`).get()).data();
  if (!invitacionActiva(invitacion)) {
    console.log(`Aviso: ${correo} no tiene invitación activa; la función programada no le enviaría nada.`);
  }
  const suya = SUSCRIPCIONES.find((s) => s === prefs.aniversarios);
  const suscripcion = (suscripcionArg as Suscripcion | undefined) ?? suya ?? "semanal";
  if (!suya) console.log(`Aviso: ${correo} no tiene los aniversarios por correo activados en Ajustes; se usa «${suscripcion}».`);
  const hoy = hoyEn("Europe/Madrid");
  const dia = fechaArg ? leerFecha(fechaArg)
    : suscripcion === "semanal" ? sumarDias(hoy, 7 - diaSemana(hoy))
      : (hoy[1] === 12 ? [hoy[0] + 1, 1, 1] : [hoy[0], hoy[1] + 1, 1]) as Dia;
  const periodo = periodoDe(suscripcion, dia);
  const region = typeof prefs.region === "string" && prefs.region ? prefs.region : REGION_POR_DEFECTO;
  const tipos = leerTiposCorreo(prefs.aniversariosTipos);

  const { datos, vivas } = await leerDatosAniversarios(db, cubo);
  const todos = aniversarios(datos, vivas, periodo.desde, periodo.hasta);
  const lista = tipos ? todos.filter((a) => tipos.includes(a.tipo)) : todos;
  if (!lista.length) {
    console.log("Sin aniversarios de sus tipos en ese periodo: la función no enviaría ningún correo.");
    return;
  }
  const persona = typeof invitacion?.persona === "string" ? invitacion.persona : null;
  const m = mensajeAniversarios(correo, periodo, lista, region, datos, await leerNombreArbol(db), persona);
  console.log(`\nPara: ${correo}\nAsunto: ${m.asunto}\n\n${m.texto}\n`);
  if (orden === "ver") {
    console.log("(Solo ver: no se ha enviado nada.)");
    return;
  }
  await confirmar(`Para enviarlo de verdad a ${correo}, escribe «enviar»: `, "enviar");
  const usuario = secreto("GMAIL_USUARIO");
  const transporte = createTransport({ service: "gmail", auth: { user: usuario, pass: secreto("GMAIL_CONTRASENA") } });
  await transporte.sendMail({ from: usuario, to: correo, subject: m.asunto, text: m.texto });
  console.log(`Enviado a ${correo}.`);
}

if (import.meta.main) {
  try {
    await principal();
    process.exit(0);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
