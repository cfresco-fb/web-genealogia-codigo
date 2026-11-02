// Libro en PDF: maqueta y dibujo del contenido de app/src/arbol/libro.ts
// con jsPDF (el mismo motor que el PDF del árbol; por qué, en
// docs/libro.md). Se carga solo al generar el libro.
//
// Orden (decisión del 30/10/2026, «Libro: estructura nueva»): portada;
// índice general; la página de la persona principal; el árbol, si se pide
// (uno solo, del alcance del libro, con «Ambos» también; las páginas de
// continuación del PDF «Árbol»); las partes de ascendientes y descendientes,
// por generaciones; índice de personas y, si se pide, de lugares. Como el
// contenido se maqueta aquí mismo, las páginas se conocen al escribir: el
// índice general se deja en blanco (sus páginas se cuentan antes) y se
// rellena al final; los índices alfabéticos van al final. Para que la
// página principal remita a la del árbol, que va detrás, se maqueta antes
// en un documento de prueba y se cuentan sus páginas.
//
// Letra: Noto Sans (normal y negrita) y las de símbolos, incrustadas; todo
// el texto se puede seleccionar y buscar. Ningún texto baja de 8 puntos.

import type { jsPDF } from "jspdf";
import { comparador, idioma, t } from "../i18n";
import type { Arbol } from "../arbol/arbol";
import { anio } from "../arbol/fechas";
import { anclaArbol, aniosIndice, type Libro, type OpcionesLibro, type Parrafo, type Trozo } from "../arbol/libro";
import {
  LETRA_MINIMA_PT, paginaDePersonas, planificarPaginas, textosPlan, type PapelLibro, type Plan,
} from "../arbol/paginasPdf";
import type { PresentacionCajas } from "../arbol/grafico";
import { normalizar } from "../arbol/arbol";
import { PAPER_SIZES } from "../gramps-connect/chartExport/paperSizes";
import { saveBlob } from "../gramps-connect/chartExport/exportChart";
import { PDF_FONT_FAMILY, registerPdfFonts } from "../gramps-connect/chartExport/pdfFonts";
import { CON_NEGRITA, FAMILIA_HEBREA, familiasDe, registrarSimbolosPdf } from "../fuentes/simbolos";
import { dibujarPaginasArbol, nuevoDocumento, type Dibujo } from "./pdfArbol";

export type { PapelLibro };

export interface OpcionesPdfLibro {
  papel: PapelLibro;
  titulo: string;
  subtitulo: string;
  /** Nombre del árbol (el que fija el administrador). */
  nombreArbol: string;
  /** Se han omitido los datos de las personas vivas. */
  sinVivos: boolean;
}

export interface Avance {
  /** Qué se está haciendo («Fotos», «Árbol: página 3 de 8»…). */
  texto: string;
}

export interface ResultadoLibro {
  paginas: number;
  /** Algún árbol fue como imagen (letras que no tiene la fuente). */
  arbolComoImagen: boolean;
  /** Caracteres que no tiene ninguna letra del PDF (salen como «?»). */
  sinLetra: string[];
}

// Medidas, en mm salvo los tamaños de letra (puntos).
const MARGEN_X = 20;
const MARGEN_ARRIBA = 18;
const MARGEN_ABAJO = 18;
const SANGRIA = 6;
const INTERLINEA = 1.3;
const PT = 25.4 / 72;
const LETRA = { texto: 10, pequena: 9, entrada: 11, generacion: 13, parte: 18, indice: 9, pie: 8 };
const ALTO_FOTO = 30;
const PIE_Y = 8; // desde abajo

// Ningún texto por debajo de la letra mínima (decisión del 22/10/2026).
for (const pt of Object.values(LETRA)) if (pt < LETRA_MINIMA_PT) throw new Error("Letra por debajo del mínimo");

const altoLinea = (pt: number) => pt * PT * INTERLINEA;

/** Un trozo de texto con una sola letra y un solo estilo. */
interface Pieza {
  texto: string;
  familia: string;
  negrita: boolean;
  persona?: string;
  lugar?: string;
  /** Página a la que enlaza. */
  enlace?: number;
}

/** Una palabra (o un espacio) ya partida en piezas, con su ancho. */
interface Atomo {
  piezas: Pieza[];
  ancho: number;
  espacio: boolean;
}

interface EntradaIndice {
  paginas: Set<number>;
  principales: Set<number>;
}

class Maqueta {
  readonly doc: jsPDF;
  private y = MARGEN_ARRIBA;
  private readonly ancho: number;
  private readonly alto: number;
  /** Columnas (en los índices): cuántas y en cuál se escribe. */
  private columnas = 1;
  private columna = 0;
  readonly anclas = new Map<string, number>();
  readonly personas = new Map<string, EntradaIndice>();
  readonly lugares = new Map<string, EntradaIndice>();
  readonly sinLetra = new Set<string>();
  private readonly anchos = new Map<string, number>();

  constructor(doc: jsPDF, private readonly papel: PapelLibro) {
    this.doc = doc;
    const [w, h] = PAPER_SIZES[papel];
    this.ancho = w;
    this.alto = h;
  }

  get pagina(): number {
    return this.doc.getCurrentPageInfo().pageNumber;
  }

  nuevaPagina() {
    this.doc.addPage([this.ancho, this.alto], "portrait");
    this.y = MARGEN_ARRIBA;
    this.columna = 0;
  }

  private get anchoColumna(): number {
    const util = this.ancho - 2 * MARGEN_X;
    return this.columnas === 1 ? util : (util - 8) / this.columnas;
  }

  private get x0(): number {
    return MARGEN_X + this.columna * (this.anchoColumna + 8);
  }

  private get limite(): number {
    return this.alto - MARGEN_ABAJO;
  }

  /** Pasa a la columna o página siguiente si no caben `alto` mm. */
  asegurar(alto: number) {
    if (this.y + alto <= this.limite) return;
    if (this.columna + 1 < this.columnas) {
      this.columna++;
      this.y = this.yColumnas;
    } else {
      this.nuevaPagina();
      this.yColumnas = MARGEN_ARRIBA;
    }
  }

  /** Altura donde empiezan las columnas en la página actual. */
  private yColumnas = MARGEN_ARRIBA;

  enColumnas(n: number) {
    this.columnas = n;
    this.columna = 0;
    this.yColumnas = this.y;
  }

  espacio(mm: number) {
    if (this.y > MARGEN_ARRIBA) this.y += mm;
  }

  // ---- Letras ----

  private ponerLetra(familia: string, negrita: boolean, pt: number) {
    this.doc.setFont(familia, negrita && (familia === PDF_FONT_FAMILY || CON_NEGRITA.has(familia)) ? "bold" : "normal");
    this.doc.setFontSize(pt);
  }

  private medir(texto: string, familia: string, negrita: boolean, pt: number): number {
    const clave = `${familia}|${negrita}|${pt}|${texto}`;
    let w = this.anchos.get(clave);
    if (w === undefined) {
      this.ponerLetra(familia, negrita, pt);
      w = this.doc.getTextWidth(texto);
      this.anchos.set(clave, w);
    }
    return w;
  }

  /** Parte un texto en piezas según la letra que tiene cada carácter
   * (familiasDe). Los que no tiene ninguna salen como «?» (y se avisa). */
  private piezas(texto: string, base: Omit<Pieza, "texto" | "familia">): Pieza[] {
    const out: Pieza[] = [];
    for (const { caracter, letra } of familiasDe(texto.replace(/[︎️]/g, ""))) {
      let c = caracter;
      let familia = letra;
      if (familia === null) {
        this.sinLetra.add(c);
        c = "?";
        familia = "";
      }
      const f = familia || PDF_FONT_FAMILY;
      const ultima = out.at(-1);
      if (ultima && ultima.familia === f) ultima.texto += c;
      else out.push({ ...base, texto: c, familia: f });
    }
    return out;
  }

  private atomos(trozos: Trozo[], pt: number, negritaBase = false): Atomo[] {
    const out: Atomo[] = [];
    for (const tr of trozos) {
      // Letras con tilde o diéresis compuestas (NFC): jsPDF no coloca los
      // signos sueltos sobre la letra.
      for (const parte of tr.texto.normalize("NFC").split(/(\s+)/)) {
        if (!parte) continue;
        const espacio = /^\s+$/.test(parte);
        const piezas = this.piezas(espacio ? " " : parte, { negrita: !!tr.negrita || negritaBase, persona: tr.persona, lugar: tr.lugar, enlace: tr.enlace });
        const ancho = piezas.reduce((s, p) => s + this.medir(p.texto, p.familia, p.negrita, pt), 0);
        // Las palabras seguidas sin espacio (p. ej. «Nombre» y « (n.º 3)»
        // en trozos distintos) se escriben juntas.
        const ultimo = out.at(-1);
        if (!espacio && ultimo && !ultimo.espacio) {
          ultimo.piezas.push(...piezas);
          ultimo.ancho += ancho;
        } else {
          out.push({ piezas, ancho, espacio });
        }
      }
    }
    return out;
  }

  /** Reparte los átomos en líneas de `ancho` mm como mucho. */
  private lineas(atomos: Atomo[], primera: number, resto: number, pt: number): Atomo[][] {
    const lineas: Atomo[][] = [[]];
    let usado = 0;
    for (const a of atomos) {
      const disponible = lineas.length === 1 ? primera : resto;
      const actual = lineas.at(-1)!;
      if (a.espacio) {
        if (actual.length) {
          actual.push(a);
          usado += a.ancho;
        }
        continue;
      }
      if (usado + a.ancho <= disponible || !actual.length) {
        if (a.ancho > disponible && !actual.length) {
          // Una palabra más larga que la línea: se parte por caracteres.
          for (const trozo of this.partirPalabra(a, disponible, pt)) {
            if (lineas.at(-1)!.length) lineas.push([]);
            lineas.at(-1)!.push(trozo);
            usado = trozo.ancho;
          }
          continue;
        }
        actual.push(a);
        usado += a.ancho;
      } else {
        while (actual.length && actual.at(-1)!.espacio) actual.pop();
        lineas.push([a]);
        usado = a.ancho;
      }
    }
    for (const l of lineas) while (l.length && l.at(-1)!.espacio) l.pop();
    return lineas;
  }

  private partirPalabra(a: Atomo, ancho: number, pt: number): Atomo[] {
    const out: Atomo[] = [];
    let actual: Atomo = { piezas: [], ancho: 0, espacio: false };
    for (const p of a.piezas) {
      for (const c of p.texto) {
        const w = this.medir(c, p.familia, p.negrita, pt);
        if (actual.ancho + w > ancho && actual.piezas.length) {
          out.push(actual);
          actual = { piezas: [], ancho: 0, espacio: false };
        }
        const ultima = actual.piezas.at(-1);
        if (ultima && ultima.familia === p.familia && ultima.negrita === p.negrita) ultima.texto += c;
        else actual.piezas.push({ ...p, texto: c });
        actual.ancho += w;
      }
    }
    if (actual.piezas.length) out.push(actual);
    return out;
  }

  private anotar(mapa: Map<string, EntradaIndice>, clave: string, principal: boolean) {
    let e = mapa.get(clave);
    if (!e) mapa.set(clave, (e = { paginas: new Set(), principales: new Set() }));
    e.paginas.add(this.pagina);
    if (principal) e.principales.add(this.pagina);
  }

  /** Si en `linea[i]` empiezan varias palabras en hebreo seguidas (con
   * espacios, cifras o signos entre ellas), el índice de la última; si no,
   * -1. Esas palabras se escriben de una vez, para que jsPDF las ponga en
   * orden de derecha a izquierda. */
  private tramoHebreo(linea: Atomo[], i: number): number {
    const hebrea = (a: Atomo) => !a.espacio && a.piezas.every((p) => p.familia === FAMILIA_HEBREA);
    const neutra = (a: Atomo) => a.espacio || /^[\p{N}\p{P}\p{S}\s]+$/u.test(a.piezas.map((p) => p.texto).join(""));
    if (!hebrea(linea[i])) return -1;
    let fin = i;
    for (let j = i + 1; j < linea.length; j++) {
      if (hebrea(linea[j])) fin = j;
      else if (!neutra(linea[j])) break;
    }
    return fin > i ? fin : -1;
  }

  private dibujarLinea(linea: Atomo[], x: number, base: number, pt: number, principal: string | null) {
    let cx = x;
    for (let i = 0; i < linea.length; i++) {
      const fin = this.tramoHebreo(linea, i);
      if (fin >= 0) {
        const tramo = linea.slice(i, fin + 1);
        const piezas = tramo.flatMap((a) => a.piezas);
        const ancho = tramo.reduce((s, a) => s + a.ancho, 0);
        this.ponerLetra(FAMILIA_HEBREA, piezas.some((p) => p.negrita), pt);
        this.doc.text(tramo.map((a) => (a.espacio ? " " : a.piezas.map((p) => p.texto).join(""))).join(""), cx, base, { baseline: "alphabetic" });
        const enlace = piezas.find((p) => p.enlace)?.enlace;
        if (enlace) this.doc.link(cx, base - pt * PT, ancho, altoLinea(pt), { pageNumber: enlace });
        for (const p of piezas) {
          if (p.persona) this.anotar(this.personas, p.persona, p.persona === principal);
          if (p.lugar) this.anotar(this.lugares, p.lugar, false);
        }
        cx += ancho;
        i = fin;
        continue;
      }
      const a = linea[i];
      for (const p of a.piezas) {
        if (!a.espacio) {
          this.ponerLetra(p.familia, p.negrita, pt);
          this.doc.text(p.texto, cx, base, { baseline: "alphabetic" });
          if (p.enlace) this.doc.link(cx, base - pt * PT, this.medir(p.texto, p.familia, p.negrita, pt), altoLinea(pt), { pageNumber: p.enlace });
          if (p.persona) this.anotar(this.personas, p.persona, p.persona === principal);
          if (p.lugar) this.anotar(this.lugares, p.lugar, false);
        }
        cx += this.medir(p.texto, p.familia, p.negrita, pt);
      }
    }
  }

  /** Escribe un párrafo: `sangria` mm a la izquierda; con `vineta`, la
   * viñeta en la sangría y el texto a continuación (sangría francesa). */
  parrafo(trozos: Trozo[], o: { pt: number; sangria?: number; vineta?: string; francesa?: number; negrita?: boolean; principal?: string | null; mantener?: number }) {
    const pt = o.pt;
    const sangria = o.sangria ?? 0;
    // Las columnas tienen todas el mismo ancho: las líneas se reparten antes
    // y la posición de cada una se calcula al escribirla (puede pasar a la
    // columna o la página siguiente).
    const ancho = this.anchoColumna - sangria;
    let primera = ancho;
    let desplVineta = 0;
    let vineta: Atomo[] = [];
    if (o.vineta) {
      vineta = this.atomos([{ texto: o.vineta }], pt);
      desplVineta = Math.max(SANGRIA, vineta[0].ancho + 2);
      primera -= desplVineta;
    }
    const francesa = o.francesa ?? 0;
    const lineas = this.lineas(this.atomos(trozos, pt, o.negrita), primera, o.vineta ? primera : ancho - francesa, pt);
    const h = altoLinea(pt);
    this.asegurar(h * Math.min(lineas.length, 2) + (o.mantener ?? 0));
    lineas.forEach((l, i) => {
      this.asegurar(h);
      const base = this.y + pt * PT;
      const x = this.x0 + sangria;
      if (i === 0 && vineta.length) this.dibujarLinea(vineta, x, base, pt, null);
      this.dibujarLinea(l, o.vineta ? x + desplVineta : i === 0 ? x : x + francesa, base, pt, o.principal ?? null);
      this.y += h;
    });
  }

  /** Una línea con texto a la izquierda y el número de página a la
   * derecha, unidos por puntos; toda ella enlaza con esa página. */
  lineaConPagina(texto: string, pagina: number, o: { pt: number; sangria: number; negrita?: boolean }) {
    const h = altoLinea(o.pt);
    this.asegurar(h);
    const base = this.y + o.pt * PT;
    const x = this.x0 + o.sangria;
    const num = String(pagina);
    const wNum = this.medir(num, PDF_FONT_FAMILY, !!o.negrita, o.pt);
    const derecha = this.x0 + this.anchoColumna;
    const atomos = this.atomos([{ texto }], o.pt, o.negrita);
    const [linea] = this.lineas(atomos, derecha - x - wNum - 6, derecha - x - wNum - 6, o.pt);
    this.dibujarLinea(linea, x, base, o.pt, null);
    const wTexto = linea.reduce((s, a) => s + a.ancho, 0);
    this.ponerLetra(PDF_FONT_FAMILY, false, o.pt);
    const punto = this.medir(" .", PDF_FONT_FAMILY, false, o.pt);
    const puntos = Math.max(0, Math.floor((derecha - wNum - 2 - (x + wTexto + 2)) / punto));
    if (puntos > 0) this.doc.text(" .".repeat(puntos), derecha - wNum - 2, base, { align: "right", baseline: "alphabetic" });
    this.ponerLetra(PDF_FONT_FAMILY, !!o.negrita, o.pt);
    this.doc.text(num, derecha, base, { align: "right", baseline: "alphabetic" });
    this.doc.link(x, this.y, derecha - x, h, { pageNumber: pagina });
    this.y += h;
  }

  /** Imágenes en fila, del mismo alto, cada una con su pie (la
   * descripción de la foto, en letra pequeña, del ancho de la foto). */
  fotos(imagenes: { datos: string; ancho: number; alto: number; pie: string }[], sangria: number) {
    if (!imagenes.length) return;
    const limite = this.x0 + this.anchoColumna;
    const pt = LETRA.pie;
    const colocadas = imagenes.map((im) => {
      const ancho = Math.min((ALTO_FOTO * im.ancho) / im.alto, limite - this.x0 - sangria);
      // El pie, como mucho tres líneas; al menos tan ancho como 25 mm.
      const anchoPie = Math.max(ancho, 25);
      const lineas = im.pie ? this.lineas(this.atomos([{ texto: im.pie }], pt), anchoPie, anchoPie, pt).slice(0, 3) : [];
      return { im, ancho, alto: (ancho * im.alto) / im.ancho, anchoPie, lineas };
    });
    // Las fotos van en filas; el alto de cada fila, el de su pie más largo.
    let fila: typeof colocadas = [];
    const escribirFila = () => {
      if (!fila.length) return;
      const altoPie = Math.max(0, ...fila.map((c) => c.lineas.length)) * altoLinea(pt);
      this.asegurar(ALTO_FOTO + altoPie + 3);
      let x = this.x0 + sangria;
      for (const c of fila) {
        this.doc.addImage(c.im.datos, "JPEG", x, this.y, c.ancho, c.alto, undefined, "FAST");
        let y = this.y + ALTO_FOTO + 1;
        for (const l of c.lineas) {
          this.dibujarLinea(l, x, y + pt * PT, pt, null);
          y += altoLinea(pt);
        }
        x += Math.max(c.ancho, c.lineas.length ? c.anchoPie : 0) + 3;
      }
      this.y += ALTO_FOTO + altoPie + 3;
      fila = [];
    };
    let x = this.x0 + sangria;
    for (const c of colocadas) {
      const w = Math.max(c.ancho, c.lineas.length ? c.anchoPie : 0);
      if (fila.length && x + w > limite) {
        escribirFila();
        x = this.x0 + sangria;
      }
      fila.push(c);
      x += w + 3;
    }
    escribirFila();
  }

  /** Texto centrado (portada y cabeceras). */
  centrado(texto: string, pt: number, negrita: boolean, y: number) {
    const atomos = this.atomos([{ texto }], pt, negrita);
    const lineas = this.lineas(atomos, this.ancho - 2 * MARGEN_X, this.ancho - 2 * MARGEN_X, pt);
    let cy = y;
    for (const l of lineas) {
      const w = l.reduce((s, a) => s + a.ancho, 0);
      this.dibujarLinea(l, (this.ancho - w) / 2, cy, pt, null);
      cy += altoLinea(pt);
    }
    return cy;
  }

  irA(y: number) {
    this.y = y;
  }

  get yActual(): number {
    return this.y;
  }

  pie(texto: string) {
    const w = this.doc.internal.pageSize.getWidth();
    const h = this.doc.internal.pageSize.getHeight();
    this.ponerLetra(PDF_FONT_FAMILY, false, LETRA.pie);
    this.doc.setTextColor("#000000");
    this.doc.text(texto, w / 2, h - PIE_Y, { align: "center", baseline: "middle" });
  }
}

/** Foto preparada para el PDF: recortada como en la referencia, reducida y
 * en JPEG. */
async function prepararFoto(url: string, rect: [number, number, number, number] | null): Promise<{ datos: string; ancho: number; alto: number } | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    let [sx, sy, sw, sh] = [0, 0, bmp.width, bmp.height];
    if (rect) {
      sx = (rect[0] / 100) * bmp.width;
      sy = (rect[1] / 100) * bmp.height;
      sw = ((rect[2] - rect[0]) / 100) * bmp.width;
      sh = ((rect[3] - rect[1]) / 100) * bmp.height;
    }
    if (sw <= 0 || sh <= 0) return null;
    const MAX = 600;
    const k = Math.min(1, MAX / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * k));
    canvas.height = Math.max(1, Math.round(sh * k));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return { datos: canvas.toDataURL("image/jpeg", 0.85), ancho: canvas.width, alto: canvas.height };
  } catch {
    return null;
  }
}

/** Entradas del índice general. */
interface LineaIndice {
  texto: string;
  nivel: number;
  pagina: number;
}

/** Genera el libro y lo descarga. */
export async function exportarLibro(
  arbol: Arbol, libro: Libro, opciones: OpcionesLibro & OpcionesPdfLibro, simbolos: PresentacionCajas,
  privadas: ReadonlySet<string>, dibujo: Dibujo, fichero: string, avance: (a: Avance) => void,
): Promise<ResultadoLibro> {
  avance({ texto: t("libro.avance.preparando") });
  const { crear, svg2pdf } = await nuevoDocumento();
  // En los árboles insertados, las fechas con el mes abreviado.
  const cajas: PresentacionCajas = { ...simbolos, formato: "abreviado" };
  // Sin ascendientes ni descendientes (de los del alcance), no hay árbol:
  // sería una sola caja (decisión del 23/10/2026).
  const conPadres = arbol.familiasPadres(opciones.persona).some((f) => arbol.padre(f) || arbol.madre(f));
  const conHijos = arbol.familiasPropias(opciones.persona).some((f) => arbol.hijos(f).length > 0);
  const conArbol = opciones.arboles && (opciones.alcance === "ascendientes" ? conPadres : opciones.alcance === "descendientes" ? conHijos : conPadres || conHijos);
  // El árbol, con la generación de la persona además de las del libro.
  const generacionesArbol = opciones.generaciones + 1;
  const [ancho, alto] = PAPER_SIZES[opciones.papel];
  const nuevaMaqueta = async () => {
    const d = crear(ancho, alto);
    await registerPdfFonts(d);
    await registrarSimbolosPdf(d);
    return new Maqueta(d, opciones.papel);
  };
  const m = await nuevaMaqueta();
  const doc = m.doc;

  // Fotos, antes de maquetar (hay que saber su tamaño).
  const fotos = new Map<string, { datos: string; ancho: number; alto: number } | null>();
  const pendientes = libro.partes.flatMap((p) => p.parrafos).flatMap((p) => (p.tipo === "fotos" ? p.fotos : []));
  for (const [i, f] of pendientes.entries()) {
    const clave = `${f.handle}|${f.rect?.join(",") ?? ""}`;
    if (fotos.has(clave)) continue;
    avance({ texto: t("libro.avance.fotos", { n: i + 1, total: pendientes.length }) });
    const url = await dibujo.photoUrl(f.handle);
    fotos.set(clave, url ? await prepararFoto(url, f.rect) : null);
  }

  // Índice general: sus líneas, para saber cuántas páginas reservar.
  const nombrePrincipal = arbol.nombre(opciones.persona);
  const lineasIndice = (): Omit<LineaIndice, "pagina">[] => {
    const out: Omit<LineaIndice, "pagina">[] = [];
    for (const parte of libro.partes) {
      if (parte.direccion === "principal") {
        out.push({ texto: nombrePrincipal, nivel: 0 });
        if (conArbol) out.push({ texto: t("libro.arbol"), nivel: 0 });
        continue;
      }
      out.push({ texto: t(`libro.parte.${parte.direccion}`), nivel: 0 });
      for (const p of parte.parrafos) if (p.tipo === "generacion") out.push({ texto: p.texto, nivel: 1 });
    }
    out.push({ texto: t("libro.indicePersonas"), nivel: 0 });
    if (opciones.indiceLugares) out.push({ texto: t("libro.indiceLugares"), nivel: 0 });
    return out;
  };
  const util = alto - MARGEN_ARRIBA - MARGEN_ABAJO - altoLinea(LETRA.parte) - 6;
  const paginasIndice = Math.max(1, Math.ceil((lineasIndice().length * (altoLinea(LETRA.texto) + 2.5)) / util));

  // Portada (pág. 1) y páginas en blanco para el índice general.
  let y = alto * 0.35;
  y = m.centrado(opciones.titulo, 24, true, y);
  if (opciones.subtitulo) y = m.centrado(opciones.subtitulo, 14, false, y + 4);
  const fecha = (d: Date) => d.toLocaleDateString(idioma().intl, { dateStyle: "long" });
  y = m.centrado(t("libro.portada.generado", { fecha: fecha(new Date()) }), 10, false, alto * 0.75);
  y = m.centrado(t("libro.portada.datos", { arbol: opciones.nombreArbol, fecha: fecha(new Date(arbol.generada)) }), 9, false, y + 1);
  if (opciones.sinVivos) m.centrado(t("libro.portada.sinVivos"), 9, false, y + 1);
  for (let i = 0; i < paginasIndice; i++) m.nuevaPagina();

  const indice: LineaIndice[] = [];
  let arbolComoImagen = false;

  for (const parte of libro.partes) {
    if (parte.direccion !== "principal") {
      avance({ texto: t("libro.avance.texto", { parte: t(`libro.parte.${parte.direccion}`) }) });
      m.nuevaPagina();
      indice.push({ texto: t(`libro.parte.${parte.direccion}`), nivel: 0, pagina: m.pagina });
      escribirParte(m, parte.parrafos, fotos, indice);
      continue;
    }
    // La página de la persona principal y, detrás, el árbol.
    avance({ texto: t("libro.avance.texto", { parte: nombrePrincipal }) });
    const plan: Plan | null = conArbol
      ? planificarPaginas({
        arbol, persona: opciones.persona, tipo: opciones.alcance, generaciones: generacionesArbol, simbolos: cajas,
        papel: opciones.papel, orientacion: "auto", disposicion: dibujo.layout, continua: () => "", privadas,
      })
      : null;
    // Cuántas páginas ocupa la principal: se maqueta en uno de prueba, con
    // una remisión al árbol del mismo largo.
    let desplazamiento = 0;
    if (plan) {
      const prueba = await nuevaMaqueta();
      for (const [h, pagina] of paginaDePersonas(plan)) prueba.anclas.set(anclaArbol(h), pagina + 999);
      escribirParte(prueba, parte.parrafos, fotos, []);
      desplazamiento = doc.getNumberOfPages() + prueba.doc.getNumberOfPages();
      for (const [h, pagina] of paginaDePersonas(plan)) m.anclas.set(anclaArbol(h), pagina + desplazamiento);
    }
    m.nuevaPagina();
    indice.push({ texto: nombrePrincipal, nivel: 0, pagina: m.pagina });
    escribirParte(m, parte.parrafos, fotos, indice);
    if (!plan) continue;
    if (doc.getNumberOfPages() !== desplazamiento) throw new Error("La página principal no ocupa lo calculado");
    const conPaginas: Plan = planificarPaginas({
      arbol, persona: opciones.persona, tipo: opciones.alcance, generaciones: generacionesArbol, simbolos: cajas,
      papel: opciones.papel, orientacion: "auto", disposicion: dibujo.layout,
      continua: (n) => t("pdf.continua", { n: n + desplazamiento }), privadas,
    });
    const subtitulo = t("libro.subtituloArbol", { n: generacionesArbol });
    const todos = textosPlan(arbol, conPaginas, opciones.persona, opciones.alcance, subtitulo, desplazamiento, false);
    indice.push({ texto: t("libro.arbol"), nivel: 0, pagina: desplazamiento + 1 });
    const comoImagen = await dibujarPaginasArbol(
      doc, svg2pdf, conPaginas, opciones.papel, todos, PDF_FONT_FAMILY, dibujo,
      (hecho, total) => avance({ texto: t("libro.avance.arbol", { n: Math.min(hecho + 1, total), total }) }),
      true,
    );
    if (comoImagen) arbolComoImagen = true;
  }

  // Índices alfabéticos.
  avance({ texto: t("libro.avance.indices") });
  m.nuevaPagina();
  indice.push({ texto: t("libro.indicePersonas"), nivel: 0, pagina: m.pagina });
  m.parrafo([{ texto: t("libro.indicePersonas") }], { pt: LETRA.parte, negrita: true });
  m.espacio(3);
  const personas = [...m.personas.entries()]
    .map(([h, e]) => ({ p: arbol.persona(h)!, e }))
    .filter((x) => x.p)
    .map(({ p, e }) => {
      const nac = privadas.has(p.handle) ? null : anio(arbol.nacimiento(p)?.evento.date);
      const anos = aniosIndice(arbol, p, privadas);
      const n = p.primary_name;
      const orden = arbol.apellidos(n);
      // El ID, solo con «Incluir identificadores» (30/10/2026).
      const id = opciones.ids ? ` [${p.gramps_id}]` : "";
      return { orden, otra: otraEscritura(orden), pila: [n.first_name, n.suffix].join(" "), texto: arbol.nombreOrden(p) + anos + id, e, anio: nac ?? 0 };
    })
    // Por apellidos (los de otras escrituras, al final), después por nombre
    // y, entre homónimos, por año.
    .sort((a, b) => Number(a.otra) - Number(b.otra) || comparador.compare(a.orden, b.orden) || comparador.compare(a.pila, b.pila) || a.anio - b.anio);
  escribirIndice(m, personas);
  if (opciones.indiceLugares) {
    m.nuevaPagina();
    indice.push({ texto: t("libro.indiceLugares"), nivel: 0, pagina: m.pagina });
    m.parrafo([{ texto: t("libro.indiceLugares") }], { pt: LETRA.parte, negrita: true });
    m.espacio(3);
    const lugares = [...m.lugares.entries()]
      .map(([h, e]) => ({ orden: arbol.tituloLugar(h), otra: otraEscritura(arbol.tituloLugar(h)), texto: arbol.tituloLugar(h), e, anio: 0 }))
      .sort((a, b) => Number(a.otra) - Number(b.otra) || comparador.compare(a.orden, b.orden));
    escribirIndice(m, lugares);
  }

  // Índice general, en las páginas reservadas.
  const total = doc.getNumberOfPages();
  doc.setPage(2);
  m.irA(MARGEN_ARRIBA);
  m.parrafo([{ texto: t("libro.indice") }], { pt: LETRA.parte, negrita: true });
  m.espacio(4);
  let reservada = 2;
  for (const l of indice) {
    if (m.yActual + altoLinea(LETRA.texto) > alto - MARGEN_ABAJO && reservada < 1 + paginasIndice) {
      doc.setPage(++reservada);
      m.irA(MARGEN_ARRIBA);
    }
    if (l.nivel === 0) m.espacio(2);
    m.lineaConPagina(l.texto, l.pagina, { pt: LETRA.texto, sangria: l.nivel * SANGRIA, negrita: l.nivel === 0 });
  }
  // Marcadores del PDF (el panel lateral del lector).
  let padre: unknown = null;
  for (const l of indice) {
    const item = doc.outline.add(l.nivel === 0 ? null : padre, l.texto, { pageNumber: l.pagina });
    if (l.nivel === 0) padre = item;
  }

  // Pie en todas las páginas menos la portada.
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    m.pie(t("pdf.pie", { n: i, total }));
  }

  doc.setProperties({ title: opciones.titulo, subject: opciones.subtitulo });
  saveBlob(doc.output("blob"), `${fichero}.pdf`);
  return { paginas: total, arbolComoImagen, sinLetra: [...m.sinLetra] };
}

function escribirParte(
  m: Maqueta, parrafos: Parrafo[],
  fotos: Map<string, { datos: string; ancho: number; alto: number } | null>, indice: LineaIndice[],
) {
  // Sustituye «{pagina}» por la página del ancla; sin ancla, quita el trozo.
  const resolver = (trozos: Trozo[]): Trozo[] => trozos.flatMap((tr) => {
    if (!tr.ancla) return [tr];
    const pagina = m.anclas.get(tr.ancla);
    return pagina === undefined ? [] : [{ ...tr, texto: tr.texto.replace("{pagina}", String(pagina)), enlace: pagina }];
  });
  let primera = true;
  for (const [i, p] of parrafos.entries()) {
    const siguiente = parrafos[i + 1];
    switch (p.tipo) {
      case "parte":
        m.parrafo([{ texto: p.texto }], { pt: LETRA.parte, negrita: true });
        m.espacio(2);
        break;
      case "generacion": {
        if (!primera) m.espacio(5);
        primera = false;
        // Que no quede sola al pie de la página.
        m.parrafo([{ texto: p.texto }], { pt: LETRA.generacion, negrita: true, mantener: 3 * altoLinea(LETRA.texto) });
        indice.push({ texto: p.texto, nivel: 1, pagina: m.pagina });
        m.espacio(1);
        break;
      }
      case "entrada":
        m.espacio(3);
        m.parrafo(
          [{ texto: `${p.numero} `, negrita: true }, ...resolver(p.trozos)],
          { pt: LETRA.entrada, principal: p.persona, mantener: siguiente?.tipo === "fotos" ? ALTO_FOTO : altoLinea(LETRA.texto) },
        );
        m.anclas.set(p.ancla, m.pagina);
        break;
      case "texto":
        m.parrafo(resolver(p.trozos), {
          pt: p.pequeno ? LETRA.pequena : LETRA.texto, sangria: p.sangria * SANGRIA, vineta: p.vineta,
        });
        break;
      case "fotos":
        m.fotos(
          p.fotos.flatMap((f) => {
            const im = fotos.get(`${f.handle}|${f.rect?.join(",") ?? ""}`);
            return im ? [{ ...im, pie: f.pie }] : [];
          }),
          SANGRIA,
        );
        break;
    }
  }
}

/** ¿Empieza por una letra que no es latina (cirílico, hebreo, griego…)?
 * Esas entradas van al final del índice, bajo «Otras escrituras»
 * (decisión del 23/10/2026: una inicial parecida, como la «Т» cirílica,
 * no debe mezclarse con la latina). */
function otraEscritura(texto: string): boolean {
  const c = texto.trim().charAt(0);
  return /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c);
}

/** Índice alfabético, a dos columnas, con letras de sección y las páginas
 * de cada entrada (en negrita, la de su entrada propia). Las que empiezan
 * por otra escritura, al final, juntas bajo «Otras escrituras». */
function escribirIndice(m: Maqueta, entradas: { orden: string; otra: boolean; texto: string; e: EntradaIndice }[]) {
  m.enColumnas(2);
  let letra = "";
  for (const { orden, otra, texto, e } of entradas) {
    const inicial = otra ? t("libro.otrasEscrituras") : normalizar(orden.trim().charAt(0) || "?").toUpperCase();
    if (inicial !== letra) {
      letra = inicial;
      m.espacio(2);
      m.parrafo([{ texto: letra }], { pt: LETRA.generacion, negrita: true, mantener: altoLinea(LETRA.indice) });
    }
    const paginas = [...e.paginas].sort((a, b) => a - b);
    const trozos: Trozo[] = [{ texto: `${texto}  ` }];
    paginas.forEach((pg, i) => {
      trozos.push({ texto: String(pg), negrita: e.principales.has(pg), enlace: pg });
      if (i < paginas.length - 1) trozos.push({ texto: ", " });
    });
    m.parrafo(trozos, { pt: LETRA.indice, francesa: SANGRIA });
  }
  m.enColumnas(1);
}
