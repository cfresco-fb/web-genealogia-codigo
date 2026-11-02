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

import { porFecha } from "./fechas";
import type { Evento, Lugar, TipoGramps } from "./tipos";

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

export function datosMapa(lugares: Map<string, Lugar>, eventos: Iterable<Evento>): DatosMapa {
  const porLugar = new Map<string, Evento[]>();
  for (const e of eventos) {
    if (!e.place || !lugares.has(e.place)) continue;
    const lista = porLugar.get(e.place);
    if (lista) lista.push(e);
    else porLugar.set(e.place, [e]);
  }

  const propias = (l: Lugar) => leerCoordenadas(l.lat, l.long);
  /** Las coordenadas del lugar o, si no tiene, las del primero que las
   * tenga subiendo por la jerarquía. */
  function situar(l: Lugar): { coordenadas: [number, number]; de: Lugar | null } | null {
    const vistos = new Set<string>();
    let actual: Lugar | undefined = l;
    while (actual && !vistos.has(actual.handle)) {
      vistos.add(actual.handle);
      const c = propias(actual);
      if (c) return { coordenadas: c, de: actual === l ? null : actual };
      actual = lugares.get(actual.placeref_list[0]?.ref ?? "");
    }
    return null;
  }

  const puntos = new Map<string, { lat: number; lon: number; lugares: LugarEnPunto[]; eventos: Evento[] }>();
  const sinCoordenadas: Lugar[] = [];
  for (const [handle, evs] of porLugar) {
    const lugar = lugares.get(handle)!;
    const sitio = situar(lugar);
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
