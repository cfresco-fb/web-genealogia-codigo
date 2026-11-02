/**
 * Altas solo con invitación (Carlos, 01/11/2026; docs/acceso.md, «Altas solo
 * con invitación»). La función de bloqueo `antesDeCrearCuenta`
 * (functions/src/index.ts) rechaza el alta con este mensaje, y la web lo
 * reconoce en el error de Firebase Auth para mostrar su aviso.
 */
export const SIN_INVITACION = "SIN_INVITACION";

/** Firebase Auth entrega el rechazo de una función de bloqueo como un error
 * interno («auth/internal-error»), con el mensaje de la función dentro del
 * texto (BLOCKING_FUNCTION_ERROR_RESPONSE …). */
export const esAltaSinInvitacion = (e: unknown): boolean => String((e as { message?: unknown } | null)?.message ?? "").includes(SIN_INVITACION);

/** Si el correo tiene invitación activa (el mismo criterio que las reglas:
 * documento `invitaciones/{correo en minúsculas}` con `estado == "activa"`). */
export const invitacionActiva = (datos: { estado?: unknown } | undefined | null): boolean => datos?.estado === "activa";
