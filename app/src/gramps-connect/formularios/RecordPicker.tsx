// Buscar y elegir un registro existente, adaptado de Gramps Connect
// (app/src/components/RecordPicker.tsx; origen y cambios en ../ORIGEN.md).
//
// Procede de Gramps Connect (https://github.com/dsblank/gramps-connect,
// app/src/components/RecordPicker.tsx, commit 9487314), AGPL-3.0-or-later.
// MODIFICADO el 25/10/2026 para esta web (los cambios, abajo).
//
// Cambios: busca en el árbol en memoria (Arbol.buscar, sin esperas ni
// servidor) en vez de pedir páginas a gramps-web-api; el rótulo de cada
// resultado lo da quien lo usa; sin «crear nuevo» (lo pone quien lo usa,
// como el botón «Nuevo lugar» del formulario de evento); `excluir` quita
// resultados (en «situado en», el propio lugar y los que contiene); el ID,
// solo para el administrador; textos por t().

import { useMemo, useState } from "react";
import { Card, NavLink, ScrollArea, Stack, Text, TextInput } from "@mantine/core";
import { useArbol } from "../../arbol/contexto";
import type { TipoObjeto } from "../../arbol/arbol";
import type { Base } from "../../arbol/tipos";
import { t } from "../../i18n";

// Pocos resultados: si hay más, hay que afinar la búsqueda.
const LIMITE = 20;

interface RecordPickerProps {
  tipo: TipoObjeto;
  placeholder: string;
  rotulo: (obj: Base) => string;
  alElegir: (obj: Base) => void;
  conIds?: boolean;
  /** Handles que no se ofrecen. */
  excluir?: ReadonlySet<string>;
}

export function RecordPicker({ tipo, placeholder, rotulo, alElegir, conIds = false, excluir }: RecordPickerProps) {
  const arbol = useArbol();
  const [consulta, setConsulta] = useState("");
  const r = useMemo(() => {
    const extra = excluir?.size ?? 0;
    const b = arbol.buscar(consulta, [tipo], LIMITE + extra, conIds).get(tipo);
    if (!b || !extra) return b;
    const objetos = b.objetos.filter((o) => !excluir!.has(o.handle));
    return { objetos: objetos.slice(0, LIMITE), total: b.total - (b.objetos.length - objetos.length) };
  }, [arbol, consulta, tipo, conIds, excluir]);
  const resultados = r?.objetos ?? [];
  return (
    <Stack gap="xs">
      <TextInput placeholder={placeholder} aria-label={placeholder} value={consulta} onChange={(e) => setConsulta(e.currentTarget.value)} data-autofocus />
      {resultados.length > 0 && (
        <Card withBorder padding={0} style={{ overflow: "hidden" }}>
          <ScrollArea.Autosize mah={300} type="auto">
            <Stack gap={0}>
              {resultados.map((o) => (
                <NavLink
                  key={o.handle}
                  label={conIds ? `${rotulo(o)} [${o.gramps_id}]` : rotulo(o)}
                  onClick={() => alElegir(o)}
                  styles={{ label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Card>
      )}
      {consulta.trim() && !resultados.length && <Text size="sm" c="dimmed">{t("selector.nada")}</Text>}
      {r && r.total > resultados.length && <Text size="sm" c="dimmed">{t("selector.afinar", { n: resultados.length, total: r.total })}</Text>}
    </Stack>
  );
}
