// Créditos y licencias (`/creditos`; docs/creditos.md): la única página
// de la web que nombra los proyectos de los que viene (Gramps, Gramps
// Connect, las letras y las bibliotecas). Lleva el enlace al código fuente
// que pide la licencia AGPL-3.0 y los textos de las licencias de las
// bibliotecas (los avisos de autoría que piden MIT, BSD, ISC, Apache…).
// La lista de bibliotecas la genera `npm run creditos` desde lo que de
// verdad va en la web compilada (scripts/creditos.ts).
//
// Se carga aparte (React.lazy en App.tsx): los textos de las licencias
// solo se descargan al abrirla.

import type { ReactNode } from "react";
import { Accordion, Alert, Anchor, Code, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useSesion } from "../acceso/sesion";
import { URL_CODIGO_FUENTE, URL_VERSION, VERSION_CODIGO } from "../configuracion";
import datos from "../creditos/bibliotecas.json";
import type { Bibliotecas, Paquete } from "../creditos/tipos";
import { Seccion, Tarjeta } from "../componentes/Ficha";
import { idioma, t, type Clave } from "../i18n";
import oflNotoSansPdf from "../gramps-connect/chartExport/fuentes/OFL.txt?raw";
import oflSimbolos from "../fuentes/OFL.txt?raw";
import oflHebreaPdf from "../fuentes/OFL-hebrew.txt?raw";

const BIBLIOTECAS = datos as Bibliotecas;
const URL_AGPL = "https://www.gnu.org/licenses/agpl-3.0.html";
const ES_LETRA = (p: Paquete) => p.nombre.startsWith("@fontsource/");

interface Proyecto {
  nombre: string;
  enlace: string;
  licencia: string;
  texto: Clave;
}

const PROYECTOS: Proyecto[] = [
  { nombre: "Gramps", enlace: "https://gramps-project.org", licencia: "GPL-2.0-or-later", texto: "creditos.gramps" },
  { nombre: "Gramps Connect", enlace: "https://github.com/dsblank/gramps-connect", licencia: "AGPL-3.0-or-later", texto: "creditos.grampsConnect" },
];

/** Un texto de licencia: el de un paquete de @fontsource (por su nombre,
 * de bibliotecas.json) o el de un fichero de letra recortada de la web. */
type Licencia = { paquete: string } | { rotulo: string; texto: string };

interface Letra {
  nombre: string;
  enlace: string;
  uso: Clave;
  licencias: Licencia[];
}

const LETRAS: Letra[] = [
  {
    nombre: "Literata", enlace: "https://github.com/googlefonts/literata", uso: "creditos.letra.literata",
    licencias: [{ paquete: "@fontsource/literata" }],
  },
  {
    nombre: "Noto Sans", enlace: "https://github.com/notofonts/latin-greek-cyrillic", uso: "creditos.letra.notoSans",
    licencias: [{ paquete: "@fontsource/noto-sans" }, { rotulo: "NotoSans-Regular-subset.ttf, NotoSans-Bold-subset.ttf", texto: oflNotoSansPdf }],
  },
  {
    nombre: "Noto Sans Hebrew, Noto Serif Hebrew", enlace: "https://github.com/notofonts/hebrew", uso: "creditos.letra.hebrea",
    licencias: [
      { paquete: "@fontsource/noto-sans-hebrew" },
      { paquete: "@fontsource/noto-serif-hebrew" },
      { rotulo: "NotoSansHebrew-Regular-subset.ttf, NotoSansHebrew-Bold-subset.ttf", texto: oflHebreaPdf },
    ],
  },
  {
    nombre: "Noto Sans Symbols, Noto Sans Symbols 2", enlace: "https://github.com/notofonts/symbols", uso: "creditos.letra.simbolos",
    licencias: [{ rotulo: "NotoSansSymbols-subset.ttf, NotoSansSymbols2-subset.ttf", texto: oflSimbolos }],
  },
];

function EnlaceExterno({ href, children }: { href: string; children: ReactNode }) {
  return <Anchor href={href} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{children}</Anchor>;
}

/** El texto de una licencia tal cual, con sus saltos de línea, sin
 * desbordar a lo ancho en el móvil. */
function TextoLicencia({ texto }: { texto: string }) {
  return (
    <Code block style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14 }}>
      {texto}
    </Code>
  );
}

/** Desplegables con textos de licencias: rótulo y texto. */
function Textos({ textos }: { textos: { rotulo: string; texto: string; nota?: string }[] }) {
  return (
    <Accordion variant="contained" chevronPosition="left">
      {textos.map((x, i) => (
        <Accordion.Item key={i} value={String(i)}>
          <Accordion.Control>
            <Text style={{ overflowWrap: "anywhere" }}>{x.rotulo}</Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {x.nota && <Text size="sm" c="dimmed">{x.nota}</Text>}
              <TextoLicencia texto={x.texto} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

function textoDe(licencia: Licencia): { rotulo: string; texto: string } {
  if ("texto" in licencia) return licencia;
  const p = BIBLIOTECAS.paquetes.find((x) => x.nombre === licencia.paquete);
  if (!p) return { rotulo: licencia.paquete, texto: "" };
  return { rotulo: `${p.nombre} ${p.version}`, texto: BIBLIOTECAS.textos[p.texto].texto };
}

function ListaPaquetes({ titulo, paquetes }: { titulo: string; paquetes: Paquete[] }) {
  return (
    <Stack gap="xs">
      <Title order={3}>{titulo}</Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="xs" component="ul" m={0} p={0} style={{ listStyle: "none" }}>
        {paquetes.map((p) => (
          <li key={`${p.nombre}@${p.version}`}>
            <EnlaceExterno href={p.enlace}>{p.nombre}</EnlaceExterno>
            <Text size="sm" c="dimmed">{t("creditos.versionLicencia", { version: p.version, licencia: p.licencia })}</Text>
          </li>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export function Creditos() {
  const { invitacion } = useSesion();
  const admin = invitacion.rol === "administrador";
  const bibliotecas = BIBLIOTECAS.paquetes.filter((p) => !ES_LETRA(p));
  // Los textos de las bibliotecas (los de las letras van con ellas), cada
  // uno con los paquetes a los que corresponde.
  const textos = BIBLIOTECAS.textos
    .map((x, i) => ({ ...x, paquetes: bibliotecas.filter((p) => p.texto === i) }))
    .filter((x) => x.paquetes.length)
    .map((x) => ({
      rotulo: x.paquetes.map((p) => p.nombre).join(", "),
      texto: x.texto,
      nota: x.estandar ? t("creditos.textoEstandar") : undefined,
    }));

  return (
    <Stack gap="xl" maw={760}>
      <Title order={1}>{t("creditos.titulo")}</Title>

      <Seccion titulo={t("creditos.estaWeb")}>
        <Tarjeta>
          <Stack gap="sm">
            <Text>{t("creditos.estaWebTexto")}</Text>
            <Group gap="lg">
              <EnlaceExterno href={URL_VERSION}>{t("creditos.codigoFuente")}</EnlaceExterno>
              {URL_VERSION !== URL_CODIGO_FUENTE && <EnlaceExterno href={URL_CODIGO_FUENTE}>{t("creditos.repositorio")}</EnlaceExterno>}
              <EnlaceExterno href={URL_AGPL}>{t("creditos.textoAgpl")}</EnlaceExterno>
            </Group>
            {VERSION_CODIGO.commit && (
              <Text size="sm">
                {t("creditos.version", {
                  version: VERSION_CODIGO.etiqueta || VERSION_CODIGO.commit.slice(0, 7),
                  fecha: new Date(VERSION_CODIGO.fecha).toLocaleDateString(idioma().codigo, { dateStyle: "long" }),
                })}
              </Text>
            )}
            <Text size="sm" c="dimmed">{t("creditos.estaWebDatos")}</Text>
            <Text size="sm">{t("creditos.copyright")}</Text>
            {admin && !VERSION_CODIGO.etiqueta && (
              <Alert color="yellow"><Text size="sm">{t("creditos.sinVersionPublicada")}</Text></Alert>
            )}
            {admin && VERSION_CODIGO.cambios && (
              <Alert color="yellow"><Text size="sm">{t("creditos.cambiosSinConfirmar")}</Text></Alert>
            )}
          </Stack>
        </Tarjeta>
      </Seccion>

      <Seccion titulo={t("creditos.proyectos")}>
        <Text c="dimmed">{t("creditos.proyectosAyuda")}</Text>
        {PROYECTOS.map((p) => (
          <Tarjeta key={p.nombre}>
            <Stack gap="xs">
              <Title order={3}><EnlaceExterno href={p.enlace}>{p.nombre}</EnlaceExterno></Title>
              <Text>{t(p.texto)}</Text>
              <Text size="sm" c="dimmed">{t("creditos.licencia", { licencia: p.licencia })}</Text>
            </Stack>
          </Tarjeta>
        ))}
      </Seccion>

      <Seccion titulo={t("creditos.letras")}>
        <Text c="dimmed">{t("creditos.letrasAyuda")}</Text>
        {LETRAS.map((l) => (
          <Tarjeta key={l.nombre}>
            <Stack gap="xs">
              <Title order={3}><EnlaceExterno href={l.enlace}>{l.nombre}</EnlaceExterno></Title>
              <Text>{t(l.uso)}</Text>
              <Textos textos={l.licencias.map(textoDe).map((x) => ({ ...x, rotulo: t("creditos.verLicenciaDe", { nombre: x.rotulo }) }))} />
            </Stack>
          </Tarjeta>
        ))}
      </Seccion>

      {/* Las imágenes del mapa (docs/mapa.md); Leaflet, entre las bibliotecas. */}
      <Seccion titulo={t("creditos.mapa")}>
        <Tarjeta>
          <Stack gap="xs">
            <Title order={3}><EnlaceExterno href="https://www.openstreetmap.org">OpenStreetMap</EnlaceExterno></Title>
            <Text>{t("creditos.osm")}</Text>
            <Text size="sm" c="dimmed">{t("creditos.osmLicencia")}</Text>
            <EnlaceExterno href="https://www.openstreetmap.org/copyright">{t("creditos.osmCopyright")}</EnlaceExterno>
          </Stack>
        </Tarjeta>
      </Seccion>

      <Seccion titulo={t("creditos.bibliotecas")}>
        <Text c="dimmed">{t("creditos.bibliotecasAyuda", { n: bibliotecas.length })}</Text>
        <Tarjeta>
          <Stack gap="lg">
            <ListaPaquetes titulo={t("creditos.directas")} paquetes={bibliotecas.filter((p) => p.directa)} />
            <ListaPaquetes titulo={t("creditos.indirectas")} paquetes={bibliotecas.filter((p) => !p.directa)} />
          </Stack>
        </Tarjeta>
      </Seccion>

      <Seccion titulo={t("creditos.textos")}>
        <Text c="dimmed">{t("creditos.textosAyuda")}</Text>
        <Textos textos={textos} />
      </Seccion>
    </Stack>
  );
}
