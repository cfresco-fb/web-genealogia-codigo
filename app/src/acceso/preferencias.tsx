// Preferencias, que se leen al entrar (docs/acceso.md, «Ajustes»):
//
// - Las propias de cada usuario (preferencias/{correo}): sus símbolos de
//   nacimiento y defunción (app/src/arbol/simbolos.ts), su persona de inicio,
//   la región de las fechas (app/src/arbol/fechas.ts), el modo de color y
//   las generaciones con que se abre el árbol. Cada una, si no la ha
//   elegido, toma el valor por defecto: los símbolos del árbol
//   (configuracion/presentacion), la persona vinculada a su invitación (o,
//   si no tiene, la persona de inicio de Gramps de escritorio), la región
//   del navegador, el modo del ordenador o el móvil («Automático») y 4
//   generaciones.
// - Las del árbol, que fija el administrador: los símbolos por defecto, los
//   parámetros de quién se considera vivo (app/src/arbol/vivos.ts;
//   configuracion/vivos) y el nombre del árbol (configuracion/arbol), que es
//   el título de la web y de los PDF.
//
// Si no se pueden leer, la web sigue con los valores por defecto.

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMantineColorScheme } from "@mantine/core";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore/lite";
import { db } from "../firebase";
import { useArbol } from "../arbol/contexto";
import { fijarRegion, normalizarRegion, regionFechas } from "../arbol/fechas";
import { GENERACIONES_POR_DEFECTO, generacionesValidas, type Generaciones } from "../arbol/grafico";
import {
  PREFERENCIA_POR_DEFECTO, simbolosDe, validarPreferencia, type PreferenciaSimbolos, type Simbolos,
} from "../arbol/simbolos";
import type { Persona } from "../arbol/tipos";
import { PARAMETROS_VIVOS_POR_DEFECTO, personasVivas, validarParametrosVivos, type ParametrosVivos } from "../arbol/vivos";
import { t } from "../i18n";
import { useSesion } from "./sesion";

const RUTA_DEFECTO = "configuracion/presentacion";
const RUTA_VIVOS = "configuracion/vivos";
const RUTA_ARBOL = "configuracion/arbol";

/** Longitud del nombre del árbol (las reglas comprueban lo mismo). */
export const LARGO_NOMBRE_ARBOL = 80;

/** El nombre ya recortado, o null si no vale. */
export function validarNombreArbol(nombre: unknown): string | null {
  if (typeof nombre !== "string") return null;
  const n = nombre.trim();
  return n.length >= 1 && n.length <= LARGO_NOMBRE_ARBOL ? n : null;
}
const rutaPropia = (correo: string) => `preferencias/${correo}`;

/** Handle de Gramps válido para las reglas. */
const HANDLE = /^[A-Za-z0-9_]{1,50}$/;

/** Modo de color (decisión del 24/10/2026, «Diseño visual»): sin elegir,
 * «Automático», el del ordenador o el móvil. Los PDF salen siempre en claro. */
export const MODOS_COLOR = ["auto", "claro", "oscuro"] as const;
export type ModoColor = (typeof MODOS_COLOR)[number];
const ESQUEMA = { auto: "auto", claro: "light", oscuro: "dark" } as const;

/** Lo que cada usuario guarda para sí; null = el valor por defecto. */
interface Propias {
  simbolos: PreferenciaSimbolos | null;
  personaInicio: string | null;
  region: string | null;
  modoColor: Exclude<ModoColor, "auto"> | null;
  generaciones: Generaciones | null;
}
const SIN_PROPIAS: Propias = { simbolos: null, personaInicio: null, region: null, modoColor: null, generaciones: null };

export interface Preferencias {
  /** Los símbolos que se usan ahora (los propios o, si no hay, los del árbol). */
  simbolos: Simbolos;
  /** Preferencia propia, o null si usa la del árbol. */
  propia: PreferenciaSimbolos | null;
  /** Valor por defecto del árbol (el de fábrica si el administrador no ha fijado ninguno). */
  delArbol: PreferenciaSimbolos;
  /** Guarda la preferencia propia; con null, vuelve a la del árbol. */
  guardarPropia: (p: PreferenciaSimbolos | null) => Promise<void>;
  /** Solo administradores (las reglas lo impiden a los demás). */
  guardarDelArbol: (p: PreferenciaSimbolos) => Promise<void>;
  /** Persona de inicio del usuario: la elegida o, si no, la vinculada (o,
   * sin persona vinculada, la de Gramps de escritorio). */
  personaInicio: Persona | null;
  /** La ha elegido él (no es la de por defecto). */
  personaInicioPropia: boolean;
  /** Con null, vuelve a la de por defecto («Volver a mí»). */
  guardarPersonaInicio: (handle: string | null) => Promise<void>;
  /** Región de las fechas elegida, o null si es la del navegador. */
  region: string | null;
  guardarRegion: (region: string | null) => Promise<void>;
  /** Modo de color elegido («auto» si no ha elegido ninguno). */
  modoColor: ModoColor;
  guardarModoColor: (modo: ModoColor) => Promise<void>;
  /** Generaciones con que se abre el árbol (decisión del 29/10/2026): las
   * elegidas o, si no, 4. */
  generaciones: Generaciones;
  /** Guarda las generaciones; con null, vuelve a las de por defecto. */
  guardarGeneraciones: (g: Generaciones | null) => Promise<void>;
  /** Parámetros de quién se considera vivo (los de fábrica si no hay). */
  vivos: ParametrosVivos;
  /** Las personas que se consideran vivas con esos parámetros, calculadas
   * una sola vez para la web y los PDF: las demás se muestran como
   * fallecidas aunque no tengan defunción (decisión del 29/10/2026). */
  vivas: ReadonlySet<string>;
  /** Solo administradores. */
  guardarVivos: (p: ParametrosVivos) => Promise<void>;
  /** Nombre del árbol (por defecto, «Árbol familiar»). */
  nombreArbol: string;
  /** Solo administradores. */
  guardarNombreArbol: (nombre: string) => Promise<void>;
}

const Contexto = createContext<Preferencias | null>(null);

/** Lo que se escribe de los símbolos: solo los campos que admiten las reglas. */
function camposSimbolos(p: PreferenciaSimbolos) {
  return p.juego === "personalizado"
    ? { juego: p.juego, nacimiento: p.nacimiento, defuncion: p.defuncion }
    : { juego: p.juego };
}

/** Las preferencias propias de un documento leído (los campos que no
 * valgan, como si no estuvieran). */
function leerPropias(datos: Record<string, unknown> | undefined): Propias {
  if (!datos) return SIN_PROPIAS;
  const { simbolos, personaInicio, region, modoColor, generaciones } = datos;
  return {
    simbolos: validarPreferencia(simbolos),
    personaInicio: typeof personaInicio === "string" && HANDLE.test(personaInicio) ? personaInicio : null,
    region: typeof region === "string" && normalizarRegion(region) === region ? region : null,
    modoColor: modoColor === "claro" || modoColor === "oscuro" ? modoColor : null,
    generaciones: generacionesValidas(generaciones),
  };
}

export function ProveedorPreferencias({ children }: { children: ReactNode }) {
  const { invitacion } = useSesion();
  const arbol = useArbol();
  const [propias, setPropias] = useState<Propias>(SIN_PROPIAS);
  const [delArbol, setDelArbol] = useState<PreferenciaSimbolos>(PREFERENCIA_POR_DEFECTO);
  const [vivos, setVivos] = useState<ParametrosVivos>(PARAMETROS_VIVOS_POR_DEFECTO);
  const [nombreArbol, setNombreArbol] = useState(t("app.titulo"));
  // Región con la que están escritas las fechas ahora (cambia cuando
  // fijarRegion ha cargado el idioma).
  const [regionActiva, setRegionActiva] = useState(regionFechas);
  // Hasta leer las propias (y poner su región), no se enseña nada: si no,
  // las fechas saldrían un momento en otro formato.
  const [leidas, setLeidas] = useState(false);
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    let vigente = true;
    Promise.all([getDoc(doc(db, RUTA_DEFECTO)), getDoc(doc(db, rutaPropia(invitacion.correo)))])
      .then(async ([d, p]) => {
        const leidas = leerPropias(p.exists() ? p.data() : undefined);
        await fijarRegion(leidas.region);
        if (!vigente) return;
        setDelArbol((d.exists() && validarPreferencia(d.data().simbolos)) || PREFERENCIA_POR_DEFECTO);
        setPropias(leidas);
        setRegionActiva(regionFechas());
      })
      .catch((e) => console.error("No se han podido leer las preferencias", e))
      .finally(() => { if (vigente) setLeidas(true); });
    getDoc(doc(db, RUTA_VIVOS))
      .then((d) => {
        if (!vigente || !d.exists()) return;
        const { actualizada: _, ...resto } = d.data();
        setVivos(validarParametrosVivos(resto) ?? PARAMETROS_VIVOS_POR_DEFECTO);
      })
      .catch((e) => console.error("No se han podido leer los parámetros de quién se considera vivo", e));
    getDoc(doc(db, RUTA_ARBOL))
      .then((d) => {
        const n = d.exists() ? validarNombreArbol(d.data().nombre) : null;
        if (vigente && n) setNombreArbol(n);
      })
      .catch((e) => console.error("No se ha podido leer el nombre del árbol", e));
    return () => {
      vigente = false;
    };
  }, [invitacion.correo]);

  // El modo de color elegido, en cuanto se leen las preferencias (hasta
  // entonces, el último de este navegador o el del sistema). Mantine lo
  // recuerda en el navegador para la próxima vez.
  useEffect(() => {
    if (leidas) setColorScheme(ESQUEMA[propias.modoColor ?? "auto"]);
  }, [leidas, propias.modoColor, setColorScheme]);

  // La región elegida (o la del navegador), con su idioma cargado.
  useEffect(() => {
    let vigente = true;
    fijarRegion(propias.region)
      .then(() => { if (vigente) setRegionActiva(regionFechas()); })
      .catch((e) => console.error("No se ha podido cambiar la región de las fechas", e));
    return () => {
      vigente = false;
    };
  }, [propias.region]);

  /** Guarda las propias: solo los campos elegidos; sin ninguno, borra el
   * documento. */
  const guardarPropias = useCallback(async (cambios: Partial<Propias>) => {
    const nuevas = { ...propias, ...cambios };
    const ref = doc(db, rutaPropia(invitacion.correo));
    const campos: Record<string, unknown> = {};
    if (nuevas.simbolos) campos.simbolos = camposSimbolos(nuevas.simbolos);
    if (nuevas.personaInicio) campos.personaInicio = nuevas.personaInicio;
    if (nuevas.region) campos.region = nuevas.region;
    if (nuevas.modoColor) campos.modoColor = nuevas.modoColor;
    if (nuevas.generaciones) campos.generaciones = nuevas.generaciones;
    if (Object.keys(campos).length) await setDoc(ref, { ...campos, actualizada: serverTimestamp() });
    else await deleteDoc(ref);
    setPropias(nuevas);
  }, [propias, invitacion.correo]);

  const guardarPropia = useCallback((p: PreferenciaSimbolos | null) => guardarPropias({ simbolos: p }), [guardarPropias]);
  const guardarPersonaInicio = useCallback((h: string | null) => guardarPropias({ personaInicio: h }), [guardarPropias]);
  const guardarRegion = useCallback((r: string | null) => guardarPropias({ region: r }), [guardarPropias]);
  const guardarModoColor = useCallback(
    (m: ModoColor) => guardarPropias({ modoColor: m === "auto" ? null : m }), [guardarPropias],
  );

  const guardarGeneraciones = useCallback((g: Generaciones | null) => guardarPropias({ generaciones: g }), [guardarPropias]);

  const guardarDelArbol = useCallback(async (p: PreferenciaSimbolos) => {
    await setDoc(doc(db, RUTA_DEFECTO), { simbolos: camposSimbolos(p), actualizada: serverTimestamp() });
    setDelArbol(p);
  }, []);

  const guardarVivos = useCallback(async (p: ParametrosVivos) => {
    await setDoc(doc(db, RUTA_VIVOS), { ...p, actualizada: serverTimestamp() });
    setVivos(p);
  }, []);

  const guardarNombreArbol = useCallback(async (nombre: string) => {
    await setDoc(doc(db, RUTA_ARBOL), { nombre, actualizada: serverTimestamp() });
    setNombreArbol(nombre);
  }, []);

  const vivas = useMemo(() => personasVivas(arbol, vivos), [arbol, vivos]);

  const elegida = arbol.persona(propias.personaInicio);
  const personaInicio = elegida ?? arbol.persona(invitacion.persona) ?? arbol.personaInicioGramps;

  const valor = useMemo<Preferencias>(() => ({
    simbolos: simbolosDe(propias.simbolos ?? delArbol),
    propia: propias.simbolos,
    delArbol,
    guardarPropia,
    guardarDelArbol,
    personaInicio,
    personaInicioPropia: !!elegida,
    guardarPersonaInicio,
    region: propias.region,
    guardarRegion,
    modoColor: propias.modoColor ?? "auto",
    guardarModoColor,
    generaciones: propias.generaciones ?? GENERACIONES_POR_DEFECTO,
    guardarGeneraciones,
    vivos,
    vivas,
    guardarVivos,
    nombreArbol,
    guardarNombreArbol,
  }), [
    propias, delArbol, guardarPropia, guardarDelArbol, personaInicio, elegida, guardarPersonaInicio, guardarRegion,
    guardarModoColor, guardarGeneraciones, vivos, vivas, guardarVivos, nombreArbol, guardarNombreArbol,
  ]);

  // Con otra región, todo se vuelve a dibujar desde cero (hay listas y
  // árboles que guardan sus textos ya calculados).
  if (!leidas) return null;
  return <Contexto.Provider value={valor}><Fragment key={regionActiva}>{children}</Fragment></Contexto.Provider>;
}

export function usePreferencias(): Preferencias {
  const p = useContext(Contexto);
  if (!p) throw new Error("usePreferencias fuera de ProveedorPreferencias");
  return p;
}
