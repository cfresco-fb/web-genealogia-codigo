// «Disposición del árbol» en los diálogos del PDF y del libro (decisión del
// 23/10/2026, «Opciones de los PDF»): con la explicación en cada opción. En
// el del árbol, con su «i» (`ayuda`; 12/11/2026); en el del libro, todavía no.

import type { ReactNode } from "react";
import { Radio, Stack } from "@mantine/core";
import { DISPOSICIONES, type Disposicion } from "../arbol/grafico";
import { t, type Clave } from "../i18n";

export function OpcionDisposicion({ value, onChange, ayuda }: { value: Disposicion; onChange: (d: Disposicion) => void; ayuda?: (texto: string) => ReactNode }) {
  return (
    <Radio.Group label={ayuda ? ayuda(t("pdf.disposicion")) : t("pdf.disposicion")} value={value} onChange={(v) => onChange(v as Disposicion)}>
      <Stack gap={6} mt={6}>
        {DISPOSICIONES.map((d) => <Radio key={d} value={d} label={t(`pdf.disposicion.${d}` as Clave)} />)}
      </Stack>
    </Radio.Group>
  );
}
