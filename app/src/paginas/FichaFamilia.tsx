import { Button, Group, Menu, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { Link, useNavigate, useParams } from "react-router";
import { usePreferencias } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { porFecha } from "../arbol/fechas";
import type { DatoVital } from "../arbol/arbol";
import type { ChildRef, Familia, Persona } from "../arbol/tipos";
import { EnlacePersona, rutaEditarFamilia } from "../componentes/Enlaces";
import { AvisoSolicitudes, MarcaPendiente, usePendientes } from "../componentes/AvisoSolicitudes";
import { BorrarFicha } from "../componentes/BorrarFicha";
import { Historial } from "../componentes/diferidos";
import { IconoDesplegar, IconoEditar } from "../componentes/Iconos";
import { Dato, DatosPareja, Galeria, hayEventos, LineasVitales, NoExiste, Seccion, SinDatos, TablaEventos, Tarjeta } from "../componentes/Ficha";
import { Notas } from "../componentes/Notas";
import { usePermisos } from "../arbol/permisos";
import { nombreTipo, t, type Clave } from "../i18n";

const PARENTESCO_NACIMIENTO = 1; // ChildRefType.BIRTH

/** El padre o la madre; con `pedido`, quien quedaría según una solicitud
 * pendiente (en cursiva, con la marca). */
function Progenitor({ etiqueta, persona, pedido }: { etiqueta: Clave; persona: Persona | null; pedido?: { nombre: string; solicitud: string } }) {
  return (
    <Tarjeta>
      <Text fw={600} size="sm" c="dimmed">{t(etiqueta)}</Text>
      <Text size="lg" td={pedido ? "line-through" : undefined}><EnlacePersona persona={persona} /></Text>
      {pedido && (
        <Group gap="xs">
          <Text size="lg" fs="italic">{pedido.nombre || t("ficha.sinDatos")}</Text>
          <MarcaPendiente solicitud={pedido.solicitud} />
        </Group>
      )}
      <LineasVitales persona={persona} />
    </Tarjeta>
  );
}

/** Casilla de nacimiento o defunción de la tabla de hijos: el texto, con el
 * rótulo delante si es un evento sustituto («Entierro: 1950»); vacía si no
 * hay defunción. */
function CeldaVital({ dato, rotulo }: { dato: DatoVital | null; rotulo: string }) {
  if (!dato) return null;
  if (dato.falta && dato.rotulo === rotulo) return <SinDatos />;
  return <>{dato.rotulo === rotulo ? dato.texto : `${dato.rotulo}: ${dato.texto}`}</>;
}

export function FichaFamilia() {
  const { handle = "" } = useParams();
  const arbol = useArbol();
  // El ID de Gramps, solo para el administrador (decisión del 23/10/2026).
  const admin = useSesion().invitacion.rol === "administrador";
  const { puede } = usePermisos();
  const { vivas } = usePreferencias();
  const navegar = useNavigate();
  const pendientes = usePendientes("Family", handle);
  const f = arbol.familias.get(handle);
  if (!f) return <NoExiste />;
  // Lo pedido en una solicitud pendiente (AvisoSolicitudes.tsx): padre,
  // madre e hijos que entran o salen.
  const pedida = pendientes.propuesta?.objeto as unknown as Familia | undefined;
  const sol = pendientes.propuesta?.solicitud ?? "";
  const personaPedida = (h: string | null) => (h ? arbol.persona(h) ?? (pendientes.fichas.get(`Person_${h}`) as unknown as Persona | undefined) ?? null : null);
  const progenitorPedido = (campo: "father_handle" | "mother_handle") =>
    pedida && (pedida[campo] ?? null) !== (f[campo] ?? null) ? { nombre: pedida[campo] ? arbol.nombre(personaPedida(pedida[campo])) : "", solicitud: sol } : undefined;
  const quitados = new Set(pedida ? f.child_ref_list.filter((r) => !pedida.child_ref_list.some((x) => x.ref === r.ref)).map((r) => r.ref) : []);
  const hijosPedidos = (pedida?.child_ref_list ?? [])
    .filter((r) => !f.child_ref_list.some((x) => x.ref === r.ref))
    .map((ref) => ({ ref, persona: personaPedida(ref.ref) }))
    .filter((x): x is { ref: ChildRef; persona: Persona } => !!x.persona);
  const hijos = [...arbol.hijos(f).map((x) => ({ ...x, pedido: false })), ...hijosPedidos.map((x) => ({ ...x, pedido: true }))];
  const notas = arbol.notasDe(f);
  const eventos = porFecha(arbol.eventosFamilia(f), (e) => e.evento.date);

  return (
    <Stack gap="xl" maw={1100}>
      <Stack gap={4}>
        <Title order={1}>{arbol.nombreFamilia(f)}</Title>
        <DatosPareja familia={f}>
          {admin && <Dato rotulo={t("col.id")}>{f.gramps_id}</Dato>}
        </DatosPareja>
        <Group mt="xs">
          {/* Fuera de la rama, «Proponer cambio» (paso 12). */}
          <Button variant="default" leftSection={<IconoEditar />} component={Link} to={rutaEditarFamilia(f.handle)}>
            {t(puede("Family", f.handle).ok ? "editar.boton" : "solicitud.proponer")}
          </Button>
          {/* Acciones compuestas (paso 11): hijo nuevo o del árbol; padre o
              madre si falta (en el formulario se elige o se crea). */}
          {puede("Family", f.handle).ok && (
            <Menu position="bottom-start">
              <Menu.Target>
                <Button variant="default" rightSection={<IconoDesplegar />}>{t("ficha.anadir")}</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component={Link} to={rutaEditarFamilia(f.handle, "hijo")}>{t("ficha.hijoNuevoMenu")}</Menu.Item>
                <Menu.Item component={Link} to={rutaEditarFamilia(f.handle, "hijoExistente")}>{t("ficha.hijoExistenteMenu")}</Menu.Item>
                {!f.father_handle && <Menu.Item component={Link} to={rutaEditarFamilia(f.handle)}>{t("ficha.anadirPadre")}</Menu.Item>}
                {!f.mother_handle && <Menu.Item component={Link} to={rutaEditarFamilia(f.handle)}>{t("ficha.anadirMadre")}</Menu.Item>}
              </Menu.Dropdown>
            </Menu>
          )}
          <BorrarFicha tipo="Family" handle={f.handle} alBorrar={() => navegar("/")} />
        </Group>
      </Stack>
      <AvisoSolicitudes pendientes={pendientes} />

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Progenitor etiqueta="col.padre" persona={arbol.padre(f)} pedido={progenitorPedido("father_handle")} />
        <Progenitor etiqueta="col.madre" persona={arbol.madre(f)} pedido={progenitorPedido("mother_handle")} />
      </SimpleGrid>

      {/* Sin eventos o sin hijos, la sección no sale (decisión del
          29/10/2026, «Datos vacíos»). */}
      {hayEventos(eventos, pendientes.eventos) && (
        <Seccion titulo={t("ficha.eventos")}>
          <TablaEventos eventos={eventos} pendientes={pendientes.eventos} />
        </Seccion>
      )}

      {hijos.length > 0 && (
        <Seccion titulo={t("ficha.hijos")}>
          <Tarjeta p={0} style={{ overflow: "hidden" }}>
          <Table.ScrollContainer minWidth={560} mb={0}>
            <Table striped verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("col.nombre")}</Table.Th>
                  <Table.Th>{t("col.sexo")}</Table.Th>
                  <Table.Th>{t("col.nacimiento")}</Table.Th>
                  <Table.Th>{t("col.defuncion")}</Table.Th>
                  <Table.Th>{t("col.relacion")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {hijos.map(({ persona, ref, pedido }) => {
                  // Pedido: en cursiva; se quita: tachado (la marca, no).
                  const estilo = pedido ? { fontStyle: "italic" } : quitados.has(persona.handle) ? { textDecoration: "line-through" } : undefined;
                  return (
                  <Table.Tr key={persona.handle}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Text span inherit style={estilo}>
                          {arbol.personas.has(persona.handle) ? <EnlacePersona persona={persona} /> : arbol.nombre(persona)}
                        </Text>
                        {pedido && <MarcaPendiente solicitud={sol} />}
                        {quitados.has(persona.handle) && <MarcaPendiente solicitud={sol} texto={t("pendientes.seQuita")} />}
                      </Group>
                    </Table.Td>
                    <Table.Td style={estilo}>{t(`sexo.${persona.gender}` as Clave)}</Table.Td>
                    <Table.Td style={estilo}><CeldaVital dato={arbol.lineaNacimiento(persona)} rotulo={t("col.nacimiento")} /></Table.Td>
                    <Table.Td style={estilo}><CeldaVital dato={arbol.lineaDefuncion(persona, "largo", vivas)} rotulo={t("col.defuncion")} /></Table.Td>
                    <Table.Td style={estilo}>
                      {ref.frel.value === PARENTESCO_NACIMIENTO && ref.mrel.value === PARENTESCO_NACIMIENTO
                        ? nombreTipo(ref.frel)
                        : `${t("col.padre")}: ${nombreTipo(ref.frel)} · ${t("col.madre")}: ${nombreTipo(ref.mrel)}`}
                    </Table.Td>
                  </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          </Tarjeta>
        </Seccion>
      )}

      <Galeria refs={f.media_list} />

      {(notas.length > 0 || puede("Family", f.handle).ok) && (
        <Seccion titulo={t("ficha.notas")}>
          <Notas notas={notas} duenio={{ tipo: "Family", handle: f.handle }} />
        </Seccion>
      )}
      <Historial tipo="Family" handle={f.handle} />
    </Stack>
  );
}
