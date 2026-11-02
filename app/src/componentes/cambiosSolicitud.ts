// Qué pide una solicitud, en palabras (paso 12; petición de Carlos del
// 28/10/2026, tras probarlo): el título («Cambio en la persona Sarah…»,
// «Borrar el lugar…»), por qué no se pudo guardar directamente («El tipo de
// evento «Prueba» es nuevo y solo el administrador puede añadirlo») y qué
// cambia, dato a dato («Apodo: sin datos → Pepe», «Evento nuevo: «Prueba»
// (tipo nuevo), 1890»).
//
// Lo que cuelga de la ficha principal (sus eventos, notas, fotos y lugares
// nuevos o cambiados) se cuenta dentro de ella; las demás fichas que toca
// van aparte, cada una con su título. Los vínculos dobles que pone la web
// (la familia en la persona) no se repiten: ya se ven en la familia.

import type { ObjetoGramps, Tipo } from "../../../comun/gramps.ts";
import type { NoPermitido } from "../../../comun/permisos.ts";
import type { ObjetoPeticion, Operacion } from "../../../comun/peticion.ts";
import type { ClaseSolicitud, ObjetoPropuesta } from "../../../comun/solicitudes.ts";
import { descripcionFoto, type Arbol } from "../arbol/arbol";
import { textoFecha } from "../arbol/fechas";
import type { ChildRef, EventRef, Evento, Familia, Lugar, MediaRef, Multimedia, Nombre, Nota, Persona, Ref, TipoGramps } from "../arbol/tipos";
import { nombreTipo, t, type Clave } from "../i18n";

/** Un objeto de la solicitud: cómo estaba (null si se crea) y cómo queda
 * (null si se borra). */
export interface Cambio {
  tipo: Tipo;
  handle: string;
  operacion: Operacion;
  antes: ObjetoGramps | null;
  despues: ObjetoGramps | null;
}

/** Los de una solicitud guardada. Las anteriores al 28/10/2026 no guardan
 * el «antes»: se toma el árbol de ahora. */
export function cambiosDePropuesta(arbol: Arbol, objetos: ObjetoPropuesta[]): Cambio[] {
  return objetos.map((o) => ({
    tipo: o.tipo,
    handle: o.handle,
    operacion: o.operacion,
    antes: o.operacion === "crear" ? null : o.antes !== undefined ? (o.antes ? (JSON.parse(o.antes) as ObjetoGramps) : null) : arbol.obtener(o.tipo, o.handle),
    despues: o.despues ? (JSON.parse(o.despues) as ObjetoGramps) : null,
  }));
}

/** Los de una petición que aún no se ha enviado. */
export function cambiosDePeticion(arbol: Arbol, objetos: ObjetoPeticion[]): Cambio[] {
  return objetos.map((o) => ({
    tipo: o.tipo,
    handle: o.handle,
    operacion: o.operacion,
    antes: o.operacion === "crear" ? null : arbol.obtener(o.tipo, o.handle),
    despues: o.despues,
  }));
}

/** Una ficha con su clase: «la persona Sarah Warner», «el evento
 * Nacimiento, 1855». */
export function laFicha(arbol: Arbol, tipo: Tipo, handle: string): string {
  return new Descripcion(arbol, [], []).laFicha(tipo, handle);
}

export const mayuscula = (s: string) => s.charAt(0).toLocaleUpperCase("es") + s.slice(1);

const corto = (s: string, n: number) => {
  const una = s.replace(/\s+/g, " ").trim();
  return `«${una.length > n ? `${una.slice(0, n - 1)}…` : una}»`;
};
const json = (x: unknown) => JSON.stringify(x ?? null);
const texto = (s: unknown) => (typeof s === "string" ? s.trim() : "");

interface Atributo { type: TipoGramps; value: string }
interface Direccion { street: string; locality: string; city: string; postal: string; county: string; state: string; country: string; phone: string; date: unknown }
interface Url { type: TipoGramps; path: string; desc: string }
interface Asociacion extends Ref { rel: string }

/** Las piezas de una lista que se comparan sin identidad (otros nombres,
 * atributos, direcciones…): los textos de «nuevo», «quitado», «cambia» y
 * «orden». */
type Rotulos = "otroNombre" | "atributo" | "direccion" | "url" | "asociacion";

/** «de evento», «de nombre»…: de qué es un tipo, por su clase de Gramps. */
const CLASES_TIPO: Record<string, Clave> = {
  EventType: "tipo.clase.EventType",
  EventRoleType: "tipo.clase.EventRoleType",
  NameType: "tipo.clase.NameType",
  AttributeType: "tipo.clase.AttributeType",
  FamilyRelType: "tipo.clase.FamilyRelType",
  ChildRefType: "tipo.clase.ChildRefType",
  PlaceType: "tipo.clase.PlaceType",
  NoteType: "tipo.clase.NoteType",
  UrlType: "tipo.clase.UrlType",
};

/** Los tipos nuevos de un «no permitido». Las solicitudes de la mañana del
 * 28/10/2026 los guardaron solo con el texto («Prueba»), sin la clase. */
function tiposDe(n: NoPermitido): { clase?: string; texto: string }[] {
  return ((n.tipos ?? []) as unknown[]).map((x) => (typeof x === "string" ? { texto: x } : (x as { clase: string; texto: string })));
}

/** La versión de una ficha con la que se la nombra: la de antes, salvo si
 * es nueva. */
const version = (c: Cambio) => (c.operacion === "crear" ? c.despues : c.antes ?? c.despues);

export interface Grupo {
  titulo: string;
  lineas: string[];
}

export class Descripcion {
  private porClave = new Map<string, Cambio>();
  private absorbidos = new Set<string>();
  private tiposNuevos = new Set<string>();

  constructor(private arbol: Arbol, private cambios: Cambio[], private noPermitidos: NoPermitido[]) {
    for (const c of cambios) this.porClave.set(`${c.tipo}_${c.handle}`, c);
    for (const n of noPermitidos) for (const x of tiposDe(n)) this.tiposNuevos.add(x.clase ? `${x.clase}|${x.texto}` : x.texto);
  }

  private cambio(tipo: Tipo, handle: string | null | undefined): Cambio | undefined {
    return handle ? this.porClave.get(`${tipo}_${handle}`) : undefined;
  }

  private absorber(tipo: Tipo, handle: string) {
    if (this.cambio(tipo, handle)) this.absorbidos.add(`${tipo}_${handle}`);
  }

  /** Cómo queda (o cómo era, si se borra). */
  private ahora(tipo: Tipo, handle: string | null | undefined): ObjetoGramps | null {
    if (!handle) return null;
    const c = this.cambio(tipo, handle);
    return c ? (c.despues ?? c.antes) : this.arbol.obtener(tipo, handle);
  }

  /** Cómo estaba antes de la solicitud. */
  private antes(tipo: Tipo, handle: string | null | undefined): ObjetoGramps | null {
    if (!handle) return null;
    const c = this.cambio(tipo, handle);
    return c ? c.antes : this.arbol.obtener(tipo, handle);
  }

  // ---- Nombres ----

  /** El nombre de un tipo; si es uno nuevo de la solicitud, señalado. */
  tipo(tg: TipoGramps | null | undefined): string {
    if (!tg) return "";
    const n = nombreTipo(tg);
    const nuevo = this.tiposNuevos.has(`${tg._class}|${tg.string}`) || this.tiposNuevos.has(tg.string);
    return tg.string && nuevo ? t("cambio.tipoNuevo", { tipo: n }) : n;
  }

  private lugar(handle: string | null | undefined, version: "antes" | "ahora" = "ahora"): string {
    if (!handle) return "";
    const c = this.cambio("Place", handle);
    const o = (version === "antes" ? this.antes("Place", handle) : this.ahora("Place", handle)) as unknown as Lugar | null;
    if (c && o) return o.name.value;
    return this.arbol.tituloLugar(handle);
  }

  /** El nombre de una ficha (`o`: la versión que se nombra). */
  nombre(tipo: Tipo, handle: string | null | undefined, o: ObjetoGramps | null = this.ahora(tipo, handle)): string {
    if (!o) return t("ficha.desconocido");
    switch (tipo) {
      case "Person":
        return this.arbol.nombre(o as unknown as Persona);
      case "Family": {
        const f = o as unknown as Familia;
        return [f.father_handle, f.mother_handle].filter(Boolean).map((h) => this.nombre("Person", h)).join(" y ") || t("ficha.desconocido");
      }
      case "Event": {
        // El lugar, de la misma versión que el evento.
        const e = o as unknown as Evento;
        const deAntes = o === this.antes("Event", handle);
        return [this.tipo(e.type), textoFecha(e.date as never), this.lugar(e.place, deAntes ? "antes" : "ahora")].filter(Boolean).join(", ");
      }
      case "Place":
        return (o as unknown as Lugar).name?.value || this.lugar(handle);
      case "Note":
        return corto((o as unknown as Nota).text.string, 50);
      case "Media":
        return descripcionFoto(o as unknown as Multimedia) || String(o.gramps_id ?? "");
      default:
        return String(o.gramps_id ?? "");
    }
  }

  laFicha(tipo: Tipo, handle: string, o?: ObjetoGramps | null): string {
    return t(`ficha.la.${tipo}` as Clave, { nombre: this.nombre(tipo, handle, o ?? this.ahora(tipo, handle)) });
  }

  // ---- Título ----

  titulo(clase: ClaseSolicitud, principal: { tipo: Tipo; handle: string }): string {
    const c = this.cambio(principal.tipo, principal.handle);
    const ficha = this.laFicha(principal.tipo, principal.handle, c ? version(c) : null);
    if (clase === "borrado") return t("solicitudes.borrarFicha", { ficha });
    if (c?.operacion === "crear") return t("solicitudes.anadirFicha", { ficha });
    return t("solicitudes.cambioEn", { ficha });
  }

  // ---- Por qué no se pudo guardar ----

  /** `principal`, en un borrado: solo lo de la ficha que se borra (lo
   * demás es lo que arrastra, y ya se cuenta en lo que cambia). */
  razones(principal?: { tipo: Tipo; handle: string }): string[] {
    const out = new Set<string>();
    const lista = principal ? this.noPermitidos.filter((n) => n.tipo === principal.tipo && n.handle === principal.handle) : this.noPermitidos;
    for (const n of lista) {
      const ficha = this.laFicha(n.tipo, n.handle);
      if (n.razon === "tipoNuevo") {
        if (!n.tipos?.length) out.add(t("solicitud.razon.tipoNuevoSin", { ficha }));
        for (const x of tiposDe(n)) {
          const clase = x.clase ? CLASES_TIPO[x.clase] : undefined;
          out.add(t("solicitud.razon.tipoNuevo", { clase: clase ? ` ${t(clase)}` : "", tipo: x.texto }));
        }
      } else if (n.razon === "quitaVinculo") {
        const quitados = this.quitados(n.tipo, n.handle);
        if (!quitados.length) out.add(t("solicitud.razon.quitaVinculoSin", { ficha }));
        for (const q of quitados) out.add(t("solicitud.razon.quitaVinculo", q));
      } else {
        out.add(t(`solicitud.razon.${n.razon}` as Clave, { ficha }));
      }
    }
    return [...out].map(mayuscula);
  }

  /** A quién se quita de qué familia (DA-10 b). */
  private quitados(tipo: Tipo, handle: string): { persona: string; familia: string }[] {
    const c = this.cambio(tipo, handle);
    if (!c?.antes || !c.despues) return [];
    const out: { persona: string; familia: string }[] = [];
    if (tipo === "Family") {
      const a = c.antes as unknown as Familia;
      const d = c.despues as unknown as Familia;
      const antes = [a.father_handle, a.mother_handle, ...a.child_ref_list.map((r) => r.ref)].filter((h): h is string => !!h);
      const despues = new Set([d.father_handle, d.mother_handle, ...d.child_ref_list.map((r) => r.ref)]);
      for (const h of antes) if (!despues.has(h)) out.push({ persona: this.nombre("Person", h), familia: this.laFicha("Family", handle, c.antes) });
    } else if (tipo === "Person") {
      const a = c.antes as unknown as Persona;
      const d = c.despues as unknown as Persona;
      const despues = new Set([...d.family_list, ...d.parent_family_list]);
      for (const f of [...a.family_list, ...a.parent_family_list]) {
        if (!despues.has(f)) out.push({ persona: this.nombre("Person", handle, c.antes), familia: this.laFicha("Family", f, this.antes("Family", f)) });
      }
    }
    return out;
  }

  // ---- Qué cambia ----

  /** Las líneas de la ficha principal y las demás fichas, cada una con su
   * título. */
  describir(clase: ClaseSolicitud, principal: { tipo: Tipo; handle: string }): { lineas: string[]; grupos: Grupo[] } {
    const p = this.cambio(principal.tipo, principal.handle);
    if (!p) return { lineas: [], grupos: [] };
    if (clase === "borrado") {
      const lineas = this.cambios.filter((c) => c !== p).map((c) =>
        c.operacion === "borrar" ? t("cambio.tambienSeBorra", { ficha: this.laFicha(c.tipo, c.handle, c.antes) })
          : t("cambio.seQuitaDe", { ficha: this.laFicha(c.tipo, c.handle, c.antes) }));
      return { lineas: lineas.map(mayuscula), grupos: [] };
    }
    this.absorbidos.add(`${p.tipo}_${p.handle}`);
    const lineas = this.lineas(p);
    // Primero las personas y familias (de las que cuelgan eventos, notas y
    // fotos); lo que quede, después.
    const colgantes: Tipo[] = ["Event", "Note", "Media", "Place"];
    const orden = [...this.cambios.filter((c) => !colgantes.includes(c.tipo)), ...this.cambios.filter((c) => colgantes.includes(c.tipo))];
    const grupos: Grupo[] = [];
    for (const c of orden) {
      const k = `${c.tipo}_${c.handle}`;
      if (this.absorbidos.has(k)) continue;
      this.absorbidos.add(k);
      const l = this.lineas(c);
      if (!l.length && c.operacion === "modificar") continue;
      const ficha = this.laFicha(c.tipo, c.handle, version(c));
      const titulo = c.operacion === "crear" ? t("solicitudes.anadirFicha", { ficha }) : c.operacion === "borrar" ? t("solicitudes.borrarFicha", { ficha }) : ficha;
      grupos.push({ titulo: mayuscula(titulo), lineas: l });
    }
    return { lineas, grupos };
  }

  /** Lo que cambia de una ficha. */
  private lineas(c: Cambio): string[] {
    if (!c.despues) return [];
    const out: string[] = [];
    const a = c.antes;
    const d = c.despues;
    let tratados: string[] = [];
    switch (c.tipo) {
      case "Person": tratados = this.persona(out, a as unknown as Persona | null, d as unknown as Persona); break;
      case "Family": tratados = this.familia(out, a as unknown as Familia | null, d as unknown as Familia); break;
      case "Event": tratados = this.evento(out, a as unknown as Evento | null, d as unknown as Evento); break;
      case "Place": tratados = this.lugarL(out, a as unknown as Lugar | null, d as unknown as Lugar); break;
      case "Note": tratados = this.nota(out, a as unknown as Nota | null, d as unknown as Nota); break;
      case "Media": tratados = this.foto(out, a as unknown as Multimedia | null, d as unknown as Multimedia); break;
    }
    // Lo que no se cuenta aquí, si ha cambiado.
    const ignorar = new Set([...tratados, "change", "gramps_id", "handle", "birth_ref_index", "death_ref_index", "title"]);
    if (a && Object.keys({ ...a, ...d }).some((k) => !ignorar.has(k) && json(a[k]) !== json(d[k]))) out.push(t("cambio.otros"));
    return out.map(mayuscula);
  }

  /** «Rótulo: antes → después» (o «Rótulo: valor» si la ficha es nueva). */
  private campo(out: string[], rotulo: string, nueva: boolean, antes: string, despues: string) {
    if (antes === despues) return;
    if (nueva) {
      if (despues) out.push(t("cambio.campoNuevo", { rotulo, valor: despues }));
      return;
    }
    out.push(t("cambio.campo", { rotulo, antes: antes || t("ficha.sinDatos"), despues: despues || t("ficha.sinDatos") }));
  }

  private lista<T>(out: string[], clave: Rotulos, antes: T[] | undefined, despues: T[] | undefined, textoDe: (x: T) => string) {
    const A = antes ?? [];
    const D = despues ?? [];
    const ja = A.map(json);
    const jd = D.map(json);
    if (json([...ja].sort()) === json([...jd].sort())) {
      if (json(ja) !== json(jd)) out.push(t(`cambio.${clave}.orden` as Clave));
      return;
    }
    if (A.length === D.length) {
      A.forEach((x, i) => {
        if (ja[i] === jd[i]) return;
        const [ta, td] = [textoDe(x), textoDe(D[i])];
        out.push(ta === td ? t(`cambio.${clave}.otros` as Clave, { x: ta }) : t(`cambio.${clave}.cambia` as Clave, { antes: ta, despues: td }));
      });
      return;
    }
    D.forEach((x, i) => { if (!ja.includes(jd[i])) out.push(t(`cambio.${clave}.nuevo` as Clave, { x: textoDe(x) })); });
    A.forEach((x, i) => { if (!jd.includes(ja[i])) out.push(t(`cambio.${clave}.quitado` as Clave, { x: textoDe(x) })); });
  }

  /** Eventos, notas o fotos de una ficha, por su referencia. Lo nuevo o
   * cambiado de la solicitud se cuenta aquí. */
  private referencias(out: string[], tipo: "Event" | "Note" | "Media", antes: string[], despues: string[], extra?: (h: string) => void) {
    const clave = tipo === "Event" ? "evento" : tipo === "Note" ? "nota" : "foto";
    for (const h of despues) {
      const c = this.cambio(tipo, h);
      this.absorber(tipo, h);
      if (!antes.includes(h)) {
        out.push(t(`cambio.${clave}.${c?.operacion === "crear" ? "nuevo" : "anadido"}` as Clave, { x: this.nombre(tipo, h) }));
        if (c?.operacion === "crear") this.colgantesNuevos(out, tipo, c.despues!);
      } else if (c?.operacion === "modificar") {
        const sub = this.lineas(c);
        for (const l of sub) out.push(t(`cambio.${clave}.en` as Clave, { x: this.nombre(tipo, h, c.antes), linea: l }));
      }
      extra?.(h);
    }
    for (const h of antes) {
      if (despues.includes(h)) continue;
      const c = this.cambio(tipo, h);
      this.absorber(tipo, h);
      out.push(t(`cambio.${clave}.${c?.operacion === "borrar" ? "quitadoBorra" : "quitado"}` as Clave, { x: this.nombre(tipo, h, this.antes(tipo, h)) }));
    }
    const comunes = despues.filter((h) => antes.includes(h));
    if (json(antes.filter((h) => despues.includes(h))) !== json(comunes)) out.push(t(`cambio.${clave}.orden` as Clave));
  }

  /** Lo que cuelga de un evento o una nota nuevos: su lugar y sus notas
   * nuevas. */
  private colgantesNuevos(out: string[], tipo: Tipo, o: ObjetoGramps) {
    if (tipo === "Event") {
      const e = o as unknown as Evento;
      if (e.place && this.cambio("Place", e.place)?.operacion === "crear") {
        this.absorber("Place", e.place);
        out.push(t("cambio.lugarNuevo", { x: this.nombre("Place", e.place) }));
      }
    }
    for (const h of (o.note_list as string[] | undefined) ?? []) {
      if (this.cambio("Note", h)?.operacion !== "crear") continue;
      this.absorber("Note", h);
      out.push(t("cambio.nota.nuevaDe", { x: this.nombre("Note", h) }));
    }
  }

  private eventos(out: string[], antes: EventRef[], despues: EventRef[]) {
    const roles = new Map(antes.map((r) => [r.ref, r.role]));
    this.referencias(out, "Event", antes.map((r) => r.ref), despues.map((r) => r.ref), (h) => {
      const a = roles.get(h);
      const d = despues.find((r) => r.ref === h)!.role;
      if (a && json(a) !== json(d)) out.push(t("cambio.papel", { x: this.nombre("Event", h), antes: this.tipo(a), despues: this.tipo(d) }));
    });
  }

  private fotos(out: string[], antes: MediaRef[], despues: MediaRef[]) {
    const rects = new Map(antes.map((r) => [r.ref, r.rect]));
    this.referencias(out, "Media", antes.map((r) => r.ref), despues.map((r) => r.ref), (h) => {
      if (rects.has(h) && json(rects.get(h)) !== json(despues.find((r) => r.ref === h)!.rect)) out.push(t("cambio.foto.recorte", { x: this.nombre("Media", h) }));
    });
  }

  /** Familias de una persona que no están en la solicitud (las que están ya
   * se cuentan en la familia). */
  private familias(out: string[], clave: "familiaPadres" | "familiaPropia", antes: string[], despues: string[]) {
    for (const h of despues) if (!antes.includes(h) && !this.cambio("Family", h)) out.push(t(`cambio.${clave}.anadida` as Clave, { x: this.nombre("Family", h) }));
    for (const h of antes) if (!despues.includes(h) && !this.cambio("Family", h)) out.push(t(`cambio.${clave}.quitada` as Clave, { x: this.nombre("Family", h, this.antes("Family", h)) }));
  }

  private persona(out: string[], a: Persona | null, d: Persona): string[] {
    const nueva = !a;
    const pa = a?.primary_name;
    const pd = d.primary_name;
    const ta = pa ? textoNombre(pa) : "";
    const td = textoNombre(pd);
    this.campo(out, t("cambio.rotulo.nombre"), nueva, ta, td);
    this.campo(out, t("ficha.apodo"), nueva, texto(pa?.nick), texto(pd.nick));
    if (pa && ta === td && texto(pa.nick) === texto(pd.nick) && json(pa) !== json(pd)) out.push(t("cambio.nombreOtros"));
    this.campo(out, t("cambio.rotulo.sexo"), nueva, a ? t(`sexo.${a.gender}` as Clave) : "", nueva && d.gender === 2 ? "" : t(`sexo.${d.gender}` as Clave));
    this.lista(out, "otroNombre", a?.alternate_names, d.alternate_names, (n) => textoNombre(n));
    this.eventos(out, a?.event_ref_list ?? [], d.event_ref_list);
    this.lista(out, "atributo", (a as unknown as { attribute_list?: Atributo[] })?.attribute_list, (d as unknown as { attribute_list: Atributo[] }).attribute_list, (x) => `${this.tipo(x.type)}: ${x.value}`);
    this.lista(out, "direccion", (a as unknown as { address_list?: Direccion[] })?.address_list, (d as unknown as { address_list: Direccion[] }).address_list, (x) =>
      [[x.street, x.locality, x.city, x.postal, x.county, x.state, x.country].filter(Boolean).join(", "), textoFecha(x.date as never), x.phone].filter(Boolean).join(" · "));
    this.lista(out, "url", (a as unknown as { urls?: Url[] })?.urls, (d as unknown as { urls: Url[] }).urls, (x) => (x.desc ? `${x.desc}: ${x.path}` : x.path));
    this.lista(out, "asociacion", (a as unknown as { person_ref_list?: Asociacion[] })?.person_ref_list, (d as unknown as { person_ref_list: Asociacion[] }).person_ref_list,
      (x) => `${x.rel}: ${this.nombre("Person", x.ref)}`);
    this.referencias(out, "Note", a?.note_list ?? [], d.note_list);
    this.fotos(out, a?.media_list ?? [], d.media_list);
    this.familias(out, "familiaPadres", a?.parent_family_list ?? [], d.parent_family_list);
    this.familias(out, "familiaPropia", a?.family_list ?? [], d.family_list);
    return ["primary_name", "gender", "alternate_names", "event_ref_list", "attribute_list", "address_list", "urls", "person_ref_list", "note_list", "media_list",
      "parent_family_list", "family_list"];
  }

  private familia(out: string[], a: Familia | null, d: Familia): string[] {
    const nueva = !a;
    const persona = (h: string | null | undefined, version: "antes" | "ahora") =>
      (h ? this.nombre("Person", h, version === "antes" ? this.antes("Person", h) : this.ahora("Person", h)) : "");
    this.campo(out, t("cambio.rotulo.padre"), nueva, persona(a?.father_handle, "antes"), persona(d.father_handle, "ahora"));
    this.campo(out, t("cambio.rotulo.madre"), nueva, persona(a?.mother_handle, "antes"), persona(d.mother_handle, "ahora"));
    this.campo(out, t("ficha.tipoRelacion"), nueva, a ? this.tipo(a.type) : "", this.tipo(d.type));
    // Hijos.
    const ha = (a?.child_ref_list ?? []).map((r) => r.ref);
    const hd = d.child_ref_list.map((r) => r.ref);
    // «Hija» si es mujer; si no, «hijo».
    const hijo = (h: string, que: "nuevo" | "anadido" | "quitado", o: ObjetoGramps | null) =>
      t(`cambio.${(o as unknown as Persona | null)?.gender === 0 ? "hija" : "hijo"}.${que}` as Clave, { x: this.nombre("Person", h, o) });
    for (const r of d.child_ref_list) {
      if (!ha.includes(r.ref)) {
        out.push(hijo(r.ref, this.cambio("Person", r.ref)?.operacion === "crear" ? "nuevo" : "anadido", this.ahora("Person", r.ref)));
        continue;
      }
      const ra = a!.child_ref_list.find((x) => x.ref === r.ref) as ChildRef;
      for (const [campo, quien] of [["frel", "cambio.conPadre"], ["mrel", "cambio.conMadre"]] as const) {
        if (json(ra[campo]) !== json(r[campo])) {
          out.push(t("cambio.filiacion", { x: this.nombre("Person", r.ref), quien: t(quien), antes: this.tipo(ra[campo]), despues: this.tipo(r[campo]) }));
        }
      }
    }
    for (const h of ha) if (!hd.includes(h)) out.push(hijo(h, "quitado", this.antes("Person", h)));
    if (json(ha.filter((h) => hd.includes(h))) !== json(hd.filter((h) => ha.includes(h)))) out.push(t("cambio.hijo.orden"));
    this.eventos(out, a?.event_ref_list ?? [], d.event_ref_list);
    this.lista(out, "atributo", (a as unknown as { attribute_list?: Atributo[] })?.attribute_list, (d as unknown as { attribute_list: Atributo[] }).attribute_list, (x) => `${this.tipo(x.type)}: ${x.value}`);
    this.referencias(out, "Note", a?.note_list ?? [], d.note_list);
    this.fotos(out, a?.media_list ?? [], d.media_list);
    return ["father_handle", "mother_handle", "type", "child_ref_list", "event_ref_list", "attribute_list", "note_list", "media_list"];
  }

  private evento(out: string[], a: Evento | null, d: Evento): string[] {
    const nuevo = !a;
    this.campo(out, t("col.tipo"), nuevo, a ? this.tipo(a.type) : "", this.tipo(d.type));
    this.campo(out, t("col.fecha"), nuevo, a ? textoFecha(a.date as never) : "", textoFecha(d.date as never));
    if (d.place && this.cambio("Place", d.place)?.operacion === "crear") this.absorber("Place", d.place);
    this.campo(out, t("col.lugar"), nuevo, this.lugar(a?.place, "antes"), this.lugar(d.place));
    this.campo(out, t("col.descripcion"), nuevo, texto(a?.description), texto(d.description));
    this.referencias(out, "Note", a?.note_list ?? [], d.note_list);
    this.fotos(out, a?.media_list ?? [], d.media_list);
    return ["type", "date", "place", "description", "note_list", "media_list"];
  }

  private lugarL(out: string[], a: Lugar | null, d: Lugar): string[] {
    const nuevo = !a;
    this.campo(out, t("lugar.nombre"), nuevo, texto(a?.name?.value), texto(d.name.value));
    this.campo(out, t("col.tipo"), nuevo, a ? this.tipo(a.place_type) : "", this.tipo(d.place_type));
    const sa = (a?.placeref_list ?? []).map((r) => r.ref);
    const sd = d.placeref_list.map((r) => r.ref);
    for (const h of sd) if (!sa.includes(h)) out.push(t("cambio.superior.anadido", { x: this.lugar(h) }));
    for (const h of sa) if (!sd.includes(h)) out.push(t("cambio.superior.quitado", { x: this.lugar(h, "antes") }));
    const coords = (l: Lugar | null) => (l && (l.lat || l.long) ? `${l.lat}, ${l.long}` : "");
    this.campo(out, t("lugar.coordenadas"), nuevo, coords(a), coords(d));
    return ["name", "place_type", "placeref_list", "lat", "long"];
  }

  private nota(out: string[], a: Nota | null, d: Nota): string[] {
    const nueva = !a;
    this.campo(out, t("col.tipo"), nueva, a ? this.tipo(a.type) : "", this.tipo(d.type));
    this.campo(out, t("nota.texto"), nueva, a ? corto(a.text.string, 80) : "", corto(d.text.string, 80));
    return ["type", "text"];
  }

  private foto(out: string[], a: Multimedia | null, d: Multimedia): string[] {
    const nueva = !a;
    this.campo(out, t("col.descripcion"), nueva, texto(a?.desc), texto(d.desc));
    this.campo(out, t("col.fecha"), nueva, a ? textoFecha(a.date as never) : "", textoFecha(d.date as never));
    return ["desc", "date", "path", "mime", "checksum"];
  }
}

/** El nombre completo de un nombre de persona (como `textoNombre` del
 * editor de nombres). */
function textoNombre(n: Nombre): string {
  const apellidos = n.surname_list.map((s) => [s.prefix, s.surname, s.connector].filter(Boolean).join(" ")).filter(Boolean).join(" ");
  return [n.title, n.first_name, apellidos, n.suffix].filter(Boolean).join(" ") || t("persona.sinNombre");
}
