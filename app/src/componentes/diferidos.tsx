// Carga diferida de la edición (revisión del 08/11/2026, B1; decisión de
// Carlos del 02/11/2026; cifras en docs/puesta-en-marcha.md, «Hosting»): el
// código de los formularios que se abren desde las fichas y las listas, y el
// historial de una ficha, se descarga la primera vez que hace falta, no al
// entrar en la web. Hasta abrir una ventana no se monta nada; después se
// queda montada, para que se cierre con su animación. Las páginas de
// edición y administración se cargan aparte en App.tsx.

import { lazy, Suspense, useState, type ComponentProps, type ReactNode } from "react";
import { Center, Loader } from "@mantine/core";
import { useSesion } from "../acceso/sesion";
import type { FormularioEvento as FormularioEventoTipo } from "./FormularioEvento";
import type { FormularioLugar as FormularioLugarTipo } from "./FormularioLugar";
import type { FormularioNota as FormularioNotaTipo } from "./FormularioNota";
import type { Historial as HistorialTipo } from "../paginas/Cambios";

const FormularioEventoDiferido = lazy(() => import("./FormularioEvento").then((m) => ({ default: m.FormularioEvento })));
const FormularioLugarDiferido = lazy(() => import("./FormularioLugar").then((m) => ({ default: m.FormularioLugar })));
const FormularioNotaDiferido = lazy(() => import("./FormularioNota").then((m) => ({ default: m.FormularioNota })));
const HistorialDiferido = lazy(() => import("../paginas/Cambios").then((m) => ({ default: m.Historial })));

/** Mientras llega el código de una página o de una sección: el indicador,
 * centrado. */
export function Espera() {
  return <Center p="xl"><Loader /></Center>;
}

/** Una página o una sección cargada aparte. */
export function Diferido({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Espera />}>{children}</Suspense>;
}

/** Mientras llega el código de una ventana: el indicador, en el centro de la
 * pantalla (por encima de la ficha y de otras ventanas abiertas). */
function EsperaVentana() {
  return <Center pos="fixed" inset={0} style={{ zIndex: 400 }}><Loader /></Center>;
}

/** Si la ventana se ha abierto alguna vez (desde entonces sigue montada). */
function useAbiertaAlgunaVez(abierta: boolean): boolean {
  const [ya, setYa] = useState(abierta);
  if (abierta && !ya) setYa(true);
  return ya || abierta;
}

export function FormularioEvento(props: ComponentProps<typeof FormularioEventoTipo>) {
  if (!useAbiertaAlgunaVez(!!props.evento)) return null;
  return <Suspense fallback={<EsperaVentana />}><FormularioEventoDiferido {...props} /></Suspense>;
}

export function FormularioLugar(props: ComponentProps<typeof FormularioLugarTipo>) {
  if (!useAbiertaAlgunaVez(props.abierto)) return null;
  return <Suspense fallback={<EsperaVentana />}><FormularioLugarDiferido {...props} /></Suspense>;
}

export function FormularioNota(props: ComponentProps<typeof FormularioNotaTipo>) {
  if (!useAbiertaAlgunaVez(props.abierto)) return null;
  return <Suspense fallback={<EsperaVentana />}><FormularioNotaDiferido {...props} /></Suspense>;
}

/** «Historial» al pie de una ficha: solo lo ven el administrador y los
 * revisores, así que a los demás ni se les descarga. */
export function Historial(props: ComponentProps<typeof HistorialTipo>) {
  const { rol } = useSesion().invitacion;
  if (rol !== "administrador" && rol !== "revisor") return null;
  return <Diferido><HistorialDiferido {...props} /></Diferido>;
}
