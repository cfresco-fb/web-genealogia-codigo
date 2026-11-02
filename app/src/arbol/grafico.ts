// Datos de los gráficos de ascendientes y descendientes, a partir del
// árbol en memoria, en la forma que dibuja el gráfico de Gramps Connect
// (gramps-connect/graficos/treeChart.ts).
//
// Las ramas se cortan por número de generaciones y, además, si una
// persona aparece en su propia línea (datos con un ciclo), para que nunca
// haya un bucle. Una persona puede salir varias veces en el gráfico (por
// ejemplo, si dos primos se casaron, sus abuelos comunes aparecen por los
// dos lados): se dibuja cada vez y se marca como repetida.

import {
  CHART_LAYOUTS, type ChartLayout, type TreeFamily, type TreeLine, type TreeNode, type TreePerson,
} from "../gramps-connect/graficos/charts/treeChart";
import { nombreTipo, t, type Clave } from "../i18n";
import type { Arbol, DatoVital } from "./arbol";
import type { Simbolos } from "./simbolos";
import { anioSuelto, type FormatoFecha } from "./fechas";
import type { ChildRef, Evento, Familia, Persona } from "./tipos";

export type TipoGrafico = "ascendientes" | "descendientes" | "ambos";
export const TIPOS_GRAFICO: TipoGrafico[] = ["ascendientes", "descendientes", "ambos"];

/** Generaciones, contando la de la persona central (como en Gramps): con
 * 4, la persona, sus padres, abuelos y bisabuelos. Sin máximo fijo: el de
 * cada persona es el número de generaciones que hay (generacionesQueHay), y
 * «todas» las pide todas (decisión del 29/10/2026). */
export const GENERACIONES_MIN = 2;
export const GENERACIONES_POR_DEFECTO = 4;
export type Generaciones = number | "todas";

const PARENTESCO_NACIMIENTO = 1; // ChildRefType.BIRTH
const TIPO_EVENTO_MATRIMONIO = { _class: "EventType", value: 1, string: "" }; // EventType.MARRIAGE

export interface DatosGrafico {
  ascendientes: TreeNode | null;
  descendientes: TreeNode | null;
  /** Cajas de persona dibujadas (contando las repeticiones). */
  cajas: number;
  /** Con cajas pequeñas (PresentacionCajas.sencillas). */
  sencillas?: boolean;
}

/** Cómo se presentan las cajas: los símbolos de nacimiento y defunción,
 * el formato de las fechas (corto en la web, abreviado en los PDF) y si se
 * ve el ID de Gramps junto al nombre (solo el administrador). Decisión del
 * 23/10/2026, «Ajustes, persona de inicio, cajas y fechas». */
export interface PresentacionCajas extends Simbolos {
  /** Por defecto, corto. */
  formato?: FormatoFecha;
  /** El ID junto al nombre (en pantalla, para el administrador). */
  ids?: boolean;
  /** El ID en su línea, bajo el nombre (PDF con «Incluir identificadores»,
   * solo el administrador; decisión del 30/10/2026). */
  idsDebajo?: boolean;
  /** Cajas pequeñas (PDF del árbol, respuesta del 25/10/2026): sin foto,
   * solo el año de cada fecha y sin lugares, y más estrechas al dibujarlas. */
  sencillas?: boolean;
  /** Quién se considera vivo (vivos.ts): las demás, como fallecidas aunque
   * no tengan defunción (decisión del 29/10/2026). */
  vivas?: ReadonlySet<string>;
}

/** Para las cajas pequeñas: solo el año («c. 1850» si es aproximada), o la
 * fecha tal cual si no lo tiene (como las de solo texto), y sin lugar. */
function soloAnio(dato: DatoVital): DatoVital {
  return { ...dato, fecha: anioSuelto(dato.evento?.date) ?? dato.fecha, lugar: "" };
}

const SIN_LINEA: TreeLine = { text: "", keep: 0, short: "", keepShort: 0 };

/** Línea de nacimiento o defunción de la caja, como en Gramps: la fecha
 * corta y el lugar, con las reglas de las fichas (Arbol.datoVital):
 * - delante, el símbolo elegido («n.», «*»…) o, si es un evento sustituto,
 *   su nombre («Bautismo:», «Entierro:»);
 * - fecha y lugar: «n. 03/05/1950, Madrid»; solo fecha: «n. 03/05/1950»;
 * - sin fecha pero con lugar, «n. sin fecha, Madrid»;
 * - sin fecha ni lugar, «n. sin datos».
 * Si no cabe, se recorta el lugar («n. 03/05/1950, Mad…»); si ni así, el
 * año en lugar de la fecha («n. 1950, Madrid»). Sin dato (defunción sin
 * evento), todo vacío. `dato` debe traer la fecha en el formato de la caja. */
export function lineaCaja(dato: DatoVital | null, simbolo: string, sustituto: boolean): TreeLine {
  if (!dato) return SIN_LINEA;
  const prefijo = sustituto ? `${dato.rotulo}: ` : `${simbolo} `;
  if (dato.falta) {
    const text = `${prefijo}${t("ficha.sinDatos")}`;
    return { text, keep: text.length, short: "", keepShort: 0 };
  }
  const lugar = dato.lugar ? `, ${dato.lugar}` : "";
  const fecha = `${prefijo}${dato.fecha || t("ficha.sinFecha")}`;
  const a = anioSuelto(dato.evento?.date);
  const corto = dato.fecha && a !== null && a !== dato.fecha ? `${prefijo}${a}` : "";
  return { text: fecha + lugar, keep: fecha.length, short: corto && corto + lugar, keepShort: corto.length };
}

/** «Rótulo: texto», para los textos emergentes. */
const linea = (rotulo: string, texto: string) => `${rotulo}: ${texto}`;
/** Una línea del óvalo, sin nada que conservar al recortarla. */
const lineaOvalo = (text: string): TreeLine => ({ text, keep: 0, short: "", keepShort: 0 });

class Constructor {
  /** Cajas de cada persona, para marcar las repetidas al final. */
  private readonly cajas = new Map<string, TreePerson[]>();

  constructor(
    private readonly arbol: Arbol, private readonly limite: number, private readonly simbolos: PresentacionCajas,
    private readonly tramo?: TramoHijos, private readonly privadas?: ReadonlySet<string>,
  ) {}

  private caja(p: Persona, ref?: ChildRef): TreePerson {
    const a = this.arbol;
    const n = p.primary_name;
    const nombre = [n.first_name, n.suffix].filter(Boolean).join(" ");
    const apellidos = a.apellidos(n);
    if (this.privadas?.has(p.handle)) return this.cajaPrivada(p, nombre, apellidos);
    const formato = this.simbolos.formato ?? "corto";
    const sencillas = this.simbolos.sencillas;
    const nac = a.lineaNacimiento(p, formato);
    const def = a.lineaDefuncion(p, formato, this.simbolos.vivas);
    const nacimiento = lineaCaja(sencillas ? soloAnio(nac) : nac, this.simbolos.nacimiento, !!a.nacimiento(p)?.sustituto);
    const defuncion = lineaCaja(sencillas && def ? soloAnio(def) : def, this.simbolos.defuncion, !!a.defuncion(p)?.sustituto);
    const datoNac = a.lineaNacimiento(p);
    const datoDef = a.lineaDefuncion(p, "largo", this.simbolos.vivas);
    // El texto emergente, con las mismas líneas que la ficha (el ID, solo
    // para el administrador).
    const lineas = [
      a.nombre(p),
      linea(t("col.sexo"), t(`ficha.sexo.${p.gender}` as Clave)),
      this.simbolos.ids ? linea(t("col.id"), p.gramps_id) : "",
      linea(datoNac.rotulo, datoNac.texto),
      datoDef ? linea(datoDef.rotulo, datoDef.texto) : "",
    ];
    if (ref && (ref.frel.value !== PARENTESCO_NACIMIENTO || ref.mrel.value !== PARENTESCO_NACIMIENTO)) {
      lineas.push(`${t("col.padre")}: ${nombreTipo(ref.frel)} · ${t("col.madre")}: ${nombreTipo(ref.mrel)}`);
    }
    const foto = this.simbolos.sencillas ? null : a.fotoPrincipal(p);
    const caja: TreePerson = {
      handle: p.handle,
      gender: p.gender,
      // Vacíos si faltan: el gráfico pone en su lugar «[sin apellidos]» o
      // «[sin nombre de pila]» (TreeChartLabels).
      nameSurname: apellidos,
      nameGiven: nombre,
      nick: a.apodo(p) || undefined,
      grampsId: this.simbolos.ids ? p.gramps_id : undefined,
      idLine: this.simbolos.idsDebajo ? p.gramps_id : undefined,
      birth: nacimiento,
      death: defuncion,
      title: lineas.filter(Boolean).join("\n"),
      photo: foto ? { handle: foto.handle, rect: p.media_list.find((r) => r.ref === foto.handle)?.rect ?? null } : null,
      repeated: false,
    };
    const lista = this.cajas.get(p.handle);
    if (lista) lista.push(caja);
    else this.cajas.set(p.handle, [caja]);
    return caja;
  }

  /** Persona viva cuyos datos se omiten (libro en PDF): solo su nombre y
   * «Persona viva», sin fechas ni foto. */
  private cajaPrivada(p: Persona, nombre: string, apellidos: string): TreePerson {
    const viva = t("libro.personaViva");
    const caja: TreePerson = {
      handle: p.handle, gender: p.gender, nameSurname: apellidos, nameGiven: nombre, nick: this.arbol.apodo(p) || undefined,
      grampsId: this.simbolos.ids ? p.gramps_id : undefined,
      idLine: this.simbolos.idsDebajo ? p.gramps_id : undefined,
      birth: { ...SIN_LINEA, text: viva, keep: viva.length }, death: SIN_LINEA,
      title: [this.arbol.nombre(p), viva].join("\n"), photo: null, repeated: false,
    };
    const lista = this.cajas.get(p.handle);
    if (lista) lista.push(caja);
    else this.cajas.set(p.handle, [caja]);
    return caja;
  }

  /** Cajas dibujadas. Marca como repetidas las personas que salen más de
   * una vez. La caja central es una sola, compartida por las dos mitades. */
  cerrar(): number {
    let total = 0;
    for (const lista of this.cajas.values()) {
      total += lista.length;
      if (lista.length > 1) {
        for (const c of lista) {
          c.repeated = true;
          c.title += `\n${t("grafico.repetida")}`;
        }
      }
    }
    return total;
  }

  /** Ascendientes: padre arriba y madre abajo, de la primera familia de
   * padres (la principal en Gramps). */
  ascendientes(p: Persona, nivel: number, ruta: Set<string>, id: string, central?: TreePerson): TreeNode {
    const nodo: TreeNode = { id, person: central ?? this.caja(p) };
    const familia = this.arbol.familiasPadres(p)[0];
    const padres = familia ? [this.arbol.padre(familia), this.arbol.madre(familia)] : [];
    if (nivel >= this.limite) {
      nodo.hasMore = padres.some(Boolean);
      return nodo;
    }
    if (ruta.has(p.handle)) return nodo;
    ruta.add(p.handle);
    const hijos: TreeNode[] = [];
    const [padre, madre] = padres;
    if (padre) hijos.push(this.ascendientes(padre, nivel + 1, ruta, `${id}f`));
    if (madre) hijos.push(this.ascendientes(madre, nivel + 1, ruta, `${id}m`));
    ruta.delete(p.handle);
    if (hijos.length) nodo.children = hijos;
    return nodo;
  }

  /** Descendientes: tras cada persona, un nodo por cada familia (el
   * cónyuge, que se dibuja al lado de la persona, y el óvalo de la boda) y,
   * tras él, los hijos de esa pareja. En la última generación, sin las
   * familias. */
  descendientes(p: Persona, nivel: number, ruta: Set<string>, id: string, ref?: ChildRef, central?: TreePerson): TreeNode {
    const nodo: TreeNode = { id, person: central ?? this.caja(p, ref) };
    const familias = this.arbol
      .familiasPorBoda(p)
      .filter((f) => this.arbol.conyuge(f, p) || f.child_ref_list.length);
    if (nivel >= this.limite) {
      nodo.hasMore = familias.some((f) => this.arbol.hijos(f).length > 0);
      return nodo;
    }
    if (ruta.has(p.handle)) return nodo;
    ruta.add(p.handle);
    // Con un tramo (PDF de una familia con muchos hijos), solo los hijos de
    // la persona central de ese tramo, contados por orden en todas sus
    // familias; las familias sin hijos en el tramo no salen, salvo las que
    // no tienen hijos, que salen en el primero.
    let orden = 0;
    const hijos = familias.flatMap((f, i): TreeNode[] => {
      const todos = this.arbol.hijos(f).map((h, j) => ({ h, j, n: orden++ }));
      const enTramo = nivel === 0 && this.tramo
        ? todos.filter(({ n }) => n >= this.tramo!.desde && n < this.tramo!.hasta)
        : todos;
      if (nivel === 0 && this.tramo && !enTramo.length && (todos.length || this.tramo.desde > 0)) return [];
      return [{
        id: `${id}f${i}`,
        family: this.familia(f, p),
        children: enTramo.map(({ h, j }) => this.descendientes(h.persona, nivel + 1, ruta, `${id}f${i}c${j}`, h.ref)),
      }];
    });
    ruta.delete(p.handle);
    if (hijos.length) nodo.children = hijos;
    return nodo;
  }

  /** La familia, como en Gramps (decisiones del 23/10/2026, del
   * 24/10/2026 y del 31/10/2026, «Tipos de relación de pareja»): el cónyuge
   * en su propia caja y, en el óvalo, solo lo que se conoce:
   * - matrimonio («Casados» y «Unión civil»): «matr. fecha, lugar» (fijo,
   *   como «div.» y «sep.»; el lugar, debajo si no cabe) o, sin fecha ni
   *   lugar de la boda, «casados»;
   * - pareja sin casar: «Pareja» (sin «desde»: el inicio de la relación se
   *   descartó el 29/10/2026);
   * - tipo desconocido: nada (el óvalo solo une);
   * - en todos, «div. fecha, lugar» y «sep. fecha» si hay divorcio o
   *   separación; sin fecha ni lugar (la separación, sin fecha),
   *   «divorciados» o «separados».
   * Padres sin relación de pareja: óvalo con el borde discontinuo y «sin
   * relación de pareja» dentro (en dos líneas si no cabe; lo parte el
   * dibujo). En el texto emergente, los mismos datos con rótulo, como en las
   * fichas. */
  private familia(f: Familia, p: Persona): TreeFamily {
    const a = this.arbol;
    const conyuge = a.conyuge(f, p);
    const pareja = a.pareja(f);
    const formato = this.simbolos.formato ?? "corto";
    const titulo = conyuge ? a.nombre(conyuge) : t("ficha.conyugeDesconocido");
    const spouse = conyuge ? this.caja(conyuge) : null;
    const sinRelacion = pareja.clase === "sinRelacion";
    const tipo = linea(t("ficha.tipoRelacion"), nombreTipo(f.type));
    // Con una persona viva omitida en la pareja, sin fechas ni lugares.
    if (this.privadas?.has(p.handle) || (conyuge && this.privadas?.has(conyuge.handle))) {
      const lines = pareja.clase === "pareja" ? [lineaOvalo(t("grafico.pareja"))]
        : pareja.clase === "matrimonio" ? [lineaOvalo(t("grafico.casados"))]
          : sinRelacion ? [lineaOvalo(t("grafico.sinRelacion"))] : [];
      return { handle: f.handle, spouse, lines, dashed: sinRelacion, title: [titulo, tipo].join("\n") };
    }
    const datoCompleto = (ev: Evento | null, fmt: FormatoFecha = "largo", rotulo = "") =>
      a.datoVital(ev && { evento: ev, sustituto: false }, rotulo || (ev ? nombreTipo(ev.type) : ""), fmt);
    // En el óvalo, con las cajas pequeñas, solo años y sin lugares.
    const dato = (ev: Evento | null, fmt: FormatoFecha = "largo", rotulo = "") => {
      const d = datoCompleto(ev, fmt, rotulo);
      return this.simbolos.sencillas && fmt !== "largo" ? soloAnio(d) : d;
    };
    const lines: TreeLine[] = [];
    if (pareja.clase === "matrimonio") {
      const boda = pareja.boda && dato(pareja.boda, formato);
      if (boda && !boda.falta) {
        // Si no cabe en una línea, el lugar va debajo (31/10/2026).
        const unaLinea = lineaCaja(boda, t("grafico.matrimonio"), false);
        const fecha = `${t("grafico.matrimonio")} ${boda.fecha || t("ficha.sinFecha")}`;
        lines.push(boda.lugar ? { ...unaLinea, wrap: [fecha, boda.lugar] } : unaLinea);
      } else lines.push(lineaOvalo(t("grafico.casados")));
    }
    if (pareja.clase === "pareja") {
      lines.push(lineaOvalo(t("grafico.pareja")));
    }
    // Sin fecha ni lugar, la palabra sola, como «casados» (31/10/2026).
    if (pareja.divorcio) {
      const div = dato(pareja.divorcio, formato);
      lines.push(div.falta ? lineaOvalo(t("grafico.divorciados")) : lineaCaja(div, t("grafico.divorcio"), false));
    }
    if (pareja.separacion) {
      // Solo la fecha; sin ella, «separados» aunque haya lugar.
      const sep = dato(pareja.separacion, formato);
      lines.push(sep.fecha ? lineaCaja({ ...sep, lugar: "" }, t("grafico.separacion"), false) : lineaOvalo(t("grafico.separados")));
    }
    // En el texto emergente, la boda siempre en un matrimonio (aunque sea
    // «sin datos»); en los demás tipos, si la hay.
    const conRotulo = (ev: Evento | null, rotulo = "") => {
      const d = dato(ev, "largo", rotulo);
      return ev || rotulo ? linea(d.rotulo, d.texto) : "";
    };
    return {
      handle: f.handle,
      spouse,
      lines: sinRelacion ? [lineaOvalo(t("grafico.sinRelacion"))] : lines,
      dashed: sinRelacion,
      title: [
        titulo,
        tipo,
        this.simbolos.ids ? linea(t("col.id"), f.gramps_id) : "",
        pareja.clase === "matrimonio" || pareja.boda ? conRotulo(pareja.boda, nombreTipo(TIPO_EVENTO_MATRIMONIO)) : "",
        conRotulo(pareja.divorcio),
        conRotulo(pareja.separacion),
      ].filter(Boolean).join("\n"),
    };
  }

  /** En el árbol de ascendientes, la persona central con sus parejas: el
   * cónyuge en su caja y el óvalo de la boda, sin los hijos (decisión del
   * 27/10/2026). */
  parejas(p: Persona, central: TreePerson): TreeNode | null {
    const familias = this.arbol.familiasPorBoda(p).filter((f) => this.arbol.conyuge(f, p));
    if (!familias.length) return null;
    return { id: "p", person: central, children: familias.map((f, i) => ({ id: `pf${i}`, family: this.familia(f, p), children: [] })) };
  }

  cajaCentral(p: Persona): TreePerson {
    return this.caja(p);
  }
}

/** Tramo de los hijos de la persona central: del hijo `desde` (incluido) al
 * `hasta` (excluido), contados desde 0 por orden en todas sus familias. */
export interface TramoHijos {
  desde: number;
  hasta: number;
}

/** Número de hijos de una persona, en todas sus familias. */
export function numeroDeHijos(arbol: Arbol, p: Persona): number {
  return arbol.familiasPorBoda(p).reduce((n, f) => n + arbol.hijos(f).length, 0);
}

/** Gráfico centrado en `persona` con `generaciones` generaciones (contando
 * la suya) hacia arriba, hacia abajo o en los dos sentidos. Con `tramo`,
 * solo esos hijos de la persona central (para el PDF). Con `privadas`, las
 * personas vivas cuyos datos se omiten (libro en PDF). Con `parejas` (por
 * defecto), el de ascendientes lleva también los cónyuges de la persona
 * central y sus óvalos; sin él, solo los ascendientes (las páginas de
 * continuación del PDF, de otras personas). */
export function construirGrafico(
  arbol: Arbol, persona: Persona, tipo: TipoGrafico, generaciones: number, simbolos: PresentacionCajas, tramo?: TramoHijos,
  privadas?: ReadonlySet<string>, parejas = true,
): DatosGrafico {
  const c = new Constructor(arbol, Math.max(1, generaciones - 1), simbolos, tramo, privadas);
  const central = c.cajaCentral(persona);
  const ascendientes = tipo !== "descendientes" ? c.ascendientes(persona, 0, new Set(), "p", central) : null;
  const descendientes = tipo !== "ascendientes"
    ? c.descendientes(persona, 0, new Set(), "p", undefined, central)
    : parejas ? c.parejas(persona, central) : null;
  // Los tramos que siguen al primero repiten la pareja encima de los hijos:
  // solo con el nombre y el apodo (decisión del 27/10/2026).
  if (tramo && tramo.desde > 0 && descendientes) {
    for (const caja of [central, ...(descendientes.children ?? []).map((n) => n.family?.spouse)]) {
      if (caja) Object.assign(caja, { birth: SIN_LINEA, death: SIN_LINEA, photo: null });
    }
  }
  return { ascendientes, descendientes, cajas: c.cerrar(), sencillas: !!simbolos.sencillas };
}

/** Generaciones válidas a partir de un texto (p. ej. de la dirección):
 * «todas» o un número desde GENERACIONES_MIN; si no vale, `porDefecto`. */
export function leerGeneraciones(texto: string | null, porDefecto: Generaciones = GENERACIONES_POR_DEFECTO): Generaciones {
  if (texto === "todas") return "todas";
  const n = texto ? Number(texto) : NaN;
  if (!Number.isInteger(n)) return porDefecto;
  return Math.max(GENERACIONES_MIN, n);
}

/** Las generaciones guardadas en las preferencias, si valen (las reglas
 * comprueban lo mismo): un entero desde GENERACIONES_MIN o «todas». */
export function generacionesValidas(g: unknown): Generaciones | null {
  return g === "todas" || (Number.isInteger(g) && (g as number) >= GENERACIONES_MIN) ? (g as Generaciones) : null;
}

/** Cuántas generaciones hay desde `persona` (contando la suya) hacia arriba,
 * hacia abajo o, con «ambos», la mayor de las dos, por los mismos caminos
 * que el gráfico y el libro: los padres de la primera familia y los hijos de
 * todas. Un ciclo en los datos no cuenta dos veces. */
export function generacionesQueHay(arbol: Arbol, persona: Persona, tipo: TipoGrafico): number {
  const hondura = (siguientes: (p: Persona) => (Persona | null)[]) => {
    const hechas = new Map<string, number>();
    const enCurso = new Set<string>();
    const de = (p: Persona): number => {
      const ya = hechas.get(p.handle);
      if (ya !== undefined) return ya;
      if (enCurso.has(p.handle)) return 0;
      enCurso.add(p.handle);
      let n = 1;
      for (const s of siguientes(p)) if (s) n = Math.max(n, 1 + de(s));
      enCurso.delete(p.handle);
      hechas.set(p.handle, n);
      return n;
    };
    return de(persona);
  };
  const arriba = () => hondura((p) => {
    const f = arbol.familiasPadres(p)[0];
    return f ? [arbol.padre(f), arbol.madre(f)] : [];
  });
  const abajo = () => hondura((p) => arbol.familiasPorBoda(p).flatMap((f) => arbol.hijos(f).map((h) => h.persona)));
  return tipo === "ascendientes" ? arriba() : tipo === "descendientes" ? abajo() : Math.max(arriba(), abajo());
}

/** Las generaciones que se dibujan: las pedidas, pero no más de las que hay
 * (ni menos de `min`); con «todas», todas las que hay. El libro las cuenta
 * sin la de la persona (desde 1). */
export function generacionesEfectivas(pedidas: Generaciones, hay: number, min = GENERACIONES_MIN): number {
  const max = Math.max(min, hay);
  return pedidas === "todas" ? max : Math.min(Math.max(min, pedidas), max);
}

/** Las opciones de un selector de generaciones: de `min` a las que hay, y
 * «todas». */
export function opcionesGeneraciones(hay: number, min = GENERACIONES_MIN): string[] {
  const max = Math.max(min, hay);
  return [...Array.from({ length: max - min + 1 }, (_, i) => String(i + min)), "todas"];
}

/** Disposición del árbol (vertical por defecto): parámetro «disp» de la
 * dirección de la página. */
export type Disposicion = ChartLayout;
export const DISPOSICIONES: Disposicion[] = CHART_LAYOUTS;
export function leerDisposicion(texto: string | null): Disposicion {
  return texto === "horizontal" ? "horizontal" : "vertical";
}

export function leerTipo(texto: string | null): TipoGrafico {
  return TIPOS_GRAFICO.includes(texto as TipoGrafico) ? (texto as TipoGrafico) : "ambos";
}
