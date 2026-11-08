import { useState } from "react";
import { Anchor, Button, Group, Menu, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { Link, useNavigate, useParams } from "react-router";
import { usePreferencias } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import type { Familia, Multimedia, Persona } from "../arbol/tipos";
import { EnlaceFamilia, EnlacePersona, rutaEditarFamilia, rutaEditarPersona, rutaFamilia, rutaMapaPersona, rutaNuevaFamilia } from "../componentes/Enlaces";
import { DatosEnColumnas, DatosPareja, Galeria, hayEventos, NoExiste, Seccion, TablaEventos, Tarjeta } from "../componentes/Ficha";
import { AvisoSolicitudes, DatoPendiente, usePendientes } from "../componentes/AvisoSolicitudes";
import { BorrarFicha } from "../componentes/BorrarFicha";
import { Historial } from "../componentes/diferidos";
import { Foto, VisorFoto } from "../componentes/Foto";
import { IconoDesplegar, IconoEditar } from "../componentes/Iconos";
import { Notas } from "../componentes/Notas";
import { usePermisos } from "../arbol/permisos";
import { rutaArbol } from "./Grafico";
import type { TipoGrafico } from "../arbol/grafico";
import { nombreTipo, t, type Clave } from "../i18n";

const PARENTESCO_NACIMIENTO = 1; // ChildRefType.BIRTH
const SEXO_DESCONOCIDO = 2; // Person.UNKNOWN

/** «Usar como persona de inicio» (decisión del 23/10/2026): se guarda en la
 * cuenta del usuario; en Ajustes, «Volver a mí». Si ya lo es, no sale (lo
 * dice la píldora junto al nombre), salvo el aviso de que se acaba de
 * guardar. */
function UsarComoInicio({ persona }: { persona: Persona }) {
  const { personaInicio, guardarPersonaInicio } = usePreferencias();
  const [estado, setEstado] = useState<"" | "guardando" | "guardada" | "error">("");
  if (personaInicio?.handle === persona.handle) {
    return estado === "guardada" ? <Text size="sm" role="status">{t("ficha.inicioGuardada")}</Text> : null;
  }
  async function usar() {
    setEstado("guardando");
    try {
      await guardarPersonaInicio(persona.handle);
      setEstado("guardada");
    } catch (e) {
      console.error(e);
      setEstado("error");
    }
  }
  return (
    <Group gap="xs">
      <Button variant="subtle" onClick={usar} loading={estado === "guardando"}>{t("ficha.usarInicio")}</Button>
      {estado === "error" && <Text size="sm" c="red">{t("ficha.inicioError")}</Text>}
    </Group>
  );
}

/** «Ver árbol ▾»: ascendientes, descendientes o ambos. */
function VerArbol({ persona }: { persona: Persona }) {
  return (
    <Menu position="bottom-start">
      <Menu.Target>
        <Button variant="default" rightSection={<IconoDesplegar />}>{t("ficha.verArbol")}</Button>
      </Menu.Target>
      <Menu.Dropdown>
        {(["ascendientes", "descendientes", "ambos"] satisfies TipoGrafico[]).map((tipo) => (
          <Menu.Item key={tipo} component={Link} to={rutaArbol(persona.handle, tipo)}>{t(`grafico.tipo.${tipo}`)}</Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Acciones compuestas (paso 11, decisión del 25/10/2026): padres, cónyuge
 * e hijo (con cada pareja que ya tiene o con otra), por el formulario de
 * familia. Solo si se puede editar a la persona. */
function Anadir({ persona }: { persona: Persona }) {
  const arbol = useArbol();
  const { puede } = usePermisos();
  const como = persona.gender === 0 ? "madre" : "padre";
  const familias = arbol.familiasPorBoda(persona).filter((f) => puede("Family", f.handle).ok);
  return (
    <Menu position="bottom-start">
      <Menu.Target>
        <Button variant="default" rightSection={<IconoDesplegar />}>{t("ficha.anadir")}</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component={Link} to={rutaNuevaFamilia("hijo", persona.handle)}>{t("ficha.anadirPadres")}</Menu.Item>
        <Menu.Item component={Link} to={rutaNuevaFamilia(como, persona.handle)}>{t("ficha.anadirConyuge")}</Menu.Item>
        {familias.length === 0 ? (
          <Menu.Item component={Link} to={rutaNuevaFamilia(como, persona.handle, "hijo")}>{t("ficha.anadirHijo")}</Menu.Item>
        ) : (
          <>
            <Menu.Label>{t("ficha.anadirHijo")}</Menu.Label>
            {familias.map((f) => {
              const c = arbol.conyuge(f, persona);
              return (
                <Menu.Item key={f.handle} component={Link} to={rutaEditarFamilia(f.handle, "hijo")}>
                  {c ? t("ficha.hijoCon", { nombre: arbol.nombre(c) }) : t("ficha.hijoConDesconocido")}
                </Menu.Item>
              );
            })}
            <Menu.Item component={Link} to={rutaNuevaFamilia(como, persona.handle, "hijo")}>{t("ficha.hijoConOtra")}</Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

export function FichaPersona() {
  const { handle = "" } = useParams();
  const arbol = useArbol();
  const [abierta, setAbierta] = useState<Multimedia | null>(null);
  // El ID de Gramps, solo para el administrador (decisión del 23/10/2026).
  const admin = useSesion().invitacion.rol === "administrador";
  const { personaInicio, vivas } = usePreferencias();
  const { puede } = usePermisos();
  const navegar = useNavigate();
  const pendientes = usePendientes("Person", handle);
  const p = arbol.personas.get(handle);
  if (!p) return <NoExiste />;
  // Lo pedido en una solicitud pendiente (AvisoSolicitudes.tsx): cada dato,
  // si cambia, con lo nuevo en cursiva.
  const pedida = pendientes.propuesta?.objeto as unknown as Persona | undefined;
  const sol = pendientes.propuesta?.solicitud;
  const otrosNombres = (x: Persona) => x.alternate_names
    .map((n) => `${[n.first_name, arbol.apellidos(n)].filter(Boolean).join(" ")} (${nombreTipo(n.type)})`)
    .join("; ");
  const pedido = (de: (x: Persona) => string) => {
    if (!pedida) return {};
    const luego = de(pedida);
    return luego === de(p) ? {} : { propuesto: luego, solicitud: sol };
  };

  const foto = arbol.fotoPrincipal(p);
  const familiasPadres = arbol.familiasPadres(p);
  const familiasPropias = arbol.familiasPorBoda(p);
  const notas = arbol.notasDe(p);
  const nacimiento = arbol.lineaNacimiento(p);
  const defuncion = arbol.lineaDefuncion(p, "largo", vivas);
  const eventos = arbol.eventosPersona(p);

  return (
    <Stack gap="xl" maw={1100}>
      {/* Cabecera (decisión del 24/10/2026, «Diseño visual»): la foto a la
          izquierda; el nombre, con la píldora si es la persona de inicio;
          los datos en dos columnas y las acciones. */}
      <Group align="flex-start" gap="lg" wrap="nowrap">
        {foto && <Foto media={foto} tam={150} alPulsar={() => setAbierta(foto)} />}
        <Stack gap="sm" miw={0}>
          <Group gap="sm" align="center">
            <Title order={1}>{arbol.nombre(p)}</Title>
            {personaInicio?.handle === p.handle && <span className="tema-pildora" data-inicio="">{t("ficha.personaInicio")}</span>}
          </Group>
          <DatosEnColumnas
            filas={[
              ...(pedido((x) => arbol.nombre(x)).propuesto !== undefined
                ? [{ rotulo: t("cambio.rotulo.nombre"), valor: <DatoPendiente actual={arbol.nombre(p)} {...pedido((x) => arbol.nombre(x))} /> }] : []),
              { rotulo: nacimiento.rotulo, valor: nacimiento.texto, falta: nacimiento.falta },
              ...(defuncion ? [{ rotulo: defuncion.rotulo, valor: defuncion.texto, falta: defuncion.falta }] : []),
              {
                rotulo: t("col.sexo"),
                valor: <DatoPendiente actual={t(`ficha.sexo.${p.gender}` as Clave)} {...pedido((x) => t(`ficha.sexo.${x.gender}` as Clave))} />,
                falta: p.gender === SEXO_DESCONOCIDO && !pedido((x) => String(x.gender)).solicitud,
              },
              // Otros nombres, solo si los tiene o se han pedido (decisión del
              // 29/10/2026, «Datos vacíos»; nacimiento y sexo salen siempre).
              ...(p.alternate_names.length || pedido(otrosNombres).solicitud
                ? [{ rotulo: t("ficha.otrosNombres"), valor: <DatoPendiente actual={otrosNombres(p)} {...pedido(otrosNombres)} /> }] : []),
              ...(admin ? [{ rotulo: t("col.id"), valor: p.gramps_id }] : []),
            ]}
          />
          <Group gap="xs">
            {/* Fuera de la rama, «Proponer cambio»: el mismo formulario, que se
                envía como solicitud (paso 12). */}
            <Button variant="default" leftSection={<IconoEditar />} component={Link} to={rutaEditarPersona(p.handle)}>
              {t(puede("Person", p.handle).ok ? "editar.boton" : "solicitud.proponer")}
            </Button>
            {puede("Person", p.handle).ok && <Anadir persona={p} />}
            <VerArbol persona={p} />
            {/* Sus lugares y su recorrido (añadidos del mapa, 02/11/2026). */}
            <Button variant="default" component={Link} to={rutaMapaPersona(p.handle)}>{t("ficha.verEnMapa")}</Button>
            <UsarComoInicio key={p.handle} persona={p} />
            <BorrarFicha tipo="Person" handle={p.handle} alBorrar={() => navegar("/")} />
          </Group>
        </Stack>
      </Group>
      <AvisoSolicitudes pendientes={pendientes} />
      <VisorFoto media={abierta} alCerrar={() => setAbierta(null)} />

      {hayEventos(eventos, pendientes.eventos) && (
        <Seccion titulo={t("ficha.eventos")}>
          <TablaEventos
            eventos={eventos}
            conyugeDe={(e) => arbol.nombre(arbol.conyuge(e.familia!, p))}
            pendientes={pendientes.eventos}
          />
        </Seccion>
      )}

      <Seccion titulo={t("ficha.padres")}>
        {familiasPadres.length === 0 && <Tarjeta><Text c="dimmed">{t("ficha.sinPadres")}</Text></Tarjeta>}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {familiasPadres.map((f) => {
            const ref = f.child_ref_list.find((r) => r.ref === p.handle);
            const especial = ref && (ref.frel.value !== PARENTESCO_NACIMIENTO || ref.mrel.value !== PARENTESCO_NACIMIENTO);
            return (
              <Tarjeta key={f.handle}>
                <Text><Text span fw={600}>{t("col.padre")}: </Text><EnlacePersona persona={arbol.padre(f)} anios /></Text>
                <Text><Text span fw={600}>{t("col.madre")}: </Text><EnlacePersona persona={arbol.madre(f)} anios /></Text>
                {especial && (
                  <Text size="sm" c="dimmed">
                    {t("col.padre")}: {nombreTipo(ref.frel)} · {t("col.madre")}: {nombreTipo(ref.mrel)}
                  </Text>
                )}
                <Anchor component={Link} to={rutaFamilia(f.handle)} size="sm">{t("ficha.verFamilia")}</Anchor>
              </Tarjeta>
            );
          })}
        </SimpleGrid>
      </Seccion>

      {familiasPropias.length > 0 && (
        <Seccion titulo={t("ficha.conyugesHijos")}>
          <Stack gap="sm">
            {familiasPropias.map((f) => <FamiliaPropia key={f.handle} p={p} familia={f} />)}
          </Stack>
        </Seccion>
      )}

      <Galeria refs={p.media_list} />

      {(notas.length > 0 || puede("Person", p.handle).ok) && (
        <Seccion titulo={t("ficha.notas")}>
          <Notas notas={notas} duenio={{ tipo: "Person", handle: p.handle }} />
        </Seccion>
      )}
      <Historial tipo="Person" handle={p.handle} />
    </Stack>
  );
}

function FamiliaPropia({ p, familia }: { p: Persona; familia: Familia }) {
  const arbol = useArbol();
  const conyuge = arbol.conyuge(familia, p);
  const hijos = arbol.hijos(familia);
  return (
    <Tarjeta>
      <Group justify="space-between" wrap="wrap">
        <Text>
          {conyuge ? <EnlacePersona persona={conyuge} anios /> : <Text span c="dimmed">{t("ficha.conyugeDesconocido")}</Text>}
        </Text>
        <EnlaceFamilia familia={familia} texto={t("ficha.verFamilia")} />
      </Group>
      <DatosPareja familia={familia} size="sm" />
      {hijos.length > 0 && (
        <Stack gap={2} mt={6} pl="md">
          {hijos.map((h) => <Text key={h.persona.handle} size="sm"><EnlacePersona persona={h.persona} anios /></Text>)}
        </Stack>
      )}
    </Tarjeta>
  );
}
