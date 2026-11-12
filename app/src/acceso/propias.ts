// Lo que se escribe en preferencias/{correo} (docs/acceso.md, «Ajustes»),
// aparte del componente para poder probarlo sin montarlo.

import type { Generaciones } from "../arbol/grafico";
import type { PreferenciaSimbolos } from "../arbol/simbolos";
import type { ModoColor } from "./preferencias";
import type { Suscripcion, TipoAniversario } from "../../../comun/aniversarios.ts";

/** Lo que cada usuario guarda para sí; null = el valor por defecto. */
export interface Propias {
  simbolos: PreferenciaSimbolos | null;
  personaInicio: string | null;
  region: string | null;
  modoColor: Exclude<ModoColor, "auto"> | null;
  generaciones: Generaciones | null;
  /** Aniversarios por correo (calendario, 03/11/2026); null = ninguno. */
  aniversarios: Suscripcion | null;
  /** Qué tipos lleva ese correo (04/11/2026); null = todos. */
  aniversariosTipos: TipoAniversario[] | null;
  /** De quién son los aniversarios, en la página y en el correo
   * (11/11/2026); null = la familia cercana. */
  aniversariosDe: "arbol" | null;
}
export const SIN_PROPIAS: Propias = { simbolos: null, personaInicio: null, region: null, modoColor: null, generaciones: null, aniversarios: null, aniversariosTipos: null, aniversariosDe: null };

/** Lo que se escribe de los símbolos: solo los campos que admiten las reglas. */
export function camposSimbolos(p: PreferenciaSimbolos) {
  return p.juego === "personalizado"
    ? { juego: p.juego, nacimiento: p.nacimiento, defuncion: p.defuncion }
    : { juego: p.juego };
}

/** Una persona de inicio que ya no está en el árbol (la borró el
 * administrador) vale como «sin elegir»: si se escribiera, la regla
 * personaValida rechazaría el documento entero y el usuario no podría
 * cambiar ninguna preferencia (revisión del 02/11/2026, A4). */
export function sinPersonaQueNoExiste(p: Propias, existePersona: (h: string) => boolean): Propias {
  return p.personaInicio && !existePersona(p.personaInicio) ? { ...p, personaInicio: null } : p;
}

/** Los campos que se escriben (solo los elegidos; ninguno: se borra el
 * documento) y las preferencias que quedan. */
export function camposPreferencias(p: Propias, existePersona: (h: string) => boolean): { campos: Record<string, unknown>; propias: Propias } {
  const propias = sinPersonaQueNoExiste(p, existePersona);
  const campos: Record<string, unknown> = {};
  if (propias.simbolos) campos.simbolos = camposSimbolos(propias.simbolos);
  if (propias.personaInicio) campos.personaInicio = propias.personaInicio;
  if (propias.region) campos.region = propias.region;
  if (propias.modoColor) campos.modoColor = propias.modoColor;
  if (propias.generaciones) campos.generaciones = propias.generaciones;
  if (propias.aniversarios) campos.aniversarios = propias.aniversarios;
  if (propias.aniversariosTipos) campos.aniversariosTipos = propias.aniversariosTipos;
  if (propias.aniversariosDe) campos.aniversariosDe = propias.aniversariosDe;
  return { campos, propias };
}
