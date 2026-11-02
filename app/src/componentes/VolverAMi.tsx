// «Volver a mí»: deja como persona de inicio la vinculada a la cuenta. Sale
// en Ajustes y en la página de inicio (decisión del 23/10/2026,
// «Correcciones tras probar las cajas nuevas»), solo si el usuario eligió
// otra y su cuenta está vinculada a alguien.

import { useState } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import { usePreferencias } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { t } from "../i18n";

export function VolverAMi() {
  const arbol = useArbol();
  const { invitacion } = useSesion();
  const { personaInicioPropia, guardarPersonaInicio } = usePreferencias();
  const [estado, setEstado] = useState<"" | "guardando" | "error">("");
  const vinculada = arbol.persona(invitacion.persona);

  async function volver() {
    setEstado("guardando");
    try {
      await guardarPersonaInicio(null);
      setEstado("");
    } catch (e) {
      console.error(e);
      setEstado("error");
    }
  }

  return (
    <>
      {personaInicioPropia && vinculada && (
        <Group>
          <Button size="sm" variant="default" onClick={volver} loading={estado === "guardando"}>{t("ajustes.volverAMi")}</Button>
        </Group>
      )}
      {estado === "error" && <Alert color="red"><Text size="sm">{t("simbolos.error")}</Text></Alert>}
    </>
  );
}
