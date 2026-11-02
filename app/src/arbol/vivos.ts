// Quién se considera vivo: traducción del algoritmo «probablemente vivo» de
// Gramps (gramps/gen/utils/alive.py, clase ProbablyAlive y función
// probably_alive, Gramps 6.0.5), con las piezas de su clase Date que usa
// (gramps/gen/lib/date.py: comparación de fechas con márgenes, sumas de
// años y días, rangos). Decisión del 22/10/2026 (docs/decisiones-web-
// familiar.md, «Quién se considera vivo»):
// - Parámetros: edad máxima, años por generación y diferencia máxima entre
//   hermanos (120, 20 y 20 por defecto; los cambia el administrador). Los
//   demás, los de Gramps por defecto: 13 años como mínimo entre una
//   generación y la siguiente y 50 años de margen para «hacia», «antes de»
//   y «después de».
// - Además de lo que haga Gramps, una persona con defunción, entierro o
//   incineración, aunque sea sin datos, se considera fallecida. (Gramps,
//   si no puede estimar ninguna fecha, la considera viva.)
// - Las fechas estimadas solo sirven para este cálculo; no se muestran.
// La comparación persona a persona con la biblioteca de Gramps está en
// vivos.test.ts. Explicación: docs/libro.md.
//
// Original: Gramps, gramps/gen/utils/alive.py y gramps/gen/lib/date.py
//   Copyright (C) 2000-2007 Donald N. Allingham, 2009 Gary Burton,
//   2011 Tim G L Lyons, 2024 Cameron Davidson y otros.
//   GNU General Public License, versión 2 o posterior.

import { Calendar, Modifier, Quality, type GrampsDate } from "../gramps-connect/gramps-date";
import { aSdn, deSdn } from "./calendarios";
import type { Evento, Familia, Persona } from "./tipos";

/** Los tres parámetros que puede cambiar el administrador. */
export interface ParametrosVivos {
  /** Edad máxima de una persona, en años. */
  edadMaxima: number;
  /** Años entre una generación y la siguiente. */
  aniosGeneracion: number;
  /** Diferencia máxima de edad entre hermanos, en años. */
  difHermanos: number;
}

export const PARAMETROS_VIVOS_POR_DEFECTO: ParametrosVivos = { edadMaxima: 120, aniosGeneracion: 20, difHermanos: 20 };

/** Límites de cada parámetro (también en firestore.rules). */
export const LIMITES_VIVOS: Record<keyof ParametrosVivos, [number, number]> = {
  edadMaxima: [80, 150],
  aniosGeneracion: [10, 50],
  difHermanos: [5, 50],
};

/** Los parámetros si son válidos (las mismas condiciones que las reglas
 * de Firestore), o null. */
export function validarParametrosVivos(v: unknown): ParametrosVivos | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const claves = Object.keys(LIMITES_VIVOS) as (keyof ParametrosVivos)[];
  if (Object.keys(o).some((k) => !claves.includes(k as keyof ParametrosVivos))) return null;
  for (const k of claves) {
    const n = o[k];
    const [min, max] = LIMITES_VIVOS[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return null;
  }
  return { edadMaxima: o.edadMaxima as number, aniosGeneracion: o.aniosGeneracion as number, difHermanos: o.difHermanos as number };
}

// Valores de configuración de Gramps que no cambian aquí (gramps/gen/config.py).
const MIN_GENERACION = 13; // behavior.min-generation-years
const MARGEN = 50; // behavior.date-about-range, date-after-range, date-before-range

// EventType y EventRoleType de Gramps.
const NACIMIENTO = 12;
const DEFUNCION = 13;
const ROL_PRINCIPAL = 1;
const SUSTITUTOS_NACIMIENTO = [45, 15, 22]; // mortinato, bautismo, bautizo
const SUSTITUTOS_DEFUNCION = [45, 19, 24, 20, 39]; // mortinato, entierro, incineración, causa de muerte, testamentaría
// Los que, según las decisiones del 22/10/2026, bastan para dar a alguien
// por fallecido: defunción, entierro, incineración, mortinato, causa de
// muerte y testamentaría (los mismos que usa Gramps como prueba).
const FALLECIDO = [DEFUNCION, 19, 24, 45, 20, 39];

type Ymd = [number, number, number];

/** Compara dos (año, mes, día) como las tuplas de Python. */
function cmp(a: Ymd, b: Ymd): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Una fecha de Gramps con la parte de su comportamiento que usa el
 * cálculo (gramps/gen/lib/date.py, clase Date). */
export class Fecha {
  calendario: Calendar = Calendar.GREGORIAN;
  modificador: Modifier = Modifier.NONE;
  calidad: Quality = Quality.NONE;
  /** [día, mes, año, barra] y, si es compuesta, otros cuatro. */
  valor: number[] = [0, 0, 0, 0];
  orden = 0;
  /** Comienzo de año (0 = 1 de enero). */
  anioNuevo: unknown = 0;

  /** Date(y, m, d). */
  static ymd(y: number, m = 0, d = 0): Fecha {
    const f = new Fecha();
    f.ponerYmd(y, m, d);
    return f;
  }

  static de(g: GrampsDate): Fecha {
    const f = new Fecha();
    f.calendario = g.calendar;
    f.modificador = g.modifier;
    f.calidad = g.quality;
    f.valor = g.dateval.map((x) => Number(x));
    f.anioNuevo = g.newyear;
    f.orden = g.sortval ?? 0;
    return f;
  }

  copia(): Fecha {
    const f = new Fecha();
    f.calendario = this.calendario;
    f.modificador = this.modificador;
    f.calidad = this.calidad;
    f.valor = [...this.valor];
    f.orden = this.orden;
    f.anioNuevo = this.anioNuevo;
    return f;
  }

  esCompuesta(): boolean {
    return this.modificador === Modifier.RANGE || this.modificador === Modifier.SPAN;
  }

  esValida(): boolean {
    return this.modificador !== Modifier.TEXTONLY && this.orden !== 0;
  }

  private bajo(i: number): number {
    return this.modificador === Modifier.TEXTONLY ? 0 : this.valor[i];
  }

  anio(): number { return this.bajo(2); }
  mes(): number { return this.bajo(1); }
  dia(): number { return this.bajo(0); }
  anioValido(): boolean { return this.modificador !== Modifier.TEXTONLY && this.valor[2] !== 0; }

  private alto(i: number): number {
    return this.esCompuesta() ? this.valor[i] : 0;
  }

  /** _calc_sort_value. */
  calcularOrden() {
    const [d, m, y] = this.valor;
    if (y === 0 && m === 0 && d === 0) this.orden = 0;
    else this.orden = aSdn(this.calendario, y !== 0 ? y : 1, Math.max(m, 1), Math.max(d, 1));
  }

  /** set_yr_mon_day. */
  ponerYmd(y: number, m: number, d: number, quitarFin?: boolean) {
    if (this.esCompuesta() && quitarFin === undefined) throw new Error("Falta quitarFin en una fecha compuesta");
    this.valor[2] = y;
    this.valor[1] = m;
    this.valor[0] = d;
    this.calcularOrden();
    if (quitarFin && this.esCompuesta()) this.ponerYmd2(y, m, d);
  }

  /** _assert_compound. */
  private asegurarCompuesta() {
    if (!this.esCompuesta()) throw new Error("Solo para fechas compuestas");
    while (this.valor.length < 8) this.valor.push(0);
  }

  /** set2_yr_mon_day. */
  ponerYmd2(y: number, m: number, d: number) {
    this.asegurarCompuesta();
    this.valor[6] = y;
    this.valor[5] = m;
    this.valor[4] = d;
  }

  /** __set_yr_mon_day_offset: suma a una de las dos partes. */
  private sumarParte(year: number, month: number, day: number, py: number, pm: number, pd: number): boolean {
    const v = this.valor;
    if (v[py]) v[py] += year;
    else if (year) v[py] = year;
    if (v[pm]) v[pm] += month;
    else if (month) v[pm] = month < 0 ? 1 + month : month;
    if (month !== 0) {
      if (v[pm] === 0) {
        v[pm] = 12;
        v[py] -= 1;
      } else if (v[pm] < 0) {
        v[py] -= Math.floor(-v[pm] / 12) + 1;
        v[pm] = ((v[pm] % 12) + 12) % 12;
      } else if (v[pm] > 12 || v[pm] < 1) {
        v[py] += Math.floor(v[pm] / 12);
        v[pm] = v[pm] % 12;
      }
    }
    this.calcularOrden();
    return day !== 0 || v[pd] > 28;
  }

  /** offset: (año, mes, día) gregorianos de esta fecha más unos días. */
  private masDias(dias: number): Ymd {
    return deSdn(Calendar.GREGORIAN, this.orden + dias);
  }

  /** set_yr_mon_day_offset: suma a la fecha (a las dos partes, si es compuesta). */
  sumar(year = 0, month = 0, day = 0) {
    if (this.sumarParte(year, month, day, 2, 1, 0)) {
      const [y, m, d] = this.masDias(day);
      this.ponerYmd(y, m, d, false);
    }
    if (this.esCompuesta()) this.sumar2(year, month, day);
  }

  /** set2_yr_mon_day_offset. */
  sumar2(year = 0, month = 0, day = 0) {
    this.asegurarCompuesta();
    if (this.sumarParte(year, month, day, 6, 5, 4)) {
      const fin = Fecha.ymd(this.alto(6), this.alto(5), this.alto(4));
      const [y, m, d] = fin.masDias(day);
      this.ponerYmd2(y, m, d);
    }
  }

  /** copy_offset_ymd: copia sumada, en gregoriano y devuelta a su calendario. */
  copiaSumada(year = 0, month = 0, day = 0): Fecha {
    const original = this.calendario;
    const f = this.copia();
    if (original !== Calendar.GREGORIAN) f.convertir(Calendar.GREGORIAN);
    f.sumar(year, month, day);
    if (original === Calendar.GREGORIAN) return f;
    f.convertir(original);
    return f;
  }

  /** copy_ymd: copia con el año (y mes y día) dados. */
  copiaYmd(year = 0, month = 0, day = 0, quitarFin?: boolean): Fecha {
    const f = this.copia();
    f.ponerYmd(year, month, day, quitarFin);
    return f;
  }

  /** convert_calendar (known_valid = true). */
  convertir(calendario: Calendar) {
    if (calendario === this.calendario && !this.anioNuevo) return;
    const [y, m, d] = deSdn(calendario, this.orden);
    if (this.esCompuesta()) {
      const ry = this.valor[6] !== 0 ? this.valor[6] : 1;
      const sdn = aSdn(this.calendario, ry, Math.max(this.valor[5], 1), Math.max(this.valor[4], 1));
      const [ny, nm, nd] = deSdn(calendario, sdn);
      this.valor = [d, m, y, 0, nd, nm, ny, 0];
    } else {
      this.valor = [d, m, y, 0];
    }
    this.calendario = calendario;
    this.anioNuevo = 0;
  }

  /** get_start_stop_range: el comienzo más temprano y el final más tardío,
   * en gregoriano, con el margen de «hacia», «antes de» y «después de». */
  inicioFin(): [Ymd, Ymd] {
    const c = this.copia();
    c.convertir(Calendar.GREGORIAN);
    const inicio: Ymd = [c.valor[2], c.valor[1], c.valor[0]];
    let fin: Ymd = c.esCompuesta() ? [c.valor[6], c.valor[5], c.valor[4]] : [0, 0, 0];
    if (fin[0] === 0 && fin[1] === 0 && fin[2] === 0) fin = inicio;
    // Gramps pone aquí start[_POS_YR], que en esta tupla (año, mes, día)
    // es el día: se copia tal cual.
    let finMax: Ymd = [fin[0] === 0 ? inicio[2] : fin[0], fin[1] === 0 ? 12 : fin[1], fin[2] === 0 ? 31 : fin[2]];
    let inicioMin: Ymd = [inicio[0], inicio[1] === 0 ? 1 : inicio[1], inicio[2] === 0 ? 1 : inicio[2]];
    const masDias = (ymd: Ymd, dias: number) => Fecha.ymd(ymd[0], ymd[1], ymd[2]).masDias(dias);
    if (this.modificador === Modifier.BEFORE || this.modificador === Modifier.TO) {
      if (this.modificador === Modifier.BEFORE) finMax = masDias(inicioMin, -1);
      inicioMin = [finMax[0] - MARGEN, finMax[1], finMax[2]];
    } else if (this.modificador === Modifier.AFTER || this.modificador === Modifier.FROM) {
      if (this.modificador === Modifier.AFTER) inicioMin = masDias(finMax, 1);
      finMax = [inicioMin[0] + MARGEN, inicioMin[1], inicioMin[2]];
    } else if (this.modificador === Modifier.ABOUT || this.calidad === Quality.ESTIMATED) {
      inicioMin = [inicioMin[0] - MARGEN, inicioMin[1], inicioMin[2]];
      finMax = [finMax[0] + MARGEN, finMax[1], finMax[2]];
    }
    return [inicioMin, finMax];
  }

  /** match, con las comparaciones que usa el cálculo: «>=», «>» y «<»
   * (alguna parte de esta fecha antes o después que alguna de la otra). */
  coincide(otra: Fecha, comparacion: ">=" | ">" | "<"): boolean {
    if (this.modificador === Modifier.TEXTONLY || otra.modificador === Modifier.TEXTONLY) return false;
    if (this.orden === 0 || otra.orden === 0) return false;
    const [otraInicio, otraFin] = otra.inicioFin();
    const [inicio, fin] = this.inicioFin();
    switch (comparacion) {
      case "<": return cmp(inicio, otraFin) < 0;
      case ">": return cmp(fin, otraInicio) > 0;
      case ">=": return cmp(fin, otraInicio) >= 0;
    }
  }
}

/** Today() de Gramps: la fecha de hoy, sin hora. */
export function hoy(): Fecha {
  const d = new Date();
  return Fecha.ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Lo que el cálculo necesita del árbol. */
export interface DatosVivos {
  personas: Map<string, Persona>;
  familias: Map<string, Familia>;
  eventos: Map<string, Evento>;
}

interface Bd {
  nacimiento: Fecha | null;
  defuncion: Fecha | null;
  fallecida: boolean;
}

/** Fechas estimadas de nacimiento y defunción (null si no hay pruebas). */
export interface Estimacion {
  nacimiento: Fecha | null;
  defuncion: Fecha | null;
  explicacion: string;
}

const SIN_ESTIMACION: Estimacion = { nacimiento: null, defuncion: null, explicacion: "" };

/** ProbablyAlive. */
class ProbablementeVivo {
  private vistos = new Set<string>();

  /** `hoy`: Gramps usa la fecha de hoy (Today()) en un paso del cálculo,
   * aunque se pida para otra fecha. */
  constructor(private readonly d: DatosVivos, private readonly p: ParametrosVivos, private readonly hoy: Fecha) {}

  private persona(h: string | null | undefined): Persona | null {
    return (h && this.d.personas.get(h)) || null;
  }

  private familia(h: string | null | undefined): Familia | null {
    return (h && this.d.familias.get(h)) || null;
  }

  private evento(h: string): Evento | null {
    return this.d.eventos.get(h) ?? null;
  }

  /** get_primary_event_ref_list. */
  private eventosPrincipales(p: Persona): Evento[] {
    return p.event_ref_list
      .filter((r) => r.role.value === ROL_PRINCIPAL)
      .map((r) => this.evento(r.ref))
      .filter((e): e is Evento => !!e);
  }

  /** get_person_bd: fechas reales (o de sus sustitutos) de una persona. */
  private bd(h: Persona | string | null | undefined): Bd {
    const p = typeof h === "string" || h == null ? this.persona(h) : h;
    const r: Bd = { nacimiento: null, defuncion: null, fallecida: false };
    if (!p) return r;
    const refDef = p.death_ref_index >= 0 ? p.event_ref_list[p.death_ref_index] : null;
    if (refDef && refDef.role.value === ROL_PRINCIPAL) {
      const ev = this.evento(refDef.ref);
      if (ev) {
        r.fallecida = true;
        const f = Fecha.de(ev.date);
        if (f.esValida()) r.defuncion = f;
      }
    }
    if (!r.defuncion) {
      for (const ev of this.eventosPrincipales(p)) {
        if (SUSTITUTOS_DEFUNCION.includes(ev.type.value as number)) {
          const f = Fecha.de(ev.date);
          r.fallecida = true;
          if (f.esValida()) {
            if (f.modificador === Modifier.NONE) f.modificador = Modifier.BEFORE;
            r.defuncion = f;
            break;
          }
        }
      }
    }
    const refNac = p.birth_ref_index >= 0 ? p.event_ref_list[p.birth_ref_index] : null;
    if (refNac && refNac.role.value === ROL_PRINCIPAL) {
      const ev = this.evento(refNac.ref);
      if (ev) {
        const f = Fecha.de(ev.date);
        if (f.esValida()) r.nacimiento = f;
      }
    }
    if (!r.nacimiento) {
      for (const ev of this.eventosPrincipales(p)) {
        if (SUSTITUTOS_NACIMIENTO.includes(ev.type.value as number)) {
          const f = Fecha.de(ev.date);
          if (f.esValida()) {
            r.nacimiento = f;
            break;
          }
        }
      }
    }
    return r;
  }

  /** probably_alive_range. */
  rango(persona: Persona, esConyuge = false, soloInmediata = false): Estimacion {
    const P = this.p;
    this.vistos = new Set();
    let minNac: number | null = null;
    let maxNac: number | null = null;
    let minNacPorDef: number | null = null;
    let maxNacPorDef: number | null = null;
    let hermMin: number | null = null;
    let hermMax: number | null = null;
    let familiaPadres: string | null = null;

    const propia = this.bd(persona);
    let nacimiento: Fecha | null = propia.nacimiento;
    let defuncion: Fecha | null = propia.defuncion;
    const fallecida = propia.fallecida;
    const directa = nacimiento !== null;
    if (nacimiento && defuncion) return { nacimiento, defuncion, explicacion: "directa" };

    if (nacimiento === null) {
      if (defuncion !== null && defuncion.anioValido()) {
        maxNacPorDef = defuncion.anio();
        minNacPorDef = maxNacPorDef - P.edadMaxima;
      }
      let madre: Bd = { nacimiento: null, defuncion: null, fallecida: false };
      let padre: Bd = madre;
      familiaPadres = persona.parent_family_list[0] ?? null;
      let padres: Familia | null = null;
      if (familiaPadres) {
        padres = this.familia(familiaPadres);
        if (padres) {
          madre = this.bd(padres.mother_handle);
          padre = this.bd(padres.father_handle);
        }
      }
      for (const hf of persona.parent_family_list) {
        const f = this.familia(hf);
        if (!f) continue;
        if (padres !== null && hf !== familiaPadres) continue;
        for (const cr of f.child_ref_list) {
          const hijo = this.persona(cr.ref);
          if (!hijo || hijo.handle === persona.handle) continue;
          let faltaNac = true;
          for (const ev of this.eventosPrincipales(hijo)) {
            if (ev.type.value === NACIMIENTO) {
              const fd = Fecha.de(ev.date);
              if (fd.anioValido()) {
                const y = fd.anio();
                faltaNac = false;
                if (hermMin === null || y < hermMin) hermMin = y;
                if (hermMax === null || y > hermMax) hermMax = y;
              }
            }
          }
          if (faltaNac) {
            for (const ev of this.eventosPrincipales(hijo)) {
              if (SUSTITUTOS_NACIMIENTO.includes(ev.type.value as number)) {
                const fd = Fecha.de(ev.date);
                if (fd.anioValido()) {
                  const y = fd.anio();
                  if (hermMin === null || y < hermMin) hermMin = y;
                  if (hermMax === null || y > hermMax) hermMax = y;
                }
              }
            }
          }
        }
      }
      if (madre.nacimiento) minNac = madre.nacimiento.anio() + MIN_GENERACION;
      if (padre.nacimiento) {
        const v = padre.nacimiento.anio() + MIN_GENERACION;
        if (minNac === null || v > minNac) minNac = v;
      }
      if (minNacPorDef) {
        if (minNac === null || minNacPorDef > minNac) minNac = minNacPorDef;
      }
      if (madre.defuncion) maxNac = madre.defuncion.anio();
      if (padre.defuncion) {
        const v = padre.defuncion.anio() + 1;
        if (maxNac === null || v < maxNac) maxNac = v;
      }
      if (maxNacPorDef) {
        if (maxNac === null || maxNacPorDef < maxNac) maxNac = maxNacPorDef;
      }
      if (hermMax) {
        const v = hermMax - P.difHermanos;
        if (minNac === null || v > minNac) minNac = v;
        const w = hermMin! + P.difHermanos;
        if (maxNac === null || w < maxNac) maxNac = w;
      }
    }

    if (nacimiento === null || !nacimiento.esValida()) {
      nacimiento = new Fecha();
      if (minNac && maxNac) {
        nacimiento.modificador = Modifier.RANGE;
        nacimiento.valor = [0, 0, minNac, 0, 0, 0, maxNac, 0];
        nacimiento.calcularOrden();
      } else if (minNac) {
        nacimiento.ponerYmd(minNac, 1, 1);
        nacimiento.modificador = Modifier.AFTER;
      } else if (maxNac) {
        nacimiento.ponerYmd(maxNac, 12, 31);
        nacimiento.modificador = Modifier.BEFORE;
      }
      nacimiento.calcularOrden();
    }

    if (defuncion === null) {
      if (nacimiento.esValida()) {
        defuncion = nacimiento.copia();
        let maxDef = nacimiento.copiaSumada(P.edadMaxima);
        if (fallecida) {
          const h = this.hoy.copia();
          if (maxDef.coincide(h, ">=")) {
            maxDef = h;
            maxDef.sumar(0, 0, -1);
          }
          defuncion.modificador = Modifier.RANGE;
          defuncion.ponerYmd2(maxDef.anio(), maxDef.mes(), maxDef.dia());
        } else {
          defuncion.sumar(P.edadMaxima);
        }
        defuncion.calcularOrden();
      } else {
        defuncion = new Fecha();
      }
    }

    if (nacimiento.esValida() && defuncion.esValida()) {
      return { nacimiento, defuncion, explicacion: directa ? "directa" : "padres y hermanos" };
    }

    const conyuge = (soloInmediataConyuge: boolean): Estimacion => {
      for (const hf of persona.family_list) {
        const f = this.familia(hf);
        if (!f) continue;
        const hm = f.mother_handle;
        const hp = f.father_handle;
        if (hm == null || hp == null) continue;
        let otro: Persona | null = null;
        if (hm === persona.handle) otro = this.persona(hp);
        else if (hp === persona.handle) otro = this.persona(hm);
        if (otro) {
          const e = this.rango(otro, true, soloInmediataConyuge);
          if (e.nacimiento && e.nacimiento.anio() !== 0) {
            const n = e.nacimiento.copiaSumada(-P.aniosGeneracion);
            if (n.esCompuesta()) {
              n.sumar2(2 * P.aniosGeneracion);
            } else {
              n.modificador = Modifier.RANGE;
              n.ponerYmd2(e.nacimiento.anio(), e.nacimiento.mes(), e.nacimiento.dia());
              n.sumar2(P.aniosGeneracion);
            }
            return { nacimiento: n, defuncion: n.copiaSumada(P.edadMaxima), explicacion: "nacimiento del cónyuge, " + e.explicacion };
          }
          if (e.defuncion && e.defuncion.anio() !== 0) {
            return {
              nacimiento: new Fecha().copiaYmd(e.defuncion.anio() + P.aniosGeneracion - P.edadMaxima),
              defuncion: new Fecha().copiaYmd(e.defuncion.anio() + P.aniosGeneracion),
              explicacion: "defunción del cónyuge, " + e.explicacion,
            };
          }
        }
        for (const r of f.event_ref_list) {
          const ev = this.evento(r.ref);
          if (!ev) continue;
          const y = Fecha.de(ev.date).anio();
          if (y !== 0) {
            return {
              nacimiento: new Fecha().copiaYmd(y - P.aniosGeneracion),
              defuncion: new Fecha().copiaYmd(y - P.aniosGeneracion + P.edadMaxima),
              explicacion: "evento con el cónyuge",
            };
          }
        }
      }
      return SIN_ESTIMACION;
    };

    if (!esConyuge) {
      const e = conyuge(true);
      if (e.nacimiento && e.defuncion) return e;
    } else if (soloInmediata) {
      return SIN_ESTIMACION;
    }

    // Descendientes.
    type Desc = { bmin: number | null; bmax: number | null; dmin: number | null; dmax: number | null; gen: number | null };
    const NINGUNO: Desc = { bmin: null, bmax: null, dmin: null, dmax: null, gen: null };
    const descendientes = (p: Persona, generacion: number): Desc => {
      if (this.vistos.has(p.handle)) return NINGUNO;
      this.vistos.add(p.handle);
      const hijos: string[] = [];
      let bmin: number | null = null;
      let bmax: number | null = null;
      let dmin: number | null = null;
      let dmax: number | null = null;
      for (const hf of p.family_list) {
        const f = this.familia(hf);
        if (!f) continue;
        for (const cr of f.child_ref_list) {
          const b = this.bd(cr.ref);
          hijos.push(cr.ref);
          if (b.nacimiento !== null) {
            const y = b.nacimiento.anio();
            if (bmin === null || y < bmin) bmin = y;
            if (bmax === null || y > bmax) bmax = y;
          }
          if (b.defuncion !== null) {
            const y = b.defuncion.anio();
            if (dmin === null || y < dmin) dmin = y;
            if (dmax === null || y > dmax) dmax = y;
          }
        }
      }
      if (bmin !== null || dmin !== null) return { bmin, bmax, dmin, dmax, gen: generacion };
      const siguiente: Desc[] = [];
      let minGen: number | null = null;
      for (const h of hijos) {
        const hijo = this.persona(h);
        if (!hijo) continue;
        const r = descendientes(hijo, generacion + 1);
        if (r.gen !== null) {
          if (minGen === null || r.gen < minGen) minGen = r.gen;
          siguiente.push(r);
        }
      }
      if (minGen === null) return NINGUNO;
      let gbmin: number | null = null;
      let gbmax: number | null = null;
      let gdmin: number | null = null;
      let gdmax: number | null = null;
      for (const r of siguiente) {
        if (r.gen! > minGen) continue;
        if (r.bmin !== null) {
          if (gbmin === null || r.bmin < gbmin) gbmin = r.bmin;
          if (gbmax === null || r.bmax! > gbmax) gbmax = r.bmax;
        }
        if (r.dmin !== null) {
          if (gdmin === null || r.dmin < gdmin) gdmin = r.dmin;
          if (gdmax === null || r.dmax! > gdmax) gdmax = r.dmax;
        }
      }
      if (gbmin !== null || gdmin !== null) return { bmin: gbmin, bmax: gbmax, dmin: gdmin, dmax: gdmax, gen: minGen };
      return NINGUNO;
    };

    const r = descendientes(persona, 1);
    if (r.bmin !== null) {
      const media = (r.bmin + r.bmax!) / 2;
      const n = Fecha.ymd(Math.trunc(media - r.gen! * P.aniosGeneracion), 1, 1);
      n.modificador = Modifier.ABOUT;
      return { nacimiento: n, defuncion: n.copiaSumada(P.edadMaxima), explicacion: `nacimiento de descendientes: ${r.gen} generaciones` };
    }
    if (r.dmin !== null) {
      let superior = r.dmin - r.gen! * MIN_GENERACION;
      let inferior = r.dmax! - (r.gen! * P.aniosGeneracion + P.edadMaxima);
      if (inferior > superior) [superior, inferior] = [inferior, superior];
      const n = Fecha.ymd(inferior, 1, 1);
      n.modificador = Modifier.RANGE;
      n.ponerYmd2(superior, 1, 1);
      return { nacimiento: n, defuncion: n.copiaSumada(P.edadMaxima), explicacion: `defunción de descendientes: ${r.gen} generaciones` };
    }

    this.vistos = new Set();

    // Ascendientes.
    type Asc = { nacimiento: Fecha; defuncion: Fecha; explicacion: string; gen: number } | null;
    const ascendientes = (p: Persona, anios: number, generacion: number): Asc => {
      if (this.vistos.has(p.handle)) return null;
      this.vistos.add(p.handle);
      const hf = p.parent_family_list[0];
      if (!hf) return null;
      const f = this.familia(hf);
      if (!f) return null;
      const hm = f.mother_handle;
      const hp = f.father_handle;
      const madre = this.bd(hm);
      const padre = this.bd(hp);
      let nacPadre = madre.nacimiento;
      let quien = "madre";
      if (nacPadre === null) {
        nacPadre = padre.nacimiento;
        quien = "padre";
      } else if (padre.nacimiento !== null && padre.nacimiento.coincide(madre.nacimiento!, ">")) {
        nacPadre = padre.nacimiento;
        quien = "padre";
      }
      if (nacPadre !== null) {
        const n = nacPadre.copiaSumada(anios);
        return { nacimiento: n, defuncion: n.copiaSumada(P.edadMaxima), explicacion: `nacimiento de ${quien} de un ascendiente`, gen: generacion };
      }
      let primera = madre.defuncion;
      let ultima = madre.defuncion;
      quien = "madre";
      if (ultima === null) {
        primera = ultima = padre.defuncion;
        quien = "padre";
      } else if (padre.defuncion !== null && padre.defuncion.coincide(madre.defuncion!, ">")) {
        ultima = padre.defuncion;
        quien = "padre";
        primera = madre.defuncion;
      }
      if (ultima !== null) {
        const n = ultima.copiaSumada(anios - P.edadMaxima);
        n.modificador = Modifier.RANGE;
        n.ponerYmd2(anios + primera!.anio(), 1, 1);
        return { nacimiento: n, defuncion: n.copiaSumada(P.edadMaxima), explicacion: `defunción de ${quien} de un ascendiente`, gen: generacion };
      }
      let m: Asc = null;
      let pa: Asc = null;
      const pm = this.persona(hm);
      if (hm != null && pm) m = ascendientes(pm, anios + P.aniosGeneracion, generacion + 1);
      const pp = this.persona(hp);
      if (hp != null && pp) pa = ascendientes(pp, anios + P.aniosGeneracion, generacion + 1);
      if (m && pa) return pa.gen < m.gen ? pa : m;
      return m ?? pa;
    };

    if (familiaPadres) {
      const a = ascendientes(persona, Math.trunc(P.aniosGeneracion), 1);
      if (a) return a;
    }

    if (!esConyuge) {
      const e = conyuge(false);
      if (e.nacimiento && e.defuncion) return e;
    }
    return SIN_ESTIMACION;
  }
}

/** probably_alive: ¿puede estar viva en la fecha dada (hoy, si no se da)?
 * Solo el algoritmo de Gramps, sin la regla añadida de la decisión. */
export function probablementeVivaGramps(
  persona: Persona, datos: DatosVivos, parametros: ParametrosVivos, fecha: Fecha = hoy(), hoyGramps: Fecha = hoy(),
): { viva: boolean; estimacion: Estimacion } {
  const e = new ProbablementeVivo(datos, parametros, hoyGramps).rango(persona);
  if (!e.nacimiento || !e.defuncion) return { viva: true, estimacion: e };
  return { viva: fecha.coincide(e.nacimiento, ">=") && fecha.coincide(e.defuncion, "<"), estimacion: e };
}

/** ¿Tiene defunción, entierro, incineración, mortinato, causa de muerte o
 * testamentaría (aunque sea sin fecha)? Basta para darla por fallecida
 * (decisiones del 22/10/2026). */
export function constaFallecida(persona: Persona, datos: DatosVivos): boolean {
  const ref = persona.death_ref_index >= 0 ? persona.event_ref_list[persona.death_ref_index] : null;
  if (ref && datos.eventos.get(ref.ref)?.type.value === DEFUNCION) return true;
  return persona.event_ref_list.some((r) => r.role.value === ROL_PRINCIPAL && FALLECIDO.includes(datos.eventos.get(r.ref)?.type.value as number));
}

/** Quién se considera vivo: el algoritmo de Gramps más la regla de la
 * decisión. Para todas las personas del árbol. */
export function personasVivas(datos: DatosVivos, parametros: ParametrosVivos, fecha: Fecha = hoy(), hoyGramps: Fecha = hoy()): Set<string> {
  const vivas = new Set<string>();
  for (const p of datos.personas.values()) {
    if (constaFallecida(p, datos)) continue;
    if (probablementeVivaGramps(p, datos, parametros, fecha, hoyGramps).viva) vivas.add(p.handle);
  }
  return vivas;
}
