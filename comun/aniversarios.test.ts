// Calendario de aniversarios (docs/calendario.md): qué fechas cuentan, el
// 29 de febrero, rangos que cruzan el fin de año, años que cumple o que
// hace, vivos y fallecidos, bodas con divorcio o separación, la semana y el
// mes del correo y sus textos. Árbol inventado.
// Uso: npm run pruebas-comun
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aniversarios, asuntoCorreo, diaSemana, introCorreo, periodoCorreo, fechaExacta, fechaLarga, leerTiposCorreo, periodosDelDia, porDia, textoAniversario,
  type Aniversario, type DatosAniversarios, type Dia, type Traducir,
} from "./aniversarios.ts";
import { es } from "../app/src/i18n/es.ts";

const t: Traducir = (clave, valores) => Object.entries(valores ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), es[clave] as string);

type F = { modifier: number; quality: number; calendar: number; dateval: (number | boolean)[] };
const fecha = (y: number, m: number, d: number, extra: Partial<F> = {}): F => ({ modifier: 0, quality: 0, calendar: 0, dateval: [d, m, y, false], ...extra });

/** Un árbol pequeño: personas con nacimiento y defunción, y familias con
 * su tipo y sus eventos. */
function arbol(
  personas: { h: string; nac?: F; def?: F }[],
  familias: { h: string; padre?: string; madre?: string; tipo?: number; eventos: { tipo: number; codigo?: string; fecha?: F }[] }[] = [],
): DatosAniversarios {
  const eventos = new Map<string, { type: { value: number; string?: string }; date: F }>();
  const ev = (h: string, tipo: number, f?: F, codigo?: string) => {
    eventos.set(h, { type: { value: tipo, string: codigo ?? "" }, date: f ?? fecha(0, 0, 0) });
    return { ref: h, role: { value: 1 } };
  };
  const ps = personas.map((p) => {
    const refs = [];
    if (p.nac) refs.push(ev(`${p.h}-n`, 12, p.nac));
    if (p.def) refs.push(ev(`${p.h}-d`, 13, p.def));
    return {
      handle: p.h, event_ref_list: refs, birth_ref_index: p.nac ? 0 : -1, death_ref_index: p.def ? (p.nac ? 1 : 0) : -1,
      parent_family_list: [], family_list: [],
    };
  });
  const fs = familias.map((f) => ({
    handle: f.h, father_handle: f.padre ?? null, mother_handle: f.madre ?? null, child_ref_list: [], type: { value: f.tipo ?? 0 },
    event_ref_list: f.eventos.map((e, i) => ev(`${f.h}-${i}`, e.tipo, e.fecha, e.codigo)),
  }));
  return { personas: new Map(ps.map((p) => [p.handle, p])), familias: new Map(fs.map((f) => [f.handle, f])), eventos };
}

const resumen = (l: Aniversario[]) => l.map((a) => `${a.fecha.join("-")} ${a.tipo} ${a.persona ?? a.familia} ${a.anios}`);

test("solo fechas exactas gregorianas con día, mes y año", () => {
  assert.deepEqual(fechaExacta(fecha(1950, 5, 3)), [1950, 5, 3]);
  assert.equal(fechaExacta(fecha(1950, 5, 3, { modifier: 3 })), null, "hacia");
  assert.equal(fechaExacta(fecha(1950, 5, 3, { modifier: 1 })), null, "antes de");
  assert.equal(fechaExacta(fecha(1950, 5, 3, { modifier: 2 })), null, "después de");
  assert.equal(fechaExacta({ modifier: 4, quality: 0, calendar: 0, dateval: [3, 5, 1950, false, 3, 5, 1951, false] }), null, "entre");
  assert.equal(fechaExacta({ modifier: 6, quality: 0, calendar: 0, dateval: [0, 0, 0, false] }), null, "texto");
  assert.equal(fechaExacta(fecha(1950, 5, 0)), null, "sin día");
  assert.equal(fechaExacta(fecha(1950, 0, 0)), null, "sin mes");
  assert.equal(fechaExacta(fecha(1950, 5, 3, { calendar: 1 })), null, "juliano");
  assert.equal(fechaExacta(fecha(1950, 5, 3, { quality: 1 })), null, "estimada");
  assert.equal(fechaExacta(null), null);
});

test("vivos: cumpleaños con la edad; fallecidos: nacimiento y defunción con los años que hace", () => {
  const datos = arbol([
    { h: "viva", nac: fecha(1946, 11, 5) },
    { h: "muerta", nac: fecha(1906, 11, 6), def: fecha(1996, 11, 7) },
    // El cálculo la da por fallecida, sin defunción: sale en «Nacimiento».
    { h: "sinDef", nac: fecha(1880, 11, 8) },
    { h: "aprox", nac: fecha(1950, 11, 9, { modifier: 3 }) },
  ]);
  const l = aniversarios(datos, new Set(["viva"]), [2026, 11, 3], [2026, 11, 30]);
  assert.deepEqual(resumen(l), [
    "2026-11-5 cumpleanos viva 80",
    "2026-11-6 nacimiento muerta 120",
    "2026-11-7 defuncion muerta 30",
    "2026-11-8 nacimiento sinDef 146",
  ]);
  assert.deepEqual(l.map((a) => textoAniversario(a, t)), ["cumple 80 años", "nació hace 120 años", "falleció hace 30 años", "nació hace 146 años"]);
});

test("cada año cuenta (no solo los redondos), en singular el primero, y nada antes del evento", () => {
  const datos = arbol([{ h: "bebe", nac: fecha(2025, 11, 10) }, { h: "nueva", nac: fecha(2026, 11, 4) }]);
  const l = aniversarios(datos, new Set(["bebe", "nueva"]), [2026, 11, 3], [2026, 11, 30]);
  assert.deepEqual(resumen(l), ["2026-11-10 cumpleanos bebe 1"]);
  assert.equal(textoAniversario(l[0], t), "cumple 1 año");
});

test("29 de febrero: el 28 en los años no bisiestos", () => {
  const datos = arbol([{ h: "bisiesto", nac: fecha(1960, 2, 29) }]);
  assert.deepEqual(resumen(aniversarios(datos, new Set(["bisiesto"]), [2027, 2, 1], [2027, 3, 31])), ["2027-2-28 cumpleanos bisiesto 67"]);
  assert.deepEqual(resumen(aniversarios(datos, new Set(["bisiesto"]), [2028, 2, 1], [2028, 3, 31])), ["2028-2-29 cumpleanos bisiesto 68"]);
});

test("un rango que cruza el fin de año, con la edad de cada año", () => {
  const datos = arbol([{ h: "dic", nac: fecha(1950, 12, 31) }, { h: "ene", nac: fecha(1950, 1, 2) }]);
  assert.deepEqual(resumen(aniversarios(datos, new Set(["dic", "ene"]), [2026, 12, 28], [2027, 1, 3])), [
    "2026-12-31 cumpleanos dic 76",
    "2027-1-2 cumpleanos ene 77",
  ]);
});

test("dentro de un día, primero los vivos y después los fallecidos, cada grupo por año", () => {
  const datos = arbol(
    [
      { h: "muertaVieja", nac: fecha(1850, 6, 1), def: fecha(1930, 1, 1) },
      { h: "vivaJoven", nac: fecha(1990, 6, 1) },
      { h: "vivaMayor", nac: fecha(1940, 6, 1) },
      { h: "muertaJoven", nac: fecha(1900, 6, 1), def: fecha(1980, 1, 1) },
    ],
    [{ h: "f", padre: "vivaMayor", madre: "vivaJoven", eventos: [{ tipo: 1, fecha: fecha(1965, 6, 1) }] }],
  );
  const l = aniversarios(datos, new Set(["vivaJoven", "vivaMayor"]), [2026, 6, 1], [2026, 6, 1]);
  assert.deepEqual(l.map((a) => a.persona ?? a.familia), ["vivaMayor", "f", "vivaJoven", "muertaVieja", "muertaJoven"]);
  assert.equal(porDia(l).length, 1);
});

test("bodas: casados y unión civil; fuera las que tienen divorcio o separación, y las demás relaciones", () => {
  const boda = (y: number) => ({ tipo: 1, fecha: fecha(y, 7, 1) });
  const datos = arbol(
    [{ h: "a" }, { h: "b" }, { h: "c" }],
    [
      { h: "vivos", padre: "a", madre: "b", eventos: [boda(2001)] },
      { h: "civil", padre: "a", madre: "b", tipo: 2, eventos: [boda(2002)] },
      { h: "unoMuerto", padre: "a", madre: "c", eventos: [boda(1966)] },
      { h: "divorcio", padre: "a", madre: "b", eventos: [boda(2003), { tipo: 7 }] },
      { h: "separacion", padre: "a", madre: "b", eventos: [boda(2004), { tipo: 0, codigo: "@separacion" }] },
      { h: "sinCasar", padre: "a", madre: "b", tipo: 1, eventos: [boda(2005)] },
      { h: "desconocida", padre: "a", madre: "b", tipo: 3, eventos: [boda(2006)] },
      { h: "sinRelacion", padre: "a", madre: "b", tipo: 4, eventos: [boda(2007)] },
      { h: "hacia", padre: "a", madre: "b", eventos: [{ tipo: 1, fecha: fecha(2008, 7, 1, { modifier: 3 }) }] },
    ],
  );
  const l = aniversarios(datos, new Set(["a", "b"]), [2026, 7, 1], [2026, 7, 1]);
  assert.deepEqual(resumen(l), ["2026-7-1 boda vivos 25", "2026-7-1 boda civil 24", "2026-7-1 boda unoMuerto 60"]);
  assert.deepEqual(l.map((a) => textoAniversario(a, t)), ["aniversario de boda: 25 años", "aniversario de boda: 24 años", "se casaron hace 60 años"]);
});

test("correo: el domingo, la semana siguiente; el último día del mes, el mes siguiente; los demás días, nada", () => {
  const dia = (d: Dia) => periodosDelDia(d).map((p) => `${p.suscripcion} ${p.desde.join("-")}/${p.hasta.join("-")}`);
  assert.equal(diaSemana([2026, 11, 9]), 0, "el 9 de noviembre de 2026 es lunes");
  assert.deepEqual(dia([2026, 11, 8]), ["semanal 2026-11-9/2026-11-15"]);
  assert.deepEqual(dia([2026, 11, 30]), ["mensual 2026-12-1/2026-12-31"]);
  assert.deepEqual(dia([2026, 12, 27]), ["semanal 2026-12-28/2027-1-3"], "una semana que cruza el fin de año");
  assert.deepEqual(dia([2027, 2, 28]), ["semanal 2027-3-1/2027-3-7", "mensual 2027-3-1/2027-3-31"], "domingo y fin de mes");
  assert.deepEqual(dia([2028, 1, 31]), ["mensual 2028-2-1/2028-2-29"], "febrero bisiesto");
  assert.deepEqual(dia([2026, 11, 9]), []);
  assert.deepEqual(dia([2026, 11, 3]), []);
});

test("correo: asunto y fechas en la región del usuario", () => {
  const [semana] = periodosDelDia([2026, 11, 8]);
  assert.equal(asuntoCorreo(semana, "es-ES", t, "Árbol Pérez"), "Árbol Pérez: aniversarios (9–15 nov)");
  const [mes] = periodosDelDia([2026, 11, 30]);
  assert.equal(asuntoCorreo(mes, "es-ES", t, "Árbol Pérez"), "Árbol Pérez: aniversarios (diciembre)");
  const [cruza] = periodosDelDia([2026, 11, 29]);
  assert.equal(asuntoCorreo(cruza, "es-ES", t, "Árbol Pérez"), "Árbol Pérez: aniversarios (30 nov – 6 dic)", "con espacios finos");
  // El periodo, en el texto (07/11/2026).
  assert.equal(periodoCorreo(semana, "es-ES", t), "del 9 al 15 de noviembre");
  assert.equal(periodoCorreo(cruza, "es-ES", t), "del 30 de noviembre al 6 de diciembre");
  assert.equal(periodoCorreo(periodosDelDia([2026, 12, 27])[0], "es-ES", t), "del 28 de diciembre de 2026 al 3 de enero de 2027");
  assert.equal(periodoCorreo(mes, "es-ES", t), "de diciembre");
  assert.deepEqual(introCorreo(semana, "es-ES", t, "Pepa", "https://web/ajustes"), [
    "Hola, Pepa:", "",
    "Te llega este correo porque has pedido en los ajustes de la web los aniversarios de cada semana. Estos son los del 9 al 15 de noviembre. Puedes cambiar lo que recibes o quitar este correo aquí: https://web/ajustes",
  ]);
  assert.equal(introCorreo(mes, "es-ES", t, "", "u")[0], "Hola:");
  assert.match(introCorreo(mes, "es-ES", t, "", "u")[2], /de cada mes\. Estos son los de diciembre\./);
  assert.equal(fechaLarga("es-ES", [2026, 11, 9]), "9 de noviembre de 2026");
  assert.equal(fechaLarga("en-US", [2026, 11, 9]), "November 9, 2026");
});

test("correo: los tipos elegidos (04/11/2026), en su orden; todos o uno que no vale, como si no se hubiera elegido", () => {
  assert.deepEqual(leerTiposCorreo(["boda", "cumpleanos"]), ["cumpleanos", "boda"]);
  assert.equal(leerTiposCorreo(["cumpleanos", "nacimiento", "defuncion", "boda"]), null, "todos");
  assert.equal(leerTiposCorreo(undefined), null);
  assert.equal(leerTiposCorreo([]), null, "ninguno");
  assert.equal(leerTiposCorreo(["boda", "boda"]), null, "repetido");
  assert.equal(leerTiposCorreo(["bautizo"]), null, "desconocido");
  assert.equal(leerTiposCorreo("boda"), null, "no es una lista");
});
