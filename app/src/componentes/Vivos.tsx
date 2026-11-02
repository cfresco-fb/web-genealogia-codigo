// Sección de Ajustes del administrador para los parámetros de quién se
// considera vivo (app/src/arbol/vivos.ts): valen para todo el árbol.

import { useState } from "react";
import { Alert, Button, Group, NumberInput, Stack, Text } from "@mantine/core";
import { usePreferencias } from "../acceso/preferencias";
import {
  LIMITES_VIVOS, PARAMETROS_VIVOS_POR_DEFECTO, validarParametrosVivos, type ParametrosVivos,
} from "../arbol/vivos";
import { t, type Clave } from "../i18n";

const CAMPOS: (keyof ParametrosVivos)[] = ["edadMaxima", "aniosGeneracion", "difHermanos"];

export function SeccionVivos() {
  const { vivos, guardarVivos } = usePreferencias();
  const [valores, setValores] = useState<Record<keyof ParametrosVivos, number | string>>(vivos);
  const [estado, setEstado] = useState<"" | "guardando" | "guardado" | "error">("");
  const eleccion = validarParametrosVivos(valores);

  async function guardar() {
    if (!eleccion) return;
    setEstado("guardando");
    try {
      await guardarVivos(eleccion);
      setEstado("guardado");
    } catch (e) {
      console.error(e);
      setEstado("error");
    }
  }

  return (
    <Stack>
      <Text size="sm">{t("vivos.explicacion")}</Text>
      {CAMPOS.map((c) => (
        <NumberInput
          key={c}
          label={t(`vivos.${c}` as Clave)}
          description={t("vivos.limites", { min: LIMITES_VIVOS[c][0], max: LIMITES_VIVOS[c][1], defecto: PARAMETROS_VIVOS_POR_DEFECTO[c] })}
          value={valores[c]}
          min={LIMITES_VIVOS[c][0]}
          max={LIMITES_VIVOS[c][1]}
          allowDecimal={false}
          allowNegative={false}
          w={260}
          onChange={(v) => { setValores({ ...valores, [c]: v }); setEstado(""); }}
        />
      ))}
      {!eleccion && <Text size="sm" c="red">{t("vivos.invalido")}</Text>}
      <Group gap="sm">
        <Button size="sm" onClick={guardar} disabled={!eleccion} loading={estado === "guardando"}>{t("simbolos.guardar")}</Button>
        <Button size="sm" variant="default" onClick={() => { setValores(PARAMETROS_VIVOS_POR_DEFECTO); setEstado(""); }}>{t("vivos.porDefecto")}</Button>
        {estado === "guardado" && <Text size="sm" c="green">{t("simbolos.guardado")}</Text>}
      </Group>
      {estado === "error" && <Alert color="red"><Text size="sm">{t("simbolos.error")}</Text></Alert>}
    </Stack>
  );
}
