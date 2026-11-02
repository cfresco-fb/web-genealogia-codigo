/**
 * Descargas de Storage sin el aviso MaxListenersExceededWarning. La
 * biblioteca de Storage (teeny-request) añade un oyente por trozo al
 * descargar un fichero grande, y Node avisa de una posible fuga que no lo
 * es (salía en la copia en Drive y en comprobar-rutas). Mientras dure
 * `fn`, sin límite de oyentes; con varias a la vez, el límite vuelve
 * cuando termina la última.
 */
import { EventEmitter } from "node:events";

let enCurso = 0;
let limite = EventEmitter.defaultMaxListeners;

export async function sinAvisoDeOyentes<T>(fn: () => Promise<T>): Promise<T> {
  if (enCurso++ === 0) {
    limite = EventEmitter.defaultMaxListeners;
    EventEmitter.defaultMaxListeners = 0;
  }
  try {
    return await fn();
  } finally {
    if (--enCurso === 0) EventEmitter.defaultMaxListeners = limite;
  }
}
