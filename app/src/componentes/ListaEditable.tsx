// Listas internas de los formularios de persona y familia (fase 3, paso 10):
// atributos, direcciones, direcciones web, asociaciones, otros nombres…
// Cada elemento con su resumen, «Editar», «Quitar» y subir o bajar; debajo,
// «Añadir». Se edita en una ventana con los campos que da quien la usa, y
// nada cambia hasta «Hecho». Escrita nueva, con la idea de las listas
// internas de Gramps Connect (EmbeddedListFields.tsx).
//
// Los campos que se cambian en la propia fila (papel, filiación) van en
// columnas con el rótulo una sola vez, arriba, y su explicación en una «i»;
// columnas y botones, alineados en todas las filas (rejilla con subgrid).
// En pantallas estrechas, cada fila con sus rótulos (decisión del
// 27/10/2026).

import { Fragment, useState, type ReactNode } from "react";
import { ActionIcon, Button, Group, Modal, Paper, Popover, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { t } from "../i18n";
import { IconoInfo } from "./Iconos";

/** Un campo que se cambia en la propia fila. */
export interface Columna<T> {
  rotulo: string;
  /** Qué es, en la «i» junto al rótulo. */
  ayuda?: string;
  /** Ancho en píxeles. */
  ancho: number;
  /** El campo, sin rótulo a la vista (el de la columna). */
  celda: (x: T, i: number) => ReactNode;
}

/** Una «i» que, al pincharla, explica qué es `rotulo`. */
export function Ayuda({ rotulo, ayuda }: { rotulo: string; ayuda: string }) {
  const [abierta, setAbierta] = useState(false);
  // Escape cierra solo la explicación, no la ventana en la que está (la
  // ventana de Mantine no lo atiende si el foco lleva esta marca).
  return (
    <Popover opened={abierta} onChange={setAbierta} width={300} position="top" withArrow shadow="md" zIndex={400}>
      <Popover.Target>
        <ActionIcon variant="light" radius="xl" size="sm" aria-label={t("lista.queEs", { rotulo })} onClick={() => setAbierta((x) => !x)}
          data-mantine-stop-propagation={abierta ? "true" : undefined}><IconoInfo /></ActionIcon>
      </Popover.Target>
      <Popover.Dropdown><Text size="sm" style={{ whiteSpace: "pre-line" }}>{ayuda}</Text></Popover.Dropdown>
    </Popover>
  );
}

/** Rótulo de una columna con su «i». */
function Rotulo({ rotulo, ayuda }: { rotulo: string; ayuda?: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="sm" fw={500}>{rotulo}</Text>
      {ayuda && <Ayuda rotulo={rotulo} ayuda={ayuda} />}
    </Group>
  );
}

interface Props<T> {
  elementos: T[];
  alCambiar: (lista: T[]) => void;
  /** Lo que se ve de cada elemento en la lista. */
  resumen: (x: T) => ReactNode;
  /** Un elemento nuevo, vacío. Sin él, no se puede añadir. */
  nuevo?: () => T;
  /** Los campos de un elemento en la ventana. */
  campos?: (valor: T, alCambiar: (x: T) => void) => ReactNode;
  /** Si el elemento está listo para «Hecho». */
  valido?: (x: T) => boolean;
  /** Antes de guardarlo (quitar espacios…). */
  limpiar?: (x: T) => T;
  /** Editar con otra ventana (la del nombre): en lugar de `campos`. */
  alEditar?: (x: T | null, alTerminar: (y: T) => void) => void;
  titulo: string;
  /** Vacío: sin «Añadir». */
  rotuloAnadir: string;
  vacia: string;
  /** Qué elementos no se pueden quitar. */
  fijo?: (x: T) => boolean;
  /** Qué elementos se pueden editar (por defecto, todos si hay `campos` o
   * `alEditar`). */
  editable?: (x: T) => boolean;
  ordenar?: boolean;
  /** Orden en que se muestran: las posiciones de `elementos` (sin cambiar el
   * de la lista, que es el que se guarda). Sin subir ni bajar. */
  orden?: (elementos: T[]) => number[];
  /** Campos que se cambian en la propia fila. */
  columnas?: Columna<T>[];
  /** Antes de quitar un elemento (para preguntar): `quitar` lo quita. */
  alQuitar?: (x: T, quitar: () => void) => void;
}

export function ListaEditable<T>(props: Props<T>) {
  const { elementos, alCambiar, resumen, nuevo, campos, alEditar, rotuloAnadir, vacia, fijo, editable, columnas = [], alQuitar } = props;
  const ordenar = !props.orden && (props.ordenar ?? false);
  const vista = props.orden ? props.orden(elementos) : elementos.map((_, i) => i);
  const estrecha = useMediaQuery("(max-width: 48em)") ?? false;
  // El elemento en la ventana y su posición (-1, uno nuevo).
  const [editando, setEditando] = useState<{ valor: T; i: number } | null>(null);
  const terminar = (i: number) => (y: T) =>
    alCambiar(i < 0 ? [...elementos, y] : elementos.map((x, j) => (j === i ? y : x)));
  const abrir = (x: T | null, i: number) => {
    if (alEditar) alEditar(x, terminar(i));
    else setEditando({ valor: x ?? nuevo!(), i });
  };
  const mover = (i: number, d: number) => {
    const copia = [...elementos];
    [copia[i], copia[i + d]] = [copia[i + d], copia[i]];
    alCambiar(copia);
  };
  // Los botones de cada fila, en huecos fijos: si una fila no tiene «Editar»,
  // su hueco queda vacío y los demás siguen alineados.
  const puedeEditar = (x: T) => !!(campos || alEditar) && (editable?.(x) ?? true);
  const conEditar = elementos.some(puedeEditar);
  const conQuitar = elementos.some((x) => !fijo?.(x));
  const nBotones = (ordenar ? 2 : 0) + (conEditar ? 1 : 0) + (conQuitar ? 1 : 0);
  const botones = (x: T, i: number) => (
    <>
      {ordenar && <ActionIcon variant="default" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={t("lista.subir")}>↑</ActionIcon>}
      {ordenar && <ActionIcon variant="default" disabled={i === elementos.length - 1} onClick={() => mover(i, 1)} aria-label={t("lista.bajar")}>↓</ActionIcon>}
      {conEditar && (puedeEditar(x) ? <Button size="xs" variant="default" onClick={() => abrir(x, i)}>{t("editar.boton")}</Button> : <span />)}
      {conQuitar && (!fijo?.(x) ? (
        <Button size="xs" variant="default" onClick={() => {
          const quitar = () => alCambiar(elementos.filter((_, j) => j !== i));
          if (alQuitar) alQuitar(x, quitar);
          else quitar();
        }}>{t("lista.quitar")}</Button>
      ) : <span />)}
    </>
  );
  const fila = { gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "subgrid", alignItems: "center" } as const;

  return (
    <Stack gap="xs">
      {!elementos.length && <Text size="sm" c="dimmed">{vacia}</Text>}
      {elementos.length > 0 && (estrecha ? (
        // Estrecha: cada fila con sus rótulos; campos y botones, debajo del
        // resumen si no caben.
        vista.map((i) => {
          const x = elementos[i];
          return (
            <Paper key={i} withBorder p="xs">
              <Group justify="space-between" wrap="wrap" gap="xs">
                <div style={{ minWidth: 200, flex: 1 }}>{resumen(x)}</div>
                <Group gap={4} wrap="wrap" align="flex-end">
                  {columnas.map((c, k) => (
                    <div key={k} style={{ width: c.ancho }}>
                      <Rotulo rotulo={c.rotulo} ayuda={c.ayuda} />
                      {c.celda(x, i)}
                    </div>
                  ))}
                  {botones(x, i)}
                </Group>
              </Group>
            </Paper>
          );
        })
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: ["minmax(0, 1fr)", ...columnas.map((c) => `${c.ancho}px`), ...Array<string>(nBotones).fill("auto")].join(" "),
          columnGap: 6,
          rowGap: "var(--mantine-spacing-xs)",
        }}>
          {columnas.length > 0 && (
            <div style={{ ...fila, alignItems: "end", padding: "0 var(--mantine-spacing-xs)", border: "1px solid transparent" }}>
              <div />
              {columnas.map((c, k) => <Rotulo key={k} rotulo={c.rotulo} ayuda={c.ayuda} />)}
            </div>
          )}
          {vista.map((i) => {
            const x = elementos[i];
            return (
              <Paper key={i} withBorder p="xs" style={fila}>
                <div style={{ paddingRight: "var(--mantine-spacing-xs)" }}>{resumen(x)}</div>
                {columnas.map((c, k) => <Fragment key={k}>{c.celda(x, i)}</Fragment>)}
                {botones(x, i)}
              </Paper>
            );
          })}
        </div>
      ))}
      {(nuevo || alEditar) && rotuloAnadir && <Group><Button size="xs" variant="default" onClick={() => abrir(null, -1)}>{rotuloAnadir}</Button></Group>}
      {campos && (
        <VentanaElemento
          titulo={props.titulo}
          editando={editando}
          campos={campos}
          valido={props.valido}
          limpiar={props.limpiar}
          alTerminar={(y) => editando && terminar(editando.i)(y)}
          alCerrar={() => setEditando(null)}
        />
      )}
    </Stack>
  );
}

function VentanaElemento<T>({ titulo, editando, campos, valido, limpiar, alTerminar, alCerrar }: {
  titulo: string;
  editando: { valor: T; i: number } | null;
  campos: (valor: T, alCambiar: (x: T) => void) => ReactNode;
  valido?: (x: T) => boolean;
  limpiar?: (x: T) => T;
  alTerminar: (x: T) => void;
  alCerrar: () => void;
}) {
  const movil = useMediaQuery("(max-width: 36em)") ?? false;
  return (
    <Modal opened={!!editando} onClose={alCerrar} title={titulo} size="lg" fullScreen={movil} zIndex={300}>
      {editando && <ContenidoElemento inicial={editando.valor} campos={campos} valido={valido} limpiar={limpiar} alTerminar={alTerminar} alCerrar={alCerrar} />}
    </Modal>
  );
}

function ContenidoElemento<T>({ inicial, campos, valido, limpiar, alTerminar, alCerrar }: {
  inicial: T;
  campos: (valor: T, alCambiar: (x: T) => void) => ReactNode;
  valido?: (x: T) => boolean;
  limpiar?: (x: T) => T;
  alTerminar: (x: T) => void;
  alCerrar: () => void;
}) {
  const [valor, setValor] = useState(inicial);
  const final = limpiar ? limpiar(valor) : valor;
  return (
    <Stack>
      {campos(valor, setValor)}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar}>{t("formulario.cancelar")}</Button>
        <Button disabled={valido ? !valido(final) : false} onClick={() => { alTerminar(final); alCerrar(); }}>{t("formulario.hecho")}</Button>
      </Group>
    </Stack>
  );
}
