/**
 * Índice de relaciones (docs/diseno-fase-3.md, 1.4; docs/edicion.md): lo
 * que hace falta para calcular la rama de un usuario, los permisos sobre
 * eventos, notas, citas y fotos («todo lo que lo usa está en la rama») y
 * la integridad de un cambio, sin leer todos los objetos del árbol.
 *
 * - personas: de cada persona, sus familias como hijo (pf) y propias (f),
 *   tal como las guarda la persona;
 * - familias: de cada familia, padre (p), madre (m) e hijos (h, con el tipo
 *   de filiación con el padre y con la madre), tal como los guarda la
 *   familia;
 * - referentes: de cada objeto, quién lo referencia («Person_X»,
 *   «Event_Y»…), sea cual sea el campo; solo los referenciados. Sirve para
 *   los permisos por uso y para que un borrado no deje referencias
 *   colgando;
 * - objetos: los handles de los tipos que no son persona ni familia (para
 *   saber si existen).
 *
 * Lo construye la carga (sistema/indice) y lo mantiene al día la función
 * del servidor en la misma transacción que cada cambio; la web lo construye
 * con el mismo código desde la instantánea.
 */
import { clave, esMapa, TIPOS, type ObjetoGramps, type Tipo } from "./gramps.ts";
import { referenciasDe } from "./referencias.ts";

export const VERSION_INDICE = 1;

export interface HijoIndice {
  ref: string;
  /** Tipo de filiación con el padre y con la madre (ChildRefType). */
  frel: number;
  mrel: number;
}

export interface PersonaIndice {
  pf: string[];
  f: string[];
}

export interface FamiliaIndice {
  p: string | null;
  m: string | null;
  h: HijoIndice[];
}

/** Tipos que no son persona ni familia (sus handles van en «objetos»). */
export type TipoReferenciado = Exclude<Tipo, "Person" | "Family">;
export const TIPOS_REFERENCIADOS = TIPOS.filter((t): t is TipoReferenciado => t !== "Person" && t !== "Family");

/** El índice tal como se guarda (JSON). */
export interface IndiceJson {
  version: number;
  /** Último cambio del registro incorporado (0 tras la carga). */
  secuencia: number;
  personas: Record<string, PersonaIndice>;
  familias: Record<string, FamiliaIndice>;
  referentes: Record<Tipo, Record<string, string[]>>;
  objetos: Record<TipoReferenciado, string[]>;
}

/** Un objeto antes y después de un cambio (null si no existía o se borra). */
export interface CambioObjeto {
  tipo: Tipo;
  handle: string;
  antes: ObjetoGramps | null;
  despues: ObjetoGramps | null;
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);
const valor = (v: unknown): number => (esMapa(v) && typeof v.value === "number" ? v.value : 0);
const handleONull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function personaIndice(p: ObjetoGramps): PersonaIndice {
  return { pf: lista(p.parent_family_list), f: lista(p.family_list) };
}

export function familiaIndice(f: ObjetoGramps): FamiliaIndice {
  const hijos = Array.isArray(f.child_ref_list) ? f.child_ref_list : [];
  return {
    p: handleONull(f.father_handle),
    m: handleONull(f.mother_handle),
    h: hijos.filter(esMapa).map((c) => ({ ref: String(c.ref ?? ""), frel: valor(c.frel), mrel: valor(c.mrel) })).filter((c) => c.ref),
  };
}

/** Índice de relaciones en memoria, con conjuntos y mapas. */
export class Indice {
  secuencia: number;
  readonly personas = new Map<string, PersonaIndice>();
  readonly familias = new Map<string, FamiliaIndice>();
  /** «Event» → handle → claves de quienes lo referencian. */
  readonly referentes = new Map<Tipo, Map<string, Set<string>>>();
  readonly objetos = new Map<TipoReferenciado, Set<string>>();

  constructor(secuencia = 0) {
    this.secuencia = secuencia;
    for (const t of TIPOS) this.referentes.set(t, new Map());
    for (const t of TIPOS_REFERENCIADOS) this.objetos.set(t, new Set());
  }

  /** Índice de un árbol completo (objetos por tipo). */
  static desdeObjetos(objetos: Partial<Record<Tipo, ObjetoGramps[]>>, secuencia = 0): Indice {
    const ind = new Indice(secuencia);
    for (const tipo of TIPOS) {
      for (const o of objetos[tipo] ?? []) ind.anadir(tipo, o);
    }
    return ind;
  }

  static desdeJson(j: IndiceJson): Indice {
    if (j.version !== VERSION_INDICE) throw new Error(`Versión del índice no reconocida: ${j.version}`);
    const ind = new Indice(j.secuencia);
    for (const [h, p] of Object.entries(j.personas)) ind.personas.set(h, p);
    for (const [h, f] of Object.entries(j.familias)) ind.familias.set(h, f);
    for (const t of TIPOS_REFERENCIADOS) for (const h of j.objetos[t] ?? []) ind.objetos.get(t)!.add(h);
    for (const t of TIPOS) {
      for (const [h, refs] of Object.entries(j.referentes[t] ?? {})) ind.referentes.get(t)!.set(h, new Set(refs));
    }
    return ind;
  }

  /** Para guardarlo: con todo ordenado, para que dos índices iguales den el
   * mismo JSON. */
  aJson(): IndiceJson {
    const orden = <T>(m: Map<string, T>, f: (x: T) => unknown = (x) => x) =>
      Object.fromEntries([...m.keys()].sort().map((k) => [k, f(m.get(k)!)]));
    const referentes = {} as IndiceJson["referentes"];
    const objetos = {} as IndiceJson["objetos"];
    for (const t of TIPOS) referentes[t] = orden(this.referentes.get(t)!, (s) => [...s].sort()) as Record<string, string[]>;
    for (const t of TIPOS_REFERENCIADOS) objetos[t] = [...this.objetos.get(t)!].sort();
    return {
      version: VERSION_INDICE,
      secuencia: this.secuencia,
      personas: orden(this.personas) as Record<string, PersonaIndice>,
      familias: orden(this.familias) as Record<string, FamiliaIndice>,
      referentes,
      objetos,
    };
  }

  existe(tipo: Tipo, handle: string): boolean {
    if (tipo === "Person") return this.personas.has(handle);
    if (tipo === "Family") return this.familias.has(handle);
    return this.objetos.get(tipo)!.has(handle);
  }

  /** Quién referencia un objeto («Person_X»…). */
  referentesDe(tipo: Tipo, handle: string): string[] {
    return [...(this.referentes.get(tipo)!.get(handle) ?? [])];
  }

  private anadir(tipo: Tipo, o: ObjetoGramps) {
    if (tipo === "Person") this.personas.set(o.handle, personaIndice(o));
    else if (tipo === "Family") this.familias.set(o.handle, familiaIndice(o));
    else this.objetos.get(tipo)!.add(o.handle);
    const k = clave(tipo, o.handle);
    for (const r of referenciasDe(o)) {
      const m = this.referentes.get(r.tipo)!;
      if (!m.has(r.handle)) m.set(r.handle, new Set());
      m.get(r.handle)!.add(k);
    }
  }

  private quitar(tipo: Tipo, o: ObjetoGramps) {
    if (tipo === "Person") this.personas.delete(o.handle);
    else if (tipo === "Family") this.familias.delete(o.handle);
    else this.objetos.get(tipo)!.delete(o.handle);
    const k = clave(tipo, o.handle);
    for (const r of referenciasDe(o)) {
      const m = this.referentes.get(r.tipo)!;
      const s = m.get(r.handle);
      if (!s) continue;
      s.delete(k);
      if (!s.size) m.delete(r.handle);
    }
  }

  /** Aplica los cambios de una transacción (cada objeto con su estado antes
   * y después). */
  aplicar(cambios: CambioObjeto[], secuencia?: number): void {
    for (const c of cambios) if (c.antes) this.quitar(c.tipo, c.antes);
    for (const c of cambios) if (c.despues) this.anadir(c.tipo, c.despues);
    if (secuencia !== undefined) this.secuencia = secuencia;
  }

  /** Copia independiente (para calcular el índice «después» sin tocar el
   * de «antes»). */
  copia(): Indice {
    return Indice.desdeJson(this.aJson());
  }
}
