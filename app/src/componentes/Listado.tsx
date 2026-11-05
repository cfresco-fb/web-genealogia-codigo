// Lista de objetos del árbol: filtro rápido de texto, filtros propios de
// cada lista, columnas a elegir y ordenación. Pinta las filas con la tabla
// virtualizada de Gramps Connect.

import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Button, Checkbox, Group, Popover, Stack, Text, TextInput, Title } from "@mantine/core";
import { DataTable, type ColumnaTabla, type OrdenTabla } from "../gramps-connect/tabla/DataTable";
import { normalizar } from "../arbol/arbol";
import { anchoPorTexto } from "./anchoColumna";
import { comparador, t } from "../i18n";

export interface ColumnaLista<T> extends Omit<ColumnaTabla<T>, "ordenable"> {
  /** Valor para ordenar. null va siempre al final, en ambos sentidos. */
  valor?: (fila: T) => string | number | null;
  /** Visible al principio (el usuario puede cambiarlo). Por defecto, sí. */
  visible?: boolean;
  /** Siempre visible, al final y fuera de la elección de columnas (los
   * botones de cada fila, como «Editar»). */
  siempre?: boolean;
  /** Columna de nombres de persona: el ancho inicial sale del texto más largo
   * (de `valor`), con `ancho` como mínimo. El que arrastre el usuario manda. */
  anchoPorTexto?: boolean;
}

interface ListadoProps<T> {
  /** Identifica la lista para recordar columnas y anchos. */
  clave: string;
  titulo: string;
  filas: T[];
  columnas: ColumnaLista<T>[];
  claveFila: (fila: T) => string;
  /** Texto en el que busca el filtro rápido. */
  texto: (fila: T) => string;
  ordenInicial: OrdenTabla;
  alPulsar?: (fila: T) => void;
  /** Filtros propios de la lista (controles y condición). */
  controles?: ReactNode;
  filtro?: (fila: T) => boolean;
  hayFiltros?: boolean;
  alLimpiarFiltros?: () => void;
  altoFila?: number;
  /** Lo que va debajo (p. ej., un formulario que se abre desde la lista). */
  pie?: ReactNode;
}

function leerColumnas(clave: string): string[] | null {
  try {
    const v = localStorage.getItem(`columnas:${clave}`);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function guardarColumnas(clave: string, columnas: string[]) {
  try {
    localStorage.setItem(`columnas:${clave}`, JSON.stringify(columnas));
  } catch {
    // sin almacenamiento local: no se recuerdan
  }
}

export function Listado<T>(props: ListadoProps<T>) {
  const { clave, titulo, filas, columnas, claveFila, texto, ordenInicial, alPulsar, controles, filtro } = props;
  const [consulta, setConsulta] = useState("");
  const consultaDiferida = useDeferredValue(consulta);
  const [orden, setOrden] = useState<OrdenTabla>(ordenInicial);
  const [visibles, setVisibles] = useState<string[]>(
    () => leerColumnas(clave) ?? columnas.filter((c) => c.visible !== false).map((c) => c.clave),
  );

  // Una vez, al montar la lista, con todas las filas: no cambia al filtrar.
  const [anchosPorTexto] = useState(() => new Map(columnas.filter((c) => c.anchoPorTexto).map((c) => [
    c.clave, anchoPorTexto(filas.map((f) => String(c.valor?.(f) ?? "")), c.ancho ?? 0),
  ])));

  // Solo depende de las filas: «texto» suele ser una función nueva en cada
  // pintado y no cambia de comportamiento.
  const textos = useMemo(() => new Map(filas.map((f) => [f, normalizar(texto(f))])), [filas]);

  const filtradas = useMemo(() => {
    const palabras = normalizar(consultaDiferida).split(/\s+/).filter(Boolean);
    return filas.filter((f) => (!filtro || filtro(f)) && palabras.every((p) => textos.get(f)!.includes(p)));
  }, [filas, filtro, consultaDiferida, textos]);

  const ordenadas = useMemo(() => {
    const col = columnas.find((c) => c.clave === orden.columna);
    if (!col?.valor) return filtradas;
    const signo = orden.direccion === "asc" ? 1 : -1;
    const conValor = filtradas.map((f) => [col.valor!(f), f] as const);
    conValor.sort(([a], [b]) => {
      if (a === null || a === "") return b === null || b === "" ? 0 : 1;
      if (b === null || b === "") return -1;
      const r = typeof a === "number" && typeof b === "number" ? a - b : comparador.compare(String(a), String(b));
      return signo * r;
    });
    return conValor.map(([, f]) => f);
  }, [filtradas, columnas, orden]);

  const columnasVisibles = columnas
    .filter((c) => visibles.includes(c.clave) || c.siempre)
    .map((c): ColumnaTabla<T> => ({ ...c, ancho: anchosPorTexto.get(c.clave) ?? c.ancho, ordenable: !!c.valor }));

  function cambiarColumnas(nuevas: string[]) {
    // Conservar el orden de definición y al menos una columna.
    const ordenadas = columnas.map((c) => c.clave).filter((c) => nuevas.includes(c));
    if (!ordenadas.length) return;
    setVisibles(ordenadas);
    guardarColumnas(clave, ordenadas);
  }

  function ordenar(columna: string) {
    setOrden((o) => ({ columna, direccion: o.columna === columna && o.direccion === "asc" ? "desc" : "asc" }));
  }

  return (
    <Stack gap="sm" h="100%">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Title order={1}>{titulo}</Title>
        <Text c="dimmed" size="sm">{t("lista.contador", { n: ordenadas.length, total: filas.length })}</Text>
      </Group>
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          placeholder={t("lista.filtrar")}
          value={consulta}
          onChange={(e) => setConsulta(e.currentTarget.value)}
          w={260}
          aria-label={t("lista.filtrar")}
        />
        {controles}
        <Popover position="bottom-start" shadow="md" withinPortal>
          <Popover.Target>
            <Button variant="default">{t("lista.columnas")}</Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Checkbox.Group value={visibles} onChange={cambiarColumnas}>
              <Stack gap="xs">
                {columnas.filter((c) => !c.siempre).map((c) => <Checkbox key={c.clave} value={c.clave} label={c.etiqueta} />)}
              </Stack>
            </Checkbox.Group>
          </Popover.Dropdown>
        </Popover>
        {props.hayFiltros && props.alLimpiarFiltros && (
          <Button variant="subtle" onClick={props.alLimpiarFiltros}>{t("lista.limpiarFiltros")}</Button>
        )}
      </Group>
      {ordenadas.length === 0 ? (
        <Text c="dimmed">{t("lista.vacia")}</Text>
      ) : (
        <DataTable
          claveVista={clave}
          columnas={columnasVisibles}
          filas={ordenadas}
          claveFila={claveFila}
          orden={orden}
          alOrdenar={ordenar}
          alPulsar={alPulsar}
          altoFila={props.altoFila}
        />
      )}
      {props.pie}
    </Stack>
  );
}
