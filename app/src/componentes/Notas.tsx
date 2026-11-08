import { useState } from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useArbol } from "../arbol/contexto";
import { usePermisos } from "../arbol/permisos";
import type { Nota } from "../arbol/tipos";
import { nombreTipo, t } from "../i18n";
import { FormularioNota } from "./diferidos";
import type { DuenioNota } from "./FormularioNota";
import { IconoEditar } from "./Iconos";

/** Texto de las notas, sin el formato (negrita, colores…) de Gramps, que
 * por ahora no se muestra. Se conservan los saltos de línea. Con `duenio`
 * (fase 3, paso 9): «Editar» en las que quien mira puede modificar y
 * «Añadir nota» si puede modificar la ficha. */
export function Notas({ notas, duenio }: { notas: Nota[]; duenio?: DuenioNota }) {
  const arbol = useArbol();
  const { puede } = usePermisos();
  const [abierta, setAbierta] = useState<Nota | "nueva" | null>(null);
  const puedeAnadir = !!duenio && puede(duenio.tipo, duenio.handle).ok;
  return (
    <Stack gap="sm">
      {notas.map((n) => (
        <Paper key={n.handle} withBorder p="md">
          <Group justify="space-between" align="flex-start" wrap="nowrap" mb={6}>
            <Badge variant="light" size="lg" fz="sm" tt="none">{nombreTipo(n.type)}</Badge>
            {duenio && puede("Note", n.handle).ok && (
              <Button size="xs" variant="default" leftSection={<IconoEditar />} onClick={() => setAbierta(n)} aria-label={t("nota.editar")}>
                {t("editar.boton")}
              </Button>
            )}
          </Group>
          <Text style={{ whiteSpace: "pre-wrap" }}>{n.text.string}</Text>
        </Paper>
      ))}
      {puedeAnadir && <Group><Button variant="default" onClick={() => setAbierta("nueva")}>{t("nota.anadir")}</Button></Group>}
      {duenio && (
        <FormularioNota
          abierto={!!abierta}
          nota={abierta === "nueva" ? null : abierta && (arbol.notas.get(abierta.handle) ?? null)}
          duenio={duenio}
          alCerrar={() => setAbierta(null)}
        />
      )}
    </Stack>
  );
}
