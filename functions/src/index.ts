/**
 * Funciones del servidor (docs/edicion.md, «Funciones»; DA-1 b):
 *
 * - arbol: una sola función invocable para todas las acciones, para que una
 *   instancia caliente sirva para todo (DA-26 a). Por ahora, «calentar»
 *   (la llama la web al abrir un formulario), «aplicar» (guardar un
 *   cambio, transaccion.ts; con `corrige`, una corrección del
 *   administrador), «solicitar», «retirarSolicitud», «aplicarSolicitud»
 *   y «rechazarSolicitud» (pasos 12 y 14, solicitudes.ts), «revertir» (paso 13, reversion.ts) y «aceptar»
 *   (revision.ts); «invitacion» (paso 14, usuarios.ts: alta y cambios de
 *   las invitaciones, el administrador). Con `resuelve`, «aplicar» es
 *   «Modificar y aplicar» una solicitud.
 * - alCrearCambio: tras cada entrada del registro, actualiza la
 *   instantánea por partes (DA-23 a).
 * - alCrearSolicitud: el aviso por correo a los administradores (avisos.ts).
 * - regenerarNocturna: cada noche, la instantánea entera, comparándola con
 *   la de por partes y con el índice; borra las fotos subidas que no se
 *   llegaron a guardar (más de un día en la carpeta de paso) y los ficheros
 *   de las fotos borradas del árbol hace más de 30 días.
 * - copiaNocturnaDrive: cada noche, después, las fotos nuevas o cambiadas
 *   y el árbol entero en el Google Drive de Carlos (copiaDrive.ts;
 *   docs/puesta-en-marcha.md, apartado 8 bis).
 * - antesDeCrearCuenta: función de bloqueo de Authentication (exige Identity
 *   Platform): solo se crean cuentas de correos con invitación activa
 *   (Carlos, 01/11/2026; docs/acceso.md, «Altas solo con invitación»).
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger, setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type FunctionsErrorCode } from "firebase-functions/v2/https";
import { beforeUserCreated, HttpsError as ErrorAlta } from "firebase-functions/v2/identity";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { REGION_FUNCIONES, REGION_PROGRAMADAS } from "../../comun/regiones.ts";
import { invitacionActiva, SIN_INVITACION } from "../../comun/altas.ts";
import { createTransport } from "nodemailer";
import { avisarSolicitud, type Enviar } from "./avisos.ts";
import { copiarADrive, driveReal } from "./copiaDrive.ts";
import { limpiarFotosBorradas, limpiarSubidas } from "./fotos.ts";
import { actualizarInstantanea, comprobarInstantanea } from "./instantanea.ts";
import { revertir } from "./reversion.ts";
import { aceptarCambio } from "./revision.ts";
import { aplicarSolicitud, crearSolicitud, rechazarSolicitud, retirarSolicitud } from "./solicitudes.ts";
import { aplicarTransaccion, ErrorTransaccion, leerInvitacion, type CodigoError } from "./transaccion.ts";
import { guardarInvitacion } from "./usuarios.ts";

setGlobalOptions({ region: REGION_FUNCIONES, maxInstances: 5 });
initializeApp();

const CODIGOS: Record<CodigoError, FunctionsErrorCode> = {
  ACCESO: "permission-denied",
  SIN_PERMISO: "permission-denied",
  PETICION: "invalid-argument",
  ESQUEMA: "invalid-argument",
  INTEGRIDAD: "failed-precondition",
  CONFLICTO: "aborted",
  LIMITE: "resource-exhausted",
};

// App Check (D5; docs/puesta-en-marcha.md, «App Check»), en dos fases según
// APP_CHECK (functions/.env.arbol-freswer): «vigilar» (por defecto) deja
// pasar las llamadas sin permiso válido y las apunta en el registro;
// «obligatorio» las rechaza. En el emulador, nunca se exige (la web no lo
// usa con los emuladores).
const emulando = process.env.FUNCTIONS_EMULATOR === "true";
const APP_CHECK_OBLIGATORIO = !emulando && process.env.APP_CHECK === "obligatorio";

export const arbol = onCall({ enforceAppCheck: APP_CHECK_OBLIGATORIO }, async (req) => {
  if (!req.app && !emulando) logger.warn("Llamada sin App Check válido (fase de vigilancia)", { correo: req.auth?.token.email ?? null });
  const token = req.auth?.token;
  if (!token) throw new HttpsError("unauthenticated", "Hay que entrar con una cuenta");
  if (!token.email || token.email_verified !== true) throw new HttpsError("permission-denied", "Correo sin verificar");
  const accion = (req.data as { accion?: unknown } | null)?.accion;
  try {
    switch (accion) {
      case "calentar":
        return { ok: true };
      case "aplicar":
        return await aplicarTransaccion(getFirestore(), token.email, (req.data as { peticion?: unknown }).peticion, {
          cubo: getStorage().bucket(),
        });
      case "solicitar":
        return await crearSolicitud(getFirestore(), token.email, (req.data as { solicitud?: unknown }).solicitud, {
          cubo: getStorage().bucket(),
        });
      case "retirarSolicitud":
        return await retirarSolicitud(getFirestore(), token.email, (req.data as { id?: unknown }).id, { cubo: getStorage().bucket() });
      case "aplicarSolicitud":
        return await aplicarSolicitud(getFirestore(), token.email, (req.data as { resolucion?: unknown }).resolucion, { cubo: getStorage().bucket() });
      case "rechazarSolicitud":
        return await rechazarSolicitud(getFirestore(), token.email, (req.data as { resolucion?: unknown }).resolucion, { cubo: getStorage().bucket() });
      case "aceptar":
        return await aceptarCambio(getFirestore(), token.email, (req.data as { revision?: unknown }).revision);
      case "revertir":
        return await revertir(getFirestore(), token.email, (req.data as { reversion?: unknown }).reversion, { cubo: getStorage().bucket() });
      case "invitacion":
        return await guardarInvitacion(getFirestore(), token.email, (req.data as { invitacion?: unknown }).invitacion);
      default:
        throw new HttpsError("invalid-argument", `Acción desconocida: ${String(accion)}`);
    }
  } catch (e) {
    if (e instanceof ErrorTransaccion) {
      throw new HttpsError(CODIGOS[e.codigo], e.message, { codigo: e.codigo, detalles: e.detalles });
    }
    if (e instanceof HttpsError) throw e;
    // Un fallo inesperado: sin esto, la web solo recibe «internal» y no
    // puede distinguirlo de un fallo de la conexión. El texto, solo al
    // administrador (revisión del 02/11/2026, B3): a los demás, null; el
    // detalle completo queda en el registro de la función.
    logger.error("Fallo al aplicar un cambio", e);
    let admin = false;
    try {
      const correo = token.email.toLowerCase();
      admin = !correo.includes("/") && leerInvitacion((await getFirestore().doc(`invitaciones/${correo}`).get()).data())?.rol === "administrador";
    } catch (l) {
      logger.error("No se ha podido leer la invitación tras un fallo interno", l);
    }
    throw new HttpsError("internal", "Fallo del servidor", { codigo: "INTERNO", mensaje: admin ? (e instanceof Error ? e.message : String(e)) : null });
  }
});

// Altas solo con invitación: antes de crear la cuenta, con contraseña o en
// la primera entrada con Google. No pasan por aquí las entradas de quien ya
// tiene cuenta (tampoco al unirle Google), ni las cuentas creadas con el SDK
// de administración (la migración de Supabase, importUsers): pruebas en
// functions/pruebas/servidor.test.ts. Solo se registra esta, no la de antes
// de entrar (las invitaciones revocadas las cortan las reglas).
export const antesDeCrearCuenta = beforeUserCreated(async (evento) => {
  const correo = evento.data?.email?.toLowerCase() ?? "";
  if (correo && !correo.includes("/") && invitacionActiva((await getFirestore().doc(`invitaciones/${correo}`).get()).data())) return;
  logger.info("Alta rechazada: correo sin invitación activa", { correo, proveedor: evento.additionalUserInfo?.providerId ?? null });
  throw new ErrorAlta("permission-denied", SIN_INVITACION);
});

// Con reintento: si falla algo pasajero, Eventarc lo repite y la
// instantánea no queda desfasada hasta el siguiente cambio
// (actualizarInstantanea es idempotente). Para que un fallo que no se arregla
// solo no se repita durante días, los avisos de hace más de una hora se dejan
// (Carlos, 02/11/2026): la regeneración nocturna pone la instantánea al día.
const MAXIMO_REINTENTO_MS = 60 * 60 * 1000;

export const alCrearCambio = onDocumentCreated({ document: "cambios/{id}", retry: true }, async (evento) => {
  const edad = Date.now() - Date.parse(evento.time);
  if (edad > MAXIMO_REINTENTO_MS) {
    logger.error("Instantánea sin actualizar: el cambio lleva más de una hora fallando; queda para la regeneración nocturna", { cambio: evento.params.id, desde: evento.time });
    return;
  }
  const r = await actualizarInstantanea(getFirestore(), getStorage().bucket());
  logger.info("Instantánea al día", { cambio: evento.params.id, ...r });
});

// Cuenta de Gmail y su contraseña de aplicación, en Secret Manager
// (docs/puesta-en-marcha.md); en el emulador no se usan.
const GMAIL_USUARIO = defineSecret("GMAIL_USUARIO");
const GMAIL_CONTRASENA = defineSecret("GMAIL_CONTRASENA");
const enEmulador = process.env.FUNCTIONS_EMULATOR === "true";

const enviarCorreo: Enviar = async (m) => {
  if (enEmulador) {
    logger.info("Correo (emulador: no se envía)", m);
    return;
  }
  const usuario = GMAIL_USUARIO.value();
  const transporte = createTransport({ service: "gmail", auth: { user: usuario, pass: GMAIL_CONTRASENA.value() } });
  await transporte.sendMail({ from: usuario, to: m.para, subject: m.asunto, text: m.texto });
};

export const alCrearSolicitud = onDocumentCreated(
  { document: "solicitudes/{id}", secrets: enEmulador ? [] : [GMAIL_USUARIO, GMAIL_CONTRASENA] },
  async (evento) => {
    const r = await avisarSolicitud(getFirestore(), evento.params.id, enviarCorreo);
    logger.info("Aviso de solicitud", { solicitud: evento.params.id, ...r });
  },
);

export const regenerarNocturna = onSchedule(
  { schedule: "every day 04:00", timeZone: "Europe/Madrid", region: REGION_PROGRAMADAS },
  async () => {
    const r = await comprobarInstantanea(getFirestore(), getStorage().bucket());
    if (r.instantanea.length || r.indice.length) {
      logger.warn("La instantánea por partes o el índice no coincidían con los reconstruidos desde cero", {
        instantanea: r.instantanea.slice(0, 50), indice: r.indice,
      });
    } else {
      logger.info("Instantánea regenerada; la de por partes y el índice coincidían");
    }
    const borradas = await limpiarSubidas(getStorage().bucket());
    if (borradas) logger.info("Fotos subidas sin guardar, borradas", { ficheros: borradas });
    const viejas = await limpiarFotosBorradas(getFirestore(), getStorage().bucket());
    if (viejas) logger.info("Ficheros de fotos borradas hace más de 30 días, borrados", { fotos: viejas });
  },
);

// Google Drive de Carlos (apartado 8 bis): el cliente OAuth (su ID, en
// functions/.env.arbol-freswer; su secreto y el permiso de refresco de la
// autorización de Carlos, en Secret Manager). Mientras no estén (el ID
// vacío o los secretos con «pendiente»), la copia no se hace y no avisa.
const DRIVE_CLIENT_SECRET = defineSecret("DRIVE_CLIENT_SECRET");
const DRIVE_REFRESH_TOKEN = defineSecret("DRIVE_REFRESH_TOKEN");

// Plazo y reintentos (01/11/2026): la primera copia (101 fotos, unos 35 MB)
// tardó 5 min 22 s subiendo de una en una; con 4 a la vez, menos. Las de
// cada noche, segundos. Plazo de 540 s (Cloud Scheduler espera lo mismo:
// la CLI lo copia a su «attemptDeadline»). Un reintento solo si la función
// se corta o falla sin responder (los fallos de Drive se anotan y responde
// bien), 10 minutos después, cuando ya ha caducado el bloqueo
// (DURACION_BLOQUEO_MS); lo copiado hasta entonces está guardado.
export const copiaNocturnaDrive = onSchedule(
  {
    schedule: "every day 04:30", timeZone: "Europe/Madrid", region: REGION_PROGRAMADAS, timeoutSeconds: 540, memory: "512MiB",
    retryCount: 1, minBackoffSeconds: 600, maxBackoffSeconds: 600,
    secrets: enEmulador ? [] : [GMAIL_USUARIO, GMAIL_CONTRASENA, DRIVE_CLIENT_SECRET, DRIVE_REFRESH_TOKEN],
  },
  async () => {
    const clientId = process.env.DRIVE_CLIENT_ID ?? "";
    if (enEmulador || !clientId || DRIVE_REFRESH_TOKEN.value() === "pendiente" || DRIVE_CLIENT_SECRET.value() === "pendiente") {
      logger.info("Copia en Drive sin configurar: no se hace");
      return;
    }
    const r = await copiarADrive(getFirestore(), getStorage().bucket(),
      () => driveReal(clientId, DRIVE_CLIENT_SECRET.value(), DRIVE_REFRESH_TOKEN.value()), enviarCorreo);
    if (r.omitida) logger.warn("Copia en Drive: había otra en marcha; esta no se hace");
    else if (r.ok) logger.info("Copia en Drive hecha", r);
    else logger.error("La copia en Drive ha fallado", r);
  },
);
