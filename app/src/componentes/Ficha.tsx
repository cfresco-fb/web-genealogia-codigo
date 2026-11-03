// Piezas comunes de las fichas de persona y de familia.

import { Fragment, useState, type ReactNode } from "react";
import { Box, Button, Group, Paper, Stack, Table, Text, Title, VisuallyHidden, type PaperProps } from "@mantine/core";
import { usePreferencias } from "../acceso/preferencias";
import { useArbol } from "../arbol/contexto";
import type { EventoDePersona } from "../arbol/arbol";
import { textoFecha } from "../arbol/fechas";
import { usePermisos } from "../arbol/permisos";
import type { Evento, Familia, MediaRef, Multimedia, Persona } from "../arbol/tipos";
import { nombreTipo, t } from "../i18n";
import { type EventosPendientes, MarcaPendiente } from "./AvisoSolicitudes";
import { EnlaceLugar } from "./Enlaces";
import { Foto, VisorFoto } from "./Foto";
import { FormularioEvento } from "./FormularioEvento";
import { IconoEditar } from "./Iconos";

/** El fondo de las filas alternas de una tabla rayada de Mantine. */
const FONDO_RAYADO = "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))";

const ROL_PRINCIPAL = 1;
const ROL_FAMILIA = 8;

/** «Nacimiento: …» siempre y «Defunción: …» (o entierro, incineración) si
 * hay evento o no se considera viva; con la persona desconocida, solo
 * «Nacimiento: sin datos». */
export function LineasVitales({ persona, size }: { persona: Persona | null; size?: string }) {
  const arbol = useArbol();
  const { vivas } = usePreferencias();
  const nacimiento = persona ? arbol.lineaNacimiento(persona) : arbol.datoVital(null, t("col.nacimiento"));
  const defuncion = persona && arbol.lineaDefuncion(persona, "largo", vivas);
  return (
    <>
      <Dato rotulo={nacimiento.rotulo} falta={nacimiento.falta} size={size}>{nacimiento.texto}</Dato>
      {defuncion && <Dato rotulo={defuncion.rotulo} falta={defuncion.falta} size={size}>{defuncion.texto}</Dato>}
    </>
  );
}

/** Datos en dos columnas, rótulo y valor (cabecera de la ficha de persona;
 * decisión del 24/10/2026, «Diseño visual»); el valor, atenuado si falta. */
export function DatosEnColumnas({ filas }: { filas: { rotulo: string; valor: ReactNode; falta?: boolean }[] }) {
  return (
    <Box component="dl" m={0} style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: 12, rowGap: 4 }}>
      {filas.map((f) => (
        <Fragment key={f.rotulo}>
          <Text component="dt" fw={600}>{f.rotulo}:</Text>
          <Text component="dd" m={0} c={f.falta ? "dimmed" : undefined}>{f.valor}</Text>
        </Fragment>
      ))}
    </Box>
  );
}

/** Tarjeta de las secciones de las fichas: todas con el mismo tratamiento. */
export function Tarjeta({ children, ...props }: PaperProps & { children: ReactNode }) {
  return <Paper withBorder p="md" {...props}>{children}</Paper>;
}

/** «sin datos», atenuado: para las casillas vacías. */
export function SinDatos() {
  return <Text span c="dimmed" inherit>{t("ficha.sinDatos")}</Text>;
}

/** «Rótulo: valor», con el valor atenuado si falta el dato. */
export function Dato({ rotulo, children, falta = false, size }: { rotulo: string; children: ReactNode; falta?: boolean; size?: string }) {
  return (
    <Text size={size}>
      <Text span fw={600} inherit>{rotulo}: </Text>
      <Text span c={falta ? "dimmed" : undefined} inherit>{children}</Text>
    </Text>
  );
}

const TIPO_EVENTO_MATRIMONIO = { _class: "EventType", value: 1, string: "" }; // EventType.MARRIAGE

/** Tipo de relación de una pareja y sus datos (decisión del 24/10/2026,
 * «Tipos de relación de pareja»), con los rótulos de los eventos: la boda
 * siempre en un matrimonio («Matrimonio: sin datos»), y en los demás tipos
 * si la hay; el inicio de la relación, el divorcio y la separación, si
 * constan. `children`, detrás (el ID, para el administrador). */
export function DatosPareja({ familia, size, children }: { familia: Familia; size?: string; children?: ReactNode }) {
  const arbol = useArbol();
  const pareja = arbol.pareja(familia);
  const dato = (ev: Evento | null, rotulo?: string) => {
    const d = arbol.datoVital(ev && { evento: ev, sustituto: false }, rotulo ?? (ev ? nombreTipo(ev.type) : ""));
    return <Dato key={rotulo ?? ev!.handle} rotulo={d.rotulo} falta={d.falta} size={size}>{d.texto}</Dato>;
  };
  return (
    <Group gap="lg">
      <Dato rotulo={t("ficha.tipoRelacion")} size={size}>{nombreTipo(familia.type)}</Dato>
      {children}
      {(pareja.clase === "matrimonio" || pareja.boda) && dato(pareja.boda, nombreTipo(TIPO_EVENTO_MATRIMONIO))}
      {[pareja.divorcio, pareja.separacion].map((ev) => ev && dato(ev))}
    </Group>
  );
}

/** Si hay eventos que mostrar en TablaEventos, contando los pedidos en
 * solicitudes pendientes. */
export const hayEventos = (eventos: EventoDePersona[], pendientes?: EventosPendientes) =>
  eventos.length > 0 || (pendientes?.nuevos.length ?? 0) > 0;

export function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Stack gap="sm" component="section">
      <Title order={2}>{titulo}</Title>
      {children}
    </Stack>
  );
}

/** Eventos de una persona o familia; con «Editar» en los que quien mira
 * puede modificar (fase 3; «Proponer cambio» en los demás llegará con las
 * solicitudes). Las notas de cada evento, en una fila debajo (decisión de
 * Carlos del 26/10/2026), con el fondo de la fila del evento. Las casillas
 * vacías, en blanco, y la columna «Descripción», solo si algún evento la
 * tiene; sin eventos, nada (decisión del 29/10/2026, «Datos vacíos»: la
 * sección tampoco sale, hayEventos). */
export function TablaEventos({ eventos: delArbol, conyugeDe, pendientes }: {
  eventos: EventoDePersona[];
  conyugeDe?: (e: EventoDePersona) => string;
  /** Lo pedido en solicitudes pendientes (AvisoSolicitudes.tsx): los
   * eventos nuevos al final, en cursiva; los cambiados, con lo nuevo en
   * cursiva y lo de ahora tachado; los que se quitan, tachados. */
  pendientes?: EventosPendientes;
}) {
  const arbol = useArbol();
  const { puede } = usePermisos();
  const [editando, setEditando] = useState<Evento | null>(null);
  const nuevos = new Map((pendientes?.nuevos ?? []).map((n) => [n.evento.handle, n.solicitud]));
  const eventos: EventoDePersona[] = [...delArbol, ...(pendientes?.nuevos ?? []).map((n) => ({ evento: n.evento, rol: n.rol, familia: null }))];
  if (!eventos.length) return null;
  const conDescripcion = eventos.some((e) => e.evento.description || pendientes?.cambiados.get(e.evento.handle)?.evento.description);
  return (
    <Tarjeta p={0} style={{ overflow: "hidden" }}>
    <Table.ScrollContainer minWidth={560} mb={0}>
      <Table verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("col.tipo")}</Table.Th>
            <Table.Th>{t("col.fecha")}</Table.Th>
            <Table.Th>{t("col.lugar")}</Table.Th>
            {conDescripcion && <Table.Th>{t("col.descripcion")}</Table.Th>}
            <Table.Th><VisuallyHidden>{t("editar.boton")}</VisuallyHidden></Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {eventos.map((e, i) => {
            const tipo = nombreTipo(e.evento.type);
            const notas = arbol.notasDe(e.evento);
            const fondo = i % 2 === 0 ? FONDO_RAYADO : undefined;
            const conyuge = e.familia && conyugeDe?.(e);
            const rol = e.rol.value !== ROL_PRINCIPAL && e.rol.value !== ROL_FAMILIA ? ` (${nombreTipo(e.rol)})` : "";
            const h = e.evento.handle;
            const nuevo = nuevos.get(h);
            const quitado = pendientes?.quitados.get(h);
            const cambiado = pendientes?.cambiados.get(h);
            const pendiente = nuevo ?? quitado ?? cambiado?.solicitud;
            // Una casilla: si se ha pedido cambiarla, lo nuevo en cursiva y
            // lo de ahora tachado.
            const casilla = (de: (x: Evento) => string) => {
              const ahora = de(e.evento);
              const luego = cambiado ? de(cambiado.evento) : ahora;
              if (luego === ahora) return ahora;
              return (
                <>
                  <Text span fs="italic" inherit>{luego || t("ficha.sinDatos")}</Text>{" "}
                  {ahora && <Text span td="line-through" c="dimmed" inherit>{ahora}</Text>}
                </>
              );
            };
            const estilo = nuevo ? { fontStyle: "italic" } : quitado ? { textDecoration: "line-through" } : undefined;
            return (
              <Fragment key={`${h}-${e.familia?.handle ?? ""}`}>
              <Table.Tr style={{ background: fondo, borderBottom: notas.length ? 0 : undefined }}>
                <Table.Td style={estilo}>{casilla((x) => {
                  const tp = nombreTipo(x.type);
                  return conyuge ? t("ficha.eventoDeFamilia", { tipo: tp, nombre: conyuge }) : tp;
                })}{rol}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap", ...estilo }}>{casilla((x) => textoFecha(x.date))}</Table.Td>
                {/* El lugar, enlazado a su ficha (añadidos del mapa, 02/11/2026), salvo si se ha pedido cambiarlo. */}
                <Table.Td style={estilo}>
                  {cambiado && cambiado.evento.place !== e.evento.place
                    ? casilla((x) => arbol.tituloLugar(x.place))
                    : <EnlaceLugar handle={e.evento.place} />}
                </Table.Td>
                {conDescripcion && <Table.Td style={estilo}>{casilla((x) => x.description)}</Table.Td>}
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Group gap="xs" wrap="nowrap" justify="flex-end">
                  {pendiente && <MarcaPendiente solicitud={pendiente} texto={quitado ? t("pendientes.seQuita") : undefined} />}
                  {!nuevo && puede("Event", h).ok && (
                    <Button size="xs" variant="default" leftSection={<IconoEditar />} onClick={() => setEditando(e.evento)}
                      aria-label={t("editar.eventoDe", { tipo: tipo.toLowerCase() })}>
                      {t("editar.boton")}
                    </Button>
                  )}
                  </Group>
                </Table.Td>
              </Table.Tr>
              {notas.length > 0 && (
                <Table.Tr style={{ background: fondo }}>
                  <Table.Td colSpan={conDescripcion ? 5 : 4} pt={0}>
                    <Stack gap={2}>
                      {notas.map((n) => (
                        <Text key={n.handle} size="sm" style={{ whiteSpace: "pre-wrap" }}>
                          <Text span fw={600} inherit>{t("ficha.notaEvento")} </Text>{n.text.string}
                        </Text>
                      ))}
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
    <FormularioEvento evento={editando && (arbol.eventos.get(editando.handle) ?? null)} alCerrar={() => setEditando(null)} />
    </Tarjeta>
  );
}

/** Todas las imágenes enlazadas, en miniatura; al pulsar, el visor. */
export function Galeria({ refs }: { refs: MediaRef[] }) {
  const arbol = useArbol();
  const [abierta, setAbierta] = useState<Multimedia | null>(null);
  const imagenes = refs
    .map((r) => arbol.multimedia.get(r.ref))
    .filter((m): m is Multimedia => arbol.esImagen(m));
  // Una misma foto puede estar enlazada varias veces (con recortes distintos).
  const unicas = [...new Map(imagenes.map((m) => [m.handle, m])).values()];
  if (!unicas.length) return null;
  return (
    <Seccion titulo={t("ficha.fotos")}>
      <Tarjeta>
        <Group gap="sm">
          {unicas.map((m) => <Foto key={m.handle} media={m} tam={140} alPulsar={() => setAbierta(m)} />)}
        </Group>
      </Tarjeta>
      <VisorFoto media={abierta} alCerrar={() => setAbierta(null)} />
    </Seccion>
  );
}

export function NoExiste() {
  return <Text c="dimmed">{t("ficha.noExiste")}</Text>;
}
