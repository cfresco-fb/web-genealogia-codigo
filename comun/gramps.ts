/**
 * Piezas comunes de la web, las funciones del servidor y los programas de
 * carga: tipos de objeto de Gramps, claves y la conversión de las listas
 * anidadas para Firestore. Sin dependencias (ni de Node ni del navegador).
 */

/** Tipos de objeto de Gramps, en el mismo orden que migracion/arbol.py.
 * Cada tipo es una colección de Firestore; cada objeto, un documento cuyo
 * identificador es su handle. */
export const TIPOS = [
  "Tag", "Note", "Repository", "Source", "Citation",
  "Media", "Place", "Event", "Person", "Family",
] as const;

export type Tipo = (typeof TIPOS)[number];

export type ObjetoGramps = { handle: string; [campo: string]: unknown };

export const esTipo = (t: unknown): t is Tipo => TIPOS.includes(t as Tipo);

/** Handle válido (el mismo patrón que las reglas de Firestore). */
export const HANDLE = /^[A-Za-z0-9_]{1,50}$/;

/** Handle de un objeto nuevo, como los de Gramps (gen/utils/id.py,
 * create_id): el momento en diezmilésimas de segundo y un número al azar,
 * en hexadecimal. */
export function nuevoHandle(): string {
  const azar = new Uint32Array(2);
  globalThis.crypto.getRandomValues(azar);
  const hex = (n: number, d: number) => n.toString(16).padStart(d, "0");
  return hex(Date.now() * 10, 12) + hex(azar[0], 8) + hex(azar[1], 8);
}

/** «Person_H1»: identifica un objeto entre todos los tipos. */
export const clave = (tipo: Tipo, handle: string) => `${tipo}_${handle}`;

export function deClave(c: string): { tipo: Tipo; handle: string } {
  const i = c.indexOf("_");
  const tipo = c.slice(0, i);
  if (i < 0 || !esTipo(tipo)) throw new Error(`Clave no válida: ${c}`);
  return { tipo, handle: c.slice(i + 1) };
}

/** Prefijos de los ID de Gramps por defecto (Gramps de escritorio,
 * preferencias de la base de datos), con cuatro cifras. Las etiquetas no
 * tienen ID. */
export const PREFIJOS_ID: Partial<Record<Tipo, string>> = {
  Person: "I", Family: "F", Event: "E", Place: "P", Source: "S",
  Citation: "C", Media: "O", Repository: "R", Note: "N",
};

export const formatoId = (tipo: Tipo, n: number) => `${PREFIJOS_ID[tipo]}${String(n).padStart(4, "0")}`;

/** El número de un ID con el prefijo del tipo («I0554» → 554), o null si
 * no lo sigue. */
export function numeroId(tipo: Tipo, id: unknown): number | null {
  const prefijo = PREFIJOS_ID[tipo];
  if (!prefijo || typeof id !== "string" || !id.startsWith(prefijo)) return null;
  const resto = id.slice(prefijo.length);
  return /^\d+$/.test(resto) ? Number(resto) : null;
}

/*
 * Firestore no admite listas dentro de listas. En la serialización de
 * Gramps solo aparecen en los rangos de las notas con formato
 * (Note.text.tags[].ranges = [[inicio, fin], …]). Cada lista interior se
 * guarda como un mapa {"_lista": […]} y se deshace al leer. Ningún objeto
 * de Gramps es un mapa con «_lista» como única clave, así que la
 * conversión es reversible.
 */
const LISTA = "_lista";

export function esMapa(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function aFirestore(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map((x) => (Array.isArray(x) ? { [LISTA]: aFirestore(x) } : aFirestore(x)));
  }
  if (esMapa(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aFirestore(x)]));
  }
  return v;
}

export function deFirestore(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (esMapa(x) && Object.keys(x).length === 1 && LISTA in x) return deFirestore(x[LISTA]);
      return deFirestore(x);
    });
  }
  if (esMapa(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deFirestore(x)]));
  }
  return v;
}

/** JSON con las claves de los mapas ordenadas: para comparar objetos sin
 * que importe el orden en que se escribieron sus campos. */
export function jsonCanonico(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (esMapa(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}
