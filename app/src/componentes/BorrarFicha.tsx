// Borrar una ficha entera (paso 12; docs/edicion.md, «Borrar»): el
// administrador la borra; los demás lo piden con una solicitud (DA-10 b,
// decisión de Carlos del 27/10/2026). Antes se enseña qué se borra con ella
// (DA-21 a: los eventos y notas que no usa nadie más, y las familias que se
// quedan vacías) y de cuántas fichas se quita (comun/borrado.ts).

// Lo de dentro de la ventana (qué se borra, el motivo y el envío), con el
// código de los formularios, se carga aparte la primera vez que se abre
// (revisión del 08/11/2026, B1; BorrarFichaContenido.tsx).

import { lazy, useState } from "react";
import { Button, Modal } from "@mantine/core";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { t } from "../i18n";
import { laFicha } from "./cambiosSolicitud";
import { Diferido } from "./diferidos";

const Contenido = lazy(() => import("./BorrarFichaContenido").then((m) => ({ default: m.Contenido })));

export function BorrarFicha({ tipo, handle, alBorrar }: {
  tipo: "Person" | "Family" | "Place";
  handle: string;
  /** Tras borrarla (el administrador): adónde ir, por ejemplo. */
  alBorrar: () => void;
}) {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <Button variant="subtle" color={admin ? "red" : "gray"} onClick={() => setAbierta(true)}>
        {t(admin ? "borrar.boton" : "borrar.solicitar")}
      </Button>
      <Modal
        opened={abierta}
        onClose={() => setAbierta(false)}
        title={t(admin ? "borrar.titulo" : "borrar.tituloSolicitud", { ficha: laFicha(arbol, tipo, handle) })}
        zIndex={340}
      >
        {abierta && <Diferido><Contenido tipo={tipo} handle={handle} admin={admin} alCerrar={() => setAbierta(false)} alBorrar={alBorrar} /></Diferido>}
      </Modal>
    </>
  );
}
