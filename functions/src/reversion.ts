/**
 * Reversión (paso 13; diseño en docs/diseno-fase-3.md, apartado 5; DA-13 b,
 * «en cadena asistida»; docs/edicion.md, «Reversión y corrección»).
 *
 * Revertir un cambio T es una transacción nueva por cada cambio que hay que
 * deshacer (`origen: "reversion"`, `revierte`), que devuelve cada objeto a
 * su «antes»: lo creado se borra, lo borrado se vuelve a crear y lo
 * modificado vuelve a como estaba. T queda `revertido` (`revertidoPor`). El
 * registro no se reescribe, así que una reversión también se puede revertir
 * (rehacer).
 *
 * Cadena: si algún objeto de T ya no está como T lo dejó, hay que deshacer
 * antes los cambios posteriores que lo tocaron, de la más nuevo al más
 * viejo; y lo mismo con cada uno de ellos. También los que usan algo que T
 * creó (al revertir, se borra) y los que borraron algo a lo que vuelve a
 * apuntar lo restaurado. Se calcula simulando, sobre el contenido actual de
 * cada objeto y una copia del índice:
 *
 * - «Como T lo dejó» se mira por el contenido (sin «change»), no por la
 *   versión, para que un cambio y su reversión posteriores se anulen.
 * - Solo cuentan los cambios posteriores con efecto: uno revertido y su
 *   reversión no cuentan; una reversión de una reversión (rehacer), sí.
 *
 * La web pide primero la cadena (sin `cadena`) y la enseña; para revertir,
 * la manda de vuelta. Si entre tanto ha cambiado, CONFLICTO con la nueva.
 * Revierten el administrador y los revisores; lo del administrador queda
 * aceptado y lo del revisor, marcado (DA-11 a).
 */
import { gunzipSync } from "node:zlib";
import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { aFirestore, clave, deClave, deFirestore, esMapa, jsonCanonico, type ObjetoGramps, type Tipo } from "../../comun/gramps.ts";
import type { CambioObjeto, Indice } from "../../comun/indice.ts";
import type { Eslabon, Operacion, ResultadoReversion } from "../../comun/peticion.ts";
import { referenciasDe } from "../../comun/referencias.ts";
import { sinAvisoDeOyentes } from "./oyentes.ts";
import { leerIndice, RUTA_CONTADORES, RUTA_INDICE, documentoIndice, type Contadores } from "./sistema.ts";
import {
  comprobarIntegridad, comprobarVinculadas, ErrorTransaccion, espacioFotos, idCambio, LIMITES, leerInvitacion, objetosParaRegistro,
  type Cubo, type ObjetoRegistro, type Opciones,
} from "./transaccion.ts";

const ID_CAMBIO = /^c\d{7}$/;

/** Una entrada del registro, con el antes y el después de cada objeto. */
interface Entrada {
  id: string;
  secuencia: number;
  estado: "marcado" | "aceptado" | "revertido";
  revierte: string | null;
  autor: { correo: string; persona: string | null; rol: string };
  accion: string;
  principal: { tipo: Tipo; handle: string };
  fecha: Timestamp;
  objetos: ObjetoRegistro[];
}

/** Un paso de la reversión: un cambio que se deshace, con lo que pasa a
 * cada uno de sus objetos. */
interface Paso {
  entrada: Entrada;
  objetos: { tipo: Tipo; handle: string; operacion: Operacion; antes: ObjetoGramps | null; despues: ObjetoGramps | null }[];
}

const sinChange = (o: ObjetoGramps | null) => (o ? jsonCanonico({ ...o, change: 0 }) : "null");
const objeto = (s: string | null) => (s ? (JSON.parse(s) as ObjetoGramps) : null);
const eslabon = (e: Entrada): Eslabon => ({
  cambio: e.id, secuencia: e.secuencia, fecha: e.fecha.toDate().toISOString(), accion: e.accion, principal: e.principal,
  autor: { persona: e.autor.persona, correo: e.autor.correo }, estado: e.estado,
});

/** Simula la reversión de `raiz` y de los cambios posteriores que haga
 * falta, leyendo dentro de la transacción. */
class Simulacion {
  /** Contenido actual (simulado) y original de cada objeto leído. */
  readonly contenido = new Map<string, ObjetoGramps | null>();
  readonly original = new Map<string, ObjetoGramps | null>();
  private entradas = new Map<string, Entrada>();
  /** Los cambios que escriben cada objeto, ya consultados. */
  private escritores = new Map<string, string[]>();
  readonly plan: Paso[] = [];
  private enPlan = new Set<string>();

  private db: Firestore;
  private tx: Transaction;
  private cubo: Cubo | undefined;
  readonly raiz: Entrada;
  /** Copia del índice, al día con lo simulado. */
  readonly indice: Indice;
  private segundos: number;

  constructor(db: Firestore, tx: Transaction, cubo: Cubo | undefined, raiz: Entrada, indice: Indice, segundos: number) {
    this.db = db;
    this.tx = tx;
    this.cubo = cubo;
    this.raiz = raiz;
    this.indice = indice;
    this.segundos = segundos;
    this.anotar(raiz);
  }

  private anotar(e: Entrada) {
    this.entradas.set(e.id, e);
  }

  async leer(k: string): Promise<ObjetoGramps | null> {
    if (!this.contenido.has(k)) {
      const { tipo, handle } = deClave(k);
      const d = await this.tx.get(this.db.collection(tipo).doc(handle));
      const o = d.exists ? (deFirestore(d.data()) as ObjetoGramps) : null;
      this.contenido.set(k, o);
      this.original.set(k, o);
    }
    return this.contenido.get(k)!;
  }

  /** Los cambios posteriores a la raíz que escribieron `k`. */
  private async escritoresDe(k: string): Promise<Entrada[]> {
    if (!this.escritores.has(k)) {
      const q = await this.tx.get(this.db.collection("cambios").where("claves", "array-contains", k));
      const ids: string[] = [];
      for (const d of q.docs) {
        const secuencia = d.get("secuencia") as number;
        if (secuencia <= this.raiz.secuencia) continue;
        const e = this.entradas.get(d.id) ?? (await leerEntrada(d.id, d.data(), this.cubo));
        if (!e.objetos.some((o) => clave(o.tipo, o.handle) === k)) continue;
        this.anotar(e);
        ids.push(e.id);
      }
      this.escritores.set(k, ids);
    }
    return this.escritores.get(k)!.map((id) => this.entradas.get(id)!);
  }

  /** Los cambios posteriores a la raíz que tienen efecto: un cambio y su
   * reversión se anulan; una reversión de una reversión vuelve a tenerlo. */
  private efectivas(): Set<string> {
    const lista = [...this.entradas.values()].filter((e) => e.secuencia > this.raiz.secuencia).sort((a, b) => a.secuencia - b.secuencia);
    const efecto = new Map<string, boolean>();
    for (const e of lista) {
      const objetivo = e.revierte ? this.entradas.get(e.revierte) : undefined;
      if (objetivo && objetivo.secuencia > this.raiz.secuencia && efecto.has(objetivo.id)) {
        if (efecto.get(objetivo.id)) {
          efecto.set(objetivo.id, false);
          efecto.set(e.id, false);
        } else {
          efecto.set(e.id, true);
        }
      } else {
        efecto.set(e.id, true);
      }
    }
    return new Set([...efecto].filter(([, v]) => v).map(([id]) => id));
  }

  /** El último cambio con efecto que escribió `k` después de `desde`, sin
   * contar los que ya se deshacen. */
  private async ultimo(k: string, desde: number): Promise<Entrada | null> {
    // Primero los escritores (que pueden añadir entradas), luego cuáles
    // tienen efecto.
    const escritores = await this.escritoresDe(k);
    const efectivas = this.efectivas();
    const candidatos = escritores.filter((e) => e.secuencia > desde && efectivas.has(e.id) && !this.enPlan.has(e.id));
    return candidatos.sort((a, b) => b.secuencia - a.secuencia)[0] ?? null;
  }

  /** Deja los objetos de `e` como `e` los dejó, deshaciendo antes lo
   * posterior. */
  private async limpiar(e: Entrada, pila: Set<string>) {
    if (pila.has(e.id)) throw new Error(`Ciclo al revertir: ${e.id}`);
    const conE = new Set(pila).add(e.id);
    for (const o of e.objetos) {
      const k = clave(o.tipo, o.handle);
      while (sinChange(await this.leer(k)) !== sinChange(objeto(o.despues))) {
        const w = await this.ultimo(k, e.secuencia);
        if (!w) throw new ErrorTransaccion("CONFLICTO", `${k} ha cambiado sin pasar por el registro`, { clave: k });
        await this.deshacer(w, conE);
      }
    }
  }

  /** Añade al plan deshacer `e` (y antes lo que haga falta). */
  async deshacer(e: Entrada, pila = new Set<string>()) {
    if (this.enPlan.has(e.id)) return;
    await this.limpiar(e, pila);
    const propios = new Set(e.objetos.map((o) => clave(o.tipo, o.handle)));
    // Lo que usa algo que `e` creó (que se va a borrar): deshacer antes los
    // cambios que se lo pusieron.
    for (const o of e.objetos.filter((x) => x.operacion === "crear")) {
      const k = clave(o.tipo, o.handle);
      for (const r of this.indice.referentesDe(o.tipo, o.handle)) {
        if (propios.has(r)) continue;
        while (referenciasDe(await this.leer(r)).some((x) => clave(x.tipo, x.handle) === k)) {
          const w = await this.ultimo(r, e.secuencia);
          if (!w) throw new ErrorTransaccion("CONFLICTO", `${r} usa ${k} sin pasar por el registro`, { clave: r });
          await this.deshacer(w, new Set(pila).add(e.id));
        }
      }
    }
    if (this.enPlan.has(e.id)) return;
    const paso: Paso = { entrada: e, objetos: [] };
    const cambios: CambioObjeto[] = [];
    for (const o of e.objetos) {
      const k = clave(o.tipo, o.handle);
      const antes = await this.leer(k);
      const vuelta = objeto(o.antes);
      // «change» siempre creciente (diseño, 5.1).
      const despues = vuelta ? { ...vuelta, change: Math.max(this.segundos, (typeof antes?.change === "number" ? antes.change : 0) + 1) } : null;
      const operacion: Operacion = !antes ? "crear" : !despues ? "borrar" : "modificar";
      paso.objetos.push({ tipo: o.tipo, handle: o.handle, operacion, antes, despues });
      cambios.push({ tipo: o.tipo, handle: o.handle, antes, despues });
      this.contenido.set(k, despues);
    }
    this.indice.aplicar(cambios);
    this.plan.push(paso);
    this.enPlan.add(e.id);
  }

  /** Lo restaurado que apunta a algo que ya no existe: deshacer el cambio
   * que lo borró. Hasta que no quede nada. */
  async restaurarBorrados() {
    for (let cambiado = true; cambiado;) {
      cambiado = false;
      for (const [k, o] of [...this.contenido]) {
        if (!o || sinChange(o) === sinChange(this.original.get(k) ?? null)) continue;
        for (const r of referenciasDe(o)) {
          if (this.indice.existe(r.tipo, r.handle)) continue;
          const kr = clave(r.tipo, r.handle);
          const w = await this.ultimo(kr, this.raiz.secuencia);
          if (!w || !w.objetos.some((x) => clave(x.tipo, x.handle) === kr && x.despues === null)) continue;
          await this.deshacer(w);
          cambiado = true;
        }
      }
    }
  }
}

async function leerEntrada(id: string, datos: Record<string, unknown> | undefined, cubo: Cubo | undefined): Promise<Entrada> {
  if (!datos) throw new ErrorTransaccion("PETICION", `No existe el cambio ${id}`);
  let objetos = datos.objetos as ObjetoRegistro[];
  const fuera = datos.fuera as { ruta: string } | null;
  if (fuera) {
    if (!cubo) throw new Error("Hace falta Storage para leer el registro");
    const [gz] = await sinAvisoDeOyentes(() => cubo.file(fuera.ruta).download());
    objetos = JSON.parse(gunzipSync(gz).toString("utf8")) as ObjetoRegistro[];
  }
  return {
    id,
    secuencia: datos.secuencia as number,
    estado: datos.estado as Entrada["estado"],
    revierte: (datos.revierte as string | null) ?? null,
    autor: datos.autor as Entrada["autor"],
    accion: datos.accion as string,
    principal: datos.principal as Entrada["principal"],
    fecha: datos.fecha as Timestamp,
    objetos,
  };
}

/** Lo que pide la web: el cambio, el motivo y, para revertir de verdad, la
 * cadena que se le enseñó. */
function leerPeticion(entrada: unknown): { cambio: string; motivo: string | null; cadena: string[] | null } {
  const mal = (m: string) => new ErrorTransaccion("PETICION", m);
  if (!esMapa(entrada)) throw mal("La petición no es un objeto");
  const { cambio, motivo, cadena } = entrada;
  if (typeof cambio !== "string" || !ID_CAMBIO.test(cambio)) throw mal("Cambio no válido");
  if (motivo !== undefined && motivo !== null && (typeof motivo !== "string" || motivo.length > LIMITES.motivo)) throw mal("Motivo no válido");
  if (cadena !== undefined && cadena !== null && (!Array.isArray(cadena) || !cadena.every((c) => typeof c === "string" && ID_CAMBIO.test(c)))) {
    throw mal("Cadena no válida");
  }
  return { cambio, motivo: typeof motivo === "string" && motivo.trim() ? motivo.trim() : null, cadena: (cadena as string[] | undefined) ?? null };
}

export async function revertir(db: Firestore, correoToken: string, entrada: unknown, opciones: Opciones = {}): Promise<ResultadoReversion> {
  const correo = correoToken.toLowerCase();
  const { cambio, motivo, cadena } = leerPeticion(entrada);
  const ahora = opciones.ahora ?? (() => new Date());

  return db.runTransaction(async (tx) => {
    const refContadores = db.doc(RUTA_CONTADORES);
    const refIndice = db.doc(RUTA_INDICE);
    const [docInvitacion, docCambio, docContadores, docIndice] = await tx.getAll(
      db.doc(`invitaciones/${correo}`), db.doc(`cambios/${cambio}`), refContadores, refIndice,
    );
    const invitacion = leerInvitacion(docInvitacion.data());
    if (!invitacion) throw new ErrorTransaccion("ACCESO", "Sin invitación activa");
    if (invitacion.rol !== "administrador" && invitacion.rol !== "revisor") {
      throw new ErrorTransaccion("SIN_PERMISO", "Solo el administrador y los revisores revierten cambios");
    }
    const raiz = await leerEntrada(cambio, docCambio.data(), opciones.cubo);
    if (raiz.estado === "revertido") throw new ErrorTransaccion("PETICION", "Este cambio ya está revertido");
    const contadores = docContadores.data() as Contadores;
    // Una carga del árbol en el proyecto real (firestore/cargar.ts) no se
    // revierte, ni lo anterior a ella: el árbol ya es otro.
    if (docCambio.get("origen") === "carga" || raiz.secuencia <= (contadores.ultimaCarga ?? 0)) {
      throw new ErrorTransaccion("PETICION", "Anterior a la última carga del árbol", { anteriorACarga: true });
    }
    const indiceAntes = leerIndice(docIndice);
    const momento = ahora();
    const segundos = Math.floor(momento.getTime() / 1000);

    // La cadena, simulando.
    const sim = new Simulacion(db, tx, opciones.cubo, raiz, indiceAntes.copia(), segundos);
    await sim.deshacer(raiz);
    await sim.restaurarBorrados();
    const eslabones = sim.plan.map((p) => eslabon(p.entrada));
    if (!cadena) return { cadena: eslabones, cambios: [], objetos: [], secuencia: contadores.secuenciaCambios };
    if (cadena.join() !== eslabones.map((e) => e.cambio).join()) {
      throw new ErrorTransaccion("CONFLICTO", "Los cambios que hay que revertir han cambiado; vuelve a mirarlos", { cadena: eslabones });
    }

    // Comprobaciones del resultado final.
    const netos: CambioObjeto[] = [...sim.contenido]
      .filter(([k, o]) => sinChange(o) !== sinChange(sim.original.get(k) ?? null) || o?.change !== sim.original.get(k)?.change)
      .map(([k, despues]) => ({ ...deClave(k), antes: sim.original.get(k) ?? null, despues }));
    const errores = comprobarIntegridad(sim.indice, netos);
    if (errores.length) throw new ErrorTransaccion("INTEGRIDAD", "La reversión dejaría el árbol incoherente", errores.slice(0, 50));
    await comprobarVinculadas(db, tx, netos.filter((c) => c.antes && !c.despues).map((c) => ({ tipo: c.tipo, handle: c.handle, operacion: "borrar" as const })));
    // Fotos subidas que desaparecen o vuelven: su espacio (espacioFotos).
    const fotosNetas = netos.filter((c) => c.tipo === "Media" && !c.antes !== !c.despues);
    const datosFotos = new Map<string, Record<string, unknown> | undefined>();
    if (fotosNetas.length) {
      (await tx.getAll(...fotosNetas.map((c) => db.doc(`datosWeb/${clave(c.tipo, c.handle)}`)))).forEach((d) => datosFotos.set(d.id, d.data()));
    }
    const espacio = espacioFotos(netos, (k) => datosFotos.get(k));
    // Una foto que vuelve y cuyos ficheros ya se borraron (pasados 30 días,
    // fotos.ts): no se puede.
    const sinFicheros = fotosNetas.filter((c) => c.despues && datosFotos.get(clave(c.tipo, c.handle))?.ficherosBorrados).map((c) => c.handle);
    if (sinFicheros.length) throw new ErrorTransaccion("INTEGRIDAD", "Los ficheros de estas fotos ya se borraron", { fotosSinFicheros: sinFicheros });

    // Las entradas que se marcan como revertidas, leídas antes de escribir.
    const fecha = Timestamp.fromDate(momento);
    const autor = { correo, persona: invitacion.persona, rol: invitacion.rol };
    const estado = invitacion.rol === "administrador" ? "aceptado" : "marcado";
    const ids: string[] = [];
    const escrituras: { id: string; datos: Record<string, unknown>; paso: Paso }[] = [];
    let secuencia = contadores.secuenciaCambios;
    for (const paso of sim.plan) {
      secuencia += 1;
      const id = idCambio(secuencia);
      ids.push(id);
      const objetosRegistro: ObjetoRegistro[] = paso.objetos.map((o) => ({
        tipo: o.tipo, handle: o.handle, operacion: o.operacion,
        changeAntes: o.antes ? (o.antes.change as number) : null,
        changeDespues: o.despues ? (o.despues.change as number) : null,
        antes: o.antes ? JSON.stringify(o.antes) : null,
        despues: o.despues ? JSON.stringify(o.despues) : null,
      }));
      const claves = new Set<string>();
      for (const o of paso.objetos) {
        claves.add(clave(o.tipo, o.handle));
        for (const r of o.despues ? referenciasDe(o.despues) : []) claves.add(clave(r.tipo, r.handle));
      }
      const guardado = await objetosParaRegistro(objetosRegistro, id, opciones.cubo);
      escrituras.push({
        id,
        paso,
        datos: {
          secuencia, fecha, autor, origen: "reversion", accion: "revertir", principal: paso.entrada.principal, motivo,
          objetos: guardado.objetos, claves: [...claves], estado,
          revision: estado === "aceptado" ? { por: autor, fecha, comentario: null } : null,
          revertidoPor: null, revierte: paso.entrada.id, corrige: null, corregidoPor: [], solicitud: null, aplicadoPor: null,
          fuera: guardado.fuera,
        },
      });
    }

    // Escrituras. Las fotos que se van, con la fecha (sus ficheros se borran
    // pasados 30 días); las que vuelven, sin ella.
    const borradoDe = new Map(fotosNetas.map((c) => [clave(c.tipo, c.handle), c.despues ? null : fecha]));
    for (const { id, datos, paso } of escrituras) {
      tx.set(db.doc(`cambios/${id}`), datos);
      const original = paso.entrada;
      tx.update(db.doc(`cambios/${original.id}`), {
        estado: "revertido",
        revertidoPor: id,
        ...(original.estado === "marcado" && { revision: { por: autor, fecha, comentario: motivo } }),
      });
      for (const o of paso.objetos) {
        const k = clave(o.tipo, o.handle);
        const pendientes = (estado === "marcado" ? 1 : 0) - (original.estado === "marcado" ? 1 : 0);
        tx.set(db.doc(`datosWeb/${k}`), {
          tipo: o.tipo, handle: o.handle, ultimoCambio: id, ultimoAutor: { correo, persona: invitacion.persona },
          ...(pendientes && { pendientes: FieldValue.increment(pendientes) }),
          ...(borradoDe.has(k) && { borrado: borradoDe.get(k) }),
        }, { merge: true });
      }
    }
    for (const c of netos) {
      const ref = db.collection(c.tipo).doc(c.handle);
      if (c.despues) tx.set(ref, aFirestore(c.despues) as Record<string, unknown>);
      else tx.delete(ref);
    }
    for (const [c, n] of espacio) if (n) tx.set(db.doc(`limites/${c}`), { bytesFotos: FieldValue.increment(n) }, { merge: true });
    sim.indice.secuencia = secuencia;
    tx.set(refIndice, documentoIndice(sim.indice));
    tx.set(refContadores, { ...contadores, secuenciaCambios: secuencia });
    return { cadena: eslabones, cambios: ids, objetos: netos.map((c) => ({ tipo: c.tipo, handle: c.handle, despues: c.despues })), secuencia };
  });
}
