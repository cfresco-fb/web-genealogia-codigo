import { Anchor, Text } from "@mantine/core";
import { Link } from "react-router";
import { useArbol } from "../arbol/contexto";
import { anio } from "../arbol/fechas";
import type { Familia, Persona } from "../arbol/tipos";
import { t } from "../i18n";

export const rutaPersona = (handle: string) => `/persona/${handle}`;
export const rutaFamilia = (handle: string) => `/familia/${handle}`;
export const rutaLugar = (handle: string) => `/lugar/${handle}`;
/** El mapa de una persona (su recorrido) o centrado en un lugar (añadidos
 * del mapa, 02/11/2026). Aquí y no en la página del mapa, que se carga
 * aparte. */
export const rutaMapaPersona = (handle: string) => `/mapa?persona=${handle}`;
export const rutaMapaLugar = (handle: string) => `/mapa?lugar=${handle}`;
export const rutaEditarPersona = (handle: string) => `/persona/${handle}/editar`;
/** `anadir`: abrir ya «Añadir hijo nuevo» («hijo») o el buscador de hijos
 * del árbol («hijoExistente»). */
export const rutaEditarFamilia = (handle: string, anadir?: "hijo" | "hijoExistente") =>
  `/familia/${handle}/editar${anadir ? `?anadir=${anadir}` : ""}`;
/** Formulario de una familia nueva (acciones compuestas, paso 11): con la
 * persona de la que se parte como padre, madre o hija. */
export const rutaNuevaFamilia = (como: "padre" | "madre" | "hijo", handle: string, anadir?: "hijo") =>
  `/familia/nueva?${como}=${handle}${anadir ? `&anadir=${anadir}` : ""}`;

/** «(1850–1920)», «(1850–)», «(–1920)» o nada. */
export function useAnios() {
  const arbol = useArbol();
  return (p: Persona): string => {
    const n = anio(arbol.nacimiento(p)?.evento.date);
    const d = anio(arbol.defuncion(p)?.evento.date);
    if (n === null && d === null) return "";
    return `(${n ?? ""}–${d ?? ""})`;
  };
}

export function EnlacePersona({ persona, anios = false }: { persona: Persona | null; anios?: boolean }) {
  const arbol = useArbol();
  const textoAnios = useAnios();
  if (!persona) return <Text span c="dimmed">{t("ficha.desconocido")}</Text>;
  return (
    <>
      <Anchor component={Link} to={rutaPersona(persona.handle)}><bdi>{arbol.nombre(persona)}</bdi></Anchor>
      {anios && textoAnios(persona) && <Text span c="dimmed" size="sm"> {textoAnios(persona)}</Text>}
    </>
  );
}

export function EnlaceFamilia({ familia, texto }: { familia: Familia; texto?: string }) {
  const arbol = useArbol();
  return <Anchor component={Link} to={rutaFamilia(familia.handle)}><bdi>{texto ?? arbol.nombreFamilia(familia)}</bdi></Anchor>;
}

/** El título completo de un lugar («Cádiz, España»), enlazado a su ficha
 * (añadidos del mapa, 02/11/2026). */
export function EnlaceLugar({ handle, texto }: { handle: string; texto?: string }) {
  const arbol = useArbol();
  if (!arbol.lugares.has(handle)) return null;
  return <Anchor component={Link} to={rutaLugar(handle)}><bdi>{texto ?? arbol.tituloLugar(handle)}</bdi></Anchor>;
}
