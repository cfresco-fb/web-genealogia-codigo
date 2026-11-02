// Borrar una ficha entera (paso 12; docs/edicion.md, «Borrar»): el
// administrador la borra; los demás lo piden con una solicitud (DA-10 b,
// decisión de Carlos del 27/10/2026). Antes se enseña qué se borra con ella
// (DA-21 a: los eventos y notas que no usa nadie más, y las familias que se
// quedan vacías) y de cuántas fichas se quita (comun/borrado.ts).

import { useMemo, useState } from "react";
import { Alert, Anchor, Button, Group, List, Modal, Stack, Text } from "@mantine/core";
import { Link } from "react-router";
import { peticionBorrado } from "../../../comun/borrado.ts";
import { esMapa, type Tipo } from "../../../comun/gramps.ts";
import { useSesion } from "../acceso/sesion";
import { useArbol, useEdicion } from "../arbol/contexto";
import { t } from "../i18n";
import { enviarSolicitud } from "../solicitudes";
import { laFicha, mayuscula } from "./cambiosSolicitud";
import { CampoMotivo, textoError } from "./Formulario";

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
        {abierta && <Contenido tipo={tipo} handle={handle} admin={admin} alCerrar={() => setAbierta(false)} alBorrar={alBorrar} />}
      </Modal>
    </>
  );
}

function Contenido({ tipo, handle, admin, alCerrar, alBorrar }: {
  tipo: Tipo;
  handle: string;
  admin: boolean;
  alCerrar: () => void;
  alBorrar: () => void;
}) {
  const arbol = useArbol();
  const { aplicarCambio } = useEdicion();
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solicitud, setSolicitud] = useState<string | null>(null);
  // Lo que se borra, con el árbol de cuando se abre.
  const { objetos, arrastrados } = useMemo(
    () => peticionBorrado(arbol.indiceRelaciones(), (x, h) => arbol.obtener(x, h), tipo, handle),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const cambian = objetos.filter((o) => o.operacion === "modificar");
  const ficha = arbol.obtener(tipo, handle);
  const conFotos = !!ficha && Array.isArray(ficha.media_list) && ficha.media_list.some(esMapa);

  async function borrar() {
    setError(null);
    setEnviando(true);
    const peticion = { accion: "borrar", motivo: motivo.trim() || null, objetos };
    try {
      if (admin) {
        await aplicarCambio(peticion);
        alCerrar();
        alBorrar();
      } else {
        setSolicitud(await enviarSolicitud("borrado", peticion));
      }
    } catch (e) {
      setError(textoError(e, admin));
    } finally {
      setEnviando(false);
    }
  }

  if (solicitud) {
    return (
      <Stack>
        <Alert variant="light" color="green" title={t("solicitud.enviada")}>
          {t("solicitud.enviadaAyuda")}{" "}
          <Anchor component={Link} to={`/solicitudes/${solicitud}`}>{t("solicitud.verSolicitud")}</Anchor>
        </Alert>
        <Group justify="flex-end"><Button onClick={alCerrar}>{t("formulario.cerrar")}</Button></Group>
      </Stack>
    );
  }

  return (
    <Stack>
      <Text>{t("borrar.seBorra", { ficha: laFicha(arbol, tipo, handle) })}</Text>
      {arrastrados.length > 0 && (
        <Stack gap={4}>
          <Text size="sm">{t("borrar.arrastra")}</Text>
          <List size="sm">
            {arrastrados.map((a) => <List.Item key={`${a.tipo}_${a.handle}`}>{mayuscula(laFicha(arbol, a.tipo, a.handle))}</List.Item>)}
          </List>
        </Stack>
      )}
      {cambian.length > 0 && (
        <Stack gap={4}>
          <Text size="sm">{t("borrar.cambian")}</Text>
          <List size="sm">
            {cambian.map((o) => <List.Item key={`${o.tipo}_${o.handle}`}>{mayuscula(laFicha(arbol, o.tipo, o.handle))}</List.Item>)}
          </List>
        </Stack>
      )}
      {conFotos && <Text size="sm">{t("borrar.fotos")}</Text>}
      {!admin && <Text size="sm" c="dimmed">{t("borrar.ayudaSolicitud")}</Text>}
      <CampoMotivo valor={motivo} alCambiar={setMotivo} obligatorio={!admin} />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar} disabled={enviando}>{t("formulario.cancelar")}</Button>
        <Button color={admin ? "red" : undefined} onClick={borrar} loading={enviando} disabled={!admin && !motivo.trim()}>
          {t(admin ? "borrar.boton" : "solicitud.enviar")}
        </Button>
      </Group>
    </Stack>
  );
}
