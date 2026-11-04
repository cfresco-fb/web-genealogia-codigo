/**
 * Pruebas de las reglas de seguridad de Firestore y Storage contra los
 * emuladores. Cada tipo de usuario prueba todas las operaciones.
 *
 * Uso: npm run pruebas-reglas
 * (arranca emuladores vacíos y desechables en otros puertos, con
 * firebase.pruebas.json; no toca emulador-datos/ y funciona aunque estén
 * abiertos los emuladores normales).
 *
 * REGLAS_FIRESTORE y REGLAS_STORAGE permiten probar otros ficheros de
 * reglas (por ejemplo, copias estropeadas para ver que las pruebas fallan).
 */
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, setLogLevel, where } from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

const PROYECTO = "demo-arbol-familiar";
const BYTES = new Uint8Array([1, 2, 3]);

const reglas = (variable: string, fichero: string) =>
  readFileSync(process.env[variable] ?? new URL(`../${fichero}`, import.meta.url), "utf8");

// Los permisos denegados son el resultado esperado de muchas pruebas.
setLogLevel("silent");

let env: RulesTestEnvironment;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: { rules: reglas("REGLAS_FIRESTORE", "firestore.rules") },
    storage: { rules: reglas("REGLAS_STORAGE", "storage.rules") },
  });
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const invitacion = (rol: string, estado = "activa") => ({ persona: "p1", rol, estado });
    await setDoc(doc(db, "invitaciones/admin@example.com"), invitacion("administrador"));
    await setDoc(doc(db, "invitaciones/revisor@example.com"), invitacion("revisor"));
    await setDoc(doc(db, "invitaciones/familiar@example.com"), invitacion("familiar"));
    await setDoc(doc(db, "invitaciones/revocado@example.com"), invitacion("familiar", "revocada"));
    await setDoc(doc(db, "Person/p1"), { handle: "p1", gramps_id: "I1" });
    await setDoc(doc(db, "Person/p2_B"), { handle: "p2_B", gramps_id: "I2" });
    await setDoc(doc(db, "metadatos/arbol"), { version_formato: 1 });
    await setDoc(doc(db, "configuracion/presentacion"), { simbolos: { juego: "abreviaturas" } });
    await setDoc(doc(db, "preferencias/revisor@example.com"), { simbolos: { juego: "asterisco" } });
    await setDoc(doc(db, "configuracion/vivos"), { edadMaxima: 120, aniosGeneracion: 20, difHermanos: 20 });
    await setDoc(doc(db, "configuracion/arbol"), { nombre: "Árbol de prueba" });
    // Fase 3: lo que escribe la función del servidor.
    await setDoc(doc(db, "cambios/c0000001"), { secuencia: 1, autor: { correo: "familiar@example.com" } });
    await setDoc(doc(db, "registroUsuarios/r1"), { correo: "familiar@example.com" });
    await setDoc(doc(db, "solicitudes/s0000001"), { secuencia: 1, autor: { correo: "familiar@example.com" } });
    await setDoc(doc(db, "solicitudes/s0000002"), { secuencia: 2, autor: { correo: "revisor@example.com" } });
    await setDoc(doc(db, "datosWeb/Person_p1"), { tipo: "Person", handle: "p1" });
    await setDoc(doc(db, "sistema/indice"), { version: 1 });
    await setDoc(doc(db, "sistema/contadores"), { secuenciaCambios: 1 });
    await setDoc(doc(db, "limites/familiar@example.com"), { marcas: [] });
    const st = ctx.storage();
    await uploadBytes(ref(st, "registro/c0000001.json.gz"), BYTES);
    await uploadBytes(ref(st, "instantanea/arbol.json.gz"), BYTES);
    await uploadBytes(ref(st, "multimedia/m1"), BYTES);
    await uploadBytes(ref(st, "miniaturas/m1"), BYTES);
  });
});

after(async () => {
  await env?.cleanup();
});

type Usuario = { nombre: string; ctx: () => RulesTestContext; invitado: boolean; correo?: string; verificado: boolean };

const sesion = (uid: string, email: string | undefined, email_verified: boolean) =>
  () => env.authenticatedContext(uid, email === undefined ? {} : { email, email_verified });

const USUARIOS: Usuario[] = [
  { nombre: "sin sesión", ctx: () => env.unauthenticatedContext(), invitado: false, verificado: false },
  { nombre: "con sesión sin correo", ctx: sesion("u0", undefined, false), invitado: false, verificado: false },
  { nombre: "con sesión sin invitación", ctx: sesion("u1", "otro@example.com", true), invitado: false, correo: "otro@example.com", verificado: true },
  { nombre: "con correo sin verificar (y con invitación)", ctx: sesion("u2", "familiar@example.com", false), invitado: false, correo: "familiar@example.com", verificado: false },
  { nombre: "con invitación revocada", ctx: sesion("u3", "revocado@example.com", true), invitado: false, correo: "revocado@example.com", verificado: true },
  { nombre: "administrador", ctx: sesion("u4", "admin@example.com", true), invitado: true, correo: "admin@example.com", verificado: true },
  { nombre: "revisor", ctx: sesion("u5", "revisor@example.com", true), invitado: true, correo: "revisor@example.com", verificado: true },
  { nombre: "familiar", ctx: sesion("u6", "familiar@example.com", true), invitado: true, correo: "familiar@example.com", verificado: true },
  // El correo del token puede venir con mayúsculas; la invitación se busca en minúsculas.
  { nombre: "familiar con mayúsculas en el correo", ctx: sesion("u7", "Familiar@Example.COM", true), invitado: true, correo: "Familiar@Example.COM", verificado: true },
];

const segun = (permitido: boolean, p: Promise<unknown>) => (permitido ? assertSucceeds(p) : assertFails(p));

for (const u of USUARIOS) {
  describe(u.nombre, () => {
    it(u.invitado ? "lee el árbol en Firestore" : "no lee el árbol en Firestore", async () => {
      const db = u.ctx().firestore();
      await segun(u.invitado, getDoc(doc(db, "Person/p1")));
      await segun(u.invitado, getDoc(doc(db, "metadatos/arbol")));
      await segun(u.invitado, getDocs(collection(db, "Person")));
    });

    it(u.invitado ? "descarga la instantánea y las fotos" : "no descarga la instantánea ni las fotos", async () => {
      const st = u.ctx().storage();
      await segun(u.invitado, getBytes(ref(st, "instantanea/arbol.json.gz")));
      await segun(u.invitado, getBytes(ref(st, "multimedia/m1")));
      await segun(u.invitado, getBytes(ref(st, "miniaturas/m1")));
    });

    // Fotos subidas desde la web (paso 11 b): solo en la carpeta de paso
    // propia, con su tipo y tamaño; no se leen; las propias se pueden borrar.
    describe("fotos subidas (paso 11 b)", () => {
      const propia = `subidas/${(u.correo ?? "nadie@example.com").toLowerCase()}/abc12345`;
      const ajena = `subidas/${u.correo?.toLowerCase() === "revisor@example.com" ? "admin" : "revisor"}@example.com/abc12345`;
      const jpeg = { contentType: "image/jpeg" };

      it(u.invitado ? "sube a su carpeta de paso" : "no sube fotos", async () => {
        const st = u.ctx().storage();
        await segun(u.invitado, uploadBytes(ref(st, `${propia}/grande`), BYTES, jpeg));
        await segun(u.invitado, uploadBytes(ref(st, `${propia}/grande`), BYTES, { contentType: "image/png" }));
        await segun(u.invitado, uploadBytes(ref(st, `${propia}/grande`), BYTES, { contentType: "image/webp" }));
        await segun(u.invitado, uploadBytes(ref(st, `${propia}/pequena`), BYTES, jpeg));
      });

      it("no sube a otra carpeta, otro tipo, de más tamaño ni con otro nombre", async () => {
        const st = u.ctx().storage();
        await assertFails(uploadBytes(ref(st, `${ajena}/grande`), BYTES, jpeg));
        await assertFails(uploadBytes(ref(st, `${propia}/grande`), BYTES, { contentType: "image/gif" }));
        await assertFails(uploadBytes(ref(st, `${propia}/pequena`), BYTES, { contentType: "image/png" }));
        await assertFails(uploadBytes(ref(st, `${propia}/pequena`), new Uint8Array(2 * 1024 * 1024 + 1), jpeg));
        await assertFails(uploadBytes(ref(st, `${propia}/otra`), BYTES, jpeg));
        await assertFails(uploadBytes(ref(st, `${propia.replace("abc12345", "ABC")}/grande`), BYTES, jpeg));
        await assertFails(uploadBytes(ref(st, "miniaturas/m2"), BYTES, jpeg));
      });

      it(u.invitado ? "no lee las subidas, pero borra las suyas" : "no lee ni borra subidas", async () => {
        const st = u.ctx().storage();
        await env.withSecurityRulesDisabled(async (c) => {
          await uploadBytes(ref(c.storage(), `${propia}/pequena`), BYTES, jpeg);
          await uploadBytes(ref(c.storage(), `${ajena}/pequena`), BYTES, jpeg);
        });
        await assertFails(getBytes(ref(st, `${propia}/pequena`)));
        await assertFails(deleteObject(ref(st, `${ajena}/pequena`)));
        await segun(u.invitado, deleteObject(ref(st, `${propia}/pequena`)));
      });

      // El administrador las ve, para «Modificar y aplicar» (paso 14).
      const adminActivo = u.invitado && u.correo?.toLowerCase() === "admin@example.com";
      it(adminActivo ? "lee, pero no escribe ni borra, las fotos apartadas de las solicitudes (pasos 12 y 14)"
        : "no lee, escribe ni borra las fotos apartadas de las solicitudes (paso 12)", async () => {
        const st = u.ctx().storage();
        const apartada = "solicitudes/familiar@example.com/abc12345";
        await env.withSecurityRulesDisabled(async (c) => {
          await uploadBytes(ref(c.storage(), `${apartada}/grande`), BYTES, jpeg);
        });
        await segun(adminActivo, getBytes(ref(st, `${apartada}/grande`)));
        await assertFails(uploadBytes(ref(st, `${apartada}/pequena`), BYTES, jpeg));
        await assertFails(deleteObject(ref(st, `${apartada}/grande`)));
      });
    });

    it(u.verificado ? "lee su propia invitación" : "no lee ninguna invitación", async () => {
      const db = u.ctx().firestore();
      if (u.correo) await segun(u.verificado, getDoc(doc(db, `invitaciones/${u.correo.toLowerCase()}`)));
    });

    const rolDe = (): string | null => {
      if (!u.invitado) return null;
      const c = u.correo!.toLowerCase();
      return c === "admin@example.com" ? "administrador" : c === "revisor@example.com" ? "revisor" : "familiar";
    };
    const esAdministrador = rolDe() === "administrador";

    it(esAdministrador ? "lee y lista todas las invitaciones" : "no lee invitaciones ajenas ni la lista de invitaciones", async () => {
      const db = u.ctx().firestore();
      const ajena = u.correo?.toLowerCase() === "admin@example.com" ? "revisor@example.com" : "admin@example.com";
      await segun(esAdministrador, getDoc(doc(db, `invitaciones/${ajena}`)));
      await segun(esAdministrador, getDocs(collection(db, "invitaciones")));
    });

    // Fase 3 (docs/edicion.md): el registro, para el administrador y los
    // revisores; las solicitudes, las propias y, el administrador, todas.
    describe("edición (fase 3)", () => {
      const revisa = rolDe() === "administrador" || rolDe() === "revisor";

      it(revisa ? "lee el registro de cambios y sus ficheros grandes" : "no lee el registro de cambios", async () => {
        const ctx = u.ctx();
        await segun(revisa, getDoc(doc(ctx.firestore(), "cambios/c0000001")));
        await segun(revisa, getDocs(collection(ctx.firestore(), "cambios")));
        await segun(revisa, getBytes(ref(ctx.storage(), "registro/c0000001.json.gz")));
      });

      it(esAdministrador ? "lee el registro de las invitaciones" : "no lee el registro de las invitaciones", async () => {
        const db = u.ctx().firestore();
        await segun(esAdministrador, getDocs(collection(db, "registroUsuarios")));
        await segun(esAdministrador, getDoc(doc(db, "registroUsuarios/r1")));
        if (u.invitado) await assertFails(setDoc(doc(db, "registroUsuarios/r2"), { correo: u.correo }));
      });

      it(esAdministrador ? "lee todas las solicitudes" : u.invitado ? "lee solo sus solicitudes" : "no lee solicitudes", async () => {
        const db = u.ctx().firestore();
        const propio = u.correo?.toLowerCase();
        await segun(esAdministrador, getDocs(collection(db, "solicitudes")));
        for (const [id, autor] of [["s0000001", "familiar@example.com"], ["s0000002", "revisor@example.com"]]) {
          await segun(u.invitado && (esAdministrador || autor === propio), getDoc(doc(db, `solicitudes/${id}`)));
        }
        if (propio) {
          await segun(u.invitado, getDocs(query(collection(db, "solicitudes"), where("autor.correo", "==", propio))));
        }
      });

      it("no lee datosWeb, sistema ni límites", async () => {
        const db = u.ctx().firestore();
        for (const r of ["datosWeb/Person_p1", "sistema/indice", "sistema/contadores", "limites/familiar@example.com"]) {
          await assertFails(getDoc(doc(db, r)));
        }
      });

      it("no escribe nada de la edición: árbol, registro, solicitudes, datosWeb, sistema, ramas ni límites", async () => {
        const ctx = u.ctx();
        const db = ctx.firestore();
        const propio = (u.correo ?? "x@example.com").toLowerCase();
        for (const tipo of ["Tag", "Note", "Repository", "Source", "Citation", "Media", "Place", "Event", "Person", "Family"]) {
          await assertFails(setDoc(doc(db, `${tipo}/nuevo`), { handle: "nuevo" }));
        }
        await assertFails(deleteDoc(doc(db, "Person/p1")));
        await assertFails(setDoc(doc(db, "cambios/c0000002"), { secuencia: 2, autor: { correo: propio } }));
        await assertFails(setDoc(doc(db, "cambios/c0000001"), { estado: "aceptado" }));
        await assertFails(deleteDoc(doc(db, "cambios/c0000001")));
        await assertFails(setDoc(doc(db, "solicitudes/s0000003"), { secuencia: 3, autor: { correo: propio } }));
        await assertFails(deleteDoc(doc(db, "solicitudes/s0000001")));
        await assertFails(setDoc(doc(db, "datosWeb/Place_x"), { creador: { correo: propio } }));
        await assertFails(setDoc(doc(db, "sistema/contadores"), { secuenciaCambios: 0 }));
        await assertFails(setDoc(doc(db, "sistema/indice"), { version: 1 }));
        await assertFails(setDoc(doc(db, `ramas/${propio}`), { personas: {} }));
        await assertFails(setDoc(doc(db, `limites/${propio}`), { marcas: [] }));
        await assertFails(setDoc(doc(db, `invitaciones/${propio}`), { persona: "p2_B", rol: "familiar", estado: "activa" }));
        await assertFails(uploadBytes(ref(ctx.storage(), "registro/c0000002.json.gz"), BYTES));
      });
    });

    it("no escribe nada", async () => {
      const db = u.ctx().firestore();
      await assertFails(setDoc(doc(db, "Person/p1"), { handle: "p1", gramps_id: "X" }));
      await assertFails(setDoc(doc(db, "metadatos/arbol"), { version_formato: 2 }));
      await assertFails(setDoc(doc(db, "otra/cosa"), { a: 1 }));
      // Nadie puede darse acceso ni subirse de rol.
      const propio = (u.correo ?? "x@example.com").toLowerCase();
      await assertFails(setDoc(doc(db, `invitaciones/${propio}`), { persona: "p1", rol: "administrador", estado: "activa" }));
      const st = u.ctx().storage();
      await assertFails(uploadBytes(ref(st, "instantanea/arbol.json.gz"), BYTES));
      await assertFails(uploadBytes(ref(st, "multimedia/m2"), BYTES));
    });

    describe("símbolos de nacimiento y defunción", () => {
      const esAdmin = u.invitado && u.correo?.toLowerCase() === "admin@example.com";
      const propia = `preferencias/${(u.correo ?? "nadie@example.com").toLowerCase()}`;
      const ajena = u.correo?.toLowerCase() === "revisor@example.com" ? "preferencias/admin@example.com" : "preferencias/revisor@example.com";
      const valida = (simbolos: object) => ({ simbolos, actualizada: serverTimestamp() });
      // Cada caso, un valor no válido.
      const NO_VALIDAS: [string, object][] = [
        ["juego desconocido", valida({ juego: "runas" })],
        ["personalizado sin símbolos", valida({ juego: "personalizado" })],
        ["personalizado con un símbolo vacío", valida({ juego: "personalizado", nacimiento: "", defuncion: "f." })],
        ["personalizado con un símbolo de más de 4 caracteres", valida({ juego: "personalizado", nacimiento: "nac.:", defuncion: "f." })],
        // Las reglas cuentan en unidades de UTF-16, como la web: este cuenta por dos.
        ["personalizado con un carácter que cuenta por dos y 3 más", valida({ juego: "personalizado", nacimiento: "𝄞abc", defuncion: "f." })],
        ["personalizado con símbolos de más de 4 caracteres", valida({ juego: "personalizado", nacimiento: "✡✡✡✡✡", defuncion: "f." })],
        ["personalizado con un símbolo que no es texto", valida({ juego: "personalizado", nacimiento: 1, defuncion: "f." })],
        ["un juego fijo con símbolos propios", valida({ juego: "asterisco", nacimiento: "x", defuncion: "y" })],
        ["un campo de más en los símbolos", valida({ juego: "abreviaturas", color: "rojo" })],
        ["un campo de más en el documento", { ...valida({ juego: "abreviaturas" }), rol: "administrador" }],
        ["sin la fecha del servidor", { simbolos: { juego: "abreviaturas" }, actualizada: new Date(2000, 0, 1) }],
        ["los símbolos no son un mapa", valida("abreviaturas" as unknown as object)],
      ];

      it(u.invitado ? "lee el valor por defecto del árbol" : "no lee el valor por defecto del árbol", async () => {
        await segun(u.invitado, getDoc(doc(u.ctx().firestore(), "configuracion/presentacion")));
      });

      it(u.invitado ? "escribe, lee y borra su propia preferencia" : "no escribe ni lee preferencias", async () => {
        const db = u.ctx().firestore();
        await segun(u.invitado, setDoc(doc(db, propia), valida({ juego: "asterisco" })));
        await segun(u.invitado, setDoc(doc(db, propia), valida({ juego: "personalizado", nacimiento: "nac.", defuncion: "✝" })));
        // 4 caracteres, aunque cada uno ocupe varios bytes.
        await segun(u.invitado, setDoc(doc(db, propia), valida({ juego: "personalizado", nacimiento: "✡✡✡✡", defuncion: "†✝" })));
        await segun(u.invitado, setDoc(doc(db, propia), valida({ juego: "david" })));
        await segun(u.invitado, getDoc(doc(db, propia)));
        await segun(u.invitado, deleteDoc(doc(db, propia)));
      });

      it("no escribe su preferencia con valores no válidos", async () => {
        const db = u.ctx().firestore();
        for (const [, datos] of NO_VALIDAS) await assertFails(setDoc(doc(db, propia), datos));
      });

      it("no lee, escribe ni borra la preferencia de otro, ni lista las preferencias", async () => {
        const db = u.ctx().firestore();
        await assertFails(getDoc(doc(db, ajena)));
        await assertFails(setDoc(doc(db, ajena), valida({ juego: "asterisco" })));
        await assertFails(deleteDoc(doc(db, ajena)));
        await assertFails(getDocs(collection(db, "preferencias")));
      });

      it(esAdmin ? "fija el valor por defecto del árbol" : "no fija el valor por defecto del árbol", async () => {
        const db = u.ctx().firestore();
        await segun(esAdmin, setDoc(doc(db, "configuracion/presentacion"), valida({ juego: "asterisco" })));
        await segun(esAdmin, setDoc(doc(db, "configuracion/presentacion"), valida({ juego: "abreviaturas" })));
      });

      it("no fija el valor por defecto con valores no válidos, ni lo borra, ni escribe otra configuración", async () => {
        const db = u.ctx().firestore();
        for (const [, datos] of NO_VALIDAS) await assertFails(setDoc(doc(db, "configuracion/presentacion"), datos));
        await assertFails(deleteDoc(doc(db, "configuracion/presentacion")));
        await assertFails(setDoc(doc(db, "configuracion/otra"), valida({ juego: "asterisco" })));
        await assertFails(getDocs(collection(db, "configuracion")));
      });
    });

    // Persona de inicio, región de las fechas y modo de color, en el mismo
    // documento que los símbolos propios (decisiones del 23/10/2026,
    // «Ajustes, persona de inicio, cajas y fechas», y del 24/10/2026,
    // «Diseño visual»).
    describe("persona de inicio, región y modo de color", () => {
      const propia = `preferencias/${(u.correo ?? "nadie@example.com").toLowerCase()}`;
      const ajena = u.correo?.toLowerCase() === "revisor@example.com" ? "preferencias/admin@example.com" : "preferencias/revisor@example.com";
      const con = (campos: object) => ({ ...campos, actualizada: serverTimestamp() });
      // Cada caso, un valor no válido.
      const NO_VALIDAS: [string, object][] = [
        ["persona que no existe", con({ personaInicio: "p9" })],
        ["persona vacía", con({ personaInicio: "" })],
        ["persona con caracteres raros", con({ personaInicio: "p1/x" })],
        ["persona que no es texto", con({ personaInicio: 1 })],
        ["región sin país", con({ region: "es" })],
        ["región en otro formato", con({ region: "ES-es" })],
        ["región con un guion bajo", con({ region: "es_ES" })],
        ["región numérica de cuatro cifras", con({ region: "es-4190" })],
        ["región que no es texto", con({ region: 34 })],
        ["región válida y símbolos no válidos", con({ region: "es-ES", simbolos: { juego: "runas" } })],
        ["modo de color automático (no se guarda)", con({ modoColor: "auto" })],
        ["modo de color desconocido", con({ modoColor: "sepia" })],
        ["modo de color en otro idioma", con({ modoColor: "dark" })],
        ["modo de color que no es texto", con({ modoColor: true })],
        ["una sola generación", con({ generaciones: 1 })],
        ["generaciones negativas", con({ generaciones: -4 })],
        ["generaciones con decimales", con({ generaciones: 4.5 })],
        ["generaciones como texto", con({ generaciones: "4" })],
        ["generaciones «todas» en otra forma", con({ generaciones: "Todas" })],
        ["aniversarios «ninguno» (no se guarda)", con({ aniversarios: "ninguno" })],
        ["aniversarios diarios", con({ aniversarios: "diario" })],
        ["aniversarios que no son texto", con({ aniversarios: true })],
        ["tipos de aniversarios vacíos", con({ aniversariosTipos: [] })],
        ["tipos de aniversarios repetidos", con({ aniversariosTipos: ["boda", "boda"] })],
        ["tipo de aniversario desconocido", con({ aniversariosTipos: ["bautizo"] })],
        ["tipos de aniversarios que no son una lista", con({ aniversariosTipos: "boda" })],
        ["cinco tipos de aniversarios", con({ aniversariosTipos: ["cumpleanos", "nacimiento", "defuncion", "boda", "cumpleanos"] })],
        ["sin la fecha del servidor", { personaInicio: "p1", actualizada: new Date(2000, 0, 1) }],
      ];

      it(u.invitado ? "guarda su persona de inicio, su región y su modo de color, con o sin símbolos" : "no guarda persona de inicio, región ni modo de color", async () => {
        const db = u.ctx().firestore();
        await segun(u.invitado, setDoc(doc(db, propia), con({ personaInicio: "p2_B" })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ region: "en-US" })));
        // Región numérica (UN M.49), la de muchos navegadores en Hispanoamérica.
        await segun(u.invitado, setDoc(doc(db, propia), con({ region: "es-419" })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ modoColor: "oscuro" })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ modoColor: "claro", region: "es-ES" })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ personaInicio: "p1", region: "es-ES", simbolos: { juego: "david" } })));
        await segun(u.invitado, deleteDoc(doc(db, propia)));
      });

      // Generaciones con que se abre el árbol (decisión del 29/10/2026):
      // desde 2, sin límite, o «todas».
      it(u.invitado ? "guarda las generaciones con que se abre el árbol" : "no guarda las generaciones", async () => {
        const db = u.ctx().firestore();
        await segun(u.invitado, setDoc(doc(db, propia), con({ generaciones: 2 })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ generaciones: 250 })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ generaciones: "todas", personaInicio: "p1" })));
      });

      // Aniversarios por correo (calendario, 03/11/2026): semanal o mensual;
      // sin el campo, ninguno.
      it(u.invitado ? "guarda los aniversarios por correo" : "no guarda los aniversarios por correo", async () => {
        const db = u.ctx().firestore();
        await segun(u.invitado, setDoc(doc(db, propia), con({ aniversarios: "semanal" })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ aniversarios: "mensual", region: "es-ES" })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ aniversarios: "semanal", aniversariosTipos: ["cumpleanos", "boda"] })));
        await segun(u.invitado, setDoc(doc(db, propia), con({ aniversariosTipos: ["cumpleanos", "nacimiento", "defuncion", "boda"] })));
      });

      it("no guarda valores no válidos", async () => {
        const db = u.ctx().firestore();
        for (const [, datos] of NO_VALIDAS) await assertFails(setDoc(doc(db, propia), datos));
      });

      it("no cambia la persona de inicio de otro", async () => {
        await assertFails(setDoc(doc(u.ctx().firestore(), ajena), con({ personaInicio: "p1" })));
      });

      it("no se guardan en el valor por defecto del árbol", async () => {
        const db = u.ctx().firestore();
        await assertFails(setDoc(doc(db, "configuracion/presentacion"), con({ simbolos: { juego: "asterisco" }, region: "es-ES" })));
        await assertFails(setDoc(doc(db, "configuracion/presentacion"), con({ simbolos: { juego: "asterisco" }, personaInicio: "p1" })));
        await assertFails(setDoc(doc(db, "configuracion/presentacion"), con({ simbolos: { juego: "asterisco" }, modoColor: "oscuro" })));
        await assertFails(setDoc(doc(db, "configuracion/presentacion"), con({ simbolos: { juego: "asterisco" }, generaciones: 6 })));
      });
    });

    describe("quién se considera vivo", () => {
      const esAdmin = u.invitado && u.correo?.toLowerCase() === "admin@example.com";
      const ruta = "configuracion/vivos";
      const valida = (o: object = {}) => ({ edadMaxima: 120, aniosGeneracion: 20, difHermanos: 20, ...o, actualizada: serverTimestamp() });
      // Cada caso, un valor no válido.
      const NO_VALIDAS: [string, object][] = [
        ["edad máxima por debajo del límite", valida({ edadMaxima: 79 })],
        ["edad máxima por encima del límite", valida({ edadMaxima: 151 })],
        ["años por generación por debajo del límite", valida({ aniosGeneracion: 9 })],
        ["años por generación por encima del límite", valida({ aniosGeneracion: 51 })],
        ["diferencia entre hermanos por debajo del límite", valida({ difHermanos: 4 })],
        ["diferencia entre hermanos por encima del límite", valida({ difHermanos: 51 })],
        ["un número con decimales", valida({ edadMaxima: 120.5 })],
        ["un texto", valida({ difHermanos: "20" })],
        ["falta un parámetro", (({ difHermanos: _, ...resto }) => resto)(valida())],
        ["un campo de más", valida({ minimo: 13 })],
        ["sin la fecha del servidor", { ...valida(), actualizada: new Date(2000, 0, 1) }],
      ];

      it(u.invitado ? "lee los parámetros" : "no lee los parámetros", async () => {
        await segun(u.invitado, getDoc(doc(u.ctx().firestore(), ruta)));
      });

      it(esAdmin ? "cambia los parámetros" : "no cambia los parámetros", async () => {
        const db = u.ctx().firestore();
        await segun(esAdmin, setDoc(doc(db, ruta), valida({ edadMaxima: 80, aniosGeneracion: 10, difHermanos: 5 })));
        await segun(esAdmin, setDoc(doc(db, ruta), valida({ edadMaxima: 150, aniosGeneracion: 50, difHermanos: 50 })));
        await segun(esAdmin, setDoc(doc(db, ruta), valida()));
      });

      it("no pone valores no válidos ni borra los parámetros", async () => {
        const db = u.ctx().firestore();
        for (const [, datos] of NO_VALIDAS) await assertFails(setDoc(doc(db, ruta), datos));
        await assertFails(deleteDoc(doc(db, ruta)));
      });
    });

    describe("nombre del árbol", () => {
      const esAdmin = u.invitado && u.correo?.toLowerCase() === "admin@example.com";
      const ruta = "configuracion/arbol";
      const valida = (nombre: unknown) => ({ nombre, actualizada: serverTimestamp() });
      // Cada caso, un valor no válido.
      const NO_VALIDAS: [string, object][] = [
        ["vacío", valida("")],
        ["de 81 caracteres", valida("a".repeat(81))],
        ["no es texto", valida(1)],
        ["falta el nombre", { actualizada: serverTimestamp() }],
        ["un campo de más", { ...valida("Árbol"), subtitulo: "x" }],
        ["sin la fecha del servidor", { nombre: "Árbol", actualizada: new Date(2000, 0, 1) }],
      ];

      it(u.invitado ? "lee el nombre" : "no lee el nombre", async () => {
        await segun(u.invitado, getDoc(doc(u.ctx().firestore(), ruta)));
      });

      it(esAdmin ? "cambia el nombre" : "no cambia el nombre", async () => {
        const db = u.ctx().firestore();
        await segun(esAdmin, setDoc(doc(db, ruta), valida("A")));
        await segun(esAdmin, setDoc(doc(db, ruta), valida("Árbol Frescó-Werchowsky ✡ ".padEnd(80, "·"))));
        await segun(esAdmin, setDoc(doc(db, ruta), valida("Árbol de prueba")));
      });

      it("no pone valores no válidos ni borra el nombre", async () => {
        const db = u.ctx().firestore();
        for (const [, datos] of NO_VALIDAS) await assertFails(setDoc(doc(db, ruta), datos));
        await assertFails(deleteDoc(doc(db, ruta)));
      });
    });

    it("no lee otras rutas", async () => {
      const ctx = u.ctx();
      await assertFails(getDoc(doc(ctx.firestore(), "otra/cosa")));
      await assertFails(getBytes(ref(ctx.storage(), "otra/cosa")));
    });
  });
}
