import { Button, Group, Paper, SimpleGrid, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { Link, useNavigate } from "react-router";
import { usePreferencias } from "../acceso/preferencias";
import { useArbol } from "../arbol/contexto";
import { textoMomento } from "../arbol/fechas";
import { EnlacePersona, rutaPersona } from "../componentes/Enlaces";
import { LineasVitales } from "../componentes/Ficha";
import { Foto } from "../componentes/Foto";
import { VolverAMi } from "../componentes/VolverAMi";
import { formatoNumero, t, type Clave } from "../i18n";
import { LETRA_TITULOS } from "../tema/tema";
import { rutaArbol } from "./Grafico";
import classes from "./Inicio.module.css";

/** Tarjeta de la persona de inicio, con «Ver ficha» y «Ver árbol»
 * (decisión del 24/10/2026, «Diseño visual»). */
function PersonaInicio() {
  const arbol = useArbol();
  const navegar = useNavigate();
  const { personaInicio: p } = usePreferencias();
  if (!p) return <Text c="dimmed">{t("inicio.sinPersonaInicio")}</Text>;
  const foto = arbol.fotoPrincipal(p);
  return (
    <Paper withBorder p="md">
      <Group align="flex-start" wrap="nowrap">
        {foto && <Foto media={foto} tam={110} alPulsar={() => navegar(rutaPersona(p.handle))} />}
        <Stack gap="xs" miw={0}>
          <Text size="xl" fw={600}><EnlacePersona persona={p} /></Text>
          <div>
            <LineasVitales persona={p} />
          </div>
          <Group gap="xs">
            <Button variant="default" component={Link} to={rutaPersona(p.handle)}>{t("inicio.verFicha")}</Button>
            <Button variant="default" component={Link} to={rutaArbol(p.handle)}>{t("inicio.verArbol")}</Button>
          </Group>
        </Stack>
      </Group>
    </Paper>
  );
}

export function Inicio() {
  const arbol = useArbol();
  // Cada cifra lleva a su lista.
  const cifras: [Clave, number, string][] = [
    ["menu.personas", arbol.personas.size, "/personas"],
    ["menu.familias", arbol.familias.size, "/familias"],
    ["menu.eventos", arbol.eventos.size, "/eventos"],
    ["menu.lugares", arbol.lugares.size, "/lugares"],
    ["menu.multimedia", arbol.multimedia.size, "/multimedia"],
  ];
  const actualizado = textoMomento(new Date(arbol.generada), true);

  return (
    <Stack gap="xl" maw={1100}>
      <Stack gap="xs">
        <Title order={1}>{t("inicio.bienvenida.titulo")}</Title>
        <Text size="lg">{t("inicio.bienvenida.texto")}</Text>
      </Stack>

      <Stack gap="sm">
        <Title order={2}>{t("inicio.personaInicio")}</Title>
        <PersonaInicio />
        <VolverAMi />
      </Stack>

      <Stack gap="sm">
        <Title order={2}>{t("inicio.cifras")}</Title>
        <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm">
          {cifras.map(([clave, n, ruta]) => (
            <UnstyledButton key={clave} component={Link} to={ruta} className={classes.cifra}>
              <Text ff={LETRA_TITULOS} fz={28} lh="34px" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>{formatoNumero(n)}</Text>
              <Text c="blue">{t(clave)}</Text>
            </UnstyledButton>
          ))}
        </SimpleGrid>
        <Text size="sm" c="dimmed">{t("inicio.actualizado", { fecha: actualizado })}</Text>
      </Stack>
    </Stack>
  );
}
