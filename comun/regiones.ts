/**
 * Regiones de Google Cloud de las funciones del servidor (docs/edicion.md,
 * «Funciones»). La web llama a la función invocable en REGION_FUNCIONES.
 *
 * Madrid (europe-southwest1) admite Cloud Functions de 2.ª generación y los
 * disparadores de Firestore (Eventarc), que tienen que estar en la misma
 * región que la base de datos de Firestore. No tiene Cloud Scheduler, así
 * que la regeneración nocturna de la instantánea va en otra región europea
 * (pendiente de que Carlos lo confirme).
 */
export const REGION_FUNCIONES = "europe-southwest1";
export const REGION_PROGRAMADAS = "europe-west1";
