/**
 * Aniversarios por correo (docs/calendario.md; decisiones de Carlos del
 * 03/11/2026 en docs/decisiones-web-familiar.md, «Calendario de
 * aniversarios»). Cada día a las 07:00 de Madrid (aniversariosPorCorreo,
 * index.ts) se mira qué toca: el domingo, los de la semana siguiente para
 * quien lo pidió semanal; el último día del mes, los del mes siguiente para
 * quien lo pidió mensual (el correo sale el día antes del periodo).
 *
 * Solo a los usuarios con invitación activa. Los aniversarios, del cálculo
 * de comun/aniversarios.ts (el mismo de la página «Calendario») sobre la
 * instantánea de Storage, con quién se considera vivo según los parámetros
 * del administrador (configuracion/vivos), solo los tipos que eligió cada
 * uno (todos, si no eligió; Carlos, 04/11/2026). Correo de texto, con las fechas
 * en el formato largo de la región de cada usuario (la elegida en Ajustes
 * o, si no eligió ninguna, la de España) y el enlace a cada ficha. Sin
 * aniversarios de sus tipos en el periodo, no se envía nada. Un fallo con un usuario no
 * corta a los demás.
 */
import type { Firestore } from "firebase-admin/firestore";
import { gunzipSync } from "node:zlib";
import {
  aniversarios, asuntoCorreo, fechaLarga, introCorreo, leerTiposCorreo, nombreTipoAniversario, periodosDelDia, porDia, SUSCRIPCIONES,
  textoAniversario, type Aniversario, type DatosAniversarios, type Dia, type Periodo, type Suscripcion, type TipoAniversario,
  type Traducir,
} from "../../comun/aniversarios.ts";
import { invitacionActiva } from "../../comun/altas.ts";
import { esMapa, type ObjetoGramps } from "../../comun/gramps.ts";
import {
  PARAMETROS_VIVOS_POR_DEFECTO, personasVivas, validarParametrosVivos, type EventoVivos, type FamiliaVivos, type PersonaVivos,
} from "../../comun/vivos.ts";
// Los textos, los mismos de la web (claves «calendario.*»).
import { es } from "../../app/src/i18n/es.ts";
import { nombrePersona, urlWeb, type Enviar } from "./avisos.ts";
import { RUTA_INSTANTANEA, type Instantanea } from "./instantanea.ts";
import { sinAvisoDeOyentes } from "./oyentes.ts";

/** Región de las fechas de quien no eligió ninguna en Ajustes (en la web es
 * la del navegador, que el servidor no conoce). */
export const REGION_POR_DEFECTO = "es-ES";

/** La traducción de la web, en castellano. */
export const traducir: Traducir = (clave, valores) => {
  let texto: string = es[clave];
  for (const [k, v] of Object.entries(valores ?? {})) texto = texto.replaceAll(`{${k}}`, String(v));
  return texto;
};

type Cubo = { file(ruta: string): { download(): Promise<[Buffer]>; exists(): Promise<[boolean]> } };

/** Lo que necesita el cálculo, de la instantánea. */
export function datosDeInstantanea(inst: Pick<Instantanea, "objetos">): DatosAniversarios & { nombres: Map<string, ObjetoGramps> } {
  const mapa = <T>(tipo: string) => new Map((inst.objetos[tipo] ?? []).map((o) => [o.handle as string, o as unknown as T]));
  const personas = mapa<PersonaVivos & ObjetoGramps>("Person");
  return {
    personas,
    familias: mapa<FamiliaVivos & { handle: string; type: { value: number | string; string?: string } }>("Family"),
    eventos: mapa<EventoVivos & { type: { value: number | string; string?: string } }>("Event"),
    nombres: personas,
  };
}

/** El nombre del árbol, el que pone el administrador en Ajustes
 * (configuracion/arbol); sin él, el de la web por defecto. */
export async function leerNombreArbol(db: Firestore): Promise<string> {
  const n = (await db.doc("configuracion/arbol").get()).get("nombre");
  return typeof n === "string" && n.trim() ? n.trim() : es["app.titulo"];
}

/** Para el saludo: el apodo o, sin apodo, el nombre de pila de la persona
 * de su invitación (Carlos, 07/11/2026); sin persona, nada. */
export function nombreSaludo(p: ObjetoGramps | null | undefined): string {
  const n = p && esMapa(p.primary_name) ? p.primary_name : null;
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return n ? texto(n.nick) || texto(n.first_name) : "";
}

/** El correo de un periodo para un usuario: `arbol`, el nombre del árbol;
 * `persona`, el handle de la persona de su invitación. */
export function mensajeAniversarios(
  para: string, p: Periodo, lista: Aniversario[], region: string, datos: DatosAniversarios & { nombres: Map<string, ObjetoGramps> },
  arbol: string, persona: string | null,
): { para: string[]; asunto: string; texto: string } {
  const web = urlWeb();
  const nombre = (h: string | null | undefined) => (h && nombrePersona(datos.nombres.get(h) ?? null)) || "";
  const saludo = nombreSaludo(persona ? datos.nombres.get(persona) : null);
  const lineas: string[] = [...introCorreo(p, region, traducir, saludo, `${web}/ajustes`), ""];
  for (const { fecha, aniversarios: delDia } of porDia(lista)) {
    lineas.push(fechaLarga(region, fecha));
    for (const a of delDia) {
      const familia = a.familia ? datos.familias.get(a.familia) : null;
      const quien = a.persona
        ? nombre(a.persona)
        : [nombre(familia?.father_handle), nombre(familia?.mother_handle)].filter(Boolean).join(" y ");
      const enlace = a.persona ? `${web}/persona/${a.persona}` : `${web}/familia/${a.familia}`;
      lineas.push(`- ${nombreTipoAniversario(a, traducir)}: ${quien || "?"}, ${textoAniversario(a, traducir)}`, `  ${enlace}`);
    }
    lineas.push("");
  }
  return { para: [para], asunto: asuntoCorreo(p, region, traducir, arbol), texto: lineas.join("\n").trimEnd() };
}

export interface ResultadoAniversarios {
  /** Periodos que tocaban hoy («semanal», «mensual»). */
  periodos: Suscripcion[];
  enviados: number;
  /** Usuarios con suscripción a los que no había nada que mandar. */
  sinAniversarios: number;
  /** Suscritos sin invitación activa (no se les manda). */
  sinInvitacion: number;
  fallos: { correo: string; error: string }[];
}

/** La instantánea y quién se considera vivo según los parámetros del
 * administrador: lo que necesita el cálculo. También lo usa el ensayo
 * (firestore/aniversarios.ts). */
export async function leerDatosAniversarios(db: Firestore, cubo: Cubo) {
  const [gz] = await sinAvisoDeOyentes(() => cubo.file(RUTA_INSTANTANEA).download());
  const datos = datosDeInstantanea(JSON.parse(gunzipSync(gz).toString("utf8")) as Instantanea);
  const conf = (await db.doc("configuracion/vivos").get()).data();
  const { actualizada: _, ...parametros } = conf ?? {};
  const vivas = personasVivas(datos, validarParametrosVivos(parametros) ?? PARAMETROS_VIVOS_POR_DEFECTO);
  return { datos, vivas };
}

/** Manda los correos de aniversarios que tocan `hoy` (en Madrid). */
export async function enviarAniversarios(db: Firestore, cubo: Cubo, hoy: Dia, enviar: Enviar): Promise<ResultadoAniversarios> {
  const periodos = periodosDelDia(hoy);
  const r: ResultadoAniversarios = { periodos: periodos.map((p) => p.suscripcion), enviados: 0, sinAniversarios: 0, sinInvitacion: 0, fallos: [] };
  if (!periodos.length) return r;
  const prefs = await db.collection("preferencias").where("aniversarios", "in", periodos.map((p) => p.suscripcion)).get();
  if (prefs.empty) return r;

  // Solo los que tienen invitación activa.
  const suscritos: { correo: string; suscripcion: Suscripcion; region: string; tipos: TipoAniversario[] | null; persona: string | null }[] = [];
  for (const d of prefs.docs) {
    const suscripcion = SUSCRIPCIONES.find((s) => s === d.get("aniversarios"));
    if (!suscripcion) continue;
    const invitacion = (await db.doc(`invitaciones/${d.id}`).get()).data();
    if (!invitacionActiva(invitacion)) {
      r.sinInvitacion++;
      continue;
    }
    const region = d.get("region");
    suscritos.push({
      correo: d.id, suscripcion, region: typeof region === "string" && region ? region : REGION_POR_DEFECTO,
      tipos: leerTiposCorreo(d.get("aniversariosTipos")),
      persona: typeof invitacion?.persona === "string" ? invitacion.persona : null,
    });
  }
  if (!suscritos.length) return r;

  const { datos, vivas } = await leerDatosAniversarios(db, cubo);
  const arbol = await leerNombreArbol(db);

  for (const p of periodos) {
    const todos = aniversarios(datos, vivas, p.desde, p.hasta);
    for (const u of suscritos.filter((x) => x.suscripcion === p.suscripcion)) {
      const lista = u.tipos ? todos.filter((a) => u.tipos!.includes(a.tipo)) : todos;
      if (!lista.length) {
        r.sinAniversarios++;
        continue;
      }
      try {
        await enviar(mensajeAniversarios(u.correo, p, lista, u.region, datos, arbol, u.persona));
        r.enviados++;
      } catch (e) {
        r.fallos.push({ correo: u.correo, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return r;
}
