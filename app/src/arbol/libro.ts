// Contenido del libro en PDF, sin maquetar (la maqueta y el PDF están en
// app/src/componentes/pdfLibro.ts). Decisiones del 22/10/2026
// (docs/decisiones-web-familiar.md, «PDF: árbol y libro» y «Libro:
// detalles»; explicación en docs/libro.md):
//
// - Como el «Informe detallado» de ascendientes y de descendientes de
//   Gramps: por generaciones; cada persona con su número, sus datos, sus
//   cónyuges, los hijos de cada pareja y sus notas.
// - Numeración Sosa-Stradonitz en los ascendientes (padre 2n, madre 2n+1)
//   y d'Aboville en los descendientes (1, 1.1, 1.2, 1.1.1…).
// - En frases, como el informe detallado de Gramps en castellano («Nació el
//   3 de mayo de 1950 en Madrid.»), con las reglas de la web para lo que
//   falta (decisión del 22/10/2026, «Libro: respuestas…»): el nacimiento
//   siempre, aunque no haya datos; la defunción si la hay; si no hay
//   nacimiento, el bautismo, y si no hay defunción, el entierro o la
//   incineración. Los demás eventos (con «todos»), en lista con su rótulo,
//   como «Más sobre…» en Gramps, sin los que no tienen ningún dato.
// - Sexo desconocido: formas neutras («Su cuerpo fue incinerado», «Sus
//   padres eran X e Y»; decisión del 23/10/2026).
// - Persona viva omitida: solo su nombre y «Persona viva».
//
// Una persona que sale dos veces en la misma parte (antepasados repetidos,
// primos casados entre sí) tiene su entrada completa la primera vez; la
// segunda remite a la primera, como hace Gramps.
//
// Estructura (decisión del 30/10/2026, «Libro: estructura nueva»): primero
// la página de la persona principal (su entrada, n.º 1, sin título de
// generación, con sus hijos solo con los datos principales y, si el libro
// tiene descendientes, su número); después, en la maqueta, el árbol; después
// las partes de ascendientes (Generación 1 = padres) y de descendientes
// (Generación 1 = hijos), sin la persona principal.

import { nombreTipo, t, type Clave, type TipoGramps } from "../i18n";
import { descripcionFoto, type Arbol, type ClasePareja } from "./arbol";
import { anioSuelto, fraseFecha, hayFecha, porFecha } from "./fechas";
import type { TipoGrafico } from "./grafico";
import type { Base, Evento, Familia, MediaRef, Persona } from "./tipos";

export type Direccion = "ascendientes" | "descendientes";
/** La página de la persona principal o una de las dos partes. */
export type TipoParte = "principal" | Direccion;

export interface OpcionesLibro {
  persona: Persona;
  alcance: TipoGrafico;
  /** Generaciones desde los padres o los hijos (Generación 1); el árbol
   * insertado lleva una más, la de la persona (decisión del 30/10/2026). */
  generaciones: number;
  /** Todos los eventos, o solo nacimiento, boda y defunción. */
  eventos: "todos" | "principales";
  notas: boolean;
  fotos: "ninguna" | "principal" | "todas";
  arboles: boolean;
  indiceLugares: boolean;
  /** El ID de Gramps junto al nombre de cada entrada y en el índice de
   * personas (solo el administrador, con la casilla; 30/10/2026). */
  ids?: boolean;
}

/** Un trozo de texto. `persona` y `lugar` lo anotan en los índices; `ancla`
 * pide sustituir «{pagina}» por la página de esa ancla (una entrada
 * anterior o la página del árbol insertado donde sale una persona). */
export interface Trozo {
  texto: string;
  negrita?: boolean;
  persona?: string;
  lugar?: string;
  ancla?: string;
  /** Página a la que enlaza (lo pone la maqueta al resolver el ancla). */
  enlace?: number;
}

export interface Foto {
  handle: string;
  rect: MediaRef["rect"];
  /** Pie de foto: la descripción del objeto multimedia (o ""). */
  pie: string;
}

export type Parrafo =
  | { tipo: "parte"; direccion: Direccion; texto: string }
  | { tipo: "generacion"; texto: string }
  /** Cabecera de una persona: número y nombre en negrita. `ancla`, para
   * remitir a ella. */
  | { tipo: "entrada"; numero: string; trozos: Trozo[]; persona: string; ancla: string }
  /** Línea de datos, con sangría (1 = bajo la entrada; 2 = más adentro) y,
   * en las listas, una viñeta («i.», «ii.»…). */
  | { tipo: "texto"; trozos: Trozo[]; sangria: number; vineta?: string; pequeno?: boolean }
  | { tipo: "fotos"; fotos: Foto[] };

export interface Parte {
  direccion: TipoParte;
  /** Personas de la parte, por generación (para el índice general). */
  generaciones: number;
  parrafos: Parrafo[];
}

export interface Libro {
  partes: Parte[];
}

const ROL_PRINCIPAL = 1;
// EventType de Gramps.
const EV = { NACIMIENTO: 12, DEFUNCION: 13, BAUTISMO: 15, ENTIERRO: 19, BAUTIZO: 22 };

/** Frase de la pareja según su tipo (decisión del 24/10/2026, «Tipos de
 * relación de pareja»). */
const FRASE_PAREJA: Record<ClasePareja, string> = {
  matrimonio: "casado", pareja: "pareja", sinRelacion: "sinRelacion", desconocida: "relacion",
};

type Genero = 0 | 1 | 2;
const genero = (p: Persona): Genero => (p.gender === 0 || p.gender === 1 ? p.gender : 2);

/** El verbo de la frase de un evento vital, sin sujeto y en minúscula
 * (los demás tipos que llegan aquí son la incineración). */
function verbo(tipo: number, g: Genero): string {
  switch (tipo) {
    case EV.NACIMIENTO: return t("libro.frase.nacio");
    case EV.BAUTISMO: case EV.BAUTIZO: return t(`libro.frase.bautizo.${g}` as Clave);
    case EV.DEFUNCION: return t("libro.frase.fallecio");
    case EV.ENTIERRO: return t("libro.frase.entierro");
    default: return t(`libro.frase.incineracion.${g}` as Clave);
  }
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «y» o «e» delante de `siguiente`: «e» si empieza por el sonido «i»
 * («Juan e Inés», «Pedro e Hilda»), salvo si forma diptongo («Ana y
 * Iolanda», «y hielo»). */
export function conjuncionY(siguiente: string): string {
  const s = siguiente.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/^h?i[aeiou]/.test(s)) return "y";
  return /^h?i/.test(s) ? "e" : "y";
}

/** Una plantilla con huecos («Es hijo de {padres}.») rellenos con trozos. */
function plantilla(clave: Clave, huecos: Record<string, Trozo[]>): Trozo[] {
  const out: Trozo[] = [];
  for (const pieza of t(clave).split(/(\{\w+\})/)) {
    const hueco = /^\{(\w+)\}$/.exec(pieza);
    if (hueco && huecos[hueco[1]]) out.push(...huecos[hueco[1]]);
    else if (pieza) out.push({ texto: pieza });
  }
  return out;
}

/** Ancla de la entrada de una persona en una parte (la n.º 1, en la página
 * de la persona principal). */
export const anclaEntrada = (direccion: TipoParte, numero: string) => (numero === "1" ? "principal:1" : `${direccion}:${numero}`);
/** Ancla de la página del árbol insertado donde sale una persona. */
export const anclaArbol = (handle: string) => `arbol:${handle}`;

/** Números romanos en minúscula, para las listas de hijos (como Gramps). */
export function romano(n: number): string {
  const tabla: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let s = "";
  for (const [v, r] of tabla) while (n >= v) { s += r; n -= v; }
  return s;
}

interface EntradaPlan {
  numero: string;
  persona: Persona;
  generacion: number;
  /** Número de la primera vez que sale, si es una repetición. */
  repiteA?: string;
}

/** Ascendientes por Sosa: la persona (generación 0) y `generaciones`
 * generaciones más. */
function planAscendientes(arbol: Arbol, raiz: Persona, generaciones: number): EntradaPlan[] {
  const out: EntradaPlan[] = [];
  const primera = new Map<string, string>();
  let nivel: { n: bigint; p: Persona }[] = [{ n: 1n, p: raiz }];
  for (let g = 0; g <= generaciones && nivel.length; g++) {
    const siguiente: typeof nivel = [];
    for (const { n, p } of nivel.sort((a, b) => (a.n < b.n ? -1 : 1))) {
      const numero = n.toString();
      const ya = primera.get(p.handle);
      if (ya) {
        out.push({ numero, persona: p, generacion: g, repiteA: ya });
        continue;
      }
      primera.set(p.handle, numero);
      out.push({ numero, persona: p, generacion: g });
      const f = arbol.familiasPadres(p)[0];
      if (!f) continue;
      const padre = arbol.padre(f);
      const madre = arbol.madre(f);
      if (padre) siguiente.push({ n: 2n * n, p: padre });
      if (madre) siguiente.push({ n: 2n * n + 1n, p: madre });
    }
    nivel = siguiente;
  }
  return out;
}

/** Descendientes por d'Aboville: la persona (generación 0) y
 * `generaciones` generaciones más. Los hijos se numeran por orden en todas
 * las familias de la persona, por fecha de boda (Arbol.familiasPorBoda). */
function planDescendientes(arbol: Arbol, raiz: Persona, generaciones: number): EntradaPlan[] {
  const out: EntradaPlan[] = [];
  const primera = new Map<string, string>();
  let nivel: { numero: string; p: Persona }[] = [{ numero: "1", p: raiz }];
  for (let g = 0; g <= generaciones && nivel.length; g++) {
    const siguiente: typeof nivel = [];
    for (const { numero, p } of nivel) {
      const ya = primera.get(p.handle);
      if (ya) {
        out.push({ numero, persona: p, generacion: g, repiteA: ya });
        continue;
      }
      primera.set(p.handle, numero);
      out.push({ numero, persona: p, generacion: g });
      let i = 0;
      for (const f of arbol.familiasPorBoda(p)) {
        for (const h of arbol.hijos(f)) siguiente.push({ numero: `${numero}.${++i}`, p: h.persona });
      }
    }
    nivel = siguiente;
  }
  return out;
}

/** Construye el libro. `privadas`: personas vivas cuyos datos se omiten
 * (vacío si se incluyen todos). `vivas`: las que se consideran vivas, para
 * el tiempo del verbo («Es hijo de…» o «Era hijo de…», como Gramps) y, si
 * se dan, para que las demás salgan como fallecidas aunque no tengan
 * defunción («Falleció; no constan la fecha ni el lugar.», decisión del
 * 29/10/2026). Sin ellas, el tiempo sale de `privadas`. */
export function construirLibro(
  arbol: Arbol, o: OpcionesLibro, privadas: ReadonlySet<string>, vivas?: ReadonlySet<string>,
): Libro {
  const direcciones: Direccion[] = o.alcance === "ambos" ? ["ascendientes", "descendientes"] : [o.alcance];
  const planes = direcciones.map((direccion) => ({
    direccion,
    plan: direccion === "ascendientes"
      ? planAscendientes(arbol, o.persona, o.generaciones)
      : planDescendientes(arbol, o.persona, o.generaciones),
  }));
  const conDescendientes = direcciones.includes("descendientes");
  const redactor = (tipo: TipoParte, plan: EntradaPlan[], numeros: Map<string, string>) =>
    new Redactor(arbol, o, privadas, vivas ?? privadas, !!vivas, tipo, plan, numeros, conDescendientes).parte();
  const numerosDe = (plan: EntradaPlan[], hasta = Infinity) =>
    plan.filter((e) => !e.repiteA && e.generacion <= hasta).map((e) => [e.persona.handle, e.numero] as const);
  // En la página de la persona principal, los números de sus padres (Sosa)
  // y de sus hijos (d'Aboville).
  const principal = redactor(
    "principal", [{ numero: "1", persona: o.persona, generacion: 0 }],
    new Map(planes.flatMap(({ plan }) => numerosDe(plan, 1)).reverse()),
  );
  // En cada parte, sin la persona principal (está en su página).
  return {
    partes: [principal, ...planes.map(({ direccion, plan }) => redactor(direccion, plan.filter((e) => e.generacion > 0), new Map(numerosDe(plan))))],
  };
}

class Redactor {
  private readonly parrafos: Parrafo[] = [];
  /** Familias cuyos hijos ya se han listado (en la entrada del primer
   * cónyuge que sale). */
  private readonly familiasListadas = new Map<string, string>();

  constructor(
    private readonly a: Arbol, private readonly o: OpcionesLibro,
    private readonly privadas: ReadonlySet<string>, private readonly vivas: ReadonlySet<string>,
    /** Las que no están en `vivas`, como fallecidas aunque no tengan defunción. */
    private readonly fallecidasSinDefuncion: boolean, private readonly direccion: TipoParte,
    private readonly plan: EntradaPlan[],
    /** Número de cada persona con entrada propia (la principal, «1»). */
    private readonly numeroDe: Map<string, string>,
    /** El libro tiene descendientes: la página principal da sus números. */
    private readonly conDescendientes: boolean,
  ) {}

  parte(): Parte {
    if (this.direccion === "principal") {
      this.entrada(this.plan[0]);
      return { direccion: this.direccion, generaciones: 0, parrafos: this.parrafos };
    }
    this.parrafos.push({ tipo: "parte", direccion: this.direccion, texto: t(`libro.parte.${this.direccion}` as Clave) });
    if (!this.plan.length) this.texto([{ texto: t(this.direccion === "ascendientes" ? "libro.sinAscendientes" : "libro.sinDescendientes") }]);
    let generacion = 0;
    for (const e of this.plan) {
      if (e.generacion !== generacion) {
        generacion = e.generacion;
        this.parrafos.push({ tipo: "generacion", texto: t("libro.generacion", { n: generacion }) });
      }
      this.entrada(e);
    }
    return { direccion: this.direccion, generaciones: generacion, parrafos: this.parrafos };
  }

  private privada(p: Persona): boolean {
    return this.privadas.has(p.handle);
  }

  /** «Nombre (n.º 12)» si tiene entrada en esta parte; si no, el nombre. */
  private mencion(p: Persona | null, negrita = false): Trozo[] {
    if (!p) return [{ texto: t("ficha.desconocido") }];
    const nombre: Trozo = { texto: this.a.nombre(p), persona: p.handle, negrita };
    const n = this.numeroDe.get(p.handle);
    return n ? [nombre, { texto: ` (${t("libro.numero", { n })})` }] : [nombre];
  }

  private texto(trozos: Trozo[], sangria = 1, extra: { vineta?: string; pequeno?: boolean } = {}) {
    this.parrafos.push({ tipo: "texto", trozos, sangria, ...extra });
  }

  /** «Rótulo: fecha, lugar», con el lugar anotado para su índice (para la
   * lista de los demás eventos). */
  private dato(rotulo: string, ev: Evento): Trozo[] {
    const d = this.a.datoVital({ evento: ev, sustituto: false }, rotulo);
    if (!d.lugar || d.falta) return [{ texto: `${d.rotulo}: ${d.texto}` }];
    return [{ texto: `${d.rotulo}: ${d.fecha || t("ficha.sinFecha")}, ` }, { texto: d.lugar, lugar: ev.place }];
  }

  /** «nació el 3 de mayo de 1950 en Madrid.», sin sujeto: el verbo, la
   * fecha («el …», «en …», «hacia …») y el lugar; si no hay ni fecha ni
   * lugar, «falleció; no constan la fecha ni el lugar.». */
  private suceso(ev: Evento, g: Genero): Trozo[] {
    const v = verbo(ev.type.value, g);
    const fecha = fraseFecha(ev.date);
    const lugar = this.a.tituloLugar(ev.place);
    if (!fecha && !lugar) return [{ texto: `${v}; ${t("libro.frase.sinDatos")}.` }];
    return [{ texto: v }, ...this.cuandoDonde(fecha, lugar, ev.place), { texto: "." }];
  }

  /** « el 3 de mayo de 1950 en Madrid»: la fecha de fraseFecha y el lugar,
   * anotado para su índice. Una fecha que es solo texto («(fecha: en la
   * guerra)») va detrás del lugar. */
  private cuandoDonde(fecha: string, lugar: string, handleLugar: string | null): Trozo[] {
    const soloTexto = fecha.startsWith("(");
    const out: Trozo[] = [];
    if (fecha && !soloTexto) out.push({ texto: ` ${fecha}` });
    if (lugar) out.push({ texto: ` ${t("libro.frase.en")} ` }, { texto: lugar, lugar: handleLugar ?? undefined });
    if (soloTexto) out.push({ texto: ` ${fecha}` });
    return out;
  }

  /** «Se divorciaron el 3 de mayo de 1980 en Madrid.»; sin fecha ni lugar,
   * «Se divorciaron; no constan la fecha ni el lugar.». */
  private sucesoPareja(ev: Evento, frase: string): Trozo[] {
    const fecha = fraseFecha(ev.date);
    const lugar = this.a.tituloLugar(ev.place);
    if (!fecha && !lugar) return [{ texto: `${frase}; ${t("libro.frase.sinDatos")}.` }];
    return [{ texto: frase }, ...this.cuandoDonde(fecha, lugar, ev.place), { texto: "." }];
  }

  /** La frase con sujeto («Juan López nació…») o sin él («Nació…»). */
  private frase(trozos: Trozo[], sujeto: Trozo[] | null): Trozo[] {
    if (sujeto) return [...sujeto, { texto: " " }, ...trozos];
    const [primero, ...resto] = trozos;
    return [{ ...primero, texto: mayuscula(primero.texto) }, ...resto];
  }

  /** Añade a `salida` las frases del nacimiento (o el bautismo) y de la
   * defunción (o el entierro o la incineración), con las reglas de la web:
   * el nacimiento siempre, aunque no haya datos; la defunción, si la hay o
   * si no se considera viva.
   * El sujeto, si se da, solo en la primera frase (como Gramps). Devuelve
   * los eventos que ya han salido. */
  private vitales(p: Persona, sujeto: Trozo[] | null, salida: Trozo[]): Set<string> {
    const mostrados = new Set<string>();
    const g = genero(p);
    const separar = () => { if (salida.length) salida.push({ texto: " " }); };
    const nac = this.a.nacimiento(p);
    separar();
    if (nac && !this.a.lineaNacimiento(p).falta) {
      salida.push(...this.frase(this.suceso(nac.evento, g), sujeto));
    } else if (sujeto) {
      salida.push(...plantilla("libro.frase.nacimientoSinDatosDe", { nombre: sujeto }));
    } else {
      salida.push({ texto: t("libro.frase.nacimientoSinDatos") });
    }
    if (nac) mostrados.add(nac.evento.handle);
    const def = this.a.defuncion(p);
    if (def) {
      separar();
      salida.push(...this.frase(this.suceso(def.evento, g), null));
      mostrados.add(def.evento.handle);
    } else if (this.fallecidasSinDefuncion && !this.vivas.has(p.handle)) {
      // No se considera viva: como una defunción sin fecha ni lugar.
      separar();
      salida.push(...this.frase([{ texto: `${verbo(EV.DEFUNCION, g)}; ${t("libro.frase.sinDatos")}.` }], null));
    }
    return mostrados;
  }

  /** Añade a `salida` «Es hijo de X (n.º 2) y de Y (n.º 3).» («Era…» si no
   * se considera viva, como Gramps); con sexo desconocido, «Sus padres
   * eran X e Y.». */
  private padres(p: Persona, salida: Trozo[]) {
    const f = this.a.familiasPadres(p)[0];
    if (!f) return;
    const padre = this.a.padre(f);
    const madre = this.a.madre(f);
    if (!padre && !madre) return;
    const neutra = genero(p) === 2;
    const padres: Trozo[] = [];
    if (padre) padres.push(...this.mencion(padre));
    if (padre && madre) padres.push({ texto: neutra ? ` ${conjuncionY(this.a.nombre(madre))} ` : t("libro.frase.yDe") });
    if (madre) padres.push(...this.mencion(madre));
    // Uno solo, con sexo desconocido: «Su padre era X» o «Su madre era Y».
    if (neutra && !(padre && madre)) {
      const tiempoUno = this.vivas.has(p.handle) ? "es" : "era";
      if (salida.length) salida.push({ texto: " " });
      salida.push(...plantilla(`libro.frase.${padre ? "padre" : "madre"}.${tiempoUno}` as Clave, { padres }));
      return;
    }
    const tiempo = this.vivas.has(p.handle) ? "es" : "era";
    if (salida.length) salida.push({ texto: " " });
    salida.push(...plantilla(`libro.frase.hijo.${tiempo}.${genero(p)}` as Clave, { padres }));
  }

  /** Un evento cualquiera: «Tipo: fecha, lugar. Descripción» y, si la
   * persona no es la protagonista, su papel. */
  private evento(ev: Evento, rol: TipoGramps | null): Trozo[] {
    const trozos = this.dato(nombreTipo(ev.type), ev);
    // La descripción, solo con todos los eventos (en el resto, Gramps suele
    // traer un texto automático como «Boda de X e Y»).
    const extra = [this.o.eventos === "todos" ? ev.description : "", rol && rol.value !== ROL_PRINCIPAL ? nombreTipo(rol) : ""].filter(Boolean);
    if (extra.length) trozos.push({ texto: `. ${extra.join(". ")}` });
    return trozos;
  }

  private notas(obj: Base, sangria: number) {
    if (!this.o.notas) return;
    const notas = this.a.notasDe(obj);
    if (notas.length) this.texto([{ texto: `${t("ficha.notas")}:` }], sangria);
    for (const nota of notas) {
      for (const linea of nota.text.string.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
        this.texto([{ texto: linea }], sangria, { pequeno: true });
      }
    }
  }

  private fotos(p: Persona) {
    if (this.o.fotos === "ninguna") return;
    const fotos: Foto[] = [];
    for (const r of p.media_list) {
      const m = this.a.multimedia.get(r.ref);
      if (!this.a.esImagen(m)) continue;
      // Sin pie si la descripción es una ruta o un nombre de fichero.
      fotos.push({ handle: r.ref, rect: r.rect, pie: descripcionFoto(m!) });
      if (this.o.fotos === "principal") break;
    }
    if (fotos.length) this.parrafos.push({ tipo: "fotos", fotos });
  }

  /** Las frases de una persona sin entrada propia (un cónyuge o un hijo),
   * o «Persona viva.». */
  private resumen(p: Persona, sujeto: Trozo[] | null): Trozo[] {
    if (this.privada(p)) return [{ texto: `${t("libro.personaViva")}.` }];
    const salida: Trozo[] = [];
    this.vitales(p, sujeto, salida);
    return salida;
  }

  private entrada(e: EntradaPlan) {
    const p = e.persona;
    const ancla = anclaEntrada(this.direccion, e.numero);
    const cabecera: Trozo[] = [{ texto: this.a.nombre(p), persona: p.handle, negrita: true }];
    if (this.o.ids) cabecera.push({ texto: ` [${p.gramps_id}]` });
    // Sin la persona en el árbol, la maqueta quita la remisión.
    if (this.o.arboles && !e.repiteA) cabecera.push({ texto: `  (${t("libro.verArbol")})`, ancla: anclaArbol(p.handle) });
    this.parrafos.push({ tipo: "entrada", numero: `${e.numero}.`, trozos: cabecera, persona: p.handle, ancla });

    if (e.repiteA) {
      this.texto([{ texto: t("libro.mismaPersona", { n: e.repiteA }) }, { texto: t("libro.enPagina"), ancla: anclaEntrada(this.direccion, e.repiteA) }]);
      return;
    }
    if (this.privada(p)) {
      this.texto([{ texto: t("libro.personaViva") }]);
    } else {
      this.fotos(p);
      const salida: Trozo[] = [];
      // «Conocido como “Juancho”.», antes del nacimiento (27/10/2026).
      const mostrados = this.vitales(p, null, salida);
      this.padres(p, salida);
      this.texto(salida);
      this.notas(p, 1);
      if (this.o.eventos === "todos") {
        const otros = porFecha(p.event_ref_list
          .map((r) => ({ ev: this.a.eventos.get(r.ref), rol: r.role }))
          .filter((x): x is { ev: Evento; rol: TipoGramps } => !!x.ev && !mostrados.has(x.ev.handle) && this.conDatos(x.ev)), (x) => x.ev.date);
        if (otros.length) this.texto([{ texto: t("libro.masSobre", { nombre: this.a.nombre(p) }) }]);
        for (const { ev, rol } of otros) this.texto(this.evento(ev, rol), 2);
      }
    }
    // Sin hijos, lo dice la parte de descendientes («No constan…»).
    this.a.familiasPorBoda(p).forEach((f, i) => this.familia(p, f, i > 0));
  }

  /** ¿Tiene el evento algún dato (fecha, lugar o descripción)? Los que no
   * tienen ninguno no salen en las listas, salvo la defunción, que dice que
   * la persona ha fallecido (decisión del 23/10/2026). */
  private conDatos(ev: Evento): boolean {
    if (ev.type.value === EV.DEFUNCION) return true;
    return hayFecha(ev.date) || !!this.a.tituloLugar(ev.place) || !!ev.description.trim();
  }

  /** La frase de la pareja según su tipo: «Se casó con Y (n.º 3) el 3 de
   * mayo de 1950 en Madrid.», «Pareja de Y.», «Tuvo hijos con Y,
   * sin relación de pareja.» o «Mantuvo una relación con Y.»; después, «Se
   * divorciaron el…» y «Se separaron en…» si constan. Con las frases del
   * cónyuge si no tiene entrada propia; con «todos», los demás eventos de la
   * familia; y la lista de los hijos. */
  private familia(p: Persona, f: Familia, tambien: boolean) {
    const conyuge = this.a.conyuge(f, p);
    // Datos de la pareja (boda y demás eventos de familia): no si alguno de
    // los dos es una persona viva omitida.
    const privada = this.privada(p) || (!!conyuge && this.privada(conyuge));
    const pareja = this.a.pareja(f);
    const conBoda = pareja.clase === "matrimonio" || pareja.clase === "desconocida";
    const boda = privada ? null : pareja.boda;
    /** Los eventos que ya salen en las frases. */
    const enFrases = new Set<Evento>(boda ? [boda] : []);
    if (conyuge) {
      // Siempre «Se casó con…» y «Pareja de…», también en la segunda y
      // siguientes; «También…» solo en los demás tipos.
      const otra = tambien && (pareja.clase === "sinRelacion" || pareja.clase === "desconocida") ? "Tambien" : "";
      const salida = plantilla(`libro.frase.${FRASE_PAREJA[pareja.clase]}${otra}` as Clave, { conyuge: this.mencion(conyuge, true) });
      if (boda && conBoda) salida.push(...this.cuandoDonde(fraseFecha(boda.date), this.a.tituloLugar(boda.place), boda.place));
      salida.push({ texto: "." });
      for (const [ev, clave] of [[pareja.divorcio, "libro.frase.divorcio"], [pareja.separacion, "libro.frase.separacion"]] as const) {
        if (!ev || privada) continue;
        salida.push({ texto: " " }, ...this.sucesoPareja(ev, t(clave)));
        enFrases.add(ev);
      }
      if (!this.numeroDe.has(conyuge.handle)) {
        salida.push({ texto: " " }, ...this.resumen(conyuge, [{ texto: this.a.nombre(conyuge), persona: conyuge.handle }]));
        if (!this.privada(conyuge)) this.padres(conyuge, salida);
      }
      this.texto(salida);
    }
    if (!privada) {
      if (this.o.eventos === "todos") {
        for (const { evento } of porFecha(this.a.eventosFamilia(f), (e) => e.evento.date)) if (!enFrases.has(evento) && this.conDatos(evento)) this.texto(this.evento(evento, null), 2);
      }
      if (conyuge && !this.numeroDe.has(conyuge.handle)) this.notas(conyuge, 2);
      this.notas(f, 2);
    }
    const hijos = this.a.hijos(f);
    if (!hijos.length) return;
    if (this.direccion === "principal") {
      this.hijosPrincipal(f, hijos.map((h) => h.persona));
      return;
    }
    const listada = this.familiasListadas.get(f.handle);
    if (listada) {
      this.texto([{ texto: t("libro.hijosVer", { n: listada }) }], 2);
      return;
    }
    this.familiasListadas.set(f.handle, this.numeroDe.get(p.handle)!);
    this.texto([{ texto: this.tituloHijos(f) }], 2);
    hijos.forEach((h, i) => {
      // Con entrada propia, solo el nombre y su número: sus datos están allí.
      const resto: Trozo[] = this.numeroDe.has(h.persona.handle) && !this.privada(h.persona)
        ? [{ texto: "." }]
        : [{ texto: ". " }, ...this.resumen(h.persona, null)];
      this.texto([...this.mencion(h.persona, false), ...resto], 3, { vineta: `${romano(i + 1)}.`, pequeno: true });
    });
  }

  /** «Hijos de X y de Y:» (o de uno solo). */
  private tituloHijos(f: Familia): string {
    const padres = [this.a.padre(f), this.a.madre(f)].filter((x): x is Persona => !!x).map((x) => this.a.nombre(x));
    return t(padres.length > 1 ? "libro.hijosDe" : "libro.hijosDeUno", { a: padres[0] ?? "", b: padres[1] ?? "", y: conjuncionY(padres[1] ?? "") });
  }

  /** Los hijos en la página de la persona principal: solo los datos
   * principales (nacimiento y, si consta, defunción), con su número
   * d'Aboville si el libro tiene descendientes, donde tienen su entrada
   * completa (decisión del 30/10/2026). */
  private hijosPrincipal(f: Familia, hijos: Persona[]) {
    this.texto([{ texto: this.tituloHijos(f) }], 2);
    hijos.forEach((h, i) => {
      const n = this.conDescendientes ? this.numeroDe.get(h.handle) : undefined;
      this.texto([{ texto: this.a.nombre(h), persona: h.handle }, { texto: ". " }, ...this.resumen(h, null)], 3, { vineta: n ?? `${romano(i + 1)}.`, pequeno: true });
    });
  }
}

/** Los años del índice de personas: « (1850–1920)», « (c. 1850–)»,
 * « (?–1920)» o nada; con «c.» si la fecha es aproximada (31/10/2026). Sin
 * años para las personas vivas omitidas. */
export function aniosIndice(arbol: Arbol, p: Persona, privadas: ReadonlySet<string>): string {
  if (privadas.has(p.handle)) return "";
  const n = anioSuelto(arbol.nacimiento(p)?.evento.date);
  const d = anioSuelto(arbol.defuncion(p)?.evento.date);
  return n !== null || d !== null ? ` (${n ?? "?"}–${d ?? ""})` : "";
}

/** Personas que salen en el libro (con entrada o mencionadas), para
 * contar las vivas omitidas. */
export function personasDelLibro(libro: Libro): Set<string> {
  const s = new Set<string>();
  for (const parte of libro.partes) {
    for (const par of parte.parrafos) {
      if (par.tipo === "entrada") s.add(par.persona);
      if (par.tipo === "entrada" || par.tipo === "texto") for (const tr of par.trozos) if (tr.persona) s.add(tr.persona);
    }
  }
  return s;
}
