/**
 * Regenera entera la instantánea del árbol (docs/instantanea.md): lee el
 * árbol de Firestore, lo guarda en un único fichero JSON comprimido y lo
 * sube a Storage. El código es el de las funciones del servidor
 * (functions/src/instantanea.ts), que la ponen al día tras cada cambio y la
 * regeneran cada noche.
 *
 * Uso: node firestore/instantanea.ts
 */
import { conectar, elegirDestino } from "./comun.ts";
import { generarInstantanea, RUTA_INSTANTANEA } from "../functions/src/instantanea.ts";

export { generarInstantanea, RUTA_INSTANTANEA };

if (import.meta.main) {
  await elegirDestino();
  const { db, cubo } = conectar();
  const r = await generarInstantanea(db, cubo);
  console.log(`Instantánea ${RUTA_INSTANTANEA}: ${(r.bytesJson / 1e6).toFixed(1)} MB de JSON, ` +
    `${(r.bytesComprimido / 1e6).toFixed(2)} MB comprimida (${r.generada}, cambio ${r.secuencia})`);
}
