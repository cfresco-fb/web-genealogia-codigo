// «Mi familia cercana» (Carlos, 11/11/2026; docs/calendario.md): de quién
// son los aniversarios en la página «Calendario» y en el correo, si el
// usuario no elige «Todo el árbol». El cálculo, en comun/familiaCercana.ts,
// el mismo que el del correo; aquí, la explicación que sale en Ajustes y en
// la página.

import { useMemo } from "react";
import { List, Stack, Text } from "@mantine/core";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { t } from "../i18n";
import { familiasSeparadas } from "../../../comun/aniversarios.ts";
import { familiaCercana } from "../../../comun/familiaCercana.ts";

/** Las personas de la familia cercana del usuario; null si su invitación no
 * tiene persona del árbol (entonces, todo el árbol). */
export function useFamiliaCercana(): ReadonlySet<string> | null {
  const arbol = useArbol();
  const { invitacion } = useSesion();
  return useMemo(
    () => familiaCercana(arbol.indiceRelaciones(), invitacion.persona, familiasSeparadas(arbol)),
    [arbol, invitacion.persona],
  );
}

const PUNTOS = ["aniversariosDe.familia.1", "aniversariosDe.familia.2", "aniversariosDe.familia.3", "aniversariosDe.familia.4"] as const;

/** Quién entra, punto por punto, con la nota de los hermanos y, si se pasa,
 * cuántas personas son ahora. */
export function QuienEntra({ cuantas }: { cuantas?: number }) {
  return (
    <Stack gap={4}>
      <List size="sm" spacing={2}>
        {PUNTOS.map((k) => <List.Item key={k}>{t(k)}</List.Item>)}
      </List>
      <Text size="sm" c="dimmed">
        {t("aniversariosDe.familia.nota")}
        {cuantas !== undefined && <> {cuantas === 1 ? t("aniversariosDe.cuantasUna") : t("aniversariosDe.cuantas", { n: cuantas })}</>}
      </Text>
    </Stack>
  );
}
