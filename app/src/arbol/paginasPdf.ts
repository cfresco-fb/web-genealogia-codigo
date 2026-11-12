// Cómo se reparte un árbol en las páginas del PDF (docs/graficos.md, «PDF»).
// Sin dibujar nada: solo con el tamaño que tendrá cada árbol
// (measureTreeChart) y el papel. Decisiones de Carlos del 22/10/2026:
//
// - Letra mínima en el papel: LETRA_MINIMA_PT para todo el texto.
// - Una sola orientación para todo el documento (con «automática», la que
//   da menos páginas).
// - Páginas de continuación: el árbol se parte en «bloques». El primero es
//   la persona central con las generaciones que quepan; cada persona del
//   borde que tiene más generaciones (dentro de las pedidas) lleva
//   «continúa en la pág. N» y su rama es otro bloque, con el mismo criterio.
//   Si una rama llega por dos caminos, es un solo bloque.
// - Con «Ambos», si la primera página no cabe ni con dos generaciones (las
//   dos mitades y sus marcas «continúa» no caben), se parte en dos:
//   ascendientes en la página 1 y descendientes en la 2.
// - Todo vale igual para las dos disposiciones (vertical u horizontal): el
//   reparto solo mira el tamaño de cada árbol (measureTreeChart).
// - Si ni con dos generaciones cabe un bloque (una familia con muchos
//   hijos), sus hijos se reparten en varios bloques («hijos 1 a 8 de 15»).
// - Los bloques pequeños se agrupan: varios bloques comparten página si
//   caben todos a la letra mínima (también en la primera, desde el
//   27/10/2026).
// - Mosaico: el árbol entero a la escala de la letra mínima, partido en
//   hojas; sin las hojas que quedarían en blanco (decisión del 23/10/2026).
// - Una sola página (decisión del 25/10/2026, «PDF del árbol en una sola
//   página»): solo con A3, A2, A1 y A0, y la elegida por defecto con ellos.
//   El árbol entero en una página, con la letra mínima más baja (4, 5 o 6
//   puntos, LETRAS_UNA_PAGINA_PT, a elegir en el diálogo; respuesta del
//   25/10/2026), para un cuadro con todo el árbol aunque no sea del todo
//   legible; si es pequeño, a su tamaño y en el centro. La persona central,
//   del mismo tamaño que las demás. También en papel de rollo de 91,4 cm de
//   ancho, con el largo que haga falta (respuesta del 25/10/2026). Si no
//   cabe, se propone otro papel, el rollo, la otra disposición o menos
//   generaciones (dondeCabeUnaPagina).
// - Las cajas nunca salen más grandes que en la pantalla (ESCALA_MAXIMA;
//   decisión del 23/10/2026): un árbol pequeño queda en el centro de la
//   página, sin agrandarlo.
// - Primera página con el título grande y el subtítulo debajo; las de
//   continuación, con el título pequeño y «Continuación» (decisión del
//   23/10/2026, «Opciones de los PDF»).
// - Sin subtítulo o sin pie en la primera página (decisión del 02/11/2026,
//   «Pie del PDF del árbol elegible»), su sitio es para el árbol, también
//   al calcular si cabe y cuántas páginas hacen falta (Espacio).

import { PAPER_SIZES, type PaperOrientation, type PaperSize } from "../gramps-connect/chartExport/paperSizes";
import {
  measureTreeChart, treeChartShapes, type ChartShapes, type TreeNode, type TreePerson,
} from "../gramps-connect/graficos/charts/treeChart";
import { t, type Clave } from "../i18n";
import type { Arbol } from "./arbol";
import {
  construirGrafico, GENERACIONES_MIN, numeroDeHijos, type DatosGrafico, type Disposicion, type PresentacionCajas, type TipoGrafico,
  type TramoHijos,
} from "./grafico";
import type { Persona } from "./tipos";

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Papeles del árbol: los de Gramps Connect (decisión del 23/10/2026). */
export type Papel = PaperSize;
export const PAPELES = Object.keys(PAPER_SIZES) as Papel[];
/** Papeles del libro (decisión del 23/10/2026). */
export type PapelLibro = Extract<Papel, "A4" | "Letter" | "A5">;
export const PAPELES_LIBRO: PapelLibro[] = ["A4", "Letter", "A5"];
/** Avisos del papel: con el lado corto de A5 o menos, el árbol ocupa muchas
 * páginas; con el de A2 o más, suele imprimirse en una copistería. */
export function avisoPapel(papel: Papel): "pequeno" | "grande" | null {
  const corto = PAPER_SIZES[papel][0];
  if (corto <= PAPER_SIZES.A5[0]) return "pequeno";
  if (corto >= PAPER_SIZES.A2[0]) return "grande";
  return null;
}
export type ModoPdf = "continuacion" | "mosaico" | "unaPagina";

/** Papeles con «Una sola página», de menor a mayor. A4 y Letter desde el
 * 08/11/2026 (para árboles pequeños que no caben a 8 puntos en una hoja
 * normal), y se comportan como los grandes. Son casi iguales (624 y 603
 * cm²): ninguno es mayor que el otro (GEMELO). */
export const PAPELES_UNA_PAGINA: Papel[] = ["A4", "Letter", "A3", "A2", "A1", "A0"];
/** Papel de rollo (copisterías, trazadores): solo con «Una sola página»; el
 * ancho, el del rollo, y el largo, el que haga falta, hasta el máximo de una
 * página de PDF (200 pulgadas, 5.080 mm). */
export const ROLLO = "rollo";
export const ROLLO_ANCHO_MM = 914;
export const ROLLO_LARGO_MAXIMO_MM = 5000;
/** Los papeles del árbol, con el rollo. */
export type PapelArbol = Papel | typeof ROLLO;
/** Si el papel tiene «Una sola página». */
export const conUnaPagina = (p: PapelArbol): boolean => p === ROLLO || PAPELES_UNA_PAGINA.includes(p);
/** El reparto al cambiar de papel: al pasar a uno con «Una sola página»
 * desde uno sin él, ese por defecto; al pasar a uno sin él, continuación;
 * entre dos que lo tienen (o dos que no), el que había. Sin cambiar de papel,
 * el que había (las opciones recordadas se respetan). */
export function modoAlCambiarPapel(antes: PapelArbol, despues: PapelArbol, modo: ModoPdf): ModoPdf {
  if (despues === antes) return modo;
  if (conUnaPagina(despues) && !conUnaPagina(antes)) return "unaPagina";
  if (!conUnaPagina(despues) && modo === "unaPagina") return "continuacion";
  return modo;
}
/** Las cajas del PDF del árbol (Carlos, 12/11/2026, «Cajas completas y ayuda
 * del PDF»): normales, pequeñas o completas. */
export type CajasPdf = "normales" | "pequenas" | "completas";
export const CAJAS_PDF: CajasPdf[] = ["normales", "pequenas", "completas"];
/** Con qué cajas abre el diálogo: Completas si la pantalla está así; si no,
 * las recordadas en el navegador, Normales o Pequeñas (Completas no se
 * recuerda nunca). */
export const cajasAlAbrir = (completasEnPantalla: boolean, pequenasRecordadas: boolean): CajasPdf =>
  completasEnPantalla ? "completas" : pequenasRecordadas ? "pequenas" : "normales";

/** A4 y Letter, casi iguales: desde uno no se propone el otro como papel en
 * el que cabe (el siguiente es A3). */
const GEMELO: Partial<Record<PapelArbol, PapelArbol>> = { A4: "Letter", Letter: "A4" };
/** Una hoja ya orientada, en mm. */
export interface TamanoHoja {
  ancho: number;
  alto: number;
}
/** Letras mínimas que se pueden elegir en «Una sola página» (respuesta del
 * 25/10/2026: opción en el diálogo). */
export const LETRAS_UNA_PAGINA_PT = [4, 5, 6] as const;
/** La elegida por defecto (respuesta del 25/10/2026). */
export const LETRA_MINIMA_UNA_PAGINA_PT = 6;
export type Orientacion = Exclude<PaperOrientation, "auto">;

/** Letra mínima en el papel, en puntos, para todo el texto. */
export const LETRA_MINIMA_PT = 8;
export const MARGEN_MM = 10;
/** Alto del pie de página («Pág. N de M»). */
export const PIE_MM = 8;
/** Alto de la cabecera: en la primera página, el título grande y el
 * subtítulo; en las de continuación, una línea con el título pequeño; en
 * el mosaico, el título y qué hoja es. */
export const CABECERA_PRIMERA_MM = 20;
/** La de la primera página sin subtítulo: solo el título grande. */
export const CABECERA_PRIMERA_SIN_SUBTITULO_MM = 13;
export const CABECERA_CONTINUACION_MM = 8;
export const CABECERA_MOSAICO_MM = 14;
/** Alto del encabezado de cada bloque en las páginas de continuación
 * («Ascendientes de X · viene de la pág. M»), y hueco entre bloques. */
export const CABECERA_BLOQUE_MM = 7;
const HUECO_BLOQUES_MM = 4;
/** Margen que añade la exportación alrededor del árbol, en unidades del SVG
 * (WHOLE_CHART_MARGIN de chartExport/prepareSvg.ts). */
const MARGEN_GRAFICO = 16;
/** La letra más pequeña del gráfico, en unidades del SVG (cajas de
 * familia y «continúa en la pág. N»); los nombres van a 13. */
const LETRA_GRAFICO = 12;
const PT_POR_MM = 72 / 25.4;

/** Escala (mm por unidad del SVG) a la que la letra más pequeña queda en
 * la letra mínima. */
export const ESCALA_MINIMA = LETRA_MINIMA_PT / (LETRA_GRAFICO * PT_POR_MM);
/** Escala de la pantalla (una unidad del SVG, un píxel de 1/96 de
 * pulgada): las cajas no se agrandan por encima de ella. */
export const ESCALA_MAXIMA = 25.4 / 96;

type Tamano = { width: number; height: number };

/** Qué textos lleva la página, para reservarles sitio: sin subtítulo, la
 * cabecera de la primera página es solo la del título; sin pie, el árbol
 * llega hasta el margen de abajo (decisión del 02/11/2026). */
export interface Espacio {
  subtitulo: boolean;
  pie: boolean;
}
/** Con todo: como antes del 02/11/2026 (el libro, y las páginas de
 * continuación, que siempre llevan «Pág. N de M»). */
export const ESPACIO_COMPLETO: Espacio = { subtitulo: true, pie: true };

/** Tamaño de la hoja en mm. */
export function hoja(papel: Papel, orientacion: Orientacion): { ancho: number; alto: number } {
  const [corto, largo] = PAPER_SIZES[papel];
  return orientacion === "landscape" ? { ancho: largo, alto: corto } : { ancho: corto, alto: largo };
}

export interface Posicion {
  /** Zona del árbol en la página, en mm (con su margen interior). */
  x: number;
  y: number;
  ancho: number;
  alto: number;
  /** Altura (mm) de la línea de encabezado del bloque, o null si no lleva. */
  cabeceraY: number | null;
}

export interface Composicion {
  /** mm por unidad del SVG, igual para todos los bloques de la página. */
  escala: number;
  /** Tamaño en puntos de la letra más pequeña. */
  pt: number;
  posiciones: Posicion[];
}

/** La hoja de un plan: la del papel o, en el rollo, la que lleva el plan. */
export function hojaDe(plan: Plan, papel: PapelArbol): TamanoHoja {
  if (plan.hoja) return plan.hoja;
  if (papel === ROLLO) throw new Error("Plan de rollo sin hoja");
  return hoja(papel, plan.orientacion);
}

/** Alto que ocupan en la página la cabecera y el pie. */
function altoTextos(cabeceras: boolean, espacio: Espacio): { cabecera: number; pie: number } {
  return {
    cabecera: cabeceras ? CABECERA_CONTINUACION_MM : espacio.subtitulo ? CABECERA_PRIMERA_MM : CABECERA_PRIMERA_SIN_SUBTITULO_MM,
    pie: espacio.pie ? PIE_MM : 0,
  };
}

/** Coloca uno o varios árboles, uno debajo de otro, en una página con
 * título arriba y número de página abajo; con `cabeceras` (páginas de
 * continuación), cada uno con su línea de encabezado. Todos a la misma
 * escala, la mayor que quepa sin pasar de la de la pantalla. `papel`: un
 * papel o una hoja ya medida (el rollo). `espacio`: si la página lleva
 * subtítulo (solo cuenta en la primera) y pie. */
export function componer(
  tamanos: Tamano[], cabeceras: boolean, papel: Papel | TamanoHoja, orientacion: Orientacion, espacio: Espacio = ESPACIO_COMPLETO,
): Composicion {
  const { ancho, alto } = typeof papel === "string" ? hoja(papel, orientacion) : papel;
  const { cabecera, pie } = altoTextos(cabeceras, espacio);
  const utilAncho = ancho - 2 * MARGEN_MM;
  const utilAlto = alto - 2 * MARGEN_MM - cabecera - pie;
  const areas = tamanos.map((t) => ({ w: t.width + 2 * MARGEN_GRAFICO, h: t.height + 2 * MARGEN_GRAFICO }));
  // Cada bloque con su encabezado, salvo el primero de la primera página
  // (lo dice el título de la página).
  const conCabecera = (i: number) => cabeceras || i > 0;
  const fijo = tamanos.filter((_, i) => conCabecera(i)).length * CABECERA_BLOQUE_MM + (tamanos.length - 1) * HUECO_BLOQUES_MM;
  const escala = Math.max(0, Math.min(
    ESCALA_MAXIMA,
    utilAncho / Math.max(...areas.map((a) => a.w)),
    (utilAlto - fijo) / areas.reduce((s, a) => s + a.h, 0),
  ));
  const total = areas.reduce((s, a) => s + a.h * escala, 0) + fijo;
  let y = MARGEN_MM + cabecera + (utilAlto - total) / 2;
  const posiciones = areas.map((a, i) => {
    const cabeceraY = conCabecera(i) ? y + CABECERA_BLOQUE_MM / 2 : null;
    if (conCabecera(i)) y += CABECERA_BLOQUE_MM;
    const p = { x: (ancho - a.w * escala) / 2, y, ancho: a.w * escala, alto: a.h * escala, cabeceraY };
    y += a.h * escala + HUECO_BLOQUES_MM;
    return p;
  });
  return { escala, pt: LETRA_GRAFICO * escala * PT_POR_MM, posiciones };
}

/** Un trozo del árbol: una persona con sus generaciones, en un sentido. */
export interface Bloque {
  id: number;
  persona: Persona;
  tipo: TipoGrafico;
  /** Generaciones del bloque, contando la de su persona central. */
  generaciones: number;
  /** Árboles del bloque, con «continúa en la pág. N» ya puesto. */
  datos: DatosGrafico;
  tamano: Tamano;
  /** Página de la que viene (null en el primero). */
  vieneDe: number | null;
  /** Si sus hijos se reparten en varios bloques: cuáles van en este (del 1
   * al total) y en qué página siguen los demás. */
  hijos?: { desde: number; hasta: number; total: number; siguenEn: number | null };
  /** Los descendientes de la persona central, cuando «Ambos» no cabe en la
   * primera página: van solos en la página siguiente. */
  mitad?: boolean;
}

export interface PaginaPlan {
  numero: number;
  bloques: Bloque[];
  composicion: Composicion;
}

export interface Plan {
  orientacion: Orientacion;
  /** En el rollo, la hoja con su largo (con los papeles, no hace falta). */
  hoja?: TamanoHoja;
  paginas: PaginaPlan[];
  /** Si «Ambos» se ha partido en dos, la página de los descendientes. */
  descendientesEn: number | null;
}

type Direccion = "ascendientes" | "descendientes";

/** Cajas del borde con más generaciones, de arriba abajo, con su sentido. */
function borde(datos: DatosGrafico): { caja: TreePerson; direccion: Direccion }[] {
  const out: { caja: TreePerson; direccion: Direccion }[] = [];
  const recorrer = (n: TreeNode, direccion: Direccion) => {
    if (n.person && n.hasMore) out.push({ caja: n.person, direccion });
    for (const h of n.children ?? []) recorrer(h, direccion);
  };
  if (datos.ascendientes) recorrer(datos.ascendientes, "ascendientes");
  if (datos.descendientes) recorrer(datos.descendientes, "descendientes");
  return out;
}

const tamanoDe = (d: DatosGrafico, disposicion: Disposicion) =>
  measureTreeChart(d.ascendientes, d.descendientes, disposicion, d.sencillas, d.completas);

interface Opciones {
  arbol: Arbol;
  persona: Persona;
  tipo: TipoGrafico;
  generaciones: number;
  /** Símbolos, formato de las fechas (en los PDF, abreviado) e IDs. */
  simbolos: PresentacionCajas;
  papel: Papel;
  orientacion: PaperOrientation;
  /** Vertical u horizontal (la del dibujo). */
  disposicion: Disposicion;
  continua: (n: number) => string;
  /** Personas vivas cuyos datos se omiten (libro en PDF). */
  privadas?: ReadonlySet<string>;
  /** Si la primera página lleva subtítulo y pie (los escritos en el
   * diálogo); por defecto, los dos (el libro). Aunque no los lleve, se les
   * reserva sitio si hace falta: al subtítulo, si dice dónde siguen los
   * descendientes o qué hijos van; al pie, si hay más de una página («Pág.
   * 1 de N»). */
  espacio?: Espacio;
}

/** Bloque interno, antes de saber en qué página va. */
interface BloqueSinPagina {
  id: number;
  persona: Persona;
  tipo: TipoGrafico;
  generaciones: number;
  datos: DatosGrafico;
  tamano: Tamano;
  /** Bloque del que viene. */
  origen: number | null;
  /** Orden en el documento: el del pendiente y, en los tramos de hijos, el
   * de cada tramo, para que vayan seguidos. */
  orden: [number, number];
  tramo?: TramoHijos & { total: number; siguiente: number | null };
  /** Cajas del borde y el bloque en que sigue cada una. */
  enlaces: { caja: TreePerson; destino: number }[];
  mitad?: boolean;
}

function bloques(o: Opciones, orientacion: Orientacion, espacio: Espacio): BloqueSinPagina[] {
  const { arbol, generaciones, simbolos, papel } = o;
  const lista: BloqueSinPagina[] = [];
  const porRama = new Map<string, number>();
  const pendientes: { id: number; persona: Persona; tipo: TipoGrafico; nivel: number; origen: number | null; mitad?: boolean }[] = [
    { id: 0, persona: o.persona, tipo: o.tipo, nivel: 0, origen: null },
  ];
  let siguiente = 1;
  const cabe = (d: DatosGrafico, primero: boolean) =>
    componer([tamanoDe(d, o.disposicion)], !primero, papel, orientacion, primero ? espacio : ESPACIO_COMPLETO).pt >= LETRA_MINIMA_PT;
  /** Marca el borde (si quedan generaciones) para contar su ancho. */
  // Las parejas de la persona central, solo en su bloque (no en los de
  // continuación de otras personas).
  const construir = (persona: Persona, tipo: TipoGrafico, g: number, restantes: number, tramo?: TramoHijos) => {
    const datos = construirGrafico(arbol, persona, tipo, g, simbolos, tramo, o.privadas, persona === o.persona);
    if (g < restantes) for (const { caja } of borde(datos)) caja.continuation = o.continua(0);
    return datos;
  };

  while (pendientes.length) {
    const pendiente = pendientes.shift()!;
    const { id, persona, nivel, origen, mitad } = pendiente;
    let tipo = pendiente.tipo;
    const restantes = generaciones - nivel;
    const primero = id === 0;
    // Las más generaciones que quepan a la letra mínima.
    const mejorG = () => {
      let g = restantes;
      let datos = construir(persona, tipo, g, restantes);
      while (g > GENERACIONES_MIN && !cabe(datos, primero)) {
        g--;
        datos = construir(persona, tipo, g, restantes);
      }
      return { g, datos };
    };
    let { g, datos } = mejorG();
    // «Ambos» que no cabe ni con dos generaciones: la primera página, solo
    // con los ascendientes; los descendientes, en la siguiente.
    if (primero && tipo === "ambos" && !cabe(datos, primero)) {
      tipo = "ascendientes";
      ({ g, datos } = mejorG());
      const idMitad = siguiente++;
      pendientes.push({ id: idMitad, persona, tipo: "descendientes", nivel: 0, origen: null, mitad: true });
    }
    // Ni con dos generaciones: los hijos de la persona central, en tramos
    // que quepan (si tiene más de uno). Solo si el problema es el alto: si
    // ni un tramo de un solo hijo cabe (no cabe a lo ancho), no se parte.
    const total = tipo !== "ascendientes" ? numeroDeHijos(arbol, persona) : 0;
    const trozos: { datos: DatosGrafico; tipo: TipoGrafico; tramo?: TramoHijos }[] = [];
    if (!cabe(datos, primero) && total > 1 && cabe(construir(persona, tipo, g, restantes, { desde: 0, hasta: 1 }), primero)) {
      // Cada tramo, con los hijos que quepan, hasta `tope(desde, i)`.
      const repartir = (tope: (desde: number, i: number) => number) => {
        const out: typeof trozos = [];
        let desde = 0;
        while (desde < total) {
          const tipoTrozo: TipoGrafico = desde === 0 ? tipo : "descendientes";
          const max = Math.min(total, desde + tope(desde, out.length));
          let hasta = desde + 1;
          let mejor = construir(persona, tipoTrozo, g, restantes, { desde, hasta });
          while (hasta < max) {
            const prueba = construir(persona, tipoTrozo, g, restantes, { desde, hasta: hasta + 1 });
            if (!cabe(prueba, primero && desde === 0)) break;
            hasta++;
            mejor = prueba;
          }
          out.push({ datos: mejor, tipo: tipoTrozo, tramo: { desde, hasta } });
          desde = hasta;
        }
        return out;
      };
      // Con tantos tramos como hagan falta, los hijos repartidos por igual
      // (4 hijos en dos tramos: 2 y 2, no 3 y 1).
      const k = repartir(() => total).length;
      trozos.push(...repartir((desde, i) => (i < k ? Math.ceil((total - desde) / (k - i)) : total)));
    } else {
      trozos.push({ datos, tipo });
    }
    // Los trozos, seguidos; el primero conserva el id del pendiente.
    const ids = trozos.map((_, i) => (i === 0 ? id : siguiente++));
    trozos.forEach((t, i) => {
      const enlaces: BloqueSinPagina["enlaces"] = [];
      if (g < restantes) {
        for (const { caja, direccion } of borde(t.datos)) {
          const clave = `${direccion}:${caja.handle}`;
          let destino = porRama.get(clave);
          if (destino === undefined) {
            destino = siguiente++;
            porRama.set(clave, destino);
            pendientes.push({ id: destino, persona: arbol.persona(caja.handle)!, tipo: direccion, nivel: nivel + g - 1, origen: ids[i] });
          }
          enlaces.push({ caja, destino });
        }
      }
      lista.push({
        id: ids[i], persona, tipo: t.tipo, generaciones: g, datos: t.datos, tamano: tamanoDe(t.datos, o.disposicion),
        origen: i === 0 ? origen : ids[i - 1],
        orden: [id, i],
        tramo: t.tramo && { ...t.tramo, total, siguiente: i + 1 < ids.length ? ids[i + 1] : null },
        enlaces,
        mitad: i === 0 && mitad,
      });
    });
  }
  // Por orden de creación; los tramos de una familia, seguidos.
  return lista.sort((a, b) => a.orden[0] - b.orden[0] || a.orden[1] - b.orden[1]);
}

/** Agrupa los bloques en páginas, por orden, varios en una página mientras
 * quepan todos a la letra mínima. El primero y, si «Ambos» se ha partido,
 * los descendientes empiezan página; desde el 27/10/2026, los bloques que
 * siguen también caben en esas páginas (antes iban solos, y sobraba papel). */
function paginar(lista: BloqueSinPagina[], papel: Papel, orientacion: Orientacion, espacio: Espacio): BloqueSinPagina[][] {
  const paginas: BloqueSinPagina[][] = [];
  for (const b of lista) {
    const actual = paginas.at(-1);
    if (b.id === 0 || b.mitad || !actual) {
      paginas.push([b]);
      continue;
    }
    const juntos = [...actual, b];
    const otra = paginas.length > 1;
    if (componer(juntos.map((x) => x.tamano), otra, papel, orientacion, otra ? ESPACIO_COMPLETO : espacio).pt >= LETRA_MINIMA_PT) actual.push(b);
    else paginas.push([b]);
  }
  return paginas;
}

/** El plan con el sitio de `o.espacio` y, si la primera página necesita
 * más (ver Opciones.espacio), otra vez con ese sitio. */
function planEn(o: Opciones, orientacion: Orientacion): Plan {
  const pedido = o.espacio ?? ESPACIO_COMPLETO;
  const plan = planCon(o, orientacion, pedido);
  const necesario: Espacio = {
    subtitulo: pedido.subtitulo || plan.descendientesEn !== null || !!plan.paginas[0].bloques[0].hijos,
    pie: pedido.pie || plan.paginas.length > 1,
  };
  if (necesario.subtitulo === pedido.subtitulo && necesario.pie === pedido.pie) return plan;
  return planCon(o, orientacion, necesario);
}

function planCon(o: Opciones, orientacion: Orientacion, espacio: Espacio): Plan {
  const lista = bloques(o, orientacion, espacio);
  const grupos = paginar(lista, o.papel, orientacion, espacio);
  const paginaDe = new Map<number, number>();
  grupos.forEach((g, i) => g.forEach((b) => paginaDe.set(b.id, i + 1)));
  // Con los números de página, los textos «continúa en la pág. N».
  // Si sigue en la misma página, «continúa en esta página».
  for (const b of lista) {
    for (const { caja, destino } of b.enlaces) {
      const pagina = paginaDe.get(destino)!;
      caja.continuation = pagina === paginaDe.get(b.id) ? t("pdf.continuaAqui") : o.continua(pagina);
    }
  }
  const paginas = grupos.map((g, i): PaginaPlan => ({
    numero: i + 1,
    bloques: g.map((b): Bloque => ({
      id: b.id, persona: b.persona, tipo: b.tipo, generaciones: b.generaciones, datos: b.datos, tamano: b.tamano,
      vieneDe: b.origen === null ? null : paginaDe.get(b.origen)!,
      hijos: b.tramo && {
        desde: b.tramo.desde + 1, hasta: b.tramo.hasta, total: b.tramo.total,
        siguenEn: b.tramo.siguiente === null ? null : paginaDe.get(b.tramo.siguiente)!,
      },
      mitad: b.mitad || undefined,
    })),
    composicion: componer(g.map((b) => b.tamano), i > 0, o.papel, orientacion, i > 0 ? ESPACIO_COMPLETO : espacio),
  }));
  const mitad = lista.find((b) => b.mitad);
  return { orientacion, paginas, descendientesEn: mitad ? paginaDe.get(mitad.id)! : null };
}

/** Las páginas de un árbol de `generaciones` generaciones (contando la de
 * `persona`). `continua(n)` es el texto «continúa en la pág. n». Con
 * orientación automática: primero, la que deja todas las páginas a la letra
 * mínima o más; después, la que da menos páginas; y si empatan, la de letra
 * más grande. */
export function planificarPaginas(o: Opciones): Plan {
  if (o.orientacion !== "auto") return planEn(o, o.orientacion);
  const v = planEn(o, "portrait");
  const h = planEn(o, "landscape");
  const legible = (p: Plan) => letraMinima(p)!.pt >= LETRA_MINIMA_PT;
  if (legible(h) !== legible(v)) return legible(h) ? h : v;
  if (h.paginas.length !== v.paginas.length) return h.paginas.length < v.paginas.length ? h : v;
  // Con las mismas páginas, la que parte menos el árbol (los bloques pueden
  // compartir página, también la primera).
  const bloques = (p: Plan) => p.paginas.reduce((n, x) => n + x.bloques.length, 0);
  if (bloques(h) !== bloques(v)) return bloques(h) < bloques(v) ? h : v;
  return letraMinima(h)!.pt > letraMinima(v)!.pt ? h : v;
}

export interface Hoja {
  /** Desde 0. */
  fila: number;
  columna: number;
}

export interface PlanMosaico {
  filas: number;
  columnas: number;
  /** Las hojas que llevan algo dibujado, por filas (las demás no se
   * imprimen). */
  hojas: Hoja[];
  orientacion: Orientacion;
  /** Tamaño de la hoja y del hueco útil de cada hoja, en mm. */
  pageWidth: number;
  pageHeight: number;
  utilAncho: number;
  utilAlto: number;
}

/** El árbol entero sin dibujarlo: su tamaño, su esquina y lo que lleva
 * dibujado (unidades del SVG). */
export interface GeometriaArbol {
  tamano: Tamano & { x0: number; y0: number };
  formas: ChartShapes;
}

export function geometria(datos: DatosGrafico, disposicion: Disposicion): GeometriaArbol {
  return {
    tamano: measureTreeChart(datos.ascendientes, datos.descendientes, disposicion, datos.sencillas, datos.completas),
    formas: treeChartShapes(datos.ascendientes, datos.descendientes, disposicion, true, datos.sencillas, datos.completas),
  };
}

/** Las hojas de un mosaico de `filas` × `columnas` que llevan alguna caja
 * o algún trozo de línea. `origen`: el punto del árbol (unidades del SVG)
 * que va en la esquina de arriba a la izquierda de la primera hoja. */
export function hojasConContenido(
  formas: ChartShapes, origen: { x: number; y: number }, filas: number, columnas: number, utilAncho: number, utilAlto: number,
): Hoja[] {
  const w = utilAncho / ESCALA_MINIMA;
  const h = utilAlto / ESCALA_MINIMA;
  const out: Hoja[] = [];
  for (let fila = 0; fila < filas; fila++) {
    for (let columna = 0; columna < columnas; columna++) {
      const x0 = origen.x + columna * w;
      const y0 = origen.y + fila * h;
      const x1 = x0 + w;
      const y1 = y0 + h;
      const algo = formas.rects.some((r) => r.x0 < x1 && r.x1 > x0 && r.y0 < y1 && r.y1 > y0)
        || formas.points.some(([x, y]) => x >= x0 && x < x1 && y >= y0 && y < y1);
      if (algo) out.push({ fila, columna });
    }
  }
  return out;
}

/** Hojas para el árbol entero a la escala de la letra mínima. Con
 * orientación automática, la que necesita menos hojas. */
export function planificarMosaico(g: GeometriaArbol, papel: Papel, orientacion: PaperOrientation): PlanMosaico {
  const ancho = (g.tamano.width + 2 * MARGEN_GRAFICO) * ESCALA_MINIMA;
  const alto = (g.tamano.height + 2 * MARGEN_GRAFICO) * ESCALA_MINIMA;
  const origen = { x: g.tamano.x0 - MARGEN_GRAFICO, y: g.tamano.y0 - MARGEN_GRAFICO };
  const plan = (o: Orientacion): PlanMosaico => {
    const { ancho: pageWidth, alto: pageHeight } = hoja(papel, o);
    const utilAncho = pageWidth - 2 * MARGEN_MM;
    const utilAlto = pageHeight - 2 * MARGEN_MM - CABECERA_MOSAICO_MM;
    const filas = Math.max(1, Math.ceil(alto / utilAlto - 1e-9));
    const columnas = Math.max(1, Math.ceil(ancho / utilAncho - 1e-9));
    return {
      filas, columnas, hojas: hojasConContenido(g.formas, origen, filas, columnas, utilAncho, utilAlto),
      orientacion: o, pageWidth, pageHeight, utilAncho, utilAlto,
    };
  };
  if (orientacion !== "auto") return plan(orientacion);
  const v = plan("portrait");
  const h = plan("landscape");
  return h.hojas.length < v.hojas.length ? h : v;
}

/** El árbol entero en una página: con orientación automática, la que deja
 * la letra más grande. `cabe`: si llega a `minimo` puntos. `espacio`: si
 * lleva subtítulo y pie (en una sola página no hay «Pág. N de M»). */
export function planificarUnaPagina(
  datos: DatosGrafico, persona: Persona, tipo: TipoGrafico, generaciones: number, disposicion: Disposicion, papel: PapelArbol,
  orientacion: PaperOrientation, minimo = LETRA_MINIMA_UNA_PAGINA_PT, espacio: Espacio = ESPACIO_COMPLETO,
): { plan: Plan; cabe: boolean } {
  const tamano = tamanoDe(datos, disposicion);
  const en = (o: Orientacion): Plan => {
    const h = papel === ROLLO ? hojaRollo(tamano, o, espacio) : undefined;
    return {
      orientacion: h ? (h.ancho > h.alto ? "landscape" : "portrait") : o,
      hoja: h,
      descendientesEn: null,
      paginas: [{
        numero: 1,
        bloques: [{ id: 0, persona, tipo, generaciones, datos, tamano, vieneDe: null }],
        composicion: componer([tamano], false, h ?? (papel as Papel), o, espacio),
      }],
    };
  };
  const pt = (p: Plan) => p.paginas[0].composicion.pt;
  const plan = orientacion !== "auto" ? en(orientacion) : [en("portrait"), en("landscape")].sort((a, b) => pt(b) - pt(a))[0];
  return { plan, cabe: pt(plan) >= minimo - 1e-9 };
}

/** Hoja de rollo para un árbol: en vertical, el ancho del rollo a lo ancho
 * del árbol; en horizontal, a lo alto. El largo, el que necesite el árbol a
 * la mayor escala que quepa (sin pasar de la de la pantalla ni del largo
 * máximo). */
function hojaRollo(tamano: Tamano, o: Orientacion, espacio: Espacio): TamanoHoja {
  const aw = tamano.width + 2 * MARGEN_GRAFICO;
  const ah = tamano.height + 2 * MARGEN_GRAFICO;
  const fijoAncho = 2 * MARGEN_MM;
  const { cabecera, pie } = altoTextos(false, espacio);
  const fijoAlto = 2 * MARGEN_MM + cabecera + pie;
  if (o === "portrait") {
    const e = Math.min(ESCALA_MAXIMA, (ROLLO_ANCHO_MM - fijoAncho) / aw, (ROLLO_LARGO_MAXIMO_MM - fijoAlto) / ah);
    return { ancho: ROLLO_ANCHO_MM, alto: ah * e + fijoAlto };
  }
  const e = Math.min(ESCALA_MAXIMA, (ROLLO_ANCHO_MM - fijoAlto) / ah, (ROLLO_LARGO_MAXIMO_MM - fijoAncho) / aw);
  return { ancho: aw * e + fijoAncho, alto: ROLLO_ANCHO_MM };
}

/** Papeles de «Una sola página» de menor a mayor, con el rollo al final. */
export const PAPELES_UNA_PAGINA_Y_ROLLO: PapelArbol[] = [...PAPELES_UNA_PAGINA, ROLLO];

export interface DondeCabe {
  /** El papel más pequeño (de A4 al rollo) en el que cabe; nunca el gemelo
   * del elegido (GEMELO). */
  papel: PapelArbol | null;
  /** Si no cabe ni en el rollo, cuántas generaciones caben en él (null si
   * ni con las mínimas). */
  generaciones: number | null;
}

/** Para «Una sola página»: dónde cabe el árbol (ver DondeCabe). */
export function dondeCabeUnaPagina(
  o: {
    arbol: Arbol; persona: Persona; tipo: TipoGrafico; generaciones: number; simbolos: PresentacionCajas; disposicion: Disposicion;
    orientacion: PaperOrientation; espacio?: Espacio;
    /** El papel elegido en el diálogo. */
    papel?: PapelArbol;
  },
  datos: DatosGrafico, minimo = LETRA_MINIMA_UNA_PAGINA_PT,
): DondeCabe {
  const gemelo = o.papel ? GEMELO[o.papel] : undefined;
  const papel = PAPELES_UNA_PAGINA_Y_ROLLO.find((p) => p !== gemelo &&
    planificarUnaPagina(datos, o.persona, o.tipo, o.generaciones, o.disposicion, p, o.orientacion, minimo, o.espacio).cabe) ?? null;
  if (papel) return { papel, generaciones: o.generaciones };
  for (let g = o.generaciones - 1; g >= GENERACIONES_MIN; g--) {
    const d = construirGrafico(o.arbol, o.persona, o.tipo, g, o.simbolos);
    if (planificarUnaPagina(d, o.persona, o.tipo, g, o.disposicion, ROLLO, o.orientacion, minimo, o.espacio).cabe) return { papel: null, generaciones: g };
  }
  return { papel: null, generaciones: null };
}

/** Cuánto mejor es un resultado de dondeCabeUnaPagina: un papel más pequeño
 * o, si no cabe en ninguno, más generaciones (menos es mejor). */
export function rangoDonde(d: DondeCabe): number {
  if (d.papel) return PAPELES_UNA_PAGINA_Y_ROLLO.indexOf(d.papel);
  return d.generaciones ? 100 - d.generaciones : 1000;
}

/** La letra más pequeña de todas las páginas (por si alguna no llega a la
 * mínima: un solo hijo que no cabe, o un árbol muy ancho). */
export function letraMinima(plan: Plan): { pt: number; pagina: PaginaPlan } | null {
  let peor: { pt: number; pagina: PaginaPlan } | null = null;
  for (const p of plan.paginas) if (!peor || p.composicion.pt < peor.pt) peor = { pt: p.composicion.pt, pagina: p };
  return peor;
}

/** Textos de cada página del plan: el título del árbol en todas; en la
 * primera, `subtitulo` (y, si «Ambos» se ha partido, dónde siguen los
 * descendientes); en las demás, «Continuación» y un encabezado por bloque
 * («Ascendientes de X · viene de la pág. M»). Las páginas se cuentan desde
 * `desplazamiento` + 1 (en el libro, el árbol no empieza en la página 1).
 * Con `pie`, «Pág. N de M» (en el libro, el pie lo pone el libro). Con
 * `titulo`, ese en lugar del de por defecto («Ascendientes de X»). Con
 * `piePrimera`, ese texto al pie de la primera página («4 generaciones ·
 * datos del…»; decisión del 23/10/2026). */
export function textosPlan(
  arbol: Arbol, plan: Plan, persona: Persona, tipo: TipoGrafico, subtitulo: string, desplazamiento = 0, pie = true, titulo?: string,
  piePrimera = "",
): { titulo: string; subtitulo: string; pie: string; bloques: string[] }[] {
  const tituloDe = (b: { tipo: TipoGrafico; persona: Persona }) => t(`grafico.titulo.${b.tipo}` as Clave, { nombre: arbol.nombre(b.persona) });
  const pag = (n: number) => n + desplazamiento;
  // Sin referencias a la misma página (decisión del 27/10/2026): el tramo
  // siguiente de los hijos, si va en la misma, no se anuncia.
  const hijosDe = (b: Bloque, pagina: number) => (b.hijos
    ? [
      b.hijos.desde === b.hijos.hasta
        ? t("pdf.hijo", { n: b.hijos.desde, total: b.hijos.total })
        : t("pdf.hijos", { desde: b.hijos.desde, hasta: b.hijos.hasta, total: b.hijos.total }),
      b.hijos.siguenEn === null || b.hijos.siguenEn === pagina ? "" : t("pdf.siguenHijos", { pagina: pag(b.hijos.siguenEn) }),
    ]
    : []);
  /** El tramo de hijos que sigue al de antes en la misma página: sin
   * repetir el título, solo qué hijos son. */
  const sigueTramo = (bloques: Bloque[], j: number) =>
    j > 0 && !!bloques[j].hijos && bloques[j].hijos!.desde > 1 && bloques[j - 1].persona === bloques[j].persona;
  return plan.paginas.map((p) => ({
    titulo: titulo ?? tituloDe({ tipo, persona }),
    subtitulo: p.numero === 1
      ? [
        subtitulo,
        plan.descendientesEn === null ? "" : t("pdf.descendientesEn", { pagina: pag(plan.descendientesEn) }),
        ...hijosDe(p.bloques[0], p.numero),
      ].filter(Boolean).join(" · ")
      : t("pdf.continuacion"),
    pie: [
      p.numero === 1 ? piePrimera : "",
      pie && plan.paginas.length > 1 ? t("pdf.pie", { n: p.numero, total: plan.paginas.length }) : "",
    ].filter(Boolean).join(" · "),
    bloques: p.bloques.map((b, j) => {
      if (sigueTramo(p.bloques, j)) return mayuscula(hijosDe(b, p.numero).filter(Boolean).join(" · "));
      return p.numero === 1 && j === 0 ? "" : [
        tituloDe(b),
        b.vieneDe === null || b.vieneDe === p.numero ? "" : t("pdf.vieneDe", { pagina: pag(b.vieneDe) }),
        ...hijosDe(b, p.numero),
      ].filter(Boolean).join(" · ");
    }),
  }));
}

/** Primera página del plan en la que sale cada persona (para «ver árbol,
 * pág. N» en el libro). */
export function paginaDePersonas(plan: Plan): Map<string, number> {
  const out = new Map<string, number>();
  const recorrer = (n: TreeNode | null, pagina: number) => {
    if (!n) return;
    if (n.person && !out.has(n.person.handle)) out.set(n.person.handle, pagina);
    const conyuge = n.family?.spouse;
    if (conyuge && !out.has(conyuge.handle)) out.set(conyuge.handle, pagina);
    for (const h of n.children ?? []) recorrer(h, pagina);
  };
  for (const p of plan.paginas) for (const b of p.bloques) {
    recorrer(b.datos.ascendientes, p.numero);
    recorrer(b.datos.descendientes, p.numero);
  }
  return out;
}
