// Qué puede modificar quien mira, con el mismo código que la función del
// servidor (comun/rama.ts, comun/permisos.ts): para mostrar «Editar» solo
// donde el guardado se va a aceptar y, al guardar, saber si el cambio es
// una solicitud (paso 12). La comprobación de verdad la hace el servidor en
// cada guardado.
//
// Modo propuesta (paso 12): un formulario abierto con «Proponer cambio»
// (una ficha fuera de la rama) lo deja editar todo; al guardar, lo que no
// se puede guardar va como solicitud.

import { createContext, useContext, useMemo } from "react";
import { calcularRama } from "../../../comun/rama.ts";
import { noPermitidos, puedeModificar, type NoPermitido, type Permiso } from "../../../comun/permisos.ts";
import type { Tipo } from "../../../comun/gramps.ts";
import type { ObjetoPeticion } from "../../../comun/peticion.ts";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "./contexto";

/** Dentro de un formulario en modo propuesta. */
export const ContextoPropuesta = createContext(false);
export const useModoPropuesta = () => useContext(ContextoPropuesta);

const SI: Permiso = { ok: true };

export function usePermisos(): {
  puede: (tipo: Tipo, handle: string) => Permiso;
  /** Lo que no se puede guardar directamente de una petición. */
  prohibido: (objetos: ObjetoPeticion[]) => NoPermitido[];
} {
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const propuesta = useModoPropuesta();
  return useMemo(() => {
    const indice = arbol.indiceRelaciones();
    const persona = invitacion.persona || null;
    const rama = calcularRama(indice, persona);
    const creadoPor = arbol.instantanea.web?.creadoPor ?? {};
    // La instantánea guarda de cada objeto creado en la web la persona de
    // quien lo creó, no su correo.
    const creador = (_tipo: Tipo, handle: string) => (persona && creadoPor[handle] === persona ? invitacion.correo : null);
    const ctx = { usuario: { correo: invitacion.correo, rol: invitacion.rol, persona }, indice, rama, creador };
    return {
      puede: (tipo: Tipo, handle: string) => (propuesta ? SI : puedeModificar(ctx, tipo, handle)),
      prohibido: (objetos: ObjetoPeticion[]) => noPermitidos(
        ctx,
        objetos.map((o) => ({ ...o, antes: o.operacion === "crear" ? null : arbol.obtener(o.tipo, o.handle) })),
        arbol.tiposConocidos(),
      ),
    };
  }, [arbol, invitacion, propuesta]);
}
