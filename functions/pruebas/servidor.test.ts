/**
 * Pruebas del servidor de la edición (docs/diseno-fase-3.md, apartado 9)
 * contra los emuladores de prueba (firebase.pruebas.json): índice y
 * contadores de la carga, aplicarTransaccion (versiones, permisos,
 * integridad, esquema, ID, registro, datosWeb, índice, límites,
 * concurrencia, fotos subidas), la instantánea por partes frente a la completa, la
 * función «arbol» y su disparador de punta a punta, la migración de los
 * usuarios de Supabase, las altas solo con invitación y los aniversarios por
 * correo.
 *
 * Uso: npm run pruebas-servidor
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { initializeApp as appCliente } from "firebase/app";
import {
  connectAuthEmulator, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, signInWithCredential, signInWithEmailAndPassword,
} from "firebase/auth";
import { esAltaSinInvitacion } from "../../comun/altas.ts";
import { cuentasSinInvitacion } from "../../firestore/invitaciones.ts";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { conectar, deFirestore, leerArbol } from "../../firestore/comun.ts";
import { cargar, recargar } from "../../firestore/cargar.ts";
import { restaurar, type Restauracion } from "../../firestore/restaurar.ts";
import {
  copiarADrive, driveReal, DURACION_BLOQUEO_MS, ErrorDrive, FOTOS_A_LA_VEZ, RUTA_BLOQUEO as RUTA_BLOQUEO_DRIVE, RUTA_ESTADO as RUTA_ESTADO_DRIVE, type Drive,
} from "../src/copiaDrive.ts";
import { getApps } from "firebase-admin/app";
import { getFirestore as getFirestoreAdmin, Timestamp } from "firebase-admin/firestore";
import { generarMiniaturas } from "../../firestore/miniaturas.ts";
import sharp from "sharp";
import bcrypt from "bcryptjs";
import {
  describirPlan, leerCorrespondencias, leerCsv, leerSupabase, migrar, planificar, registrosImportacion,
} from "../../firestore/usuarios_supabase.ts";
import { MAXIMO_TEXTO_NOTA, plantilla } from "../../comun/esquema.ts";
import { Indice } from "../../comun/indice.ts";
import { jsonCanonico, type ObjetoGramps, type Tipo } from "../../comun/gramps.ts";
import { REGION_FUNCIONES } from "../../comun/regiones.ts";
import { aplicarTransaccion, ErrorTransaccion, LIMITES, type CodigoError } from "../src/transaccion.ts";
import { limpiarFotosBorradas, limpiarSubidas } from "../src/fotos.ts";
import { CUOTA_FOTOS, rutaApartada, rutaSubida } from "../../comun/fotos.ts";
import { aplicarSolicitud, crearSolicitud, rechazarSolicitud, retirarSolicitud } from "../src/solicitudes.ts";
import { revertir } from "../src/reversion.ts";
import { aceptarCambio } from "../src/revision.ts";
import { guardarInvitacion } from "../src/usuarios.ts";
import { avisarSolicitud, type Mensaje } from "../src/avisos.ts";
import { enviarAniversarios } from "../src/aniversarios.ts";
import { peticionBorrado } from "../../comun/borrado.ts";
import { leerIndice, RUTA_CONTADORES, RUTA_INDICE } from "../src/sistema.ts";
import {
  actualizarInstantanea, comprobarInstantanea, construirInstantanea, diferencias, RUTA_INSTANTANEA, type Instantanea,
} from "../src/instantanea.ts";
import { CORREOS, evento, familia, ficheroArbolPrueba, INVITACIONES, lugar, nota, persona, refEvento } from "./arbolPrueba.ts";

type O = Record<string, any>;

const { db, cubo, auth } = conectar();
/** Bytes que pasan por JPEG (el servidor mira los primeros, B1 de la revisión
 * del 02/11/2026) seguidos de un texto: no hace falta una foto de verdad. */
const jpeg = (texto: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(texto)]);
// La carga escribe mucho por la consola; en las pruebas, solo los fallos.
const log = console.log;

async function cargarPrueba(fichero = ficheroArbolPrueba()) {
  console.log = () => {};
  try {
    await cargar(fichero);
  } finally {
    console.log = log;
  }
  const lote = db.batch();
  for (const [c, inv] of Object.entries(INVITACIONES)) lote.set(db.doc(`invitaciones/${c}`), { ...inv, correo: c });
  await lote.commit();
}

const leer = async (tipo: Tipo, h: string): Promise<O | null> => {
  const d = await db.collection(tipo).doc(h).get();
  return d.exists ? (deFirestore(d.data()) as O) : null;
};

/** Petición de modificar un objeto: lo lee y le aplica `cambiar`. */
async function modificar(tipo: Tipo, h: string, cambiar: (o: O) => void) {
  const o = (await leer(tipo, h))!;
  const base = o.change;
  cambiar(o);
  return { tipo, handle: h, operacion: "modificar", base, despues: o };
}

const crear = (tipo: Tipo, o: O) => ({ tipo, handle: o.handle, operacion: "crear", base: null, despues: o });
const peticion = (...objetos: O[]) => ({ accion: "prueba", motivo: null, objetos });
const aplicar = (correo: string, p: unknown, opciones = {}) => aplicarTransaccion(db, correo, p, { cubo, ...opciones });

/** La petición que borra una ficha, con el árbol de Firestore. */
async function borrado(tipo: Tipo, h: string) {
  const indice = leerIndice(await db.doc(RUTA_INDICE).get());
  const objetos = new Map<string, O>();
  for (const t of ["Person", "Family", "Event", "Place", "Note"] as Tipo[]) {
    for (const d of (await db.collection(t).get()).docs) objetos.set(`${t}_${d.id}`, deFirestore(d.data()) as O);
  }
  const r = peticionBorrado(indice, (t, x) => (objetos.get(`${t}_${x}`) ?? null) as ObjetoGramps | null, tipo, h);
  return { accion: "borrar", motivo: null as string | null, objetos: r.objetos as O[] };
}

async function rechaza(promesa: Promise<unknown>, codigo: CodigoError, comprobar?: (detalles: any) => void) {
  await assert.rejects(promesa, (e: unknown) => {
    assert.ok(e instanceof ErrorTransaccion, String(e));
    assert.equal(e.codigo, codigo, `${e.message} ${JSON.stringify(e.detalles)}`);
    comprobar?.(e.detalles);
    return true;
  });
}

/** El índice guardado, comparado con el reconstruido desde Firestore. */
async function indiceCuadra() {
  const guardado = leerIndice(await db.doc(RUTA_INDICE).get()).aJson();
  const ins = await construirInstantanea(db);
  const reconstruido = Indice.desdeObjetos(ins.objetos as Partial<Record<Tipo, ObjetoGramps[]>>, guardado.secuencia).aJson();
  assert.equal(jsonCanonico(guardado), jsonCanonico(reconstruido));
}

async function instantaneaGuardada(): Promise<Instantanea> {
  const [gz] = await cubo.file(RUTA_INSTANTANEA).download();
  return JSON.parse(gunzipSync(gz).toString("utf8"));
}

describe("carga: índice y contadores (paso 5)", () => {
  it("el índice coincide con el reconstruido desde la instantánea, y los contadores con los ID", async () => {
    await cargarPrueba();
    await indiceCuadra();
    const c = (await db.doc(RUTA_CONTADORES).get()).data()!;
    assert.deepEqual(c.ids, { Person: 8, Family: 3, Event: 3, Place: 1, Note: 1, Source: 0, Citation: 0, Media: 0, Repository: 0 });
    assert.equal(c.secuenciaCambios, 0);
  });

  it("con el árbol de ejemplo de Gramps (10.500 objetos)", async () => {
    const carpeta = path.resolve(import.meta.dirname, "..", "..", "migracion", ".cache");
    const json = path.join(carpeta, "ejemplo.json");
    if (!existsSync(json)) {
      mkdirSync(carpeta, { recursive: true });
      const migracion = path.resolve(import.meta.dirname, "..", "..", "migracion");
      const python = path.join(migracion, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
      const ejemplo = path.join(migracion, ".venv", "share", "doc", "gramps", "example", "gramps", "example.gramps");
      const r = spawnSync(python, ["exportar_json.py", ejemplo, json], { cwd: migracion, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    }
    await cargarPrueba(json);
    await indiceCuadra();
    const tamano = (await db.doc(RUTA_INDICE).get()).get("datos").length;
    assert.ok(tamano < 900_000, `índice de ${tamano} bytes`);
    const c = (await db.doc(RUTA_CONTADORES).get()).data()!;
    assert.ok(c.ids.Person >= 2000);
  });
});

describe("aplicarTransaccion (paso 6)", () => {
  beforeEach(() => cargarPrueba());

  it("modifica una persona de la rama: versión nueva, registro exacto, datosWeb e índice al día", async () => {
    const antes = (await leer("Person", "Padre"))!;
    const pet = await modificar("Person", "Padre", (o) => { o.primary_name.first_name = "Padre nuevo"; });
    const r = await aplicar(CORREOS.familiar, { ...peticion(pet), motivo: "  corrección  " });
    assert.equal(r.cambio, "c0000001");
    assert.equal(r.estado, "marcado");
    const despues = (await leer("Person", "Padre"))!;
    assert.equal(despues.primary_name.first_name, "Padre nuevo");
    assert.ok(despues.change > antes.change);
    assert.equal(despues.gramps_id, antes.gramps_id);

    const reg = (await db.doc("cambios/c0000001").get()).data()!;
    assert.equal(reg.secuencia, 1);
    assert.equal(reg.motivo, "corrección");
    assert.deepEqual(reg.autor, { correo: CORREOS.familiar, persona: "P", rol: "familiar" });
    assert.equal(reg.estado, "marcado");
    assert.deepEqual(reg.principal, { tipo: "Person", handle: "Padre" });
    assert.equal(reg.objetos.length, 1);
    assert.deepEqual(JSON.parse(reg.objetos[0].antes), antes);
    assert.deepEqual(JSON.parse(reg.objetos[0].despues), despues);
    assert.equal(reg.objetos[0].changeAntes, antes.change);
    assert.equal(reg.objetos[0].changeDespues, despues.change);
    assert.ok(reg.claves.includes("Person_Padre") && reg.claves.includes("Family_fPadres"));

    const dw = (await db.doc("datosWeb/Person_Padre").get()).data()!;
    assert.equal(dw.ultimoCambio, "c0000001");
    assert.equal(dw.pendientes, 1);
    assert.equal(dw.creador, undefined);
    await indiceCuadra();
  });

  it("«change» crece estrictamente aunque se guarde dos veces en el mismo segundo", async () => {
    const ahora = () => new Date(1_800_000_000_000);
    let previo = (await leer("Person", "P"))!.change;
    for (const nombre of ["a", "b", "c"]) {
      await aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { o.primary_name.nick = nombre; })), { ahora });
      const c = (await leer("Person", "P"))!.change;
      assert.ok(c > previo);
      previo = c;
    }
  });

  it("conflicto: la segunda modificación con la misma versión se rechaza (DA-14 a)", async () => {
    const a = await modificar("Person", "P", (o) => { o.primary_name.nick = "uno"; });
    const b = await modificar("Person", "P", (o) => { o.primary_name.nick = "dos"; });
    await aplicar(CORREOS.familiar, peticion(a));
    await rechaza(aplicar(CORREOS.familiar, peticion(b)), "CONFLICTO", (d) => {
      assert.equal(d[0].handle, "P");
      assert.ok(d[0].actual > b.base);
    });
    assert.equal((await leer("Person", "P"))!.primary_name.nick, "uno");
  });

  it("permisos: fuera de la rama, eventos compartidos, lugares y notas", async () => {
    // El hermano, dentro (ampliación de la rama del 24/10/2026).
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Hermano", (o) => { o.gender = 1; })));
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Person", "Tio", (o) => { o.gender = 1; }))), "SIN_PERMISO",
      (d) => assert.deepEqual(d, [{ tipo: "Person", handle: "Tio", razon: "fueraDeRama" }]));
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Event", "E2", (o) => { o.description = "x"; }))), "SIN_PERMISO",
      (d) => assert.equal(d[0].razon, "usadoFueraDeRama"));
    await aplicar(CORREOS.familiar, peticion(await modificar("Event", "E1", (o) => { o.description = "nacimiento"; })));
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Place", "L1", (o) => { o.name.value = "Toledo"; }))), "SIN_PERMISO",
      (d) => assert.equal(d[0].razon, "noEsCreador"));
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Note", "N1", (o) => { o.text.string = "x"; }))), "SIN_PERMISO");
    // La familia del abuelo (DA-5 b: el abuelo está en la rama) sí.
    await aplicar(CORREOS.familiar, peticion(await modificar("Family", "fAbuelos", (o) => { o.private = true; })));
    // Quien tiene a Tio como persona edita su nota y, como el padre de P es
    // su hermano, también a P (la rama completa de cada hermano).
    await aplicar(CORREOS.otro, peticion(await modificar("Note", "N1", (o) => { o.text.string = "nota nueva"; })));
    await aplicar(CORREOS.otro, peticion(await modificar("Person", "P", (o) => { o.gender = 1; })));
  });

  it("lugares nuevos: los crea cualquiera y solo los corrige su creador", async () => {
    const l = lugar("L2", "Toledo");
    await aplicar(CORREOS.otro, peticion(crear("Place", l)));
    assert.equal((await db.doc("datosWeb/Place_L2").get()).get("creador.correo"), CORREOS.otro);
    await aplicar(CORREOS.otro, peticion(await modificar("Place", "L2", (o) => { o.name.value = "Toledo (España)"; })));
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Place", "L2", (o) => { o.name.value = "x"; }))), "SIN_PERMISO");
  });

  it("tipos propios (decisión del 25/10/2026): los demás eligen de los que hay; el administrador crea nuevos", async () => {
    const propio = (s: string) => ({ _class: "EventType", value: 0, string: s });
    assert.deepEqual((await db.doc(RUTA_CONTADORES).get()).get("tiposPropios"), { EventType: ["@separacion"] });
    // Uno que ya hay en el árbol, sí.
    await aplicar(CORREOS.familiar, peticion(await modificar("Event", "E1", (o) => { o.type = propio("@separacion"); })));
    // Uno del catálogo, aunque nadie lo use todavía, también (31/10/2026);
    // un código que no está en el catálogo, nunca (tampoco el administrador).
    await aplicar(CORREOS.familiar, peticion(await modificar("Event", "E1", (o) => { o.type = propio("@deportacion"); })));
    for (const correo of [CORREOS.familiar, CORREOS.admin]) {
      await rechaza(aplicar(correo, peticion(await modificar("Event", "E1", (o) => { o.type = propio("@inventado"); }))), "ESQUEMA",
        (d) => assert.deepEqual(d[0].errores, ["Código de tipo desconocido: EventType «@inventado»"]));
    }
    await rechaza(aplicar(CORREOS.admin, peticion(await modificar("Event", "E1", (o) => { o.type = { _class: "NoteType", value: 0, string: "@separacion" }; }))), "ESQUEMA");
    // Uno nuevo, no (tampoco el revisor).
    for (const correo of [CORREOS.familiar, CORREOS.revisor]) {
      await rechaza(aplicar(correo, peticion(await modificar("Event", "E1", (o) => { o.type = propio("Mudanza"); }))), "SIN_PERMISO",
        (d) => assert.deepEqual(d, [{ tipo: "Event", handle: "E1", razon: "tipoNuevo", tipos: [{ clase: "EventType", texto: "Mudanza" }] }]));
    }
    // El administrador, sí; y desde entonces está en la lista para todos.
    await aplicar(CORREOS.admin, peticion(await modificar("Event", "E2", (o) => { o.type = propio("Mudanza"); })));
    assert.deepEqual((await db.doc(RUTA_CONTADORES).get()).get("tiposPropios"), { EventType: ["@deportacion", "@separacion", "Mudanza"] });
    await aplicar(CORREOS.familiar, peticion(await modificar("Event", "E1", (o) => { o.type = propio("Mudanza"); })));
    // Uno que ya tenía el objeto se conserva aunque no esté en la lista
    // (p. ej., si la lista se quedó atrás).
    await db.doc(RUTA_CONTADORES).update({ tiposPropios: {} });
    await aplicar(CORREOS.familiar, peticion(await modificar("Event", "E1", (o) => { o.description = "sin tocar el tipo"; })));
  });

  it("añadir una nota a una persona de la rama: la nota nueva y la persona en un solo guardado", async () => {
    const n = nota("Nnueva", "Una nota");
    n.gramps_id = "";
    const p = await modificar("Person", "P", (o) => { o.note_list = [...o.note_list, "Nnueva"]; });
    const r = await aplicar(CORREOS.familiar, { accion: "anadirNota", motivo: null, objetos: [crear("Note", n), p] });
    assert.equal(r.objetos[0].despues!.gramps_id, "N0002");
    assert.equal((await db.doc("datosWeb/Note_Nnueva").get()).get("creador.correo"), CORREOS.familiar);
    // A alguien de fuera de la rama, no.
    const t = await modificar("Person", "Tio", (o) => { o.note_list = [...o.note_list, "Notra"]; });
    await rechaza(aplicar(CORREOS.familiar, { accion: "anadirNota", motivo: null, objetos: [crear("Note", nota("Notra", "x")), t] }), "SIN_PERMISO");
  });

  it("añadir un hijo: persona, evento y familia en una transacción; ID asignados; el hijo entra en la rama", async () => {
    const hijo = persona("H2", "Hija", { parent_family_list: ["fP"], event_ref_list: [refEvento("E9")], birth_ref_index: 0, gramps_id: null });
    const nac = evento("E9", { gramps_id: null, place: "L1", type: { _class: "EventType", value: 12, string: "" } });
    const fam = await modificar("Family", "fP", (o) => { o.child_ref_list.push({ ...plantilla<O>("ChildRef"), ref: "H2" }); });
    const r = await aplicar(CORREOS.familiar, { accion: "anadirHijo", motivo: null, objetos: [crear("Person", hijo), crear("Event", nac), fam] });
    assert.equal(r.objetos[0].despues!.gramps_id, "I0009");
    assert.equal(r.objetos[1].despues!.gramps_id, "E0004");
    assert.equal((await leer("Person", "H2"))!.gramps_id, "I0009");
    assert.equal((await db.doc(RUTA_CONTADORES).get()).get("ids.Person"), 9);
    assert.equal((await db.doc("datosWeb/Person_H2").get()).get("cambioCreacion"), r.cambio);
    // Al momento, editable: es descendiente.
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "H2", (o) => { o.primary_name.nick = "Nena"; })));
    // Y su evento también (solo lo usa ella).
    await aplicar(CORREOS.familiar, peticion(await modificar("Event", "E9", (o) => { o.description = "en casa"; })));
    await indiceCuadra();
  });

  it("una tía nueva (DA-6 a) queda fuera de la rama, pero su creador la puede corregir (DA-7 b), y también la familia que crea para ella", async () => {
    const tia = persona("Tia", "Tía", { parent_family_list: ["fAbuelos"], gramps_id: null });
    const fam = await modificar("Family", "fAbuelos", (o) => { o.child_ref_list.push({ ...plantilla<O>("ChildRef"), ref: "Tia" }); });
    await aplicar(CORREOS.familiar, peticion(crear("Person", tia), fam));
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Tia", (o) => { o.gender = 0; })));
    await rechaza(aplicar(CORREOS.revisor, peticion(await modificar("Person", "Tia", (o) => { o.gender = 1; }))), "SIN_PERMISO");
    // Su familia: fuera de la rama, pero la corrige quien la creó.
    const fTia = familia("fTia", null, "Tia", [], { gramps_id: null });
    await aplicar(CORREOS.familiar, peticion(crear("Family", fTia), await modificar("Person", "Tia", (o) => { o.family_list.push("fTia"); })));
    await aplicar(CORREOS.familiar, peticion(await modificar("Family", "fTia", (o) => { o.private = true; })));
    await rechaza(aplicar(CORREOS.revisor, peticion(await modificar("Family", "fTia", (o) => { o.private = false; }))), "SIN_PERMISO",
      (d) => assert.equal(d[0].razon, "fueraDeRama"));
  });

  it("integridad: vínculos de un solo lado, referencias que no existen, índices, ID y padre = madre", async () => {
    // P como hijo de fAbuelos sin cambiar la familia.
    await rechaza(aplicar(CORREOS.admin, peticion(await modificar("Person", "P", (o) => { o.parent_family_list.push("fAbuelos"); }))), "INTEGRIDAD",
      (d) => assert.ok(d.some((e: string) => e.includes("fAbuelos"))));
    // La familia quita un hijo y la persona no se entera.
    await rechaza(aplicar(CORREOS.admin, peticion(await modificar("Family", "fP", (o) => { o.child_ref_list = []; }))), "INTEGRIDAD");
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { o.event_ref_list.push(refEvento("NoExiste")); }))), "INTEGRIDAD",
      (d) => assert.ok(d[0].includes("Event_NoExiste")));
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { o.death_ref_index = 5; }))), "INTEGRIDAD");
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { o.gramps_id = "I9999"; }))), "INTEGRIDAD");
    await rechaza(aplicar(CORREOS.admin, peticion(await modificar("Family", "fP", (o) => { o.mother_handle = "P"; }))), "INTEGRIDAD");
    // Sacar a un hijo bien hecho (los dos lados): es borrado (DA-10 b), solo
    // para el administrador.
    const sacarHijo = async () => peticion(
      await modificar("Family", "fP", (o) => { o.child_ref_list = []; }),
      await modificar("Person", "H", (o) => { o.parent_family_list = []; }),
    );
    await rechaza(aplicar(CORREOS.familiar, await sacarHijo()), "SIN_PERMISO",
      (d) => assert.deepEqual(d.map((x: O) => x.razon), ["quitaVinculo", "quitaVinculo"]));
    // Cambiar al padre por otro también quita un vínculo; añadir no.
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Family", "fP", (o) => { o.father_handle = null; }))), "SIN_PERMISO",
      (d) => assert.equal(d[0].razon, "quitaVinculo"));
    await aplicar(CORREOS.admin, peticion(
      await modificar("Family", "fP", (o) => { o.child_ref_list = []; }),
      await modificar("Person", "H", (o) => { o.parent_family_list = []; }),
    ));
    await indiceCuadra();
  });

  it("esquema: campos que faltan, que sobran o de otro tipo, y peticiones mal formadas", async () => {
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { delete o.primary_name.nick; }))), "ESQUEMA",
      (d) => assert.ok(d[0].errores.includes("Person.primary_name: faltan nick")));
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { o.gender = "m"; }))), "ESQUEMA");
    await rechaza(aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { o.apodo = "x"; }))), "ESQUEMA");
    // Notas de 50.000 caracteres como mucho (Carlos, 02/11/2026), también las del administrador.
    await rechaza(aplicar(CORREOS.admin, peticion(await modificar("Note", "N1", (o) => { o.text.string = "x".repeat(MAXIMO_TEXTO_NOTA + 1); }))), "ESQUEMA",
      (d) => assert.ok(d[0].errores.includes(`Note.text.string: más de ${MAXIMO_TEXTO_NOTA} caracteres`)));
    await rechaza(aplicar(CORREOS.familiar, { accion: "x y", motivo: null, objetos: [] }), "PETICION");
    await rechaza(aplicar(CORREOS.familiar, peticion({ tipo: "Person", handle: "P", operacion: "modificar", base: 1, despues: { handle: "Q" } })), "PETICION");
  });

  it("borrar: solo el administrador (los eventos y notas, quien los puede modificar), y sin dejar referencias colgando", async () => {
    await rechaza(aplicar(CORREOS.familiar, peticion({ tipo: "Person", handle: "H", operacion: "borrar", base: (await leer("Person", "H"))!.change, despues: null })), "SIN_PERMISO",
      (d) => assert.equal(d[0].razon, "soloAdministrador"));
    // E2 lo tiene también Tio, fuera de la rama (27/10/2026).
    await rechaza(aplicar(CORREOS.familiar, peticion({ tipo: "Event", handle: "E2", operacion: "borrar", base: (await leer("Event", "E2"))!.change, despues: null })), "SIN_PERMISO",
      (d) => assert.equal(d[0].razon, "usadoFueraDeRama"));
    const borrar = async () => ({ tipo: "Event", handle: "E1", operacion: "borrar", base: (await leer("Event", "E1"))!.change, despues: null });
    await rechaza(aplicar(CORREOS.familiar, peticion(await borrar())), "INTEGRIDAD", (d) => assert.ok(d[0].includes("Person_P")));
    await rechaza(aplicar(CORREOS.admin, peticion(await borrar())), "INTEGRIDAD", (d) => assert.ok(d[0].includes("Person_P")));
    // Quitar a P su nacimiento, que solo tiene P: se borra (el familiar).
    const r1 = await aplicar(CORREOS.familiar, peticion(
      await modificar("Person", "P", (o) => { o.event_ref_list = o.event_ref_list.filter((e: O) => e.ref !== "E1"); o.birth_ref_index = -1; }),
      await borrar(),
    ));
    assert.equal(r1.estado, "marcado");
    assert.equal(await leer("Event", "E1"), null);
    // La nota de Tio (fuera de la rama del familiar), el administrador.
    const r = await aplicar(CORREOS.admin, peticion(
      await modificar("Person", "Tio", (o) => { o.note_list = []; }),
      { tipo: "Note", handle: "N1", operacion: "borrar", base: (await leer("Note", "N1"))!.change, despues: null },
    ));
    assert.equal(r.estado, "aceptado");
    const reg = (await db.doc(`cambios/${r.cambio}`).get()).data()!;
    assert.equal(reg.estado, "aceptado");
    assert.equal(reg.revision.por.rol, "administrador");
    assert.equal(reg.objetos[1].despues, null);
    await indiceCuadra();
  });

  it("revisor con su rama (DA-11 a); usuario sin persona solo añade; invitación revocada, nada", async () => {
    await aplicar(CORREOS.revisor, peticion(await modificar("Person", "P", (o) => { o.primary_name.nick = "r"; })));
    await rechaza(aplicar(CORREOS.revisor, peticion(await modificar("Person", "Tio", (o) => { o.gender = 1; }))), "SIN_PERMISO");
    await rechaza(aplicar(CORREOS.sinPersona, peticion(await modificar("Person", "P", (o) => { o.gender = 1; }))), "SIN_PERMISO");
    await aplicar(CORREOS.sinPersona, peticion(crear("Note", nota("Nx", "nueva"))));
    await rechaza(aplicar(CORREOS.revocada, peticion(crear("Note", nota("Ny", "nueva")))), "ACCESO");
    await rechaza(aplicar("nadie@example.com", peticion(crear("Note", nota("Nz", "nueva")))), "ACCESO");
  });

  it("invitación revocada a mitad de sesión: el siguiente guardado se rechaza", async () => {
    await aplicar(CORREOS.familiar, peticion(crear("Note", nota("N2", "a"))));
    await db.doc(`invitaciones/${CORREOS.familiar}`).update({ estado: "revocada" });
    await rechaza(aplicar(CORREOS.familiar, peticion(crear("Note", nota("N3", "b")))), "ACCESO");
  });

  it("límites para familiares (DA-27 b): 50 fichas por guardado y 20 guardados por minuto", async () => {
    const muchas = Array.from({ length: LIMITES.objetosFamiliar + 1 }, (_, i) => crear("Note", nota(`M${i}`, "x")));
    await rechaza(aplicar(CORREOS.familiar, peticion(...muchas)), "LIMITE");
    await aplicar(CORREOS.admin, peticion(...muchas));
    let t = 1_800_000_000_000;
    const ahora = () => new Date(t);
    for (let i = 0; i < LIMITES.guardadosPorMinuto; i++) {
      await aplicar(CORREOS.familiar, peticion(crear("Note", nota(`L${i}`, "x"))), { ahora });
      t += 1000;
    }
    await rechaza(aplicar(CORREOS.familiar, peticion(crear("Note", nota("Lx", "x"))), { ahora }), "LIMITE");
    t += 60_000;
    await aplicar(CORREOS.familiar, peticion(crear("Note", nota("Ly", "x"))), { ahora });
  });

  it("ID de Gramps únicos con creaciones simultáneas", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      aplicar(CORREOS.otro, peticion(crear("Person", persona(`S${i}`, `Simultánea ${i}`, { gramps_id: null }))))));
    const ids = rs.map((r) => r.objetos[0].despues!.gramps_id as string).sort();
    assert.deepEqual(ids, ["I0009", "I0010", "I0011", "I0012", "I0013", "I0014", "I0015", "I0016"]);
    assert.deepEqual(rs.map((r) => r.secuencia).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("dos guardados simultáneos con la misma versión: uno pasa y el otro da conflicto", async () => {
    const a = await modificar("Person", "P", (o) => { o.primary_name.nick = "A"; });
    const b = await modificar("Person", "P", (o) => { o.primary_name.nick = "B"; });
    const r = await Promise.allSettled([aplicar(CORREOS.familiar, peticion(a)), aplicar(CORREOS.familiar, peticion(b))]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    const fallo = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    assert.equal((fallo.reason as ErrorTransaccion).codigo, "CONFLICTO");
  });

  it("dos cambios de relaciones simultáneos: el índice queda bien", async () => {
    const hijo = (h: string) => async () => aplicar(CORREOS.familiar, peticion(
      crear("Person", persona(h, h, { parent_family_list: ["fP"], gramps_id: null })),
      await modificar("Family", "fP", (o) => { o.child_ref_list.push({ ...plantilla<O>("ChildRef"), ref: h }); }),
    ));
    // La segunda puede dar conflicto (las dos tocan fP); se reintenta.
    const conReintento = async (f: () => Promise<unknown>) => {
      for (;;) {
        try {
          return await f();
        } catch (e) {
          if (!(e instanceof ErrorTransaccion) || e.codigo !== "CONFLICTO") throw e;
        }
      }
    };
    await Promise.all([conReintento(hijo("X1")), conReintento(hijo("X2"))]);
    const fP = (await leer("Family", "fP"))!;
    assert.deepEqual(fP.child_ref_list.map((c: O) => c.ref).sort(), ["H", "X1", "X2"]);
    await indiceCuadra();
  });

  it("un cambio muy grande guarda el antes y el después en Storage", async () => {
    // Más de TAMANO_MAXIMO_REGISTRO con notas del largo máximo.
    const grandes = Array.from({ length: 20 }, (_, i) => crear("Note", nota(`G${i}`, "x".repeat(MAXIMO_TEXTO_NOTA))));
    const r = await aplicar(CORREOS.admin, peticion(...grandes));
    const reg = (await db.doc(`cambios/${r.cambio}`).get()).data()!;
    assert.equal(reg.fuera.ruta, `registro/${r.cambio}.json.gz`);
    assert.equal(reg.objetos[0].despues, undefined);
    const [gz] = await cubo.file(reg.fuera.ruta).download();
    assert.equal(JSON.parse(gunzipSync(gz).toString("utf8")).length, 20);
  });
});

describe("fotos subidas (paso 11 b)", () => {
  beforeEach(() => cargarPrueba());

  const GRANDE = jpeg("grande: los bytes de la foto grande");
  const PEQUENA = jpeg("pequeña");
  async function subir(correo: string, id: string, tipo = "image/jpeg") {
    await cubo.file(rutaSubida(correo, id, "grande")).save(GRANDE, { resumable: false, contentType: tipo });
    await cubo.file(rutaSubida(correo, id, "pequena")).save(PEQUENA, { resumable: false, contentType: "image/jpeg" });
  }
  const existe = async (ruta: string) => (await cubo.file(ruta).exists())[0];
  const media = (h: string) => ({ ...plantilla<O>("Media"), handle: h, desc: "En la playa", mime: "image/gif", path: "c:/lo/que/diga/la/web" });
  /** Foto nueva enlazada a una persona, con su recorte. */
  async function conFoto(h: string, persona: string, subida: string) {
    const pet = await modificar("Person", persona, (o) => { o.media_list.push({ ...plantilla<O>("MediaRef"), ref: h, rect: [10, 20, 60, 70] }); });
    return { ...peticion(crear("Media", media(h)), pet), ficheros: [{ handle: h, subida }] };
  }

  it("un familiar sube una foto: el Media con ruta, tipo y suma del servidor, los ficheros en su sitio y el espacio contado", async () => {
    await subir(CORREOS.familiar, "subida0001");
    const r = await aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0001"));
    assert.equal(r.estado, "marcado");
    const m = (await leer("Media", "M1"))!;
    assert.match(m.gramps_id, /^O\d+$/);
    assert.equal(m.path, `web/${m.gramps_id}.jpg`);
    assert.equal(m.mime, "image/jpeg");
    assert.equal(m.checksum, createHash("md5").update(GRANDE).digest("hex"));
    assert.equal(m.desc, "En la playa");
    assert.deepEqual((await leer("Person", "P"))!.media_list.at(-1).rect, [10, 20, 60, 70]);
    assert.deepEqual((await cubo.file("multimedia/M1").download())[0], GRANDE);
    assert.deepEqual((await cubo.file("miniaturas/M1").download())[0], PEQUENA);
    assert.equal((await cubo.file("multimedia/M1").getMetadata())[0].contentType, "image/jpeg");
    assert.equal(await existe(rutaSubida(CORREOS.familiar, "subida0001", "grande")), false);
    assert.equal(await existe(rutaSubida(CORREOS.familiar, "subida0001", "pequena")), false);
    assert.equal((await db.doc(`limites/${CORREOS.familiar}`).get()).get("bytesFotos"), GRANDE.length + PEQUENA.length);
    // Las marcas de los límites (DA-27 b) siguen ahí.
    assert.equal((await db.doc(`limites/${CORREOS.familiar}`).get()).get("marcas").length, 1);
    await indiceCuadra();
  });

  it("peticiones mal hechas: Media sin fichero, fichero sin Media, subida que no está o de otro tipo", async () => {
    await rechaza(aplicar(CORREOS.familiar, peticion(crear("Media", media("M1")))), "PETICION");
    await rechaza(aplicar(CORREOS.familiar, { ...peticion(crear("Note", nota("N9", "x"))), ficheros: [{ handle: "M1", subida: "subida0001" }] }), "PETICION");
    await rechaza(aplicar(CORREOS.familiar, await conFoto("M1", "P", "nohaynada1")), "PETICION");
    await rechaza(aplicar(CORREOS.familiar, { ...(await conFoto("M1", "P", "subida0001")), ficheros: [{ handle: "M1", subida: "../x" }] }), "PETICION");
    // La de otro usuario no vale: se busca en la carpeta de quien guarda.
    await subir(CORREOS.otro, "subida0002");
    await rechaza(aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0002")), "PETICION");
    await subir(CORREOS.familiar, "subida0003", "image/gif");
    await rechaza(aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0003")), "PETICION");
    assert.equal(await existe("multimedia/M1"), false);
  });

  it("el tipo de la foto se comprueba por sus primeros bytes, no por lo que declaró el navegador (B1)", async () => {
    const conBytes = async (id: string, grande: Buffer, tipo: string, pequena = PEQUENA) => {
      await cubo.file(rutaSubida(CORREOS.familiar, id, "grande")).save(grande, { resumable: false, contentType: tipo });
      await cubo.file(rutaSubida(CORREOS.familiar, id, "pequena")).save(pequena, { resumable: false, contentType: "image/jpeg" });
    };
    // Un fichero de texto que dice ser JPEG.
    await conBytes("subida0004", Buffer.from("esto es un texto, no una foto"), "image/jpeg");
    await assert.rejects(aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0004")),
      (e: unknown) => e instanceof ErrorTransaccion && e.codigo === "PETICION" && /no es una imagen del tipo que dice/.test(e.message));
    // Un JPEG que dice ser PNG.
    await conBytes("subida0005", GRANDE, "image/png");
    await rechaza(aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0005")), "PETICION");
    // La grande, bien; la pequeña, un PNG (tiene que ser JPEG). No queda
    // nada copiado y la subida sigue en su sitio.
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("resto")]);
    await conBytes("subida0006", png, "image/png", png);
    await rechaza(aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0006")), "PETICION");
    assert.equal(await existe("multimedia/M1"), false);
    assert.equal(await existe("miniaturas/M1"), false);
    assert.equal(await existe(rutaSubida(CORREOS.familiar, "subida0006", "grande")), true);
    // Un PNG de verdad, declarado como PNG: se guarda.
    await conBytes("subida0007", png, "image/png");
    await aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0007"));
    assert.equal((await cubo.file("multimedia/M1").getMetadata())[0].contentType, "image/png");
  });

  it("espacio (DF-6): 200 MB para familiares, 1 GB para administradores; si no cabe, no se copia nada", async () => {
    await subir(CORREOS.familiar, "subida0001");
    await db.doc(`limites/${CORREOS.familiar}`).set({ bytesFotos: CUOTA_FOTOS.otros - 10 });
    await rechaza(aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0001")), "LIMITE",
      (d) => assert.equal(d.espacio.cuota, CUOTA_FOTOS.otros));
    assert.equal(await existe("multimedia/M1"), false);
    assert.equal(await existe(rutaSubida(CORREOS.familiar, "subida0001", "grande")), true);
    // Al administrador, con lo mismo usado, sí le cabe.
    await subir(CORREOS.admin, "subida0001");
    await db.doc(`limites/${CORREOS.admin}`).set({ bytesFotos: CUOTA_FOTOS.otros - 10 });
    await aplicar(CORREOS.admin, await conFoto("M1", "P", "subida0001"));
    assert.equal(await existe("multimedia/M1"), true);
  });

  it("si la transacción falla, se borra lo copiado y la subida se queda para volver a intentarlo", async () => {
    await subir(CORREOS.familiar, "subida0001");
    // Tio está fuera de la rama del familiar.
    await rechaza(aplicar(CORREOS.familiar, await conFoto("M1", "Tio", "subida0001")), "SIN_PERMISO");
    assert.equal(await existe("multimedia/M1"), false);
    assert.equal(await existe("miniaturas/M1"), false);
    assert.equal(await existe(rutaSubida(CORREOS.familiar, "subida0001", "grande")), true);
    await aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0001"));
    assert.equal(await existe("multimedia/M1"), true);
  });

  it("no pisa un fichero que ya está", async () => {
    await cubo.file("multimedia/M1").save(Buffer.from("otra"), { resumable: false });
    await subir(CORREOS.familiar, "subida0001");
    await rechaza(aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0001")), "PETICION");
    assert.deepEqual((await cubo.file("multimedia/M1").download())[0], Buffer.from("otra"));
  });

  it("el espacio de una foto vuelve a quien la subió si desaparece (al revertir o al borrarla) y vuelve a contar si se rehace (29/10/2026)", async () => {
    const total = GRANDE.length + PEQUENA.length;
    const usado = async (c: string) => Number((await db.doc(`limites/${c}`).get()).get("bytesFotos") ?? 0);
    await subir(CORREOS.familiar, "subida0001");
    await aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0001"));
    assert.equal((await db.doc("datosWeb/Media_M1").get()).get("bytes"), total);
    assert.equal(await usado(CORREOS.familiar), total);
    // Rechazar el cambio (revertirlo): la foto se va y su espacio vuelve; los
    // ficheros se quedan, para poder rehacerlo.
    await revertir(db, CORREOS.admin, { cambio: "c0000001", motivo: null, cadena: ["c0000001"] }, { cubo });
    assert.equal(await leer("Media", "M1"), null);
    assert.equal(await usado(CORREOS.familiar), 0);
    assert.equal(await usado(CORREOS.admin), 0);
    assert.equal(await existe("multimedia/M1"), true);
    // Rehacerlo (revertir la reversión): vuelve a contar.
    await revertir(db, CORREOS.admin, { cambio: "c0000002", motivo: null, cadena: ["c0000002"] }, { cubo });
    assert.ok(await leer("Media", "M1"));
    assert.equal(await usado(CORREOS.familiar), total);
    // El administrador la borra (quitándola de la persona): vuelve otra vez.
    const sinFoto = await modificar("Person", "P", (o) => { o.media_list = o.media_list.filter((r: O) => r.ref !== "M1"); });
    await aplicar(CORREOS.admin, peticion(sinFoto, { tipo: "Media", handle: "M1", operacion: "borrar", base: (await leer("Media", "M1"))!.change, despues: null }));
    assert.equal(await usado(CORREOS.familiar), 0);
    assert.equal(await usado(CORREOS.admin), 0);
    await indiceCuadra();
  });

  it("copias pequeñas de las fotos de Gramps (npm run miniaturas): JPEG de 1.600 px como mucho, solo las que faltan y solo imágenes", async () => {
    const grande = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 0.5 } } }).png().toBuffer();
    const pequena = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    await cubo.file("multimedia/G1").save(grande, { resumable: false, contentType: "image/png" });
    await cubo.file("multimedia/G2").save(pequena, { resumable: false, contentType: "image/jpeg" });
    await cubo.file("multimedia/G3").save(Buffer.from("%PDF-1.4"), { resumable: false, contentType: "application/pdf" });
    await cubo.file("miniaturas/G4").save(Buffer.from("ya estaba"), { resumable: false, contentType: "image/jpeg" });
    await cubo.file("multimedia/G4").save(pequena, { resumable: false, contentType: "image/jpeg" });
    const r = await generarMiniaturas(cubo);
    assert.deepEqual(r.fallos, []);
    const m1 = await sharp((await cubo.file("miniaturas/G1").download())[0]).metadata();
    assert.deepEqual([m1.format, m1.width, m1.height], ["jpeg", 1600, 1067]);
    const m2 = await sharp((await cubo.file("miniaturas/G2").download())[0]).metadata();
    assert.deepEqual([m2.format, m2.width, m2.height], ["jpeg", 800, 600]);
    assert.equal(await existe("miniaturas/G3"), false);
    assert.deepEqual((await cubo.file("miniaturas/G4").download())[0], Buffer.from("ya estaba"));
    // Con «--todas», también la que ya estaba.
    await generarMiniaturas(cubo, { todas: true });
    assert.equal((await sharp((await cubo.file("miniaturas/G4").download())[0]).metadata()).format, "jpeg");
  });

  it("un familiar quita una foto de su rama y se borra (29/10/2026); sus ficheros, a los 30 días, y después no se puede revertir", async () => {
    const usado = async (c: string) => Number((await db.doc(`limites/${c}`).get()).get("bytesFotos") ?? 0);
    await subir(CORREOS.familiar, "subida0001");
    await aplicar(CORREOS.familiar, await conFoto("M1", "P", "subida0001"));
    const sinFoto = await modificar("Person", "P", (o) => { o.media_list = o.media_list.filter((r: O) => r.ref !== "M1"); });
    const r = await aplicar(CORREOS.familiar, peticion(sinFoto, { tipo: "Media", handle: "M1", operacion: "borrar", base: (await leer("Media", "M1"))!.change, despues: null }));
    assert.equal(await leer("Media", "M1"), null);
    assert.equal(await usado(CORREOS.familiar), 0);
    assert.ok((await db.doc("datosWeb/Media_M1").get()).get("borrado"));
    // Antes de 30 días, los ficheros siguen (y se podría revertir).
    assert.equal(await limpiarFotosBorradas(db, cubo, new Date(Date.now() + 29 * 86_400_000)), 0);
    assert.equal(await existe("multimedia/M1"), true);
    assert.equal(await limpiarFotosBorradas(db, cubo, new Date(Date.now() + 31 * 86_400_000)), 1);
    assert.equal(await existe("multimedia/M1"), false);
    assert.equal(await existe("miniaturas/M1"), false);
    assert.ok((await db.doc("datosWeb/Media_M1").get()).get("ficherosBorrados"));
    await rechaza(revertir(db, CORREOS.admin, { cambio: r.cambio, motivo: null, cadena: [r.cambio] }, { cubo }), "INTEGRIDAD",
      (d) => assert.deepEqual(d.fotosSinFicheros, ["M1"]));
  });

  it("la limpieza nocturna borra las subidas de hace más de un día", async () => {
    await subir(CORREOS.familiar, "subida0001");
    assert.equal(await limpiarSubidas(cubo), 0);
    assert.equal(await limpiarSubidas(cubo, new Date(Date.now() + 25 * 3600_000)), 2);
    assert.equal(await existe(rutaSubida(CORREOS.familiar, "subida0001", "grande")), false);
  });
});

describe("solicitudes (paso 12)", () => {
  beforeEach(() => cargarPrueba());

  const solicitar = (correo: string, clase: string, p: unknown) => crearSolicitud(db, correo, { clase, peticion: p }, { cubo });
  const conMotivo = (p: O, motivo = "Es mi tío y lo sé") => ({ ...p, motivo });
  const existe = async (ruta: string) => (await cubo.file(ruta).exists())[0];

  it("un cambio fuera de la rama: se guarda la propuesta con su motivo y por qué no se pudo, y el árbol no cambia", async () => {
    const pet = await modificar("Person", "Tio", (o) => { o.primary_name.nick = "Pepe"; });
    await rechaza(solicitar(CORREOS.familiar, "cambio", peticion(pet)), "PETICION");
    const r = await solicitar(CORREOS.familiar, "cambio", conMotivo(peticion(pet)));
    assert.deepEqual(r, { solicitud: "s0000001", secuencia: 1 });
    const s = (await db.doc("solicitudes/s0000001").get()).data()!;
    assert.equal(s.estado, "pendiente");
    assert.equal(s.clase, "cambio");
    assert.equal(s.motivo, "Es mi tío y lo sé");
    assert.deepEqual(s.autor, { correo: CORREOS.familiar, persona: "P", rol: "familiar" });
    assert.deepEqual(s.principal, { tipo: "Person", handle: "Tio" });
    assert.deepEqual(s.noPermitidos, [{ tipo: "Person", handle: "Tio", razon: "fueraDeRama" }]);
    assert.equal(JSON.parse(s.objetos[0].despues).primary_name.nick, "Pepe");
    // Cómo estaba al pedirlo, para enseñar qué cambia.
    assert.deepEqual(JSON.parse(s.objetos[0].antes), await leer("Person", "Tio"));
    assert.equal(s.objetos[0].base, pet.base);
    assert.equal((await leer("Person", "Tio"))!.primary_name.nick, "");
    assert.equal((await db.doc(RUTA_CONTADORES).get()).get("secuenciaSolicitudes"), 1);
    assert.equal((await db.collection("cambios").get()).size, 0);
    // La segunda, con otro número; y las comprobaciones de un guardado.
    assert.equal((await solicitar(CORREOS.familiar, "cambio", conMotivo(peticion(pet)))).solicitud, "s0000002");
    await rechaza(solicitar(CORREOS.familiar, "cambio", conMotivo(peticion({ ...pet, base: 1 }))), "CONFLICTO");
    await rechaza(solicitar(CORREOS.familiar, "cambio", conMotivo(peticion(await modificar("Person", "Tio", (o) => { o.parent_family_list = []; })))), "INTEGRIDAD");
    await rechaza(solicitar(CORREOS.revocada, "cambio", conMotivo(peticion(pet))), "ACCESO");
    await rechaza(solicitar(CORREOS.familiar, "otra", conMotivo(peticion(pet))), "PETICION");
  });

  it("quitar un vínculo en la rama y un tipo nuevo: solicitud con su razón", async () => {
    const pets = [
      await modificar("Family", "fPadres", (o) => { o.child_ref_list = o.child_ref_list.filter((c: O) => c.ref !== "Hermano"); }),
      await modificar("Person", "Hermano", (o) => { o.parent_family_list = []; }),
    ];
    await rechaza(aplicar(CORREOS.familiar, peticion(...pets)), "SIN_PERMISO");
    await solicitar(CORREOS.familiar, "cambio", conMotivo(peticion(...pets)));
    const s = (await db.doc("solicitudes/s0000001").get()).data()!;
    assert.deepEqual(s.noPermitidos.map((n: O) => `${n.handle} ${n.razon}`), ["fPadres quitaVinculo", "Hermano quitaVinculo"]);
    const tipo = await modificar("Event", "E1", (o) => { o.type = { _class: "EventType", value: 0, string: "Bar mitzvá" }; });
    await solicitar(CORREOS.familiar, "cambio", conMotivo(peticion(tipo)));
    assert.equal((await db.doc("solicitudes/s0000002").get()).get("noPermitidos")[0].razon, "tipoNuevo");
  });

  it("borrar: el familiar lo pide (con lo que arrastra) y el administrador lo borra directamente, sin dejar nada colgando", async () => {
    const pet = await borrado("Person", "Tio");
    await rechaza(aplicar(CORREOS.familiar, pet), "SIN_PERMISO");
    await rechaza(solicitar(CORREOS.familiar, "borrado", conMotivo({ ...pet, objetos: [...pet.objetos].reverse() })), "PETICION");
    await solicitar(CORREOS.familiar, "borrado", conMotivo(pet));
    const s = (await db.doc("solicitudes/s0000001").get()).data()!;
    assert.equal(s.clase, "borrado");
    assert.deepEqual(s.principal, { tipo: "Person", handle: "Tio" });
    assert.ok(s.objetos.some((o: O) => o.handle === "E3" && o.operacion === "borrar"));
    // Tio tiene invitación: antes hay que quitársela.
    await rechaza(aplicar(CORREOS.admin, pet), "INTEGRIDAD", (d) => assert.deepEqual(d.vinculadas, [{ handle: "Tio", motivo: "invitacion" }]));
    await db.doc(`invitaciones/${CORREOS.otro}`).delete();
    const r = await aplicar(CORREOS.admin, pet);
    assert.equal(r.estado, "aceptado");
    for (const [t, h] of [["Person", "Tio"], ["Event", "E3"], ["Note", "N1"]] as [Tipo, string][]) assert.equal(await leer(t, h), null);
    assert.ok(await leer("Event", "E2"));
    assert.deepEqual((await leer("Family", "fAbuelos"))!.child_ref_list.map((c: O) => c.ref), ["Padre"]);
    await indiceCuadra();
  });

  it("no se borra a quien tiene invitación ni a la persona de inicio del árbol", async () => {
    await rechaza(aplicar(CORREOS.admin, await borrado("Person", "P")), "INTEGRIDAD",
      (d) => assert.deepEqual(d.vinculadas.map((v: O) => v.motivo).sort(), ["inicio", "invitacion", "invitacion", "invitacion"]));
    await db.doc("metadatos/arbol").update({ persona_inicio: "Hermano" });
    await rechaza(aplicar(CORREOS.admin, await borrado("Person", "Hermano")), "INTEGRIDAD",
      (d) => assert.deepEqual(d.vinculadas, [{ handle: "Hermano", motivo: "inicio" }]));
  });

  it("con fotos: se apartan hasta que se resuelva; retirarla las borra; solo la retira su autor y mientras esté pendiente", async () => {
    for (const copia of ["grande", "pequena"] as const) {
      await cubo.file(rutaSubida(CORREOS.familiar, "subida0001", copia)).save(jpeg(copia), { resumable: false, contentType: "image/jpeg" });
    }
    const media = { ...plantilla<O>("Media"), handle: "M1", desc: "Tío en la playa" };
    const pet = await modificar("Person", "Tio", (o) => { o.media_list.push({ ...plantilla<O>("MediaRef"), ref: "M1" }); });
    await solicitar(CORREOS.familiar, "cambio", { ...conMotivo(peticion(crear("Media", media), pet)), ficheros: [{ handle: "M1", subida: "subida0001" }] });
    const s = (await db.doc("solicitudes/s0000001").get()).data()!;
    assert.deepEqual(s.ficheros, [{ handle: "M1", subida: "subida0001", mime: "image/jpeg", bytes: jpeg("grande").length + jpeg("pequena").length }]);
    assert.equal(s.principal.tipo, "Media");
    assert.equal(await existe(rutaApartada(CORREOS.familiar, "subida0001", "grande")), true);
    assert.equal(await existe(rutaSubida(CORREOS.familiar, "subida0001", "grande")), false);
    assert.equal(await existe("multimedia/M1"), false);
    assert.equal(await leer("Media", "M1"), null);
    await rechaza(retirarSolicitud(db, CORREOS.otro, "s0000001", { cubo }), "SIN_PERMISO");
    await rechaza(retirarSolicitud(db, CORREOS.familiar, "s9", { cubo }), "PETICION");
    await retirarSolicitud(db, CORREOS.familiar, "s0000001", { cubo });
    const r = (await db.doc("solicitudes/s0000001").get()).data()!;
    assert.equal(r.estado, "retirada");
    assert.equal(r.resolucion.por.correo, CORREOS.familiar);
    assert.equal(await existe(rutaApartada(CORREOS.familiar, "subida0001", "grande")), false);
    assert.equal(await existe(rutaApartada(CORREOS.familiar, "subida0001", "pequena")), false);
    await rechaza(retirarSolicitud(db, CORREOS.familiar, "s0000001", { cubo }), "PETICION");
  });

  const resolver = (accion: "aplicar" | "rechazar", correo: string, solicitud: string, comentario: string | null = null) =>
    (accion === "aplicar" ? aplicarSolicitud : rechazarSolicitud)(db, correo, { solicitud, comentario }, { cubo });

  it("aplicar (el administrador): un cambio a nombre de quien la pidió, origen «solicitud»; la solicitud, aplicada", async () => {
    await solicitar(CORREOS.familiar, "cambio", conMotivo(peticion(await modificar("Person", "Tio", (o) => { o.primary_name.nick = "Pepe"; }))));
    await rechaza(resolver("aplicar", CORREOS.revisor, "s0000001"), "SIN_PERMISO");
    const r = await aplicarSolicitud(db, CORREOS.admin, { solicitud: "s0000001", comentario: "Correcto" }, { cubo });
    assert.equal(r.cambio, "c0000001");
    assert.equal((await leer("Person", "Tio"))!.primary_name.nick, "Pepe");
    const c = (await db.doc("cambios/c0000001").get()).data()!;
    assert.deepEqual([c.origen, c.solicitud, c.autor.correo, c.aplicadoPor.correo, c.estado, c.motivo, c.revision.comentario],
      ["solicitud", "s0000001", CORREOS.familiar, CORREOS.admin, "aceptado", "Es mi tío y lo sé", "Correcto"]);
    const s = (await db.doc("solicitudes/s0000001").get()).data()!;
    assert.deepEqual([s.estado, s.resolucion.cambio, s.resolucion.comentario, s.resolucion.por.correo], ["aplicada", "c0000001", "Correcto", CORREOS.admin]);
    await rechaza(resolver("aplicar", CORREOS.admin, "s0000001"), "PETICION");
    await rechaza(resolver("rechazar", CORREOS.admin, "s0000001"), "PETICION");
    await indiceCuadra();
  });

  it("aplicar un tipo nuevo y un borrado pedidos; si la ficha ha cambiado desde entonces, CONFLICTO y sigue pendiente", async () => {
    await solicitar(CORREOS.familiar, "cambio", conMotivo(peticion(await modificar("Event", "E1", (e) => { e.type = { _class: "EventType", value: 0, string: "Mudanza" }; }))));
    await resolver("aplicar", CORREOS.admin, "s0000001");
    assert.equal((await leer("Event", "E1"))!.type.string, "Mudanza");
    assert.deepEqual((await db.doc(RUTA_CONTADORES).get()).get("tiposPropios").EventType, ["@separacion", "Mudanza"]);
    await solicitar(CORREOS.familiar, "cambio", conMotivo(peticion(await modificar("Person", "Tio", (o) => { o.primary_name.nick = "Pepe"; }))));
    await aplicar(CORREOS.admin, peticion(await modificar("Person", "Tio", (o) => { o.gender = 1; })));
    await rechaza(resolver("aplicar", CORREOS.admin, "s0000002"), "CONFLICTO");
    assert.equal((await db.doc("solicitudes/s0000002").get()).get("estado"), "pendiente");
    await solicitar(CORREOS.familiar, "borrado", conMotivo(await borrado("Person", "Hermano")));
    await resolver("aplicar", CORREOS.admin, "s0000003");
    assert.equal(await leer("Person", "Hermano"), null);
    await indiceCuadra();
  });

  it("rechazar (el administrador), con comentario; las fotos apartadas se borran", async () => {
    for (const copia of ["grande", "pequena"] as const) {
      await cubo.file(rutaSubida(CORREOS.familiar, "subida0001", copia)).save(jpeg(copia), { resumable: false, contentType: "image/jpeg" });
    }
    const media = { ...plantilla<O>("Media"), handle: "M1", desc: "Tío en la playa" };
    const pet = await modificar("Person", "Tio", (o) => { o.media_list.push({ ...plantilla<O>("MediaRef"), ref: "M1" }); });
    await solicitar(CORREOS.familiar, "cambio", { ...conMotivo(peticion(crear("Media", media), pet)), ficheros: [{ handle: "M1", subida: "subida0001" }] });
    await rechaza(resolver("rechazar", CORREOS.revisor, "s0000001"), "SIN_PERMISO");
    await resolver("rechazar", CORREOS.admin, "s0000001", "No es él");
    const s = (await db.doc("solicitudes/s0000001").get()).data()!;
    assert.deepEqual([s.estado, s.resolucion.comentario, s.resolucion.cambio], ["rechazada", "No es él", null]);
    assert.equal(await existe(rutaApartada(CORREOS.familiar, "subida0001", "grande")), false);
    assert.equal(await leer("Media", "M1"), null);
  });

  it("modificar y aplicar (paso 14): el guardado del administrador con `resuelve` la da por aplicada, con su motivo; las fotos apartadas se borran", async () => {
    for (const copia of ["grande", "pequena"] as const) {
      await cubo.file(rutaSubida(CORREOS.familiar, "subida0001", copia)).save(jpeg(copia), { resumable: false, contentType: "image/jpeg" });
    }
    const media = { ...plantilla<O>("Media"), handle: "M1", desc: "Tío en la playa" };
    const pet = await modificar("Person", "Tio", (o) => { o.media_list.push({ ...plantilla<O>("MediaRef"), ref: "M1" }); o.primary_name.nick = "Pepe"; });
    await solicitar(CORREOS.familiar, "cambio", { ...conMotivo(peticion(crear("Media", media), pet)), ficheros: [{ handle: "M1", subida: "subida0001" }] });
    // El administrador la rehace a mano: solo el apodo, y escrito de otra forma.
    const rehecha = (motivo: string | null) => async () =>
      ({ ...peticion(await modificar("Person", "Tio", (o) => { o.primary_name.nick = "Pepito"; })), motivo, resuelve: "s0000001" });
    await rechaza(aplicar(CORREOS.revisor, await rehecha(null)()), "SIN_PERMISO");
    await rechaza(aplicar(CORREOS.admin, { ...(await rehecha(null)()), resuelve: "s0000009" }), "PETICION");
    await rechaza(aplicar(CORREOS.admin, { ...(await rehecha(null)()), corrige: "c0000001" }), "PETICION");
    const r = await aplicar(CORREOS.admin, await rehecha("La foto no es suya")());
    assert.equal((await leer("Person", "Tio"))!.primary_name.nick, "Pepito");
    assert.equal(await leer("Media", "M1"), null);
    const c = (await db.doc(`cambios/${r.cambio}`).get()).data()!;
    assert.deepEqual([c.origen, c.solicitud, c.autor.correo, c.estado], ["solicitud", "s0000001", CORREOS.admin, "aceptado"]);
    const sol = (await db.doc("solicitudes/s0000001").get()).data()!;
    assert.deepEqual([sol.estado, sol.resolucion.cambio, sol.resolucion.comentario, sol.resolucion.modificada], ["aplicada", r.cambio, "La foto no es suya", true]);
    assert.equal(await existe(rutaApartada(CORREOS.familiar, "subida0001", "grande")), false);
    // Ya no está pendiente: otra vez, no.
    await rechaza(aplicar(CORREOS.admin, await rehecha(null)()), "PETICION");
    await indiceCuadra();
  });

  it("modificar y aplicar con una foto de la solicitud: pasa a su sitio y cuenta en el espacio de quien la pidió, que es su creador", async () => {
    for (const copia of ["grande", "pequena"] as const) {
      await cubo.file(rutaSubida(CORREOS.familiar, "subida0001", copia)).save(jpeg(copia), { resumable: false, contentType: "image/jpeg" });
    }
    const media = { ...plantilla<O>("Media"), handle: "M1", desc: "Tío en la playa" };
    const pet = await modificar("Person", "Tio", (o) => { o.media_list.push({ ...plantilla<O>("MediaRef"), ref: "M1" }); o.primary_name.nick = "Pepe"; });
    await solicitar(CORREOS.familiar, "cambio", { ...conMotivo(peticion(crear("Media", media), pet)), ficheros: [{ handle: "M1", subida: "subida0001" }] });
    // El administrador se queda con la foto, cambia su descripción y no pone el apodo.
    const rehecha = {
      ...peticion(crear("Media", { ...media, desc: "En la playa" }), await modificar("Person", "Tio", (o) => { o.media_list.push({ ...plantilla<O>("MediaRef"), ref: "M1" }); })),
      motivo: "Sin el apodo", resuelve: "s0000001", ficheros: [{ handle: "M1", subida: "subida0001" }],
    };
    // Una subida que no es de la solicitud se busca en la carpeta de paso del administrador: no está.
    await rechaza(aplicar(CORREOS.admin, { ...rehecha, ficheros: [{ handle: "M1", subida: "otra0001" }] }), "PETICION");
    await aplicar(CORREOS.admin, rehecha);
    const m = (await leer("Media", "M1"))!;
    assert.equal(m.desc, "En la playa");
    assert.equal(m.checksum, createHash("md5").update(jpeg("grande")).digest("hex"));
    assert.equal(await existe("multimedia/M1"), true);
    assert.equal(await existe("miniaturas/M1"), true);
    assert.equal(await existe(rutaApartada(CORREOS.familiar, "subida0001", "grande")), false);
    assert.equal((await db.doc(`limites/${CORREOS.familiar}`).get()).get("bytesFotos"), jpeg("grande").length + jpeg("pequena").length);
    assert.equal((await db.doc(`limites/${CORREOS.admin}`).get()).get("bytesFotos") ?? 0, 0);
    assert.equal((await db.doc("datosWeb/Media_M1").get()).get("creador.correo"), CORREOS.familiar);
    assert.equal((await db.doc("datosWeb/Person_Tio").get()).get("ultimoAutor.correo"), CORREOS.admin);
    assert.equal((await leer("Person", "Tio"))!.primary_name.nick, "");
    assert.equal((await db.doc("solicitudes/s0000001").get()).get("estado"), "aplicada");
    await indiceCuadra();
  });

  it("aplicar con fotos: pasan a su sitio, con su suma, y cuentan en el espacio de quien la pidió", async () => {
    for (const copia of ["grande", "pequena"] as const) {
      await cubo.file(rutaSubida(CORREOS.familiar, "subida0001", copia)).save(jpeg(copia), { resumable: false, contentType: "image/jpeg" });
    }
    const media = { ...plantilla<O>("Media"), handle: "M1", desc: "Tío en la playa" };
    const pet = await modificar("Person", "Tio", (o) => { o.media_list.push({ ...plantilla<O>("MediaRef"), ref: "M1" }); });
    await solicitar(CORREOS.familiar, "cambio", { ...conMotivo(peticion(crear("Media", media), pet)), ficheros: [{ handle: "M1", subida: "subida0001" }] });
    await resolver("aplicar", CORREOS.admin, "s0000001");
    const m = (await leer("Media", "M1"))!;
    assert.equal(m.checksum, createHash("md5").update(jpeg("grande")).digest("hex"));
    assert.equal(await existe("multimedia/M1"), true);
    assert.equal(await existe("miniaturas/M1"), true);
    assert.equal(await existe(rutaApartada(CORREOS.familiar, "subida0001", "grande")), false);
    assert.equal((await db.doc(`limites/${CORREOS.familiar}`).get()).get("bytesFotos"), jpeg("grande").length + jpeg("pequena").length);
    assert.equal((await db.doc(`limites/${CORREOS.admin}`).get()).get("bytesFotos") ?? 0, 0);
    // Quien la pidió es el creador de la foto.
    assert.equal((await db.doc("datosWeb/Media_M1").get()).get("creador.correo"), CORREOS.familiar);
  });

  it("aviso por correo a los administradores con invitación activa; si falla, se anota", async () => {
    await solicitar(CORREOS.familiar, "borrado", conMotivo(await borrado("Person", "Tio"), "Está repetido"));
    // Con un número que no usa ninguna otra prueba: el disparador del
    // emulador de una solicitud s0000001 de otra prueba puede llegar tarde y
    // escribir encima (fallo intermitente, 28/10/2026).
    const ID = "s0009999";
    await db.doc(`solicitudes/${ID}`).set({ ...(await db.doc("solicitudes/s0000001").get()).data()!, aviso: { enviado: null, error: null } });
    // Antes, que termine el disparador del emulador, que hace lo mismo.
    for (let i = 0; !(await db.doc(`solicitudes/${ID}`).get()).get("aviso.enviado"); i++) {
      assert.ok(i < 60, "el disparador no ha mandado el aviso");
      await new Promise((ok) => setTimeout(ok, 250));
    }
    const enviados: Mensaje[] = [];
    const r = await avisarSolicitud(db, ID, async (m) => { enviados.push(m); });
    assert.deepEqual(r, { enviado: true, destinatarios: 1 });
    assert.deepEqual(enviados[0].para, [CORREOS.admin]);
    assert.equal(enviados[0].asunto, "Solicitud de P: borrado");
    assert.match(enviados[0].texto, /P \(p@example\.com\) pide borrar la persona Tío\./);
    assert.match(enviados[0].texto, /Motivo: Está repetido/);
    assert.match(enviados[0].texto, new RegExp(`/solicitudes/${ID}$`));
    assert.ok((await db.doc(`solicitudes/${ID}`).get()).get("aviso.enviado"));
    await avisarSolicitud(db, ID, async () => { throw new Error("Gmail no responde"); });
    const aviso = (await db.doc(`solicitudes/${ID}`).get()).get("aviso");
    assert.deepEqual([aviso.enviado, aviso.error], [null, "Gmail no responde"]);
  });
});

describe("invitaciones desde la web (paso 14, DA-22 a)", () => {
  beforeEach(async () => {
    await cargarPrueba();
    await db.recursiveDelete(db.collection("registroUsuarios"));
    await db.doc("invitaciones/nuevo@example.com").delete();
  });
  const guardar = (correo: string, inv: O) => guardarInvitacion(db, correo, inv);
  const registro = async () => (await db.collection("registroUsuarios").orderBy("fecha").get()).docs.map((d) => d.data());

  it("el administrador da de alta, cambia, revoca y reactiva, y cada cambio queda en el registro", async () => {
    const alta = { correo: " Nuevo@Example.com ", persona: "Tio", rol: "familiar", estado: "activa" };
    await rechaza(guardar(CORREOS.revisor, alta), "SIN_PERMISO");
    await rechaza(guardar(CORREOS.familiar, alta), "SIN_PERMISO");
    await rechaza(guardar(CORREOS.revocada, alta), "ACCESO");
    assert.deepEqual(await guardar(CORREOS.admin, alta), { correo: "nuevo@example.com", cambiada: true });
    const i = (await db.doc("invitaciones/nuevo@example.com").get()).data()!;
    assert.deepEqual([i.correo, i.persona, i.rol, i.estado, i.revocada, i.actualizadaPor.correo], ["nuevo@example.com", "Tio", "familiar", "activa", null, CORREOS.admin]);
    // Lo mismo otra vez: nada que guardar.
    assert.equal((await guardar(CORREOS.admin, alta)).cambiada, false);
    await guardar(CORREOS.admin, { ...alta, rol: "revisor", persona: "P" });
    await guardar(CORREOS.admin, { ...alta, rol: "revisor", persona: "P", estado: "revocada" });
    const revocada = (await db.doc("invitaciones/nuevo@example.com").get()).data()!;
    assert.equal(revocada.estado, "revocada");
    assert.ok(revocada.revocada);
    assert.deepEqual(revocada.creada, i.creada);
    await guardar(CORREOS.admin, { ...alta, rol: "revisor", persona: null });
    const r = await registro();
    assert.deepEqual(r.map((e) => [e.antes, e.despues]), [
      [null, { persona: "Tio", rol: "familiar", estado: "activa" }],
      [{ persona: "Tio", rol: "familiar", estado: "activa" }, { persona: "P", rol: "revisor", estado: "activa" }],
      [{ persona: "P", rol: "revisor", estado: "activa" }, { persona: "P", rol: "revisor", estado: "revocada" }],
      [{ persona: "P", rol: "revisor", estado: "revocada" }, { persona: null, rol: "revisor", estado: "activa" }],
    ]);
    assert.ok(r.every((e) => e.por.correo === CORREOS.admin && e.correo === "nuevo@example.com"));
  });

  it("peticiones mal hechas y personas que no están en el árbol", async () => {
    const bien = { correo: "nuevo@example.com", persona: "Tio", rol: "familiar", estado: "activa" };
    for (const mal of [{ ...bien, correo: "sin-arroba" }, { ...bien, rol: "jefe" }, { ...bien, estado: "borrada" }, { ...bien, persona: "a/b" }, null]) {
      await rechaza(guardar(CORREOS.admin, mal as O), "PETICION");
    }
    // Handles que no admiten las reglas ni comun/gramps.ts (con guion, de más
    // de 50 caracteres): se rechazan antes de buscarlos en el árbol (B2).
    for (const persona of ["Ti-o", "x".repeat(51)]) {
      await assert.rejects(guardar(CORREOS.admin, { ...bien, persona }),
        (e: unknown) => e instanceof ErrorTransaccion && e.codigo === "PETICION" && e.message === "Persona no válida");
    }
    await rechaza(guardar(CORREOS.admin, { ...bien, persona: "NoEsta" }), "PETICION");
    assert.equal((await db.doc("invitaciones/nuevo@example.com").get()).exists, false);
  });

  it("varios administradores; el último no se quita el rol ni se revoca", async () => {
    const admin = { correo: CORREOS.admin, persona: null, rol: "administrador", estado: "activa" };
    await rechaza(guardar(CORREOS.admin, { ...admin, rol: "revisor" }), "PETICION");
    await rechaza(guardar(CORREOS.admin, { ...admin, estado: "revocada" }), "PETICION");
    await guardar(CORREOS.admin, { correo: "nuevo@example.com", persona: null, rol: "administrador", estado: "activa" });
    // Con otro, sí; y entonces el otro ya es el último.
    await guardar(CORREOS.admin, { ...admin, rol: "revisor" });
    await rechaza(guardar("nuevo@example.com", { correo: "nuevo@example.com", persona: null, rol: "familiar", estado: "activa" }), "PETICION");
    assert.equal((await db.doc(`invitaciones/${CORREOS.admin}`).get()).get("rol"), "revisor");
  });
});

describe("reversión y corrección (paso 13)", () => {
  beforeEach(() => cargarPrueba());
  const deshacer = (correo: string, cambio: string, cadena?: string[], motivo: string | null = null) =>
    revertir(db, correo, { cambio, motivo, ...(cadena && { cadena }) }, { cubo });
  /** Todo el árbol, sin «change» (que al revertir avanza). */
  async function arbolSinChange(): Promise<Record<string, string>> {
    const ins = await construirInstantanea(db);
    const salida: Record<string, string> = {};
    for (const [tipo, lista] of Object.entries(ins.objetos)) {
      for (const o of lista) salida[`${tipo}_${o.handle}`] = jsonCanonico({ ...o, change: 0 });
    }
    return salida;
  }
  /** La instantánea por partes, igual que la completa. */
  async function instantaneaCuadra() {
    await actualizarInstantanea(db, cubo);
    assert.deepEqual(diferencias(await instantaneaGuardada(), await construirInstantanea(db)), []);
  }
  const hijoRef = (h: string) => ({ ...plantilla<O>("ChildRef"), ref: h });
  const nacimiento = (h: string) => evento(h, { type: { _class: "EventType", value: 12, string: "" } });

  it("un cambio limpio: vuelve a como estaba, con «change» nuevo; el original, revertido; índice e instantánea al día", async () => {
    const original = await arbolSinChange();
    const antes = (await leer("Person", "Padre"))!;
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Padre", (o) => { o.primary_name.first_name = "Otro"; })));
    assert.equal((await db.doc("datosWeb/Person_Padre").get()).get("pendientes"), 1);
    // Primero, la cadena (sin escribir nada).
    const vista = await deshacer(CORREOS.admin, "c0000001");
    assert.deepEqual(vista.cadena.map((e) => e.cambio), ["c0000001"]);
    assert.deepEqual(vista.cambios, []);
    assert.equal((await leer("Person", "Padre"))!.primary_name.first_name, "Otro");
    const r = await deshacer(CORREOS.admin, "c0000001", ["c0000001"], "No era así");
    assert.deepEqual(r.cambios, ["c0000002"]);
    assert.deepEqual(await arbolSinChange(), original);
    const despues = (await leer("Person", "Padre"))!;
    assert.ok(despues.change > antes.change);
    const t1 = (await db.doc("cambios/c0000001").get()).data()!;
    assert.equal(t1.estado, "revertido");
    assert.equal(t1.revertidoPor, "c0000002");
    assert.equal(t1.revision.comentario, "No era así");
    const t2 = (await db.doc("cambios/c0000002").get()).data()!;
    assert.deepEqual([t2.origen, t2.revierte, t2.estado, t2.accion, t2.motivo], ["reversion", "c0000001", "aceptado", "revertir", "No era así"]);
    assert.equal(JSON.parse(t2.objetos[0].despues).primary_name.first_name, "Padre");
    assert.equal((await db.doc("datosWeb/Person_Padre").get()).get("pendientes"), 0);
    assert.equal((await db.doc(RUTA_CONTADORES).get()).get("secuenciaCambios"), 2);
    await indiceCuadra();
    await instantaneaCuadra();
  });

  it("caso clave: A añade un hijo y luego le añaden un evento; revertir lo de A pide revertir los dos, en orden", async () => {
    const original = await arbolSinChange();
    const x = persona("X", "Equis", { parent_family_list: ["fP"], event_ref_list: [refEvento("E4")], birth_ref_index: 0 });
    await aplicar(CORREOS.familiar, peticion(
      await modificar("Family", "fP", (f) => { f.child_ref_list.push(hijoRef("X")); }),
      crear("Person", x), crear("Event", nacimiento("E4")),
    ));
    await aplicar(CORREOS.familiar, peticion(
      await modificar("Person", "X", (p) => { p.event_ref_list.push(refEvento("E5")); }),
      crear("Event", evento("E5", { description: "otro" })),
    ));
    const vista = await deshacer(CORREOS.admin, "c0000001");
    assert.deepEqual(vista.cadena.map((e) => e.cambio), ["c0000002", "c0000001"]);
    // Si se manda otra cadena (la que se vio antes de que cambiara), no.
    await rechaza(deshacer(CORREOS.admin, "c0000001", ["c0000001"]), "CONFLICTO",
      (d) => assert.deepEqual(d.cadena.map((e: { cambio: string }) => e.cambio), ["c0000002", "c0000001"]));
    const r = await deshacer(CORREOS.admin, "c0000001", ["c0000002", "c0000001"]);
    assert.deepEqual(r.cambios, ["c0000003", "c0000004"]);
    assert.deepEqual(await arbolSinChange(), original);
    assert.equal((await db.doc("cambios/c0000003").get()).get("revierte"), "c0000002");
    assert.equal((await db.doc("cambios/c0000004").get()).get("revierte"), "c0000001");
    await indiceCuadra();
    await instantaneaCuadra();
  });

  it("revertir una reversión (rehacer); y un cambio y su reversión posteriores se anulan", async () => {
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Padre", (o) => { o.primary_name.first_name = "Otro"; })));
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Padre", (o) => { o.primary_name.nick = "Pepe"; })));
    await deshacer(CORREOS.admin, "c0000002", ["c0000002"]); // c0000003
    // c0000002 y c0000003 se anulan: revertir c0000001 no necesita más.
    assert.deepEqual((await deshacer(CORREOS.admin, "c0000001")).cadena.map((e) => e.cambio), ["c0000001"]);
    // Rehacer c0000002: revertir su reversión.
    await deshacer(CORREOS.admin, "c0000003", ["c0000003"]); // c0000004
    assert.equal((await leer("Person", "Padre"))!.primary_name.nick, "Pepe");
    await rechaza(deshacer(CORREOS.admin, "c0000003"), "PETICION");
    // Ahora el apodo vuelve a estar puesto (por c0000004): revertir c0000001 pide quitarlo antes.
    assert.deepEqual((await deshacer(CORREOS.admin, "c0000001")).cadena.map((e) => e.cambio), ["c0000004", "c0000001"]);
    await indiceCuadra();
  });

  it("revertir un borrado: vuelve la ficha con sus vínculos y lo que arrastró", async () => {
    const original = await arbolSinChange();
    await aplicar(CORREOS.admin, await borrado("Person", "Hermano"));
    assert.equal(await leer("Person", "Hermano"), null);
    await deshacer(CORREOS.admin, "c0000001", ["c0000001"]);
    assert.deepEqual(await arbolSinChange(), original);
    await indiceCuadra();
    await instantaneaCuadra();
  });

  it("revertir la creación de un lugar que otro cambio ya usa: ese cambio entra en la cadena", async () => {
    const original = await arbolSinChange();
    await aplicar(CORREOS.familiar, peticion(crear("Place", lugar("L2", "Sevilla"))));
    await aplicar(CORREOS.familiar, peticion(await modificar("Event", "E1", (e) => { e.place = "L2"; })));
    assert.deepEqual((await deshacer(CORREOS.admin, "c0000001")).cadena.map((e) => e.cambio), ["c0000002", "c0000001"]);
    await deshacer(CORREOS.admin, "c0000001", ["c0000002", "c0000001"]);
    assert.deepEqual(await arbolSinChange(), original);
  });

  it("restaurar algo que apunta a una ficha borrada después: el borrado entra en la cadena", async () => {
    // c1 quita el lugar del nacimiento; c2 (administrador) borra el lugar; revertir c1 necesita el lugar.
    const original = await arbolSinChange();
    await aplicar(CORREOS.familiar, peticion(await modificar("Event", "E1", (e) => { e.place = ""; })));
    await aplicar(CORREOS.admin, await borrado("Place", "L1"));
    assert.deepEqual((await deshacer(CORREOS.admin, "c0000001")).cadena.map((e) => e.cambio), ["c0000001", "c0000002"]);
    await deshacer(CORREOS.admin, "c0000001", ["c0000001", "c0000002"]);
    assert.deepEqual(await arbolSinChange(), original);
    await indiceCuadra();
  });

  it("quién revierte: el administrador y los revisores (lo del revisor queda marcado); los familiares, no", async () => {
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Padre", (o) => { o.primary_name.first_name = "Otro"; })));
    await rechaza(deshacer(CORREOS.familiar, "c0000001"), "SIN_PERMISO");
    await rechaza(deshacer(CORREOS.admin, "c0000009"), "PETICION");
    await deshacer(CORREOS.revisor, "c0000001", ["c0000001"]);
    assert.equal((await db.doc("cambios/c0000002").get()).get("estado"), "marcado");
    // El original deja de estar pendiente; la reversión del revisor, sí.
    assert.equal((await db.doc("datosWeb/Person_Padre").get()).get("pendientes"), 1);
  });

  it("dos a la vez: uno revierte y el otro se entera de que ya está revertido", async () => {
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Padre", (o) => { o.primary_name.first_name = "Otro"; })));
    const r = await Promise.allSettled([deshacer(CORREOS.admin, "c0000001", ["c0000001"]), deshacer(CORREOS.revisor, "c0000001", ["c0000001"])]);
    assert.deepEqual(r.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
    const fallo = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    assert.ok(fallo.reason instanceof ErrorTransaccion && fallo.reason.codigo === "PETICION", String(fallo.reason));
    assert.equal((await db.doc(RUTA_CONTADORES).get()).get("secuenciaCambios"), 2);
    await indiceCuadra();
  });

  it("no se revierte la creación de una persona que ya tiene invitación", async () => {
    await aplicar(CORREOS.familiar, peticion(
      await modificar("Family", "fP", (f) => { f.child_ref_list.push(hijoRef("X")); }),
      crear("Person", persona("X", "Equis", { parent_family_list: ["fP"] })),
    ));
    await db.doc("invitaciones/x2@example.com").set({ correo: "x2@example.com", persona: "X", rol: "familiar", estado: "activa" });
    await rechaza(deshacer(CORREOS.admin, "c0000001", ["c0000001"]), "INTEGRIDAD", (d) => assert.equal(d.vinculadas[0].handle, "X"));
  });

  it("aceptar: el administrador o un revisor, nunca el suyo; una sola vez; sale de los pendientes", async () => {
    const aceptar = (correo: string, cambio: string, comentario: string | null = null) => aceptarCambio(db, correo, { cambio, comentario });
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Padre", (o) => { o.primary_name.first_name = "Otro"; })));
    await aplicar(CORREOS.revisor, peticion(await modificar("Person", "Madre", (o) => { o.primary_name.first_name = "Otra"; })));
    await rechaza(aceptar(CORREOS.familiar, "c0000001"), "SIN_PERMISO");
    await rechaza(aceptar(CORREOS.revisor, "c0000002"), "SIN_PERMISO");
    await rechaza(aceptar(CORREOS.admin, "c0000009"), "PETICION");
    await aceptar(CORREOS.revisor, "c0000001", "  Bien  ");
    const t1 = (await db.doc("cambios/c0000001").get()).data()!;
    assert.deepEqual([t1.estado, t1.revision.por.correo, t1.revision.comentario], ["aceptado", CORREOS.revisor, "Bien"]);
    assert.equal((await db.doc("datosWeb/Person_Padre").get()).get("pendientes"), 0);
    await rechaza(aceptar(CORREOS.admin, "c0000001"), "PETICION");
    await aceptar(CORREOS.admin, "c0000002");
    // Uno aceptado se puede revertir igual (DA-13 b).
    await deshacer(CORREOS.admin, "c0000002", ["c0000002"]);
    assert.equal((await leer("Person", "Madre"))!.primary_name.first_name, "Madre");
  });

  it("corrección del administrador: entrada «correccion»; el corregido, aceptado y con corregidoPor", async () => {
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "Padre", (o) => { o.primary_name.first_name = "Otro"; })));
    const corregir = async (_correo: string) => ({
      ...peticion(await modificar("Person", "Padre", (o) => { o.primary_name.first_name = "Padre bien"; })),
      motivo: "Se escribía así", corrige: "c0000001",
    });
    await rechaza(aplicar(CORREOS.revisor, await corregir(CORREOS.revisor)), "SIN_PERMISO");
    await rechaza(aplicar(CORREOS.admin, { ...(await corregir(CORREOS.admin)), corrige: "c0000099" }), "PETICION");
    await aplicar(CORREOS.admin, await corregir(CORREOS.admin));
    const t2 = (await db.doc("cambios/c0000002").get()).data()!;
    assert.deepEqual([t2.origen, t2.corrige], ["correccion", "c0000001"]);
    const t1 = (await db.doc("cambios/c0000001").get()).data()!;
    assert.deepEqual([t1.estado, t1.corregidoPor, t1.revision.comentario], ["aceptado", ["c0000002"], "Se escribía así"]);
    assert.equal((await db.doc("datosWeb/Person_Padre").get()).get("pendientes"), 0);
  });
});

describe("carga en el proyecto real (puesta en marcha, DA-12)", () => {
  beforeEach(() => cargarPrueba());
  async function recargarPrueba(vaciarPruebas = false, autor = CORREOS.admin) {
    console.log = () => {};
    try {
      return await recargar({ db, cubo }, leerArbol(ficheroArbolPrueba()), { autor, vaciarPruebas, fichero: "arbol.json" });
    } finally {
      console.log = log;
    }
  }
  const cambiarPadre = async (nombre: string) =>
    aplicar(CORREOS.familiar, peticion(await modificar("Person", "Padre", (o) => { o.primary_name.first_name = nombre; })));

  it("sustituye el árbol, conserva el registro y las solicitudes y queda como una entrada; lo anterior ya no se revierte", async () => {
    await cambiarPadre("Otro");
    await db.doc("solicitudes/s0000001").set({ estado: "pendiente" });
    assert.equal(await recargarPrueba(), "c0000002");
    assert.ok((await db.doc("cambios/c0000001").get()).exists);
    assert.ok((await db.doc("solicitudes/s0000001").get()).exists);
    assert.equal((await leer("Person", "Padre"))!.primary_name.first_name, "Padre");
    const e = (await db.doc("cambios/c0000002").get()).data()!;
    assert.deepEqual([e.origen, e.accion, e.principal, e.objetos.length, e.estado, e.carga.fichero], ["carga", "cargar", null, 0, "aceptado", "arbol.json"]);
    // Su autor, quien la lanza, con su persona (como un cambio del administrador).
    const inv = (await db.doc(`invitaciones/${CORREOS.admin}`).get()).data()!;
    assert.deepEqual(e.autor, { correo: CORREOS.admin, persona: inv.persona, rol: "administrador" });
    assert.ok(e.carga.fichas.Person > 0);
    const contadores = (await db.doc(RUTA_CONTADORES).get()).data()!;
    assert.deepEqual([contadores.secuenciaCambios, contadores.ultimaCarga, contadores.pruebasVaciadas], [2, 2, undefined]);
    await rechaza(revertir(db, CORREOS.admin, { cambio: "c0000001", motivo: null, cadena: ["c0000001"] }, { cubo }), "PETICION",
      (d) => assert.equal(d.anteriorACarga, true));
    await rechaza(revertir(db, CORREOS.admin, { cambio: "c0000002", motivo: null, cadena: ["c0000002"] }, { cubo }), "PETICION");
    // Lo de después de la carga, como siempre.
    const r = await cambiarPadre("Nuevo");
    assert.equal(r.cambio, "c0000003");
    await revertir(db, CORREOS.admin, { cambio: r.cambio, motivo: null, cadena: [r.cambio] }, { cubo });
    assert.equal((await leer("Person", "Padre"))!.primary_name.first_name, "Padre");
    await indiceCuadra();
    // La instantánea por partes, igual que la completa (la carga la rehace entera).
    await actualizarInstantanea(db, cubo);
    assert.deepEqual(diferencias(await instantaneaGuardada(), await construirInstantanea(db)), []);
  });

  it("la cabecera del árbol en Firestore no lleva la carpeta del PC (base_multimedia, 30/10/2026)", async () => {
    const cabecera = (await db.doc("metadatos/arbol").get()).data()!;
    assert.equal("base_multimedia" in cabecera, false);
    assert.ok(cabecera.version_formato);
    await recargarPrueba();
    assert.equal("base_multimedia" in (await db.doc("metadatos/arbol").get()).data()!, false);
  });

  it("solo la lanza un administrador con invitación activa; si no, no se toca nada", async () => {
    await cambiarPadre("Otro");
    for (const correo of [CORREOS.revisor, CORREOS.revocada, "nadie@example.com"]) {
      await assert.rejects(recargarPrueba(true, correo), /invitación activa de administrador/);
    }
    assert.deepEqual((await db.collection("cambios").get()).docs.map((d) => d.id), ["c0000001"]);
    assert.equal((await leer("Person", "Padre"))!.primary_name.first_name, "Otro");
  });

  it("vaciar lo de las pruebas (antes del corte): registro, solicitudes, datosWeb y límites, una sola vez; las secuencias siguen", async () => {
    await cambiarPadre("Otro");
    await db.doc("solicitudes/s0000001").set({ estado: "pendiente" });
    assert.ok((await db.collection("datosWeb").get()).size > 0);
    assert.equal(await recargarPrueba(true), "c0000002");
    assert.deepEqual((await db.collection("cambios").get()).docs.map((d) => d.id), ["c0000002"]);
    for (const c of ["solicitudes", "datosWeb", "limites"]) assert.equal((await db.collection(c).get()).size, 0, c);
    assert.ok((await db.doc(RUTA_CONTADORES).get()).get("pruebasVaciadas"));
    assert.equal((await db.doc("cambios/c0000002").get()).get("carga.pruebasVaciadas"), true);
    await assert.rejects(recargarPrueba(true), /solo se hace una vez/);
    // Sin vaciar, se puede volver a cargar, y la marca sigue.
    assert.equal(await recargarPrueba(), "c0000003");
    assert.ok((await db.doc(RUTA_CONTADORES).get()).get("pruebasVaciadas"));
  });
});

describe("instantánea por partes (paso 7)", () => {
  beforeEach(() => cargarPrueba());

  it("tras una serie aleatoria de cambios, con actualizaciones solapadas, es idéntica a la completa", async () => {
    let semilla = 20261024;
    const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const actualizaciones: Promise<unknown>[] = [];
    for (let i = 0; i < 25; i++) {
      const tirada = azar();
      if (tirada < 0.3) {
        await aplicar(CORREOS.familiar, peticion(crear("Note", nota(`R${i}`, `nota ${i}`))));
      } else if (tirada < 0.6) {
        await aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { o.primary_name.nick = `n${i}`; })));
      } else if (tirada < 0.8) {
        await aplicar(CORREOS.otro, peticion(crear("Place", lugar(`Q${i}`, `Lugar ${i}`))));
      } else {
        const notas = (await db.collection("Note").get()).docs.map((d) => d.id).filter((h) => h.startsWith("R"));
        if (notas.length) {
          const h = notas[Math.floor(azar() * notas.length)];
          await aplicar(CORREOS.admin, peticion({ tipo: "Note", handle: h, operacion: "borrar", base: (await leer("Note", h))!.change, despues: null }));
        }
      }
      // Como los disparadores: varias a la vez, sin esperar.
      if (azar() < 0.5) actualizaciones.push(actualizarInstantanea(db, cubo), actualizarInstantanea(db, cubo));
    }
    await Promise.all(actualizaciones);
    await actualizarInstantanea(db, cubo);
    const porPartes = await instantaneaGuardada();
    const completa = await construirInstantanea(db);
    assert.deepEqual(diferencias(porPartes, completa), []);
    assert.equal(porPartes.version_instantanea, 2);
    assert.ok(porPartes.web.recientes.length > 0);
    assert.ok(Object.values(porPartes.web.creadoPor).includes("Tio"));
  });

  it("la regeneración nocturna no encuentra diferencias", async () => {
    await aplicar(CORREOS.familiar, peticion(crear("Note", nota("Z1", "z"))));
    const r = await comprobarInstantanea(db, cubo);
    assert.deepEqual(r, { instantanea: [], indice: [] });
  });

  it("y sí las encuentra si alguien escribe por fuera del servidor", async () => {
    await actualizarInstantanea(db, cubo);
    await db.collection("Person").doc("P").update({ "primary_name.nick": "por fuera" });
    const r = await comprobarInstantanea(db, cubo);
    assert.deepEqual(r.instantanea, ["Person_P: distinto"]);
  });
});

describe("función «arbol» y disparador, de punta a punta (pasos 4 y 7)", () => {
  const cliente = appCliente({ projectId: "demo-arbol-familiar", apiKey: "demo" }, "pruebas");
  const authCliente = getAuth(cliente);
  const funciones = getFunctions(cliente, REGION_FUNCIONES);
  const arbol = httpsCallable<unknown, any>(funciones, "arbol");

  before(async () => {
    const puertos = JSON.parse((await import("node:fs")).readFileSync(new URL("../../firebase.pruebas.json", import.meta.url), "utf8")).emulators;
    connectAuthEmulator(authCliente, `http://127.0.0.1:${puertos.auth.port}`, { disableWarnings: true });
    connectFunctionsEmulator(funciones, "127.0.0.1", puertos.functions.port);
    await cargarPrueba();
    await auth.createUser({ email: CORREOS.familiar, password: "contrasena-de-prueba", emailVerified: true }).catch(() => {});
  });

  after(() => authCliente.signOut());

  it("sin sesión, la función no responde", async () => {
    await assert.rejects(arbol({ accion: "calentar" }), (e: any) => e.code === "functions/unauthenticated");
  });

  it("con sesión: «calentar», «aplicar», errores con su código y la instantánea al día por el disparador", async () => {
    await signInWithEmailAndPassword(authCliente, CORREOS.familiar, "contrasena-de-prueba");
    const t0 = Date.now();
    assert.deepEqual((await arbol({ accion: "calentar" })).data, { ok: true });
    console.log(`    (primera llamada: ${Date.now() - t0} ms)`);
    const pet = await modificar("Person", "P", (o) => { o.primary_name.nick = "por la función"; });
    const r = (await arbol({ accion: "aplicar", peticion: peticion(pet) })).data;
    assert.equal(r.cambio, "c0000001");
    assert.equal(r.objetos[0].despues.primary_name.nick, "por la función");
    await assert.rejects(arbol({ accion: "aplicar", peticion: peticion(pet) }), (e: any) =>
      e.code === "functions/aborted" && e.details.codigo === "CONFLICTO");
    await assert.rejects(arbol({ accion: "aplicar", peticion: peticion(await modificar("Person", "Tio", (o) => { o.gender = 1; })) }), (e: any) =>
      e.code === "functions/permission-denied" && e.details.detalles[0].razon === "fueraDeRama");
    // Solicitud por la función; el disparador alCrearSolicitud anota el
    // aviso (en el emulador, el correo solo va al registro).
    const cambioTio = await modificar("Person", "Tio", (o) => { o.gender = 1; });
    const sol = (await arbol({ accion: "solicitar", solicitud: { clase: "cambio", peticion: { ...peticion(cambioTio), motivo: "Es un hombre" } } })).data;
    assert.equal(sol.solicitud, "s0000001");
    for (let i = 0; !(await db.doc("solicitudes/s0000001").get()).get("aviso.enviado"); i++) {
      assert.ok(i < 60, "el disparador no ha mandado el aviso");
      await new Promise((ok) => setTimeout(ok, 500));
    }
    assert.deepEqual((await arbol({ accion: "retirarSolicitud", id: "s0000001" })).data, { solicitud: "s0000001" });
    // El disparador alCrearCambio pone la instantánea al día.
    for (let i = 0; ; i++) {
      const ins = await instantaneaGuardada();
      if (ins.secuencia === 1) {
        assert.deepEqual(ins.objetos.Person.find((p) => p.handle === "P")!.primary_name, r.objetos[0].despues.primary_name);
        break;
      }
      assert.ok(i < 60, "el disparador no ha actualizado la instantánea");
      await new Promise((ok) => setTimeout(ok, 500));
    }
  });

  it("un fallo interno lleva su texto solo para el administrador (B3)", async () => {
    await auth.createUser({ email: CORREOS.admin, password: "contrasena-de-prueba", emailVerified: true }).catch(() => {});
    // Sin el índice, la transacción falla con un Error corriente (no un
    // ErrorTransaccion): un fallo inesperado controlado.
    await db.doc(RUTA_INDICE).delete();
    try {
      const pet = peticion(await modificar("Person", "P", (o) => { o.primary_name.nick = "sin índice"; }));
      await signInWithEmailAndPassword(authCliente, CORREOS.familiar, "contrasena-de-prueba");
      await assert.rejects(arbol({ accion: "aplicar", peticion: pet }), (e: any) =>
        e.code === "functions/internal" && e.details.codigo === "INTERNO" && e.details.mensaje === null);
      await signInWithEmailAndPassword(authCliente, CORREOS.admin, "contrasena-de-prueba");
      await assert.rejects(arbol({ accion: "aplicar", peticion: pet }), (e: any) =>
        e.code === "functions/internal" && e.details.codigo === "INTERNO" && /No existe sistema\/indice/.test(e.details.mensaje));
    } finally {
      await cargarPrueba();
    }
  });
});

describe("copia nocturna en Google Drive (puesta en marcha, apartado 8 bis), con la API simulada", () => {
  /** Drive en memoria: lo que hay, por id. */
  function driveSimulado() {
    const ficheros = new Map<string, { nombre: string; padre: string | null; carpeta: boolean; datos?: Buffer; versiones: number }>();
    let n = 0;
    const api: Drive = {
      async crearCarpeta(nombre, padre) {
        const id = `d${++n}`;
        ficheros.set(id, { nombre, padre, carpeta: true, versiones: 0 });
        return id;
      },
      existe: async (id) => ficheros.has(id),
      buscar: async (nombre, padre) => [...ficheros].find(([, f]) => f.nombre === nombre && f.padre === padre)?.[0] ?? null,
      async subir(nombre, padre, datos) {
        const id = `d${++n}`;
        ficheros.set(id, { nombre, padre, carpeta: false, datos, versiones: 1 });
        return id;
      },
      async actualizar(id, datos) {
        const f = ficheros.get(id);
        if (!f) throw new ErrorDrive(404, "no existe");
        f.datos = datos;
        f.versiones++;
      },
      listar: async (padre) => [...ficheros].filter(([, f]) => f.padre === padre).map(([id, f]) => ({ id, nombre: f.nombre })),
      async borrar(id) {
        ficheros.delete(id);
      },
    };
    /** La ruta de cada fichero (no carpeta), desde la raíz de la copia. */
    const rutas = () => [...ficheros].filter(([, f]) => !f.carpeta).map(([id, f]) => {
      const partes = [f.nombre];
      for (let p = f.padre; p && ficheros.get(p)!.padre; p = ficheros.get(p)!.padre) partes.unshift(ficheros.get(p)!.nombre);
      return { id, ruta: partes.join("/"), versiones: f.versiones };
    }).sort((a, b) => a.ruta.localeCompare(b.ruta));
    return { api, ficheros, rutas };
  }
  const correos: Mensaje[] = [];
  const enviar = async (m: Mensaje) => { correos.push(m); };
  const dia = (d: number) => () => new Date(Date.UTC(2026, 10, d, 3, 30));
  async function foto(handle: string, ruta: string, contenido: string) {
    await db.doc(`Media/${handle}`).set({ handle, gramps_id: handle, path: ruta, mime: "image/jpeg" });
    await cubo.file(`multimedia/${handle}`).save(Buffer.from(contenido), { contentType: "image/jpeg" });
  }

  before(async () => {
    await cargarPrueba();
    await db.doc(RUTA_ESTADO_DRIVE).delete();
    await foto("M1", "Fotos/a.jpg", "foto a");
    await foto("M2", "web/O0001.jpg", "foto b");
    await db.doc("Media/M3").set({ handle: "M3", gramps_id: "M3", path: "https://example.com/c.jpg", mime: "image/jpeg" });
  });

  it("primera noche: las fotos con sus rutas de Gramps y el árbol entero comprimido; la segunda, solo lo que cambia", async () => {
    const d = driveSimulado();
    const r = await copiarADrive(db, cubo, async () => d.api, enviar, dia(1));
    assert.deepEqual([r.ok, r.fotosNuevas, r.fotosCambiadas, r.aviso], [true, 2, 0, null]);
    assert.deepEqual(d.rutas().map((x) => x.ruta), ["copias-del-arbol/arbol-2026-11-01.json.gz", "Fotos/a.jpg", "web/O0001.jpg"]);
    const raiz = [...d.ficheros.values()].find((f) => f.padre === null)!;
    assert.equal(raiz.nombre, "Árbol Frescó-Werchowsky (copia de la web)");
    const arbol = JSON.parse(gunzipSync(d.ficheros.get(d.rutas()[0].id)!.datos!).toString("utf8"));
    assert.equal(arbol.version_formato, 1);
    assert.equal(arbol.objetos.Person.length, (await db.collection("Person").get()).size);
    assert.equal(d.ficheros.get(d.rutas()[1].id)!.datos!.toString(), "foto a");

    // Otra vez el mismo día: nada nuevo; la copia del árbol de hoy se
    // sustituye (no se repite).
    const r2 = await copiarADrive(db, cubo, async () => d.api, enviar, dia(1));
    assert.deepEqual([r2.fotosNuevas, r2.fotosCambiadas], [0, 0]);
    assert.deepEqual(d.rutas().map((x) => [x.ruta, x.versiones]), [
      ["copias-del-arbol/arbol-2026-11-01.json.gz", 2], ["Fotos/a.jpg", 1], ["web/O0001.jpg", 1],
    ]);

    // Una foto cambiada: el mismo fichero. Una borrada en la web: se queda
    // en Drive. Una borrada a mano en Drive (borrado a petición): no se
    // vuelve a copiar.
    await cubo.file("multimedia/M1").save(Buffer.from("foto a, recortada"), { contentType: "image/jpeg" });
    await db.doc("Media/M2").delete();
    const r3 = await copiarADrive(db, cubo, async () => d.api, enviar, dia(2));
    assert.deepEqual([r3.fotosNuevas, r3.fotosCambiadas], [0, 1]);
    const a = d.rutas().find((x) => x.ruta === "Fotos/a.jpg")!;
    assert.equal(a.versiones, 2);
    assert.equal(d.ficheros.get(a.id)!.datos!.toString(), "foto a, recortada");
    assert.ok(d.rutas().some((x) => x.ruta === "web/O0001.jpg"));
    await d.api.borrar(a.id);
    const r4 = await copiarADrive(db, cubo, async () => d.api, enviar, dia(3));
    assert.deepEqual([r4.fotosNuevas, r4.fotosCambiadas], [0, 0]);
    assert.ok(!d.rutas().some((x) => x.ruta === "Fotos/a.jpg"));
    assert.equal(correos.length, 0);
  });

  it("guarda las 30 últimas copias del árbol", async () => {
    await db.doc(RUTA_ESTADO_DRIVE).delete();
    const d = driveSimulado();
    let borradas = 0;
    for (let i = 1; i <= 33; i++) borradas += (await copiarADrive(db, cubo, async () => d.api, enviar, () => new Date(Date.UTC(2026, 11, i, 3)))).copiasBorradas;
    const copias = d.rutas().filter((x) => x.ruta.startsWith("copias-del-arbol/")).map((x) => x.ruta.slice(-18, -8));
    assert.equal(copias.length, 30);
    assert.equal(borradas, 3);
    assert.deepEqual([copias[0], copias[29]], ["2026-12-04", "2027-01-02"]);
  });

  it("si la carpeta se borra a mano, se empieza de nuevo", async () => {
    await db.doc(RUTA_ESTADO_DRIVE).delete();
    const d = driveSimulado();
    await copiarADrive(db, cubo, async () => d.api, enviar, dia(1));
    d.ficheros.clear();
    const r = await copiarADrive(db, cubo, async () => d.api, enviar, dia(2));
    assert.equal(r.fotosNuevas, 1);
    assert.deepEqual(d.rutas().map((x) => x.ruta), ["copias-del-arbol/arbol-2026-11-02.json.gz", "Fotos/a.jpg"]);
  });

  it("si falla: un correo al empezar a fallar, ninguno mientras siga y otro al volver a funcionar", async () => {
    await db.doc(RUTA_ESTADO_DRIVE).delete();
    correos.length = 0;
    const d = driveSimulado();
    const roto = async (): Promise<Drive> => { throw new ErrorDrive(400, "No se pudo renovar el permiso de Drive: 400 invalid_grant"); };
    const r1 = await copiarADrive(db, cubo, roto, enviar, dia(1));
    assert.deepEqual([r1.ok, r1.aviso], [false, "fallo"]);
    assert.equal((await copiarADrive(db, cubo, roto, enviar, dia(2))).aviso, null);
    assert.equal(correos.length, 1);
    assert.ok(correos[0].para.includes(CORREOS.admin));
    assert.match(correos[0].asunto, /ha fallado/);
    assert.match(correos[0].texto, /volver a autorizarla/);
    assert.equal((await db.doc(RUTA_ESTADO_DRIVE).get()).get("fallando"), true);
    const r3 = await copiarADrive(db, cubo, async () => d.api, enviar, dia(3));
    assert.deepEqual([r3.ok, r3.aviso], [true, "recuperada"]);
    assert.equal(correos.length, 2);
    assert.match(correos[1].asunto, /vuelve a funcionar/);
    assert.equal((await copiarADrive(db, cubo, async () => d.api, enviar, dia(4))).aviso, null);
    // Si el correo no sale, no cambia de estado: se vuelve a intentar avisar.
    const sinCorreo = async () => { throw new Error("Gmail no responde"); };
    await copiarADrive(db, cubo, roto, sinCorreo, dia(5));
    assert.equal((await db.doc(RUTA_ESTADO_DRIVE).get()).get("fallando"), false);
    assert.equal((await copiarADrive(db, cubo, roto, enviar, dia(6))).aviso, "fallo");
  });

  // Dos copias a la vez (01/11/2026: dos lanzamientos a mano crearon dos
  // carpetas en producción), el estado guardado a medias y las fotos de
  // varias en varias.
  describe("una sola copia a la vez, estado a medias y fotos en paralelo", () => {
    const MUCHAS = Array.from({ length: 25 }, (_, i) => `MP${String(i).padStart(2, "0")}`);
    /** Drive simulado que tarda en responder, cuenta las subidas en marcha y
     * puede fallar en la subida número `fallaEn`. */
    function driveLento(fallaEn = 0) {
      const d = driveSimulado();
      const espera = () => new Promise((ok) => setTimeout(ok, 5));
      let enMarcha = 0;
      let subidas = 0;
      const cuenta = { maximo: 0 };
      const crearCarpeta = d.api.crearCarpeta;
      const subir = d.api.subir;
      d.api.crearCarpeta = async (nombre, padre) => { await espera(); return crearCarpeta(nombre, padre); };
      d.api.subir = async (nombre, padre, datos, tipo) => {
        enMarcha++;
        cuenta.maximo = Math.max(cuenta.maximo, enMarcha);
        try {
          await espera();
          if (++subidas === fallaEn) throw new ErrorDrive(500, "Drive no responde");
          return await subir(nombre, padre, datos, tipo);
        } finally {
          enMarcha--;
        }
      };
      const raices = () => [...d.ficheros.values()].filter((f) => f.padre === null).length;
      const carpetasLlamadas = (nombre: string) => [...d.ficheros.values()].filter((f) => f.carpeta && f.nombre === nombre).length;
      return { ...d, cuenta, raices, carpetasLlamadas };
    }
    const estado = async () => (await db.doc(RUTA_ESTADO_DRIVE).get()).data() ?? {};

    before(async () => {
      for (const h of MUCHAS) await foto(h, `Fotos/lote/${h}.jpg`, `foto ${h}`);
    });
    beforeEach(async () => {
      await db.doc(RUTA_ESTADO_DRIVE).delete();
      await db.doc(RUTA_BLOQUEO_DRIVE).delete();
      correos.length = 0;
    });
    after(async () => {
      for (const h of MUCHAS) {
        await db.doc(`Media/${h}`).delete();
        await cubo.file(`multimedia/${h}`).delete();
      }
    });

    it("dos copias lanzadas a la vez: una la hace y la otra no hace nada; una sola carpeta", async () => {
      const d = driveLento();
      // La que toma el bloqueo no empieza a copiar hasta que la otra ha
      // terminado (en el emulador, la transacción que pierde reintenta a
      // los segundos): así coinciden seguro.
      let omitida!: () => void;
      const otraTerminada = new Promise<void>((ok) => { omitida = ok; });
      const fabrica = async () => {
        await Promise.race([otraTerminada, new Promise((ok) => setTimeout(ok, 20_000))]);
        return d.api;
      };
      const lanzar = () => copiarADrive(db, cubo, fabrica, enviar, dia(1)).then((r) => { if (r.omitida) omitida(); return r; });
      const [a, b] = await Promise.all([lanzar(), lanzar()]);
      assert.deepEqual([a, b].map((x) => x.omitida === true).sort(), [false, true]);
      const hecha = a.omitida ? b : a;
      assert.deepEqual([hecha.ok, hecha.fotosNuevas], [true, MUCHAS.length + 1]);
      assert.equal(d.raices(), 1);
      assert.equal((await estado()).raiz, [...d.ficheros].find(([, f]) => f.padre === null)![0]);
      // Al terminar, el bloqueo se suelta: la siguiente sí se hace.
      assert.equal((await db.doc(RUTA_BLOQUEO_DRIVE).get()).exists, false);
      const c = await copiarADrive(db, cubo, async () => d.api, enviar, dia(2));
      assert.deepEqual([c.omitida ?? false, c.ok, c.fotosNuevas], [false, true, 0]);
      assert.equal(correos.length, 0);
    });

    it("con el bloqueo de otra copia en marcha, no hace nada ni toca el estado; caducado (copia cortada), sí", async () => {
      const d = driveLento();
      const t = dia(1)().getTime();
      await db.doc(RUTA_BLOQUEO_DRIVE).set({ id: "otra", hasta: Timestamp.fromMillis(t + 60_000) });
      const r = await copiarADrive(db, cubo, async () => d.api, enviar, dia(1));
      assert.deepEqual([r.omitida, r.ok], [true, false]);
      assert.equal(d.ficheros.size, 0);
      assert.equal((await db.doc(RUTA_ESTADO_DRIVE).get()).exists, false);
      assert.equal((await db.doc(RUTA_BLOQUEO_DRIVE).get()).get("id"), "otra", "no suelta el bloqueo de otra");
      assert.equal(correos.length, 0);
      await db.doc(RUTA_BLOQUEO_DRIVE).set({ id: "cortada", hasta: Timestamp.fromMillis(t - 1) });
      const r2 = await copiarADrive(db, cubo, async () => d.api, enviar, dia(1));
      assert.deepEqual([r2.omitida ?? false, r2.ok], [false, true]);
      assert.ok(DURACION_BLOQUEO_MS > 540_000, "el bloqueo dura más que el plazo de la función");
    });

    it("si se corta a mitad, lo copiado ya está guardado (la carpeta en seguida y las fotos por tandas): la siguiente sigue sin otra carpeta", async () => {
      // Falla la primera subida: la carpeta ya está anotada.
      const d = driveLento(1);
      const r = await copiarADrive(db, cubo, async () => d.api, enviar, dia(1));
      assert.equal(r.ok, false);
      const raiz = (await estado()).raiz;
      const antes = Object.keys((await estado()).fotos ?? {}).length;
      assert.ok(raiz && d.ficheros.has(raiz));
      // Falla la subida 23 (en la segunda tanda): las 20 de la primera y las
      // que terminaron de la segunda, anotadas.
      const d2 = { ...d, api: { ...d.api } };
      let n = 0;
      d2.api.subir = async (...args) => { if (++n === 23) throw new ErrorDrive(500, "Drive no responde"); return d.api.subir(...args); };
      const r2 = await copiarADrive(db, cubo, async () => d2.api, enviar, dia(1));
      assert.equal(r2.ok, false);
      const anotadas = Object.keys((await estado()).fotos ?? {}).length;
      assert.ok(anotadas >= 20 && anotadas < MUCHAS.length + 1, `anotadas: ${anotadas}`);
      assert.equal(r2.fotosNuevas, anotadas - antes);
      // La siguiente: solo las que faltan, en la misma carpeta.
      const r3 = await copiarADrive(db, cubo, async () => d.api, enviar, dia(2));
      assert.deepEqual([r3.ok, r3.fotosNuevas], [true, MUCHAS.length + 1 - anotadas]);
      assert.equal(d.raices(), 1);
      assert.equal((await estado()).raiz, raiz);
      assert.equal(d.rutas().filter((x) => x.ruta.startsWith("Fotos/lote/")).length, MUCHAS.length);
    });

    it(`sube las fotos de ${FOTOS_A_LA_VEZ} en ${FOTOS_A_LA_VEZ}, y cada carpeta una sola vez`, async () => {
      const d = driveLento();
      const r = await copiarADrive(db, cubo, async () => d.api, enviar, dia(1));
      assert.equal(r.ok, true);
      assert.equal(d.cuenta.maximo, FOTOS_A_LA_VEZ);
      assert.deepEqual([d.carpetasLlamadas("Fotos"), d.carpetasLlamadas("lote")], [1, 1]);
    });
  });

  it("el cliente de verdad: permiso renovado con el de refresco y subida reanudable", async () => {
    const peticiones: { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string }[] = [];
    const falsoFetch = (async (url: string, init: RequestInit = {}) => {
      peticiones.push({ url, metodo: init.method ?? "GET", cabeceras: (init.headers ?? {}) as Record<string, string>, cuerpo: String(init.body ?? "") });
      if (url.startsWith("https://oauth2")) return new Response(JSON.stringify({ access_token: "tk" }));
      if (url.includes("uploadType=resumable")) return new Response("", { headers: { location: "https://subida/1" } });
      return new Response(JSON.stringify({ id: "f1" }));
    }) as typeof fetch;
    const dr = await driveReal("cliente", "secreto", "refresco", falsoFetch);
    assert.equal(await dr.subir("a.jpg", "carpeta", Buffer.from("x"), "image/jpeg"), "f1");
    assert.match(peticiones[0].cuerpo, /grant_type=refresh_token/);
    assert.match(peticiones[0].cuerpo, /refresh_token=refresco/);
    assert.equal(peticiones[1].cabeceras.authorization, "Bearer tk");
    assert.deepEqual(JSON.parse(peticiones[1].cuerpo), { name: "a.jpg", parents: ["carpeta"] });
    assert.deepEqual([peticiones[2].url, peticiones[2].metodo], ["https://subida/1", "PUT"]);
    const sinPermiso = (async () => new Response("invalid_grant", { status: 400 })) as unknown as typeof fetch;
    await assert.rejects(driveReal("c", "s", "r", sinPermiso), /invalid_grant/);
  });

  after(async () => {
    for (const h of ["M1", "M2", "M3"]) await db.doc(`Media/${h}`).delete();
    await cubo.deleteFiles({ prefix: "multimedia/" });
  });
});

describe("restaurar una copia de Firestore (puesta en marcha, apartado 6; decisión A del 31/10/2026)", () => {
  // La copia gestionada se restaura en otra base de datos («restauracion»);
  // aquí se simula copiando la principal en ella.
  const copia = getFirestoreAdmin(getApps()[0], "restauracion");
  async function vaciar(base: typeof db) {
    for (const c of await base.listCollections()) await base.recursiveDelete(c);
  }
  async function contenido(base: typeof db) {
    const salida: Record<string, Record<string, unknown>> = {};
    for (const c of await base.listCollections()) {
      for (const d of (await c.get()).docs) salida[`${c.id}/${d.id}`] = d.data();
    }
    return salida;
  }

  it("sustituye todo lo de la principal por lo de la copia, regenera la instantánea y avisa de las fotos sin fichero", async () => {
    await cargarPrueba();
    await vaciar(copia);
    const escritor = copia.bulkWriter();
    for (const c of await db.listCollections()) for (const d of (await c.get()).docs) escritor.set(copia.doc(`${c.id}/${d.id}`), d.data());
    // Una foto de la copia cuyo fichero ya no está en Storage.
    escritor.set(copia.doc("Media/MSinFichero"), { handle: "MSinFichero", gramps_id: "O0099", path: "Fotos/borrada.jpg" });
    await escritor.close();
    const enCopia = await contenido(copia);

    // Después de la copia: un cambio, una solicitud, una invitación y una
    // colección que la copia no tiene.
    await aplicar(CORREOS.familiar, peticion(await modificar("Person", "P", (o) => { o.primary_name.nick = "después de la copia"; })));
    await db.doc("solicitudes/s0000009").set({ estado: "pendiente" });
    await db.doc("invitaciones/nuevo@example.com").set({ correo: "nuevo@example.com", persona: null, rol: "familiar", estado: "activa" });
    await db.doc("otraCosa/x").set({ a: 1 });
    // Que el disparador del cambio haya puesto ya la instantánea al día (si
    // no, la pondría después de restaurar: por eso nadie debe editar
    // mientras se restaura).
    for (let i = 0; (await instantaneaGuardada()).secuencia !== 1; i++) {
      assert.ok(i < 60, "el disparador no ha actualizado la instantánea");
      await new Promise((ok) => setTimeout(ok, 500));
    }

    console.log = () => {};
    let r: Restauracion;
    try {
      r = await restaurar(db, copia, cubo);
    } finally {
      console.log = log;
    }
    assert.deepEqual(await contenido(db), enCopia);
    // Las colecciones que no había al hacer la copia (también el registro y
    // las solicitudes, vacíos entonces) se vacían.
    assert.deepEqual(r.sobrantes, ["cambios", "datosWeb", "limites", "otraCosa", "solicitudes"]);
    assert.ok(r.sobrantes.every((c) => !Object.keys(enCopia).some((k) => k.startsWith(`${c}/`))));
    assert.deepEqual(r.fotosSinFichero, ["O0099 Fotos/borrada.jpg (multimedia/MSinFichero)"]);
    assert.equal(r.copiados.Person, Object.keys(enCopia).filter((k) => k.startsWith("Person/")).length);
    const ins = await instantaneaGuardada();
    assert.equal((ins.objetos.Person.find((p) => p.handle === "P") as O).primary_name.nick, "");
    assert.ok(ins.objetos.Media.some((m) => m.handle === "MSinFichero"));
    await vaciar(copia);
  });

  it("con la copia vacía (o un nombre que no existe), no toca nada", async () => {
    await cargarPrueba();
    const antes = await contenido(db);
    await assert.rejects(restaurar(db, getFirestoreAdmin(getApps()[0], "noexiste"), cubo), /vacía/);
    assert.deepEqual(await contenido(db), antes);
  });
});

describe("migración de los usuarios de Supabase (puesta en marcha, apartado 4)", () => {
  // Usuarios inventados, con sus contraseñas cifradas con bcrypt aquí mismo
  // («$2a$», como las de Supabase).
  const cifrar = (c: string) => bcrypt.hashSync(c, 4).replace(/^\$2b\$/, "$2a$");
  const CONTRASENAS: Record<string, string> = {
    "prima@example.com": "la-de-siempre-1",
    "tio@example.com": "la-de-siempre-2",
    "sinpersona@example.com": "la-de-siempre-3",
    "fuera@example.com": "la-de-siempre-4",
    [CORREOS.admin]: "la-de-siempre-5",
  };
  const HASH = Object.fromEntries(Object.entries(CONTRASENAS).map(([c, p]) => [c, cifrar(p)]));
  const exportacion = () => [
    "id,email,encrypted_password,email_confirmed_at,created_at",
    `"0b6c…-1",Prima@Example.com,"${HASH["prima@example.com"]}",2024-01-01 10:00:00+00,2024-01-01 09:00:00+00`,
    `0b6c…-2,tio@example.com,${HASH["tio@example.com"]},,2024-01-02 09:00:00+00`,
    `0b6c…-3,sinpersona@example.com,${HASH["sinpersona@example.com"]},2024-01-03 10:00:00+00,2024-01-03 09:00:00+00`,
    `0b6c…-4,sincontrasena@example.com,,2024-01-04 10:00:00+00,2024-01-04 09:00:00+00`,
    `0b6c…-5,fuera@example.com,${HASH["fuera@example.com"]},2024-01-05 10:00:00+00,2024-01-05 09:00:00+00`,
    `0b6c…-6,${CORREOS.admin},${HASH[CORREOS.admin]},2024-01-06 10:00:00+00,2024-01-06 09:00:00+00`,
  ].join("\r\n");
  // Como la guarda Excel: con BOM, «;» y una fila vacía.
  const lista = (filas: string[]) => "﻿correo;persona;rol\r\n" + filas.join("\r\n") + "\r\n;;\r\n";
  let ids: Record<string, string>;
  const filasBien = () => [
    `prima@example.com;${ids.P};familiar`,
    `TIO@example.com;${ids.Tio};Revisor`,
    "sinpersona@example.com;;familiar",
    "sincontrasena@example.com;;familiar",
    `solo-invitacion@example.com;${ids.Hermano};familiar`,
    `${CORREOS.admin};${ids.P};familiar`,
  ];
  const correosPrueba = [...Object.keys(CONTRASENAS), "sincontrasena@example.com", "solo-invitacion@example.com"];
  const supabase = () => leerSupabase(exportacion());
  const plan = () => planificar(db, auth, supabase(), leerCorrespondencias(lista(filasBien())));
  const cuentas = async () => (await auth.getUsers(correosPrueba.map((email) => ({ email })))).users;
  const invitaciones = async () => (await db.collection("invitaciones").get()).size;

  before(async () => {
    await cargarPrueba();
    await db.recursiveDelete(db.collection("registroUsuarios"));
    await auth.deleteUsers((await cuentas()).map((u) => u.uid));
    // La cuenta del administrador ya existe (con Google, por ejemplo).
    await auth.createUser({ email: CORREOS.admin, emailVerified: true });
    ids = Object.fromEntries((await db.collection("Person").get()).docs.map((d) => [d.id, String(d.get("gramps_id"))]));
  });

  it("lee los CSV de Excel y de Supabase", () => {
    assert.deepEqual(leerCsv('﻿A;B\r\n"x;y";"di ""hola"""\r\n\r\n1;\r\n'), [
      { linea: 2, campos: { a: "x;y", b: 'di "hola"' } },
      { linea: 4, campos: { a: "1", b: "" } },
    ]);
    const s = supabase();
    assert.equal(s.size, 6);
    assert.deepEqual({ ...s.get("prima@example.com"), hash: "…" }, { correo: "prima@example.com", hash: "…", confirmado: true });
    assert.equal(s.get("tio@example.com")!.confirmado, false);
    assert.equal(s.get("sincontrasena@example.com")!.hash, null);
  });

  it("se para antes de escribir nada con personas que no están, roles desconocidos o correos repetidos", async () => {
    const antes = [(await cuentas()).length, await invitaciones()];
    assert.throws(() => leerCorrespondencias(lista([...filasBien(), "Prima@example.com;;familiar", "x@example.com;;jefe", "sin-arroba;;familiar"])), (e: Error) =>
      /línea 8: prima@example.com, repetido \(ya está en la línea 2\)/.test(e.message) && /línea 9 \(x@example.com\): rol desconocido «jefe»/.test(e.message) &&
      /línea 10: Correo no válido/.test(e.message));
    await assert.rejects(planificar(db, auth, supabase(), leerCorrespondencias(lista([...filasBien(), "x@example.com;I9999;familiar"]))), /línea 8 \(x@example.com\): I9999/);
    assert.throws(() => leerSupabase(exportacion() + "\r\n7,mal@example.com,secreta,,"), (e: Error) =>
      /mal@example.com\): la contraseña no está cifrada con bcrypt/.test(e.message) && !e.message.includes("secreta"));
    assert.deepEqual([(await cuentas()).length, await invitaciones()], antes);
  });

  it("ensayo: dice qué haría, sin escribir nada y sin mostrar las contraseñas cifradas", async () => {
    const antes = [(await cuentas()).length, await invitaciones()];
    const p = await plan();
    const texto = describirPlan(p).join("\n");
    assert.deepEqual(p.altas.filter((a) => a.cuenta).map((a) => a.correo), ["prima@example.com", "tio@example.com", "sinpersona@example.com"]);
    assert.deepEqual(p.altas.filter((a) => a.invitacion).map((a) => a.correo),
      ["prima@example.com", "tio@example.com", "sinpersona@example.com", "sincontrasena@example.com", "solo-invitacion@example.com"]);
    assert.deepEqual(p.altas.map((a) => a.sinCuenta), [null, null, null, "sinContrasena", "noEnSupabase", "existe"]);
    assert.deepEqual(p.fuera.map((s) => s.correo), ["fuera@example.com"]);
    assert.match(texto, /tio@example.com {2}\(no lo confirmó en Supabase/);
    assert.match(texto, new RegExp(`${CORREOS.admin}: la cuenta y la invitación; la invitación es distinta de la lista \\(administrador, activa, sin persona\\)`));
    assert.match(texto, /no están en la lista[^\n]*: 1\n {2}fuera@example.com/);
    assert.ok(!texto.includes("$2"), "sin contraseñas cifradas");
    assert.deepEqual([(await cuentas()).length, await invitaciones()], antes);
  });

  it("crea las cuentas (contraseña bcrypt, identificador nuevo, correo verificado) y las invitaciones con su registro; lo que existe no se toca", async () => {
    const p = await plan();
    await assert.rejects(migrar(db, auth, p, { autor: CORREOS.familiar }), /no tiene invitación activa de administrador/);
    assert.deepEqual(registrosImportacion(p).map((r) => [r.email, r.emailVerified, r.uid.length]), [
      ["prima@example.com", true, 28], ["tio@example.com", true, 28], ["sinpersona@example.com", true, 28],
    ]);
    assert.deepEqual(await migrar(db, auth, p, { autor: CORREOS.admin }), { cuentas: 3, invitaciones: 5 });

    const porCorreo = new Map((await cuentas()).map((u) => [u.email!, u]));
    assert.deepEqual([...porCorreo.keys()].sort(), ["a@example.com", "prima@example.com", "sinpersona@example.com", "tio@example.com"]);
    for (const c of ["prima@example.com", "tio@example.com", "sinpersona@example.com"]) {
      const u = porCorreo.get(c)!;
      assert.ok(u.emailVerified, `${c}: correo verificado`);
      assert.ok(!u.uid.startsWith("0b6c"), "identificador nuevo, no el de Supabase");
      // Se guarda el cifrado de Supabase tal cual; con él, la contraseña de
      // siempre (el emulador no comprueba bcrypt al entrar: ver la prueba en
      // el proyecto real, docs/puesta-en-marcha.md, apartado 4).
      const guardado = Buffer.from(u.passwordHash!, "base64").toString("utf8");
      assert.equal(guardado, HASH[c]);
      assert.ok(bcrypt.compareSync(CONTRASENAS[c], guardado));
    }
    // La del administrador, sin tocar (sin contraseña, como estaba).
    assert.equal(porCorreo.get(CORREOS.admin)!.passwordHash, undefined);

    const inv = async (c: string) => (await db.doc(`invitaciones/${c}`).get()).data()!;
    const tio = await inv("tio@example.com");
    assert.deepEqual([tio.persona, tio.rol, tio.estado], ["Tio", "revisor", "activa"]);
    assert.equal((await inv("sinpersona@example.com")).persona, null);
    assert.equal((await inv("solo-invitacion@example.com")).persona, "Hermano");
    assert.deepEqual([(await inv(CORREOS.admin)).rol, (await inv(CORREOS.admin)).persona], ["administrador", null]);
    const registro = (await db.collection("registroUsuarios").get()).docs.map((d) => d.data());
    assert.equal(registro.length, 5);
    assert.ok(registro.every((e) => e.por.correo === CORREOS.admin && e.antes === null && e.despues.estado === "activa"));
    // Los de Supabase que no están en la lista no se crean.
    assert.equal((await db.doc("invitaciones/fuera@example.com").get()).exists, false);

    // Otra vez: nada que crear.
    const otra = await plan();
    assert.ok(!otra.altas.some((a) => a.cuenta || a.invitacion));
  });

  it("el usuario sin persona no tiene rama: solo añade", async () => {
    await rechaza(aplicar("sinpersona@example.com", peticion(await modificar("Person", "P", (o) => { o.gender = 1; }))), "SIN_PERMISO");
    await aplicar("sinpersona@example.com", peticion(crear("Note", nota("Nsupabase", "nueva"))));
  });

  it("con un correo de Gmail, «Entrar con Google» entra en la misma cuenta, que conserva la contraseña", async () => {
    const cliente = appCliente({ projectId: "demo-arbol-familiar", apiKey: "demo" }, "supabase");
    const authCliente = getAuth(cliente);
    const puertos = JSON.parse((await import("node:fs")).readFileSync(new URL("../../firebase.pruebas.json", import.meta.url), "utf8")).emulators;
    connectAuthEmulator(authCliente, `http://127.0.0.1:${puertos.auth.port}`, { disableWarnings: true });
    // El correo es de example.com (los de las pruebas, inventados): al
    // emulador le da igual el dominio; el caso es el de una cuenta de Gmail.
    const antes = await auth.getUserByEmail("prima@example.com");
    // El emulador acepta un token de Google sin firmar.
    const token = JSON.stringify({ sub: "google-prima", email: "prima@example.com", email_verified: true });
    const r = await signInWithCredential(authCliente, GoogleAuthProvider.credential(token));
    assert.equal(r.user.uid, antes.uid);
    const despues = await auth.getUserByEmail("prima@example.com");
    assert.deepEqual(despues.providerData.map((p) => p.providerId).sort(), ["google.com", "password"]);
    assert.equal(despues.passwordHash, antes.passwordHash);
    await authCliente.signOut();
  });
});

describe("altas solo con invitación (Carlos, 01/11/2026): la función de bloqueo antesDeCrearCuenta", () => {
  const cliente = appCliente({ projectId: "demo-arbol-familiar", apiKey: "demo" }, "altas");
  const authCliente = getAuth(cliente);
  const C = {
    invitado: "alta-invitado@example.com",
    sin: "alta-sin@example.com",
    revocado: "alta-revocado@example.com",
    google: "alta-google@example.com",
    googleSin: "alta-google-sin@example.com",
    importado: "alta-importado@example.com",
    admin: "alta-admin@example.com",
  };
  // El emulador acepta un token de Google sin firmar.
  const google = (correo: string, sub: string) =>
    signInWithCredential(authCliente, GoogleAuthProvider.credential(JSON.stringify({ sub, email: correo, email_verified: true })));
  const existe = (correo: string) => auth.getUserByEmail(correo).then(() => true, () => false);
  const sinInvitacion = (e: unknown) => {
    assert.ok(esAltaSinInvitacion(e), String(e));
    assert.equal((e as { code?: string }).code, "auth/internal-error");
    return true;
  };

  before(async () => {
    const puertos = JSON.parse((await import("node:fs")).readFileSync(new URL("../../firebase.pruebas.json", import.meta.url), "utf8")).emulators;
    connectAuthEmulator(authCliente, `http://127.0.0.1:${puertos.auth.port}`, { disableWarnings: true });
    const viejas = (await auth.getUsers(Object.values(C).map((email) => ({ email })))).users;
    await auth.deleteUsers(viejas.map((u) => u.uid));
    const lote = db.batch();
    for (const c of Object.values(C)) lote.delete(db.doc(`invitaciones/${c}`));
    lote.set(db.doc(`invitaciones/${C.invitado}`), { correo: C.invitado, persona: null, rol: "familiar", estado: "activa" });
    lote.set(db.doc(`invitaciones/${C.revocado}`), { correo: C.revocado, persona: null, rol: "familiar", estado: "revocada" });
    lote.set(db.doc(`invitaciones/${C.google}`), { correo: C.google, persona: null, rol: "familiar", estado: "activa" });
    await lote.commit();
  });

  after(() => authCliente.signOut());

  it("«Crear cuenta» con contraseña: con invitación activa, sí (también con el correo en mayúsculas); sin ella o revocada, no", async () => {
    await createUserWithEmailAndPassword(authCliente, "Alta-Invitado@Example.com", "contrasena-de-prueba");
    assert.equal(authCliente.currentUser?.email, C.invitado);
    await authCliente.signOut();
    for (const c of [C.sin, C.revocado]) {
      await assert.rejects(createUserWithEmailAndPassword(authCliente, c, "contrasena-de-prueba"), sinInvitacion);
      assert.equal(await existe(c), false, `${c}: sin cuenta`);
    }
    assert.equal(authCliente.currentUser, null);
  });

  it("primera entrada con Google: con invitación, sí; sin ella, no", async () => {
    const r = await google(C.google, "google-alta-1");
    assert.equal(r.user.email, C.google);
    await authCliente.signOut();
    await assert.rejects(google(C.googleSin, "google-alta-2"), sinInvitacion);
    assert.equal(await existe(C.googleSin), false);
  });

  it("no pasan por el bloqueo: las cuentas del SDK de administración (importUsers, createUser) ni las entradas de quien ya tiene cuenta, aunque no tenga invitación", async () => {
    // La migración de Supabase importa con importUsers (aquí, sin
    // invitación a propósito: si pasara por la función, fallaría).
    const r = await auth.importUsers([{ uid: "alta-importado-1", email: C.importado, emailVerified: true, passwordHash: Buffer.from(bcrypt.hashSync("x", 4)) }],
      { hash: { algorithm: "BCRYPT" } });
    assert.equal(r.successCount, 1, JSON.stringify(r.errors));
    await auth.createUser({ uid: "alta-admin-1", email: C.admin, password: "contrasena-de-prueba", emailVerified: true });
    // Entrar con contraseña en una cuenta que ya existe.
    await signInWithEmailAndPassword(authCliente, C.admin, "contrasena-de-prueba");
    assert.equal(authCliente.currentUser?.uid, "alta-admin-1");
    await authCliente.signOut();
    // La primera entrada con Google de un usuario importado lo une a su
    // cuenta, sin crear otra ni pasar por el bloqueo.
    const g = await google(C.importado, "google-alta-3");
    assert.equal(g.user.uid, "alta-importado-1");
    assert.deepEqual((await auth.getUserByEmail(C.importado)).providerData.map((p) => p.providerId).sort(), ["google.com", "password"]);
    await authCliente.signOut();
    // Y las que se crearon con invitación siguen entrando si se revoca
    // (el acceso lo cortan las reglas, no la entrada).
    await db.doc(`invitaciones/${C.invitado}`).update({ estado: "revocada" });
    await signInWithEmailAndPassword(authCliente, C.invitado, "contrasena-de-prueba");
    await authCliente.signOut();
  });

  it("ensayo de las cuentas sin invitación activa (npm run invitaciones -- sin-invitacion): las lista y no borra nada", async () => {
    const antes = (await auth.listUsers()).users.length;
    const cuentas = await cuentasSinInvitacion(db, auth);
    const nuestras = cuentas.filter((c) => Object.values(C).includes(c.correo ?? ""));
    assert.deepEqual(nuestras.map((c) => [c.correo, c.invitacion]), [
      [C.admin, "ninguna"], [C.importado, "ninguna"], [C.invitado, "revocada"],
    ]);
    assert.deepEqual(nuestras.find((c) => c.correo === C.importado)!.proveedores.sort(), ["Google", "contraseña"]);
    assert.ok(!cuentas.some((c) => c.correo === C.google), "la de invitación activa no sale");
    assert.equal((await auth.listUsers()).users.length, antes);
  });
});

describe("aniversarios por correo (calendario, 03/11/2026), con el envío simulado", () => {
  const correos: Mensaje[] = [];
  const enviar = async (m: Mensaje) => { correos.push(m); };
  const fecha = (y: number, m: number, d: number) => ({ _class: "Date", modifier: 0, quality: 0, calendar: 0, dateval: [d, m, y, false], text: "", newyear: 0, sortval: 1 });
  const nombre = (pila: string, apellido: string) => ({ first_name: pila, surname_list: [{ surname: apellido, prefix: "", connector: "" }] });
  const persona = (h: string, pila: string, nac: string | null, def: string | null = null) => {
    const refs = [nac, def].filter(Boolean).map((e) => ({ ref: e, role: { value: 1 } }));
    return {
      handle: h, gramps_id: h, primary_name: nombre(pila, "Prueba"), event_ref_list: refs,
      birth_ref_index: nac ? 0 : -1, death_ref_index: def ? refs.length - 1 : -1, parent_family_list: [], family_list: [],
    };
  };
  const evento = (h: string, tipo: number, f: object) => ({ handle: h, type: { value: tipo, string: "" }, date: f });

  before(async () => {
    // Una instantánea pequeña, solo con lo que lee el cálculo: una persona
    // viva que cumple años el lunes 9 de noviembre de 2026 y una boda de
    // dos vivos el 5 de diciembre.
    const objetos = {
      Person: [persona("ANA", "Ana", "e1"), persona("NOVIO", "Novio", "e2")],
      Family: [{ handle: "F1", gramps_id: "F1", father_handle: "NOVIO", mother_handle: "ANA", child_ref_list: [], type: { value: 0, string: "" }, event_ref_list: [{ ref: "e3" }] }],
      Event: [evento("e1", 12, fecha(1956, 11, 9)), evento("e2", 12, fecha(1950, 3, 20)), evento("e3", 1, fecha(1980, 12, 5))],
    };
    await cubo.file(RUTA_INSTANTANEA).save(gzipSync(JSON.stringify({ objetos })), { contentType: "application/gzip" });
    for (const d of (await db.collection("preferencias").get()).docs) await d.ref.delete();
    const lote = db.batch();
    const suscrito = (correo: string, aniversarios: string, estado: string, region?: string) => {
      lote.set(db.doc(`invitaciones/${correo}`), { correo, persona: null, rol: "familiar", estado });
      lote.set(db.doc(`preferencias/${correo}`), { aniversarios, ...(region ? { region } : {}) });
    };
    suscrito("semanal@example.com", "semanal", "activa");
    suscrito("mensual@example.com", "mensual", "activa", "en-US");
    suscrito("revocado@example.com", "semanal", "revocada");
    lote.set(db.doc("preferencias/sin-suscripcion@example.com"), { modoColor: "oscuro" });
    await lote.commit();
  });

  it("el domingo, la semana siguiente a los semanales con invitación activa, con el enlace a cada ficha", async () => {
    correos.length = 0;
    const r = await enviarAniversarios(db, cubo, [2026, 11, 8], enviar);
    assert.deepEqual([r.periodos, r.enviados, r.sinAniversarios, r.sinInvitacion, r.fallos], [["semanal"], 1, 0, 1, []]);
    assert.deepEqual(correos.map((m) => [m.para, m.asunto]), [[["semanal@example.com"], "Aniversarios de la semana (9–15 de noviembre)"]]);
    const texto = correos[0].texto;
    assert.match(texto, /^9 de noviembre de 2026$/m);
    assert.match(texto, /^- Cumpleaños: Ana Prueba, cumple 70 años$/m);
    assert.match(texto, /^ {2}http:\/\/localhost:5173\/persona\/ANA$/m);
    assert.match(texto, /Ajustes: http:\/\/localhost:5173\/ajustes$/);
  });

  it("el último día del mes, el mes siguiente a los mensuales, en su región", async () => {
    correos.length = 0;
    const r = await enviarAniversarios(db, cubo, [2026, 11, 30], enviar);
    assert.deepEqual([r.periodos, r.enviados], [["mensual"], 1]);
    assert.equal(correos[0].asunto, "Aniversarios de December");
    assert.match(correos[0].texto, /^December 5, 2026$/m);
    assert.match(correos[0].texto, /^- Boda: Novio Prueba y Ana Prueba, aniversario de boda: 46 años$/m);
    assert.match(correos[0].texto, /familia\/F1$/m);
  });

  it("sin aniversarios en el periodo, no se envía nada; y los demás días, tampoco", async () => {
    correos.length = 0;
    // La semana del 16 al 22 de noviembre no tiene ninguno.
    const r = await enviarAniversarios(db, cubo, [2026, 11, 15], enviar);
    assert.deepEqual([r.periodos, r.enviados, r.sinAniversarios], [["semanal"], 0, 1]);
    const otro = await enviarAniversarios(db, cubo, [2026, 11, 10], enviar);
    assert.deepEqual([otro.periodos, otro.enviados], [[], 0]);
    assert.equal(correos.length, 0);
  });

  it("solo los tipos que eligió cada uno (04/11/2026): sin ninguno de los suyos, nada", async () => {
    await db.doc("invitaciones/bodas@example.com").set({ correo: "bodas@example.com", persona: null, rol: "familiar", estado: "activa" });
    await db.doc("preferencias/bodas@example.com").set({ aniversarios: "semanal", aniversariosTipos: ["boda"] });
    await db.doc("preferencias/mensual@example.com").update({ aniversariosTipos: ["boda", "defuncion"] });
    correos.length = 0;
    // La semana del 9 de noviembre solo tiene un cumpleaños.
    const r = await enviarAniversarios(db, cubo, [2026, 11, 8], enviar);
    assert.deepEqual([r.enviados, r.sinAniversarios], [1, 1]);
    assert.deepEqual(correos.map((m) => m.para[0]), ["semanal@example.com"]);
    // En diciembre, la boda: le llega al que eligió bodas.
    correos.length = 0;
    const m = await enviarAniversarios(db, cubo, [2026, 11, 30], enviar);
    assert.deepEqual([m.enviados, m.sinAniversarios], [1, 0]);
    assert.match(correos[0].texto, /Boda: Novio Prueba y Ana Prueba/);
    await db.doc("preferencias/bodas@example.com").delete();
  });

  it("un fallo al enviar a uno no corta a los demás", async () => {
    await db.doc("invitaciones/otro-semanal@example.com").set({ correo: "otro-semanal@example.com", persona: null, rol: "familiar", estado: "activa" });
    await db.doc("preferencias/otro-semanal@example.com").set({ aniversarios: "semanal" });
    correos.length = 0;
    const r = await enviarAniversarios(db, cubo, [2026, 11, 8], async (m) => {
      if (m.para[0] === "semanal@example.com") throw new Error("Gmail no responde");
      correos.push(m);
    });
    assert.deepEqual([r.enviados, r.fallos], [1, [{ correo: "semanal@example.com", error: "Gmail no responde" }]]);
    assert.deepEqual(correos.map((m) => m.para[0]), ["otro-semanal@example.com"]);
  });
});

// Que no quede nada abierto.
after(() => db.terminate());
