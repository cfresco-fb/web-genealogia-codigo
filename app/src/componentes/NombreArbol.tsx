// Sección de Ajustes del administrador para el nombre del árbol: el título
// de la web (cabecera y pestaña) y de los PDF. Vale para todo el árbol.

import { useState } from "react";
import { Alert, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { LARGO_NOMBRE_ARBOL, usePreferencias, validarNombreArbol } from "../acceso/preferencias";
import { t } from "../i18n";

export function SeccionNombreArbol() {
  const { nombreArbol, guardarNombreArbol } = usePreferencias();
  const [valor, setValor] = useState(nombreArbol);
  const [estado, setEstado] = useState<"" | "guardando" | "guardado" | "error">("");
  const nombre = validarNombreArbol(valor);

  async function guardar() {
    if (!nombre) return;
    setEstado("guardando");
    try {
      await guardarNombreArbol(nombre);
      setEstado("guardado");
    } catch (e) {
      console.error(e);
      setEstado("error");
    }
  }

  return (
    <Stack>
      <Text size="sm">{t("nombreArbol.explicacion")}</Text>
      <TextInput
        label={t("nombreArbol.campo")}
        description={t("nombreArbol.limites", { max: LARGO_NOMBRE_ARBOL })}
        value={valor}
        maxLength={LARGO_NOMBRE_ARBOL}
        maw={480}
        onChange={(e) => { setValor(e.currentTarget.value); setEstado(""); }}
        error={nombre ? undefined : t("nombreArbol.invalido")}
      />
      <Group gap="sm">
        <Button size="sm" onClick={guardar} disabled={!nombre} loading={estado === "guardando"}>{t("simbolos.guardar")}</Button>
        {estado === "guardado" && <Text size="sm" c="green">{t("simbolos.guardado")}</Text>}
      </Group>
      {estado === "error" && <Alert color="red"><Text size="sm">{t("simbolos.error")}</Text></Alert>}
    </Stack>
  );
}
