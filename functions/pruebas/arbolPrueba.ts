/**
 * Árbol inventado para las pruebas del servidor, hecho con las plantillas
 * de Gramps (comun/esquema.ts), e invitaciones de cada tipo.
 *
 *   Abuelo ─┬─ (sin pareja)          fAbuelos
 *           ├─ Padre ─┬─ Madre       fPadres
 *           │         ├─ P ─┬─ C     fP
 *           │         │     └─ H
 *           │         └─ Hermano
 *           └─ Tio
 *
 * Eventos: E1 (nacimiento de P), E2 (compartido por P y Tio), E3 (de
 * Tio, con el tipo propio «Separación», como código: «@separacion»). Lugar L1 (migrado, sin creador).
 * Nota N1 (de Tio).
 */
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { plantilla } from "../../comun/esquema.ts";
import type { ObjetoGramps, Tipo } from "../../comun/gramps.ts";

type O = Record<string, any>;

export const CORREOS = {
  familiar: "p@example.com",
  otro: "otro@example.com",
  revisor: "r@example.com",
  admin: "a@example.com",
  revocada: "x@example.com",
  sinPersona: "s@example.com",
};

export const INVITACIONES: Record<string, { persona: string | null; rol: string; estado: string }> = {
  [CORREOS.familiar]: { persona: "P", rol: "familiar", estado: "activa" },
  [CORREOS.otro]: { persona: "Tio", rol: "familiar", estado: "activa" },
  [CORREOS.revisor]: { persona: "P", rol: "revisor", estado: "activa" },
  [CORREOS.admin]: { persona: null, rol: "administrador", estado: "activa" },
  [CORREOS.revocada]: { persona: "P", rol: "familiar", estado: "revocada" },
  [CORREOS.sinPersona]: { persona: null, rol: "familiar", estado: "activa" },
};

// Un contador por prefijo, como Gramps (I0001, F0001…).
const contadores = new Map<string, number>();
const id = (prefijo: string) => {
  const n = (contadores.get(prefijo) ?? 0) + 1;
  contadores.set(prefijo, n);
  return `${prefijo}${String(n).padStart(4, "0")}`;
};

export function persona(handle: string, nombre: string, campos: O = {}): O {
  const p = plantilla<O>("Person");
  p.handle = handle;
  p.gramps_id = id("I");
  p.change = 1_700_000_000;
  p.gender = 2;
  p.primary_name.first_name = nombre;
  return Object.assign(p, campos);
}

export function familia(handle: string, padre: string | null, madre: string | null, hijos: string[], campos: O = {}): O {
  const f = plantilla<O>("Family");
  f.handle = handle;
  f.gramps_id = id("F");
  f.change = 1_700_000_000;
  f.father_handle = padre;
  f.mother_handle = madre;
  f.child_ref_list = hijos.map((h) => ({ ...plantilla<O>("ChildRef"), ref: h }));
  return Object.assign(f, campos);
}

export function evento(handle: string, campos: O = {}): O {
  const e = plantilla<O>("Event");
  e.handle = handle;
  e.gramps_id = id("E");
  e.change = 1_700_000_000;
  return Object.assign(e, campos);
}

export const refEvento = (h: string): O => ({ ...plantilla<O>("EventRef"), ref: h });

export function lugar(handle: string, nombre: string): O {
  const l = plantilla<O>("Place");
  l.handle = handle;
  l.gramps_id = id("P");
  l.change = 1_700_000_000;
  l.name = { ...plantilla<O>("PlaceName"), value: nombre };
  return l;
}

export function nota(handle: string, texto: string): O {
  const o = plantilla<O>("Note");
  o.handle = handle;
  o.gramps_id = id("N");
  o.change = 1_700_000_000;
  o.text.string = texto;
  return o;
}

export function arbolPrueba(): Partial<Record<Tipo, ObjetoGramps[]>> {
  contadores.clear();
  const pf = (...f: string[]) => ({ parent_family_list: f });
  const fl = (...f: string[]) => ({ family_list: f });
  return {
    Person: [
      persona("Abuelo", "Abuelo", fl("fAbuelos")),
      persona("Padre", "Padre", { ...pf("fAbuelos"), ...fl("fPadres") }),
      persona("Tio", "Tío", { ...pf("fAbuelos"), event_ref_list: [refEvento("E3"), refEvento("E2")], note_list: ["N1"] }),
      persona("Madre", "Madre", fl("fPadres")),
      persona("P", "P", { ...pf("fPadres"), ...fl("fP"), event_ref_list: [refEvento("E1"), refEvento("E2")], birth_ref_index: 0 }),
      persona("Hermano", "Hermano", pf("fPadres")),
      persona("C", "Cónyuge", fl("fP")),
      persona("H", "Hijo", pf("fP")),
    ] as ObjetoGramps[],
    Family: [
      familia("fAbuelos", "Abuelo", null, ["Padre", "Tio"]),
      familia("fPadres", "Padre", "Madre", ["P", "Hermano"]),
      familia("fP", "P", "C", ["H"]),
    ] as ObjetoGramps[],
    Event: [
      evento("E1", { type: { _class: "EventType", value: 12, string: "" }, place: "L1" }),
      evento("E2", { description: "compartido" }),
      evento("E3", { description: "del tío", type: { _class: "EventType", value: 0, string: "@separacion" } }),
    ] as ObjetoGramps[],
    Place: [lugar("L1", "Madrid")] as ObjetoGramps[],
    Note: [nota("N1", "Nota del tío")] as ObjetoGramps[],
  };
}

/** El árbol como JSON de la web, en un fichero temporal, para cargar(). */
export function ficheroArbolPrueba(): string {
  const objetos = arbolPrueba();
  const ruta = path.join(os.tmpdir(), `arbol-prueba-${process.pid}.json`);
  writeFileSync(ruta, JSON.stringify({
    version_formato: 1, generado: "2026-10-24T00:00:00Z", origen: "pruebas", version_gramps: "6.0.5",
    base_multimedia: os.tmpdir(), persona_inicio: "P", objetos,
  }));
  return ruta;
}
