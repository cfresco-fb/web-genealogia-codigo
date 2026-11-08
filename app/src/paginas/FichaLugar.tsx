// Ficha de lugar (/lugar/:handle; Carlos, 02/11/2026, con los añadidos del
// mapa; docs/mapa.md, «Ficha de lugar»): sus datos, «Editar» (o «Proponer
// cambio»), el mapa pequeño con «Ver en el mapa», sus eventos por fecha
// (con una casilla para incluir los de los lugares que contiene) y los
// lugares que contiene. Como en las demás fichas, solo sale lo que hay.

import { lazy, Suspense, useMemo, useState } from "react";
import { Button, Checkbox, Group, Loader, Stack, Table, Text, Title } from "@mantine/core";
import { Link, useParams } from "react-router";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { porFecha, textoFecha } from "../arbol/fechas";
import { situarLugar } from "../arbol/mapa";
import { ContextoPropuesta, usePermisos } from "../arbol/permisos";
import type { Evento, Familia, Lugar, Persona } from "../arbol/tipos";
import { EnlaceFamilia, EnlaceLugar, EnlacePersona, rutaMapaLugar } from "../componentes/Enlaces";
import { DatosEnColumnas, NoExiste, Seccion, Tarjeta } from "../componentes/Ficha";
import { FormularioLugar, Historial } from "../componentes/diferidos";
import { IconoEditar } from "../componentes/Iconos";
import { Notas } from "../componentes/Notas";
import { nombreTipo, t } from "../i18n";

// El mapa pequeño, con Leaflet, aparte: solo se descarga si se muestra.
const MapaLugar = lazy(() => import("../componentes/MapaLugar").then((m) => ({ default: m.MapaLugar })));

/** Los lugares que contiene directamente (los que lo tienen entre sus
 * lugares superiores). */
function contenidos(lugares: Iterable<Lugar>, handle: string): Lugar[] {
  return [...lugares].filter((l) => l.handle !== handle && l.placeref_list.some((r) => r.ref === handle));
}

/** El lugar y todos los que contiene, a cualquier profundidad. */
function conContenidos(lugares: Map<string, Lugar>, handle: string): Set<string> {
  const hijos = new Map<string, string[]>();
  for (const l of lugares.values()) {
    for (const r of l.placeref_list) {
      const lista = hijos.get(r.ref);
      if (lista) lista.push(l.handle);
      else hijos.set(r.ref, [l.handle]);
    }
  }
  const dentro = new Set([handle]);
  const pendientes = [handle];
  while (pendientes.length) {
    for (const h of hijos.get(pendientes.pop()!) ?? []) {
      if (!dentro.has(h)) {
        dentro.add(h);
        pendientes.push(h);
      }
    }
  }
  return dentro;
}

export function FichaLugar() {
  const { handle = "" } = useParams();
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const { puede } = usePermisos();
  const [editando, setEditando] = useState(false);
  const [incluir, setIncluir] = useState(false);
  const l = arbol.lugares.get(handle);

  const hijos = useMemo(() => contenidos(arbol.lugares.values(), handle), [arbol, handle]);
  const eventos = useMemo(() => {
    const lugares = incluir ? conContenidos(arbol.lugares, handle) : new Set([handle]);
    return porFecha([...arbol.eventos.values()].filter((e) => lugares.has(e.place)), (e) => e.date);
  }, [arbol, handle, incluir]);
  const hayEventosDentro = useMemo(() => {
    if (!hijos.length) return false;
    const dentro = conContenidos(arbol.lugares, handle);
    return [...arbol.eventos.values()].some((e) => e.place !== handle && dentro.has(e.place));
  }, [arbol, handle, hijos]);
  if (!l) return <NoExiste />;

  const sitio = situarLugar(arbol.lugares, l.handle);
  const titulo = arbol.tituloLugar(l.handle);
  const puedeEditar = puede("Place", l.handle).ok;
  const superiores = l.placeref_list.map((r) => r.ref).filter((h) => arbol.lugares.has(h));
  const otrosNombres = l.alt_names.map((n) => n.value).filter(Boolean).join("; ");
  const coordenadas = sitio && !sitio.de
    ? `${l.lat}, ${l.long}`
    : sitio?.de ? t("lugar.coordenadasDe", { lugar: arbol.tituloLugar(sitio.de.handle) }) : null;
  const notas = arbol.notasDe(l);

  return (
    <Stack gap="xl" maw={1100}>
      <Stack gap="sm">
        <Title order={1}>{l.name.value || titulo}</Title>
        <DatosEnColumnas
          filas={[
            { rotulo: t("col.tipo"), valor: nombreTipo(l.place_type) },
            ...(superiores.length
              ? [{ rotulo: t("lugar.situadoEn"), valor: <>{superiores.map((h, i) => <span key={h}>{i > 0 && "; "}<EnlaceLugar handle={h} /></span>)}</> }]
              : []),
            ...(otrosNombres ? [{ rotulo: t("ficha.otrosNombres"), valor: otrosNombres }] : []),
            ...(coordenadas ? [{ rotulo: t("lugar.coordenadas"), valor: coordenadas }] : []),
            ...(admin ? [{ rotulo: t("col.id"), valor: l.gramps_id }] : []),
          ]}
        />
        <Group gap="xs">
          {/* Fuera de la rama, «Proponer cambio»: el mismo formulario, que se
              envía como solicitud (como en la lista de lugares). */}
          <Button variant="default" leftSection={<IconoEditar />} onClick={() => setEditando(true)}>
            {t(puedeEditar ? "editar.boton" : "solicitud.proponer")}
          </Button>
          {sitio && <Button variant="default" component={Link} to={rutaMapaLugar(l.handle)}>{t("ficha.verEnMapa")}</Button>}
        </Group>
      </Stack>

      {sitio && (
        <Tarjeta p={0} style={{ overflow: "hidden" }}>
          <Suspense fallback={<Group h={260} justify="center"><Loader /></Group>}>
            <MapaLugar lugar={l} coordenadas={sitio.coordenadas} aproximado={!!sitio.de} titulo={titulo} />
          </Suspense>
        </Tarjeta>
      )}

      {(eventos.length > 0 || hayEventosDentro) && (
        <Seccion titulo={t("ficha.eventos")}>
          {hayEventosDentro && (
            <Checkbox label={t("lugar.incluirContenidos")} checked={incluir} onChange={(e) => setIncluir(e.currentTarget.checked)} />
          )}
          {eventos.length > 0
            ? <TablaEventosLugar eventos={eventos} conLugar={incluir} />
            : <Text c="dimmed">{t("lugar.sinEventosPropios")}</Text>}
        </Seccion>
      )}

      {hijos.length > 0 && (
        <Seccion titulo={t("lugar.contiene")}>
          <Tarjeta>
            <Stack gap={4}>
              {hijos
                .map((h) => ({ h, nombre: h.name.value || arbol.tituloLugar(h.handle) }))
                .sort((a, b) => a.nombre.localeCompare(b.nombre))
                .map(({ h, nombre }) => (
                  <Text key={h.handle}><EnlaceLugar handle={h.handle} texto={nombre} /> <Text span c="dimmed" size="sm">({nombreTipo(h.place_type)})</Text></Text>
                ))}
            </Stack>
          </Tarjeta>
        </Seccion>
      )}

      {notas.length > 0 && (
        <Seccion titulo={t("ficha.notas")}>
          <Notas notas={notas} />
        </Seccion>
      )}
      <Historial tipo="Place" handle={l.handle} />

      <ContextoPropuesta.Provider value={editando && !puedeEditar}>
        <FormularioLugar abierto={editando} lugar={editando ? l : null} alCerrar={() => setEditando(false)} />
      </ContextoPropuesta.Provider>
    </Stack>
  );
}

/** Los eventos del lugar: tipo, fecha, (lugar, si se incluyen los que
 * contiene), quién y descripción (solo si alguno la tiene). */
function TablaEventosLugar({ eventos, conLugar }: { eventos: Evento[]; conLugar: boolean }) {
  const arbol = useArbol();
  const conDescripcion = eventos.some((e) => e.description);
  return (
    <Tarjeta p={0} style={{ overflow: "hidden" }}>
      <Table.ScrollContainer minWidth={560} mb={0}>
        <Table verticalSpacing={4} striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("col.tipo")}</Table.Th>
              <Table.Th>{t("col.fecha")}</Table.Th>
              {conLugar && <Table.Th>{t("col.lugar")}</Table.Th>}
              <Table.Th>{t("lugar.quien")}</Table.Th>
              {conDescripcion && <Table.Th>{t("col.descripcion")}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {eventos.map((e) => (
              <Table.Tr key={e.handle}>
                <Table.Td>{nombreTipo(e.type)}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{textoFecha(e.date)}</Table.Td>
                {conLugar && <Table.Td><EnlaceLugar handle={e.place} /></Table.Td>}
                <Table.Td>
                  {arbol.participantes(e).map(({ tipo, objeto }, i) => (
                    <span key={objeto.handle}>
                      {i > 0 && "; "}
                      {tipo === "Person" ? <EnlacePersona persona={objeto as Persona} /> : <EnlaceFamilia familia={objeto as Familia} />}
                    </span>
                  ))}
                </Table.Td>
                {conDescripcion && <Table.Td>{e.description}</Table.Td>}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Tarjeta>
  );
}
