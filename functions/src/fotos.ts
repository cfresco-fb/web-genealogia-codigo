/**
 * Fotos subidas desde la web (fase 3, paso 11 b; docs/edicion.md, «Subir
 * fotos»; comun/fotos.ts). El navegador deja la grande y la pequeña en
 * `subidas/{correo}/{id}/`; al guardar, la transacción (transaccion.ts):
 *
 *  1. comprueba que están, su tipo y su tamaño (`comprobarSubidas`);
 *  2. antes de la transacción de Firestore, las copia a su sitio
 *     (`multimedia/{handle}` y `miniaturas/{handle}`), sin pisar nada, y
 *     calcula la suma MD5 de la grande, que Gramps guarda en el objeto
 *     (`colocarFotos`);
 *  3. si la transacción falla, borra lo copiado (`quitarFicheros`); si va
 *     bien, borra la carpeta de paso.
 *
 * Lo que se queda en la carpeta de paso (formularios abandonados) lo borra
 * la regeneración nocturna (`limpiarSubidas`).
 *
 * Los ficheros de una foto borrada del árbol se quedan DIAS_FOTOS_BORRADAS
 * días, para poder revertir el borrado, y luego los borra la regeneración
 * nocturna (`limpiarFotosBorradas`; 29/10/2026).
 *
 * Las de una solicitud de cambio (paso 12) se apartan a
 * `solicitudes/{correo}/{id}/` (`apartarFotos`) hasta que se aplica (y se
 * colocan desde ahí), se rechaza o se retira (y se borran).
 */
import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  BYTES_MAXIMO_GRANDE, BYTES_MAXIMO_PEQUENA, CARPETA_MINIATURAS, CARPETA_SUBIDAS, DIAS_FOTOS_BORRADAS, rutaApartada, rutaSubida, tipoPorCabecera,
  TIPOS_FOTO, type TipoFoto,
} from "../../comun/fotos.ts";
import type { FicheroPeticion } from "../../comun/peticion.ts";
import { sinAvisoDeOyentes } from "./oyentes.ts";
import type { Cubo } from "./transaccion.ts";

/** Una foto subida, comprobada. */
export interface FotoSubida extends FicheroPeticion {
  mime: TipoFoto;
  /** Las dos copias juntas. */
  bytes: number;
}

/** Una foto ya en su sitio. */
export interface FotoColocada extends FotoSubida {
  /** MD5 de la grande, en hexadecimal (como Media.checksum de Gramps). */
  checksum: string;
  /** De una solicitud que el administrador aplica modificada (paso 14):
   * quien la pidió, que es su creador y en cuyo espacio cuenta. */
  de?: { correo: string; persona: string | null; rol: string };
}

export class ErrorFotos extends Error {}

/** Las subidas existen y son lo que dicen; si no, ErrorFotos. */
export async function comprobarSubidas(cubo: Cubo, correo: string, ficheros: FicheroPeticion[]): Promise<FotoSubida[]> {
  const salida: FotoSubida[] = [];
  for (const f of ficheros) {
    const meta = async (copia: "grande" | "pequena") => {
      const [m] = await cubo.file(rutaSubida(correo, f.subida, copia)).getMetadata().catch(() => {
        throw new ErrorFotos(`No está la foto subida ${f.subida} (${copia})`);
      });
      return { tipo: String(m.contentType ?? ""), bytes: Number(m.size ?? 0) };
    };
    const g = await meta("grande");
    const p = await meta("pequena");
    if (!TIPOS_FOTO.includes(g.tipo as TipoFoto) || g.bytes <= 0 || g.bytes > BYTES_MAXIMO_GRANDE) throw new ErrorFotos(`Foto grande no válida: ${f.subida}`);
    if (p.tipo !== "image/jpeg" || p.bytes <= 0 || p.bytes > BYTES_MAXIMO_PEQUENA) throw new ErrorFotos(`Foto pequeña no válida: ${f.subida}`);
    salida.push({ ...f, mime: g.tipo as TipoFoto, bytes: g.bytes + p.bytes });
  }
  return salida;
}

/** Copia cada foto a su sitio, sin pisar ninguna que ya esté (si la hay,
 * ErrorFotos, tras quitar lo que se haya copiado). Comprueba por sus
 * primeros bytes que cada copia es del tipo que dice (la pequeña, siempre
 * JPEG): comprobarSubidas solo ve el tipo que declaró el navegador.
 * Devuelve las fotos con su suma y las rutas escritas. Una a una, para no
 * tener muchas en memoria. */
export async function colocarFotos(
  cubo: Cubo, correo: string, fotos: FotoSubida[], origen = rutaSubida,
): Promise<{ colocadas: FotoColocada[]; rutas: string[] }> {
  const colocadas: FotoColocada[] = [];
  const rutas: string[] = [];
  try {
    for (const f of fotos) {
      const destinos = { grande: `multimedia/${f.handle}`, pequena: `${CARPETA_MINIATURAS}${f.handle}` };
      for (const d of Object.values(destinos)) {
        const [existe] = await cubo.file(d).exists();
        if (existe) throw new ErrorFotos(`Ya hay un fichero en ${d}`);
      }
      let checksum = "";
      for (const copia of ["grande", "pequena"] as const) {
        const [bytes] = await sinAvisoDeOyentes(() => cubo.file(origen(correo, f.subida, copia)).download());
        const tipo = copia === "grande" ? f.mime : "image/jpeg";
        if (tipoPorCabecera(bytes) !== tipo) throw new ErrorFotos(`La foto ${f.subida} (${copia}) no es una imagen del tipo que dice`);
        if (copia === "grande") checksum = createHash("md5").update(bytes).digest("hex");
        await cubo.file(destinos[copia]).save(bytes, { resumable: false, contentType: tipo });
        rutas.push(destinos[copia]);
      }
      colocadas.push({ ...f, checksum });
    }
  } catch (e) {
    await quitarFicheros(cubo, rutas);
    throw e;
  }
  return { colocadas, rutas };
}

/** Copia las subidas de una solicitud a su carpeta (paso 12). Devuelve las
 * rutas escritas; si falla, quita lo copiado. */
export async function apartarFotos(cubo: Cubo, correo: string, fotos: FotoSubida[]): Promise<string[]> {
  const rutas: string[] = [];
  try {
    for (const f of fotos) {
      for (const copia of ["grande", "pequena"] as const) {
        const destino = rutaApartada(correo, f.subida, copia);
        await cubo.file(rutaSubida(correo, f.subida, copia)).copy(cubo.file(destino));
        rutas.push(destino);
      }
    }
  } catch (e) {
    await quitarFicheros(cubo, rutas);
    throw e;
  }
  return rutas;
}

/** Las fotos apartadas de una solicitud (al rechazarla o retirarla). */
export async function borrarApartadas(cubo: Cubo, correo: string, fotos: FicheroPeticion[]) {
  await quitarFicheros(cubo, fotos.flatMap((f) => [rutaApartada(correo, f.subida, "grande"), rutaApartada(correo, f.subida, "pequena")]));
}

/** Borra ficheros, sin fallar si alguno ya no está. */
export async function quitarFicheros(cubo: Cubo, rutas: string[]) {
  await Promise.all(rutas.map((r) => cubo.file(r).delete({ ignoreNotFound: true }).catch(() => undefined)));
}

/** Borra la carpeta de paso de las subidas ya guardadas. */
export async function borrarSubidas(cubo: Cubo, correo: string, fotos: FicheroPeticion[]) {
  await quitarFicheros(cubo, fotos.flatMap((f) => [rutaSubida(correo, f.subida, "grande"), rutaSubida(correo, f.subida, "pequena")]));
}

/** Borra los ficheros (grande y pequeña) de las fotos borradas del árbol
 * hace más de `dias` (`datosWeb.borrado`, que ponen la transacción y la
 * reversión) y lo apunta (`ficherosBorrados`: ya no se puede revertir el
 * borrado). Si la foto ha vuelto, solo quita la marca. Devuelve cuántas
 * fotos ha borrado. */
export async function limpiarFotosBorradas(db: Firestore, cubo: Cubo, ahora = new Date(), dias = DIAS_FOTOS_BORRADAS): Promise<number> {
  const limite = Timestamp.fromMillis(ahora.getTime() - dias * 86_400_000);
  const viejas = await db.collection("datosWeb").where("borrado", "<=", limite).get();
  let n = 0;
  for (const d of viejas.docs) {
    if (d.get("tipo") !== "Media") continue;
    const handle = String(d.get("handle"));
    const sigue = (await db.doc(`Media/${handle}`).get()).exists;
    if (!sigue) {
      await quitarFicheros(cubo, [`multimedia/${handle}`, `${CARPETA_MINIATURAS}${handle}`]);
      n++;
    }
    await d.ref.update({ borrado: FieldValue.delete(), ...(!sigue && { ficherosBorrados: Timestamp.fromDate(ahora) }) });
  }
  return n;
}

/** Borra las subidas de hace más de `horas` (formularios abandonados).
 * Devuelve cuántos ficheros ha borrado. */
export async function limpiarSubidas(cubo: Cubo, ahora = new Date(), horas = 24): Promise<number> {
  const [ficheros] = await cubo.getFiles({ prefix: CARPETA_SUBIDAS });
  const limite = ahora.getTime() - horas * 3600_000;
  const viejos = ficheros.filter((f) => new Date(String(f.metadata.timeCreated ?? 0)).getTime() < limite);
  await quitarFicheros(cubo, viejos.map((f) => f.name));
  return viejos.length;
}
