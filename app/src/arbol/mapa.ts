// Mapa de lugares (encargo del 02/11/2026, docs/encargo-mapa-basico.md;
// cómo funciona: docs/mapa.md): qué lugares salen, dónde y con qué
// eventos. Sin Leaflet ni React, para probarlo aparte (mapa.test.ts); el
// dibujo, en app/src/paginas/Mapa.tsx.
//
// - Coordenadas: Gramps las guarda como texto; se leen con la misma
//   tolerancia que Gramps (conv_lat_lon, gramps/gen/utils/place.py,
//   traducido aquí; comparado con Gramps en mapa.test.ts). Lo que no se
//   pueda leer o se salga de rango vale como «sin coordenadas».
// - Un lugar sin coordenadas toma las del primero que las tenga subiendo
//   por la jerarquía (el lugar superior principal, como el título), y queda
//   como aproximado.
// - Solo salen los lugares con eventos propios (los de los lugares que
//   contienen no cuentan).
// - Los lugares con las mismas coordenadas, en un solo punto, con todos sus
//   nombres y todos sus eventos.
// - Añadidos (02/11/2026, docs/encargo-mapa-anadidos.md): grupos de eventos
//   y filtro de años (los eventos que quedan son los que se pasan a
//   datosMapa), recorrido de una persona y personas de una rama.

import type { Arbol } from "./arbol";
import { anio, porFecha, valorOrden } from "./fechas";
import type { Evento, Lugar, Persona, TipoGramps } from "./tipos";

// ---- Coordenadas ----

/** Como float() de Python con el texto ya sin espacios a los lados: signo,
 * decimales y exponente. (Python admite además «inf», «nan» y «1_000»;
 * aquí no, y de todas formas no serían coordenadas.) */
function numero(s: string): number | null {
  const x = s.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(x) ? Number(x) : null;
}

/** Como int() de Python: entero con signo opcional y espacios a los lados. */
function entero(s: string): number | null {
  const x = s.trim();
  return /^[+-]?\d+$/.test(x) ? Number(x) : null;
}

const grados = (signo: string, g: number, m = 0, s = 0) => (signo === "-" ? -1 : 1) * (g + m / 60 + s / 3600);

/** «XX:YY:ZZ» */
function conDosPuntos(texto: string): number | null {
  if (!texto.includes(":")) return null;
  const l = texto.split(":");
  if (l.length < 2 || l.length > 3) return null;
  let primero = l[0].trim();
  if (!primero) return null;
  let signo = "+";
  if (primero[0] === "+" || primero[0] === "-") {
    signo = primero[0];
    primero = primero.slice(1).trim();
    if (!primero || primero[0] === "+" || primero[0] === "-") return null;
  }
  const g = entero(primero);
  if (g === null || g < 0) return null;
  const m = entero(l[1]);
  if (m === null || m < 0 || m >= 60) return null;
  let s = 0;
  if (l.length === 3) {
    const x = numero(l[2]);
    if (x === null || x < 0 || x >= 60) return null;
    s = x;
  }
  return grados(signo, g, m, s);
}

/** «XX° YY' ZZ" N» (también º, # y comillas tipográficas; minutos con
 * decimales y sin segundos). */
function clasica(texto: string, tipo: "lat" | "lon"): number | null {
  if (texto.includes("_")) return null;
  const v = texto
    .replaceAll("°", "_").replaceAll("º", "_").replaceAll("#", "_")
    .replaceAll("''", '"').replaceAll("″", '"').replaceAll("′", "'")
    .replaceAll(" ", "").replaceAll("\\t", "");
  if (!v.includes("_")) return null;
  const l = v.split("_");
  if (l.length !== 2) return null;
  const g = entero(l[0]);
  if (g === null || g < 0) return null;
  const l2 = l[1].split("'");
  let l3 = l2;
  let m = 0;
  if (l2[0].indexOf(".") > 0) {
    // Minutos con decimales: la parte decimal pasa a segundos.
    const l4 = l2[0].split(".");
    l2[0] = l4[0];
    const decimales = numero(`0.${l4[1]}`);
    if (decimales === null || l2.length < 2) return null;
    l2[1] = `${decimales * 60}"${l2[1]}`;
  }
  if (l2.length > 2) return null;
  if (l2.length === 2) {
    l3 = [l2[1]];
    const x = entero(l2[0]);
    if (x === null || x < 0 || x >= 60) return null;
    m = x;
  }
  const partes = l3[0].split('"');
  let ultimo = partes[0];
  let s = 0;
  if (partes.length > 2) return null;
  if (partes.length === 2) {
    ultimo = partes[1];
    const x = numero(partes[0]);
    if (x === null || x < 0 || x >= 60) return null;
    s = x;
  }
  const signos: Record<string, string> = tipo === "lat" ? { N: "+", S: "-" } : { E: "+", W: "-" };
  const signo = signos[ultimo];
  return signo ? grados(signo, g, m, s) : null;
}

/** «XX.YYYY[NSEW]» (la dirección, ya puesta detrás). */
function gedcom(texto: string, tipo: "lat" | "lon"): number | null {
  const [mas, menos] = tipo === "lat" ? ["N", "S"] : ["E", "W"];
  let i = texto.indexOf(mas);
  if (i >= 0) return numero(texto.slice(0, i));
  i = texto.indexOf(menos);
  if (i < 0) return null;
  const x = numero(texto.slice(0, i));
  return x === null ? null : -x;
}

function valor(texto: string, tipo: "lat" | "lon"): number | null {
  return numero(texto) ?? conDosPuntos(texto) ?? clasica(texto, tipo) ?? gedcom(texto, tipo);
}

/** Latitud y longitud de un lugar en grados decimales, o null si no se
 * pueden leer o se salen de rango (latitud de -90 a 90; longitud desde
 * -180 y menor que 180). Como conv_lat_lon de Gramps con la interfaz en
 * castellano: «O» vale por «W» (oeste). */
export function leerCoordenadas(latitud: string, longitud: string): [number, number] | null {
  let lat = latitud;
  let lon = longitud;
  if (!lon.includes("E") && !lon.includes("W")) lon = lon.replaceAll("O", "W");
  lat = lat.trimStart();
  lon = lon.trimStart();
  // La dirección delante («N50.8»), detrás.
  if (lat.length > 1 && /\p{L}/u.test(lat[0])) lat = lat.slice(1) + lat[0];
  if (lon.length > 1 && /\p{L}/u.test(lon[0])) lon = lon.slice(1) + lon[0];
  const a = valor(lat, "lat");
  const b = valor(lon, "lon");
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a > 90 || a < -90 || b >= 180 || b < -180) return null;
  return [a, b];
}

// ---- Tipos de lugar ----

export type ClaseLugar = "pais" | "ciudad" | "cementerio" | "resto";

/** Tipos de Gramps (PlaceType) que se marcan como ciudad: ciudad,
 * localidad, municipio, villa, pueblo y aldea. */
const CIUDADES = new Set([4, 6, 14, 15, 16, 17]);
const PAIS = 1;
/** Cementerio no es un tipo de Gramps: es el tipo propio «@cementerio»
 * (comun/tipos-propios.json). */
const CEMENTERIO = "@cementerio";

export function claseLugar(tipo: TipoGramps): ClaseLugar {
  if (tipo.value === PAIS) return "pais";
  if (CIUDADES.has(tipo.value)) return "ciudad";
  if (tipo.value === 0 && tipo.string === CEMENTERIO) return "cementerio";
  return "resto";
}

// ---- Puntos del mapa ----

export interface LugarEnPunto {
  lugar: Lugar;
  /** El lugar del que toma las coordenadas, si no tiene las suyas. */
  aproximadoDe: Lugar | null;
}

export interface Punto {
  /** Latitud y longitud, para agrupar y para el mapa. */
  clave: string;
  lat: number;
  lon: number;
  /** Los lugares de este punto: primero los que tienen sus coordenadas. */
  lugares: LugarEnPunto[];
  /** Todos los eventos de esos lugares, por fecha. */
  eventos: Evento[];
  clase: ClaseLugar;
  /** Si todos sus lugares están puestos con las coordenadas de otro. */
  aproximado: boolean;
}

export interface DatosMapa {
  puntos: Punto[];
  /** Lugares con eventos que no se pueden poner: ni ellos ni los que los
   * contienen tienen coordenadas (los ve el administrador). */
  sinCoordenadas: Lugar[];
}

/** Para elegir el símbolo de un punto con lugares de varios tipos: el más
 * concreto. */
const PRIORIDAD: ClaseLugar[] = ["cementerio", "ciudad", "resto", "pais"];

/** Seis decimales: unos 10 cm. Lo bastante para que dos lugares guardados
 * con las mismas coordenadas caigan juntos. */
const claveDe = (lat: number, lon: number) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

/** Las coordenadas de un lugar o, si no tiene, las del primero que las
 * tenga subiendo por la jerarquía (el lugar superior principal, como el
 * título); `de`, ese lugar (null si son las suyas). null si no hay. */
export function situarLugar(lugares: Map<string, Lugar>, handle: string): { coordenadas: [number, number]; de: Lugar | null } | null {
  const lugar = lugares.get(handle);
  const vistos = new Set<string>();
  let actual: Lugar | undefined = lugar;
  while (actual && !vistos.has(actual.handle)) {
    vistos.add(actual.handle);
    const c = leerCoordenadas(actual.lat, actual.long);
    if (c) return { coordenadas: c, de: actual === lugar ? null : actual };
    actual = lugares.get(actual.placeref_list[0]?.ref ?? "");
  }
  return null;
}

export function datosMapa(lugares: Map<string, Lugar>, eventos: Iterable<Evento>): DatosMapa {
  const porLugar = new Map<string, Evento[]>();
  for (const e of eventos) {
    if (!e.place || !lugares.has(e.place)) continue;
    const lista = porLugar.get(e.place);
    if (lista) lista.push(e);
    else porLugar.set(e.place, [e]);
  }

  const puntos = new Map<string, { lat: number; lon: number; lugares: LugarEnPunto[]; eventos: Evento[] }>();
  const sinCoordenadas: Lugar[] = [];
  for (const [handle, evs] of porLugar) {
    const lugar = lugares.get(handle)!;
    const sitio = situarLugar(lugares, handle);
    if (!sitio) {
      sinCoordenadas.push(lugar);
      continue;
    }
    const [lat, lon] = sitio.coordenadas;
    const clave = claveDe(lat, lon);
    let p = puntos.get(clave);
    if (!p) puntos.set(clave, (p = { lat, lon, lugares: [], eventos: [] }));
    p.lugares.push({ lugar, aproximadoDe: sitio.de });
    p.eventos.push(...evs);
  }

  const nombre = (l: Lugar) => l.name.value || l.title;
  return {
    puntos: [...puntos].map(([clave, p]) => {
      const lugaresOrdenados = [...p.lugares].sort((a, b) =>
        Number(!!a.aproximadoDe) - Number(!!b.aproximadoDe) || nombre(a.lugar).localeCompare(nombre(b.lugar)));
      const exactos = lugaresOrdenados.filter((x) => !x.aproximadoDe);
      const clases = (exactos.length ? exactos : lugaresOrdenados).map((x) => claseLugar(x.lugar.place_type));
      return {
        clave, lat: p.lat, lon: p.lon,
        lugares: lugaresOrdenados,
        eventos: porFecha(p.eventos, (e) => e.date),
        clase: PRIORIDAD.find((c) => clases.includes(c))!,
        aproximado: !exactos.length,
      };
    }),
    sinCoordenadas: sinCoordenadas.sort((a, b) => nombre(a).localeCompare(nombre(b))),
  };
}

// ---- Filtros (añadido 1) ----

export type GrupoEvento = "nacimientos" | "defunciones" | "bodas" | "otros";
export const GRUPOS_EVENTO: GrupoEvento[] = ["nacimientos", "defunciones", "bodas", "otros"];

/** Grupo de cada tipo de evento de Gramps (EventType). Nacimientos:
 * nacimiento, bautismo, bautizo y bautismo de adulto. Defunciones:
 * defunción, entierro e incineración. Bodas: matrimonio y los relacionados
 * (amonestaciones, licencia, contrato, capitulaciones, compromiso,
 * matrimonio alternativo, divorcio, demanda de divorcio y anulación). Los
 * demás y los tipos propios, otros. */
const GRUPO: Record<number, GrupoEvento> = {
  12: "nacimientos", 14: "nacimientos", 15: "nacimientos", 22: "nacimientos",
  13: "defunciones", 19: "defunciones", 24: "defunciones",
  1: "bodas", 2: "bodas", 3: "bodas", 4: "bodas", 5: "bodas", 6: "bodas", 7: "bodas", 8: "bodas", 9: "bodas", 10: "bodas",
};

export const grupoEvento = (tipo: TipoGramps): GrupoEvento => (tipo.value === 0 ? "otros" : GRUPO[tipo.value] ?? "otros");

export interface FiltroEventos {
  grupos: ReadonlySet<GrupoEvento>;
  /** Años, como en las listas (anio: el de la fecha, también si es
   * aproximada); null, sin límite. */
  desde: number | null;
  hasta: number | null;
}

/** Los eventos con lugar que pasan el filtro y cuántos se quitan solo por no
 * tener fecha (con «desde» o «hasta» puestos; de los grupos marcados). */
export function filtrarEventos(eventos: Iterable<Evento>, f: FiltroEventos): { eventos: Evento[]; sinFecha: number } {
  const conAnios = f.desde !== null || f.hasta !== null;
  const out: Evento[] = [];
  let sinFecha = 0;
  for (const e of eventos) {
    if (!e.place || !f.grupos.has(grupoEvento(e.type))) continue;
    if (conAnios) {
      const a = anio(e.date);
      if (a === null) {
        sinFecha++;
        continue;
      }
      if ((f.desde !== null && a < f.desde) || (f.hasta !== null && a > f.hasta)) continue;
    }
    out.push(e);
  }
  return { eventos: out, sinFecha };
}

// ---- Una persona y su rama (añadido 3) ----

/** Los eventos de unas personas (los propios y los de sus familias), sin
 * repetir. */
export function eventosDePersonas(arbol: Arbol, personas: Iterable<Persona>): Evento[] {
  const vistos = new Map<string, Evento>();
  for (const p of personas) for (const { evento } of arbol.eventosPersonaGuardados(p)) vistos.set(evento.handle, evento);
  return [...vistos.values()];
}

/** El recorrido de una persona: las coordenadas de sus eventos con fecha y
 * lugar, por orden de fecha (los que no tienen fecha, fuera), sin repetir
 * un punto seguido. `eventos`: los suyos que se ven (ya filtrados). */
export function recorrido(lugares: Map<string, Lugar>, eventos: Evento[]): [number, number][] {
  const linea: [number, number][] = [];
  for (const e of porFecha(eventos.filter((x) => valorOrden(x.date) !== null), (x) => x.date)) {
    const sitio = situarLugar(lugares, e.place);
    if (!sitio) continue;
    const ultimo = linea[linea.length - 1];
    if (!ultimo || ultimo[0] !== sitio.coordenadas[0] || ultimo[1] !== sitio.coordenadas[1]) linea.push(sitio.coordenadas);
  }
  return linea;
}

export type TipoRama = "ascendientes" | "descendientes" | "ambos";
export const TIPOS_RAMA: TipoRama[] = ["ascendientes", "descendientes", "ambos"];

/** Las personas de la rama de `persona` con `generaciones` generaciones
 * (contando la suya), por los mismos caminos que el árbol: hacia arriba,
 * los padres de la primera familia; hacia abajo, los hijos de todas sus
 * familias y, como en el árbol, los cónyuges de cada uno (también los de
 * `persona`). Un ciclo en los datos no se recorre dos veces. «Ambos», como
 * en el árbol: los ascendientes y los descendientes, cada uno con
 * `generaciones`. */
export function personasRama(arbol: Arbol, persona: Persona, tipo: TipoRama, generaciones: number): Persona[] {
  if (tipo === "ambos") {
    const juntas = new Map<string, Persona>();
    for (const t of ["ascendientes", "descendientes"] as const) {
      for (const p of personasRama(arbol, persona, t, generaciones)) juntas.set(p.handle, p);
    }
    return [...juntas.values()];
  }
  const dentro = new Map<string, Persona>([[persona.handle, persona]]);
  let actuales = [persona];
  for (let g = 1; g < generaciones && actuales.length; g++) {
    const siguientes: Persona[] = [];
    for (const p of actuales) {
      const nuevas = tipo === "ascendientes"
        ? (() => {
          const f = arbol.familiasPadres(p)[0];
          return f ? [arbol.padre(f), arbol.madre(f)] : [];
        })()
        : arbol.familiasPorBoda(p).flatMap((f) => arbol.hijos(f).map((h) => h.persona));
      for (const n of nuevas) {
        if (n && !dentro.has(n.handle)) {
          dentro.set(n.handle, n);
          siguientes.push(n);
        }
      }
    }
    actuales = siguientes;
  }
  if (tipo === "descendientes") {
    for (const p of [...dentro.values()]) {
      for (const f of arbol.familiasPorBoda(p)) {
        const c = arbol.conyuge(f, p);
        if (c && !dentro.has(c.handle)) dentro.set(c.handle, c);
      }
    }
  }
  return [...dentro.values()];
}
