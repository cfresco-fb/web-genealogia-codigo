// El árbol en memoria, construido a partir de la instantánea: acceso por
// handle, relaciones (padres, cónyuges, hijos, participantes de un
// evento), nombres y lugares para mostrar, y búsqueda de texto.

import { comparador, nombreTipo, t, type TipoGramps } from "../i18n";
import { porFecha, textoFecha, valorOrden, type FormatoFecha } from "./fechas";
import { Indice } from "../../../comun/indice.ts";
import { tiposPropios as calcularTipos, type TiposPropios } from "../../../comun/tipos.ts";
import type { ObjetoGramps, Tipo } from "../../../comun/gramps.ts";
import type {
  Base, ChildRef, Evento, Familia, Instantanea, Lugar, Multimedia, Nombre, Nota, Persona,
} from "./tipos";

/** Tipos de objeto que muestra la web, con el nombre de clase de Gramps. */
export type TipoObjeto = "Person" | "Family" | "Event" | "Place" | "Media" | "Note";
export const TIPOS_OBJETO: TipoObjeto[] = ["Person", "Family", "Event", "Place", "Media", "Note"];

// Valores de EventType y EventRoleType de Gramps (gramps/gen/lib/eventtype.py).
const EV = { PERSONALIZADO: 0, MATRIMONIO: 1, DIVORCIO: 7, NACIMIENTO: 12, DEFUNCION: 13, BAUTISMO: 15, ENTIERRO: 19, BAUTIZO: 22, CREMACION: 24 };
const ROL_PRINCIPAL = 1;
// Valores de FamilyRelType de Gramps (gramps/gen/lib/familyreltype.py).
const FAM = { CASADOS: 0, SIN_CASAR: 1, UNION_CIVIL: 2, PERSONALIZADO: 4 };

/** Tipos personalizados que reconoce la web (decisión del 24/10/2026,
 * «Tipos de relación de pareja»), por su código del catálogo
 * (comun/tipos-propios.json; decisión del 31/10/2026). El «Inicio de la
 * relación», descartado el 29/10/2026, ya no se reconoce. */
export const TIPO_SIN_RELACION = "@sin_relacion";
export const EVENTO_SEPARACION = "@separacion";

/** Cómo se presenta una pareja: matrimonio («Casados» y «Unión civil»),
 * pareja sin casar, padres sin relación de pareja o tipo desconocido (y
 * cualquier otro personalizado). */
export type ClasePareja = "matrimonio" | "pareja" | "sinRelacion" | "desconocida";

/** Tipo de relación de una familia y sus eventos de pareja (el primero de
 * cada tipo). */
export interface Pareja {
  clase: ClasePareja;
  boda: Evento | null;
  divorcio: Evento | null;
  separacion: Evento | null;
}
// Si falta el nacimiento o la defunción, Gramps muestra en su lugar estos
// eventos (gramps/gen/utils/db.py, get_birth_or_fallback). Para la
// defunción, solo entierro e incineración (decisión del 22/10/2026; Gramps
// añade la causa de muerte, que no dice cuándo ni dónde murió).
const SUSTITUTOS_NACIMIENTO = [EV.BAUTISMO, EV.BAUTIZO];
const SUSTITUTOS_DEFUNCION = [EV.ENTIERRO, EV.CREMACION];

/** Un nacimiento, defunción o boda listo para mostrar. */
export interface DatoVital {
  rotulo: string;
  texto: string;
  /** Sin fecha ni lugar («sin datos»). */
  falta: boolean;
  /** Fecha ya formateada y título del lugar, por separado ("" si faltan). */
  fecha: string;
  lugar: string;
  /** El evento, si lo hay. */
  evento: Evento | null;
}

export interface FechaVital {
  evento: Evento;
  /** true si no es el nacimiento (o la defunción) sino un sustituto. */
  sustituto: boolean;
}

export interface EventoDePersona {
  evento: Evento;
  rol: TipoGramps;
  /** La familia, si es un evento de familia (p. ej. el matrimonio). */
  familia: Familia | null;
}

export interface Hijo {
  persona: Persona;
  ref: ChildRef;
}

export interface Referente {
  tipo: TipoObjeto;
  objeto: Base;
}

export type ResultadosBusqueda = Map<TipoObjeto, { total: number; objetos: Base[] }>;

/** Minúsculas y sin acentos, para buscar. */
/** Extensiones de imagen: una descripción que acaba así es un nombre de
 * fichero. */
const EXTENSION_IMAGEN = /\.(jpe?g|png|gif|tiff?|bmp|webp|heic|heif|avif|svg)$/i;

/** La descripción de una foto, para mostrarla; vacía si parece una ruta o
 * un nombre de fichero (la que pone Gramps si no se escribe otra, que deja
 * ver el usuario y las carpetas del PC): si tiene «/» o «\», si acaba en
 * una extensión de imagen o si es el nombre del fichero, con o sin
 * extensión («50003»). Decisión del 30/10/2026. El formulario de la foto
 * sigue enseñando la de verdad, para poder corregirla. */
export function descripcionFoto(m: { desc: string; path: string }): string {
  const d = (m.desc ?? "").trim();
  if (!d || /[\\/]/.test(d) || EXTENSION_IMAGEN.test(d)) return "";
  const fichero = (m.path ?? "").split(/[\\/]/).pop() ?? "";
  const igual = (a: string, b: string) => !!b && a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
  return igual(d, fichero) || igual(d, fichero.replace(/\.[^.]*$/, "")) ? "" : d;
}

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Un objeto tal como queda tras un cambio (null si se ha borrado). */
export interface ObjetoCambiado {
  tipo: string;
  handle: string;
  operacion?: "crear" | "modificar" | "borrar";
  despues: Base | null;
}

export class Arbol {
  readonly personas = new Map<string, Persona>();
  readonly familias = new Map<string, Familia>();
  readonly eventos = new Map<string, Evento>();
  readonly lugares = new Map<string, Lugar>();
  readonly multimedia = new Map<string, Multimedia>();
  readonly notas = new Map<string, Nota>();
  readonly generada: string;
  /** Último cambio del registro incluido (0 en una instantánea v1). */
  readonly secuencia: number;
  /** La instantánea de la que sale (para aplicarle cambios, conCambios). */
  readonly instantanea: Instantanea;
  /** La persona de inicio de Gramps de escritorio: solo la reserva para un
   * usuario sin persona vinculada (cada usuario tiene la suya; ver
   * usePersonaInicio en app/src/acceso/preferencias.tsx). */
  readonly personaInicioGramps: Persona | null;

  private readonly tipoDe = new Map<string, TipoObjeto>();
  private readonly referentesDe = new Map<string, Set<string>>();
  private readonly titulosLugar = new Map<string, string>();
  /** Por tipo: cada objeto, su texto de búsqueda y el mismo con su ID. */
  private textosBusqueda: Map<TipoObjeto, [Base, string, string][]> | null = null;
  private tipos: TiposPropios | null = null;

  constructor(instantanea: Instantanea) {
    const o = instantanea.objetos;
    const colecciones: [TipoObjeto, Map<string, Base>, Base[] | undefined][] = [
      ["Person", this.personas, o.Person], ["Family", this.familias, o.Family],
      ["Event", this.eventos, o.Event], ["Place", this.lugares, o.Place],
      ["Media", this.multimedia, o.Media], ["Note", this.notas, o.Note],
    ];
    for (const [tipo, mapa, lista] of colecciones) {
      for (const obj of lista ?? []) {
        mapa.set(obj.handle, obj);
        this.tipoDe.set(obj.handle, tipo);
      }
    }
    // Referencias inversas: quién apunta a cada objeto. En el JSON de
    // Gramps, toda referencia es una cadena igual al handle del objeto.
    for (const lista of Object.values(o)) {
      for (const obj of lista ?? []) this.anotarReferencias(obj, obj.handle);
    }
    this.generada = instantanea.generada;
    this.secuencia = instantanea.secuencia ?? 0;
    this.instantanea = instantanea;
    this.personaInicioGramps = this.personas.get(instantanea.persona_inicio ?? "") ?? null;
  }

  private anotarReferencias(valor: unknown, origen: string) {
    if (typeof valor === "string") {
      if (valor !== origen && this.tipoDe.has(valor)) {
        let s = this.referentesDe.get(valor);
        if (!s) this.referentesDe.set(valor, (s = new Set()));
        s.add(origen);
      }
    } else if (Array.isArray(valor)) {
      for (const v of valor) this.anotarReferencias(v, origen);
    } else if (valor && typeof valor === "object") {
      for (const [k, v] of Object.entries(valor)) if (k !== "handle") this.anotarReferencias(v, origen);
    }
  }

  /** Un árbol nuevo con los objetos de un cambio ya aplicados (los que
   * devuelve la función del servidor al guardar): así quien guarda ve su
   * cambio al momento, sin esperar a la instantánea (docs/edicion.md).
   * `autor`: la persona vinculada de quien guarda, para anotar quién creó
   * los objetos nuevos (como hace la instantánea). */
  conCambios(objetos: ObjetoCambiado[], secuencia: number, autor: string | null = null): Arbol {
    const ins: Instantanea = {
      ...this.instantanea,
      secuencia: Math.max(this.secuencia, secuencia),
      objetos: { ...this.instantanea.objetos },
      web: this.instantanea.web && { ...this.instantanea.web, creadoPor: { ...this.instantanea.web.creadoPor } },
    };
    for (const o of objetos) {
      if (o.operacion === "crear" && ins.web) ins.web.creadoPor[o.handle] = autor;
      // La lista, ordenada por handle como en la instantánea.
      const lista = [...(ins.objetos[o.tipo] ?? [])];
      const i = lista.findIndex((x) => x.handle >= o.handle);
      const esta = i >= 0 && lista[i].handle === o.handle;
      if (!o.despues) {
        if (esta) lista.splice(i, 1);
      } else if (esta) {
        lista[i] = o.despues;
      } else {
        lista.splice(i < 0 ? lista.length : i, 0, o.despues);
      }
      ins.objetos[o.tipo] = lista;
    }
    return new Arbol(ins);
  }

  private indice: Indice | null = null;

  /** Índice de relaciones (comun/indice.ts), con el mismo código que el
   * servidor: para calcular la rama y los permisos en la web. */
  indiceRelaciones(): Indice {
    this.indice ??= Indice.desdeObjetos(this.instantanea.objetos as Partial<Record<Tipo, ObjetoGramps[]>>, this.secuencia);
    return this.indice;
  }

  tipo(handle: string): TipoObjeto | undefined {
    return this.tipoDe.get(handle);
  }

  /** Objetos del árbol que hacen referencia a este. */
  referentes(handle: string): Referente[] {
    const out: Referente[] = [];
    for (const h of this.referentesDe.get(handle) ?? []) {
      const tipo = this.tipoDe.get(h);
      const objeto = tipo && this.mapa(tipo).get(h);
      if (tipo && objeto) out.push({ tipo, objeto });
    }
    return out;
  }

  mapa(tipo: TipoObjeto): Map<string, Base> {
    return {
      Person: this.personas, Family: this.familias, Event: this.eventos,
      Place: this.lugares, Media: this.multimedia, Note: this.notas,
    }[tipo];
  }

  // ---- Nombres ----

  apellidos(n: Nombre): string {
    const partes: string[] = [];
    for (const a of n.surname_list) {
      const ap = [a.prefix, a.surname].filter(Boolean).join(" ");
      if (ap) partes.push(ap);
      if (a.connector) partes.push(a.connector);
    }
    return partes.join(" ");
  }

  /** El apodo entre comillas («“Juancho”»), o "" si no tiene. Va dentro del
   * nombre, detrás del de pila (decisión de Carlos del 05/11/2026). */
  private apodo(n: Nombre): string {
    const nick = n.nick.trim();
    return nick ? `“${nick}”` : "";
  }

  /** «Nombre “Apodo” Sufijo»: la primera línea de las cajas del árbol. */
  nombrePila(n: Nombre): string {
    return [n.first_name, this.apodo(n), n.suffix].filter(Boolean).join(" ");
  }

  /** «Nombre “Apodo” Apellidos Sufijo». */
  nombre(p: Persona | null | undefined): string {
    if (!p) return t("ficha.desconocido");
    const n = p.primary_name;
    return [n.first_name, this.apodo(n), this.apellidos(n), n.suffix].filter(Boolean).join(" ") || t("persona.sinNombre");
  }

  /** «Apellidos, Nombre “Apodo” Sufijo», para listas ordenadas por apellido. */
  nombreOrden(p: Persona): string {
    const n = p.primary_name;
    return [this.apellidos(n), this.nombrePila(n)].filter(Boolean).join(", ") || t("persona.sinNombre");
  }

  /** «Padre y Madre». */
  nombreFamilia(f: Familia): string {
    const nombres = [this.padre(f), this.madre(f)].filter(Boolean).map((p) => this.nombre(p));
    return nombres.join(" y ") || t("ficha.desconocido");
  }

  // ---- Personas y familias ----

  persona(handle: string | null | undefined): Persona | null {
    return (handle && this.personas.get(handle)) || null;
  }

  padre(f: Familia): Persona | null {
    return this.persona(f.father_handle);
  }

  madre(f: Familia): Persona | null {
    return this.persona(f.mother_handle);
  }

  /** Familias en las que la persona es hija. */
  familiasPadres(p: Persona): Familia[] {
    return p.parent_family_list.map((h) => this.familias.get(h)).filter((f): f is Familia => !!f);
  }

  /** Familias en las que la persona es padre o madre. */
  familiasPropias(p: Persona): Familia[] {
    return p.family_list.map((h) => this.familias.get(h)).filter((f): f is Familia => !!f);
  }

  /** Familias propias por fecha de boda (en una pareja sin boda, la del
   * inicio de la relación); las que no la tienen, después, en el orden de
   * Gramps (decisiones del 24/10/2026, «Cajas y cónyuges: más respuestas»
   * y «Tipos de relación de pareja»). Para el árbol, el libro y la ficha de
   * persona. */
  familiasPorBoda(p: Persona): Familia[] {
    const fecha = (f: Familia) => valorOrden(this.pareja(f).boda?.date);
    const con = this.familiasPropias(p).map((f, i) => ({ f, i, v: fecha(f) }));
    return con
      .sort((a, b) => (a.v === null ? (b.v === null ? a.i - b.i : 1) : b.v === null ? -1 : a.v - b.v || a.i - b.i))
      .map(({ f }) => f);
  }

  /** Tipo de relación y eventos de pareja de una familia. */
  pareja(f: Familia): Pareja {
    const eventos = this.eventosFamilia(f).map((e) => e.evento);
    const de = (tipo: number, codigo?: string) =>
      eventos.find((e) => e.type.value === tipo && (codigo === undefined || e.type.string === codigo)) ?? null;
    const v = f.type.value;
    const clase: ClasePareja = v === FAM.CASADOS || v === FAM.UNION_CIVIL ? "matrimonio"
      : v === FAM.SIN_CASAR ? "pareja"
        : v === FAM.PERSONALIZADO && f.type.string === TIPO_SIN_RELACION ? "sinRelacion"
          : "desconocida";
    return {
      clase,
      boda: de(EV.MATRIMONIO),
      divorcio: de(EV.DIVORCIO),
      separacion: de(EV.PERSONALIZADO, EVENTO_SEPARACION),
    };
  }

  conyuge(f: Familia, p: Persona): Persona | null {
    return this.persona(f.father_handle === p.handle ? f.mother_handle : f.father_handle);
  }

  hijos(f: Familia): Hijo[] {
    return f.child_ref_list
      .map((ref) => ({ persona: this.personas.get(ref.ref)!, ref }))
      .filter((h) => h.persona);
  }

  // ---- Eventos ----

  private eventoVital(p: Persona, indice: number, tipo: number, sustitutos: number[]): FechaVital | null {
    const ref = p.event_ref_list[indice];
    const ev = ref && this.eventos.get(ref.ref);
    if (ev && ev.type.value === tipo) return { evento: ev, sustituto: false };
    for (const s of sustitutos) {
      for (const r of p.event_ref_list) {
        const e = this.eventos.get(r.ref);
        if (e && e.type.value === s && r.role.value === ROL_PRINCIPAL) return { evento: e, sustituto: true };
      }
    }
    return null;
  }

  nacimiento(p: Persona): FechaVital | null {
    return this.eventoVital(p, p.birth_ref_index, EV.NACIMIENTO, SUSTITUTOS_NACIMIENTO);
  }

  defuncion(p: Persona): FechaVital | null {
    return this.eventoVital(p, p.death_ref_index, EV.DEFUNCION, SUSTITUTOS_DEFUNCION);
  }

  /** Rótulo y texto de un evento vital (o una boda), con las reglas de
   * presentación (docs/decisiones-web-familiar.md, «Presentación»):
   * - fecha y lugar: «3 de mayo de 1950, Madrid»; solo fecha: «3 de mayo
   *   de 1950»;
   * - solo lugar: «sin fecha, Madrid»;
   * - evento sin fecha ni lugar: «sin datos» (falta = true);
   * - sin evento: «sin datos» también (falta = true).
   * El rótulo es el dado o, si el evento es un sustituto, el suyo
   * («Bautismo», «Entierro»). Para la defunción, sin evento no se muestra
   * nada: ver lineaDefuncion. La fecha, en formato largo salvo que se pida
   * otro (cajas del árbol). */
  datoVital(fv: FechaVital | null, rotulo: string, formato: FormatoFecha = "largo"): DatoVital {
    const fecha = fv ? textoFecha(fv.evento.date, formato) : "";
    const lugar = fv ? this.tituloLugar(fv.evento.place) : "";
    const r = fv?.sustituto ? nombreTipo(fv.evento.type) : rotulo;
    const evento = fv?.evento ?? null;
    if (!fecha && !lugar) return { rotulo: r, texto: t("ficha.sinDatos"), falta: true, fecha, lugar, evento };
    return { rotulo: r, texto: [fecha || t("ficha.sinFecha"), lugar].filter(Boolean).join(", "), falta: false, fecha, lugar, evento };
  }

  /** «Nacimiento: …» (o el bautismo), siempre, aunque no haya evento. */
  lineaNacimiento(p: Persona, formato: FormatoFecha = "largo"): DatoVital {
    return this.datoVital(this.nacimiento(p), t("col.nacimiento"), formato);
  }

  /** «Defunción: …» (o el entierro o la incineración). Sin ninguno de esos
   * eventos, «Defunción: sin datos» si no está entre las `vivas` (quién se
   * considera vivo, vivos.ts; decisión del 29/10/2026), y si no, null:
   * entonces no se muestra nada. Sin `vivas`, solo con evento. */
  lineaDefuncion(p: Persona, formato: FormatoFecha = "largo", vivas?: ReadonlySet<string>): DatoVital | null {
    const fv = this.defuncion(p);
    if (fv) return this.datoVital(fv, t("col.defuncion"), formato);
    return vivas && !vivas.has(p.handle) ? this.datoVital(null, t("col.defuncion"), formato) : null;
  }

  /** Eventos propios y los de sus familias, mezclados por fecha (los que no
   * tienen, al final: los propios y después los de las familias, en su
   * orden; decisión del 29/10/2026). Para mostrarlos. */
  eventosPersona(p: Persona): EventoDePersona[] {
    return porFecha(this.eventosPersonaGuardados(p), (e) => e.evento.date);
  }

  /** Eventos propios y, después, los de sus familias, en el orden guardado
   * (como en Gramps). */
  eventosPersonaGuardados(p: Persona): EventoDePersona[] {
    const out: EventoDePersona[] = [];
    for (const r of p.event_ref_list) {
      const evento = this.eventos.get(r.ref);
      if (evento) out.push({ evento, rol: r.role, familia: null });
    }
    for (const familia of this.familiasPropias(p)) {
      for (const r of familia.event_ref_list) {
        const evento = this.eventos.get(r.ref);
        if (evento) out.push({ evento, rol: r.role, familia });
      }
    }
    return out;
  }

  /** Los eventos de la familia, en el orden guardado (para mostrarlos,
   * porFecha). */
  eventosFamilia(f: Familia): EventoDePersona[] {
    return f.event_ref_list
      .map((r) => ({ evento: this.eventos.get(r.ref)!, rol: r.role, familia: f }))
      .filter((e) => e.evento);
  }

  /** Personas y familias que tienen este evento. */
  participantes(ev: Evento): Referente[] {
    return this.referentes(ev.handle).filter((r) => r.tipo === "Person" || r.tipo === "Family");
  }

  /** Los tipos propios de una clase («EventType»…) que hay en el árbol
   * (comun/tipos.ts), para las listas de los formularios. */
  tiposPropios(clase: string): string[] {
    return this.tiposConocidos()[clase] ?? [];
  }

  /** Todos los tipos propios del árbol, por clase (para saber si un cambio
   * trae uno nuevo, comun/permisos.ts). */
  tiposConocidos(): TiposPropios {
    this.tipos ??= calcularTipos(Object.values(this.instantanea.objetos).flat());
    return this.tipos;
  }

  /** Un objeto de cualquier tipo (también los que la web no indexa, como
   * fuentes y citas), o null. */
  obtener(tipo: Tipo, handle: string): ObjetoGramps | null {
    if ((TIPOS_OBJETO as Tipo[]).includes(tipo)) return (this.mapa(tipo as TipoObjeto).get(handle) as ObjetoGramps | undefined) ?? null;
    const lista = (this.instantanea.objetos as Partial<Record<Tipo, ObjetoGramps[]>>)[tipo] ?? [];
    return lista.find((o) => o.handle === handle) ?? null;
  }

  // ---- Lugares ----

  /** Título completo, siguiendo la jerarquía: «Portales, Roosevelt, NM,
   * USA». Es el título automático de Gramps 6. */
  tituloLugar(handle: string | null | undefined): string {
    if (!handle) return "";
    const guardado = this.titulosLugar.get(handle);
    if (guardado !== undefined) return guardado;
    const partes: string[] = [];
    const vistos = new Set<string>();
    let lugar = this.lugares.get(handle);
    while (lugar && !vistos.has(lugar.handle)) {
      vistos.add(lugar.handle);
      if (lugar.name.value) partes.push(lugar.name.value);
      lugar = this.lugares.get(lugar.placeref_list[0]?.ref ?? "");
    }
    const titulo = partes.join(", ") || this.lugares.get(handle)?.title || "";
    this.titulosLugar.set(handle, titulo);
    return titulo;
  }

  lugarSuperior(l: Lugar): string {
    return this.tituloLugar(l.placeref_list[0]?.ref);
  }

  // ---- Multimedia y notas ----

  esImagen(m: Multimedia | undefined): boolean {
    return !!m && m.mime.startsWith("image/");
  }

  /** Primera imagen enlazada al objeto (persona, familia, evento…). */
  fotoPrincipal(obj: { media_list: { ref: string }[] }): Multimedia | null {
    for (const r of obj.media_list) {
      const m = this.multimedia.get(r.ref);
      if (this.esImagen(m)) return m!;
    }
    return null;
  }

  notasDe(obj: Base): Nota[] {
    return obj.note_list.map((h) => this.notas.get(h)).filter((n): n is Nota => !!n);
  }

  // ---- Búsqueda ----

  private textoDe(tipo: TipoObjeto, obj: Base): string {
    const partes: string[] = [];
    switch (tipo) {
      case "Person": {
        const p = obj as Persona;
        for (const n of [p.primary_name, ...p.alternate_names]) {
          partes.push(n.first_name, this.apellidos(n), n.suffix, n.title, n.call, n.nick);
        }
        break;
      }
      case "Family": {
        const f = obj as Familia;
        partes.push(this.nombreFamilia(f));
        break;
      }
      case "Event": {
        const e = obj as Evento;
        partes.push(nombreTipo(e.type), e.description, textoFecha(e.date), this.tituloLugar(e.place));
        break;
      }
      case "Place": {
        const l = obj as Lugar;
        partes.push(this.tituloLugar(l.handle), l.title, ...l.alt_names.map((n) => n.value));
        break;
      }
      case "Media": {
        // Ni la ruta ni una descripción que lo sea (30/10/2026).
        partes.push(descripcionFoto(obj as Multimedia));
        break;
      }
      case "Note":
        partes.push((obj as Nota).text.string);
        break;
    }
    return normalizar(partes.filter(Boolean).join(" "));
  }

  /** Objetos que contienen todas las palabras de la consulta, sin
   * distinguir mayúsculas ni acentos. Como mucho «limite» por tipo. Por el
   * ID de Gramps, solo con `conIds` (el administrador; decisión del
   * 23/10/2026, «Parejas y cajas: respuestas»). */
  buscar(consulta: string, ambitos: TipoObjeto[], limite: number, conIds = false): ResultadosBusqueda {
    const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
    const resultados: ResultadosBusqueda = new Map();
    if (!palabras.length) return resultados;
    if (!this.textosBusqueda) {
      this.textosBusqueda = new Map(TIPOS_OBJETO.map((tipo) => [
        tipo, [...this.mapa(tipo).values()].map((o): [Base, string, string] => {
          const texto = this.textoDe(tipo, o);
          return [o, texto, `${normalizar(o.gramps_id)} ${texto}`];
        }),
      ]));
    }
    for (const tipo of ambitos) {
      const encontrados = this.textosBusqueda.get(tipo)!
        .filter(([, texto, conId]) => palabras.every((p) => (conIds ? conId : texto).includes(p)))
        .map(([o]) => o);
      if (tipo === "Person") {
        encontrados.sort((a, b) => comparador.compare(this.nombreOrden(a as Persona), this.nombreOrden(b as Persona)));
      }
      if (encontrados.length) {
        resultados.set(tipo, { total: encontrados.length, objetos: encontrados.slice(0, limite) });
      }
    }
    return resultados;
  }
}
