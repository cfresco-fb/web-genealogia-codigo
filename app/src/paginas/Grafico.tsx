// Árbol de ascendientes, de descendientes o de los dos, centrado en una
// persona. Dirección: /arbol/{handle}?tipo=…&gen=…&disp=…; sin handle, la
// persona de inicio; sin «disp», vertical. Pulsar una persona centra el árbol en ella; «Anterior» vuelve
// a la persona central de antes (la pila va en el estado del historial, así
// que también funciona el botón de atrás del navegador).

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Alert, Anchor, Button, Group, Menu, Paper, SegmentedControl, Select, Stack, Text, Title, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { usePreferencias } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import {
  construirGrafico, DISPOSICIONES, generacionesEfectivas, generacionesQueHay, leerDisposicion, leerGeneraciones, leerTipo,
  opcionesGeneraciones, TIPOS_GRAFICO, type Disposicion, type Generaciones, type TipoGrafico,
} from "../arbol/grafico";
import { AvisoAjustes, rutaPersona } from "../componentes/Enlaces";
import { ExportarLibro } from "../componentes/ExportarLibro";
import { ExportarPdf } from "../componentes/ExportarPdf";
import { IconoArbol, IconoAtras, IconoDescargar, IconoDesplegar, IconoInicio, IconoLibro } from "../componentes/Iconos";
import { NoExiste } from "../componentes/Ficha";
import { urlMultimedia } from "../firebase";
import { TreeChart, type TreeChartHandle } from "../gramps-connect/graficos/visuals/TreeChart";
import { t, type Clave } from "../i18n";
import { color } from "../tema/colores";

/** Dirección del árbol de una persona. Sin generaciones, las de las
 * preferencias del usuario. */
export function rutaArbol(handle: string, tipo: TipoGrafico = "ambos", generaciones?: Generaciones, disposicion?: Disposicion): string {
  const q = new URLSearchParams({ tipo });
  if (generaciones) q.set("gen", String(generaciones));
  if (disposicion && disposicion !== "vertical") q.set("disp", disposicion);
  return `/arbol/${handle}?${q}`;
}

interface EstadoHistorial {
  /** Personas centrales anteriores, la última la más reciente. */
  anteriores?: string[];
}

/** Botón sutil (texto azul sin fondo) para moverse por el árbol, con icono
 * y una explicación al pasar el ratón (o al tocarlo, en el móvil). La
 * explicación sale también con el botón desactivado, para decir por qué lo
 * está. */
function BotonConAyuda({ ayuda, icono, children, disabled = false, movil, onClick }: {
  ayuda: string;
  icono: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  /** En el móvil, los botones van de dos en dos, repartiéndose el ancho, y
   * el texto puede ir en dos líneas. */
  movil: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={ayuda} multiline w={260} withArrow openDelay={300} events={{ hover: true, focus: true, touch: true }}>
      {/* Un botón desactivado no recibe el ratón: el envoltorio sí. */}
      <span style={{ display: "inline-flex", flex: movil ? "1 1 40%" : undefined, minWidth: 0, alignSelf: "stretch" }}>
        <Button
          variant="subtle"
          leftSection={icono}
          disabled={disabled}
          onClick={onClick}
          aria-description={ayuda}
          fullWidth={movil}
          px={movil ? 8 : undefined}
          styles={movil ? {
            root: { height: "100%", minHeight: 44, paddingBlock: 6 },
            label: { whiteSpace: "normal", lineHeight: 1.2, textAlign: "left" },
            section: { marginInlineEnd: 6 },
          } : undefined}
          style={disabled ? { pointerEvents: "none" } : undefined}
        >
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}

/** Una opción del menú «Descargar PDF»: qué es y qué se elige antes de
 * descargarlo (decisión del 24/10/2026, «Diseño visual»). */
function OpcionDescarga({ nombre, que, eliges }: { nombre: string; que: string; eliges: string }) {
  return (
    <Stack gap={2}>
      <Text fw={600}>{nombre}</Text>
      <Text size="sm" fw={400}>{que}</Text>
      <Text size="sm" fw={400} c="dimmed">{eliges}</Text>
    </Stack>
  );
}

export function Grafico() {
  const arbol = useArbol();
  const { handle } = useParams();
  const [parametros] = useSearchParams();
  const { state } = useLocation() as { state: EstadoHistorial | null };
  const navegar = useNavigate();
  const grafico = useRef<TreeChartHandle>(null);
  const { simbolos, nombreArbol, personaInicio, vivas, generaciones: preferidas } = usePreferencias();
  const { invitacion } = useSesion();
  // El ID de Gramps en las cajas, solo para el administrador.
  const presentacion = useMemo(() => ({ ...simbolos, ids: invitacion.rol === "administrador", vivas }), [simbolos, invitacion.rol, vivas]);
  const [pdfAbierto, setPdfAbierto] = useState(false);
  const [libroAbierto, setLibroAbierto] = useState(false);
  const [aviso, setAviso] = useState("");
  const movil = useMediaQuery("(max-width: 36em)") ?? false;

  const tipo = leerTipo(parametros.get("tipo"));
  const disposicion = leerDisposicion(parametros.get("disp"));
  const persona = handle ? arbol.persona(handle) : personaInicio;
  // Las pedidas (en la dirección o, si no, las de las preferencias) se
  // conservan al cambiar de persona; se dibujan como mucho las que hay
  // (decisión del 29/10/2026).
  const pedidas = leerGeneraciones(parametros.get("gen"), preferidas);
  const hay = useMemo(() => (persona ? generacionesQueHay(arbol, persona, tipo) : 0), [arbol, persona, tipo]);
  const generaciones = generacionesEfectivas(pedidas, hay);
  const anteriores = state?.anteriores ?? [];

  const datos = useMemo(
    () => (persona ? construirGrafico(arbol, persona, tipo, generaciones, presentacion) : null),
    [arbol, persona, tipo, generaciones, presentacion],
  );

  /** Cambia la persona central, el tipo o las generaciones. */
  const ir = useCallback(
    (cambios: { handle?: string; tipo?: TipoGrafico; generaciones?: Generaciones; disposicion?: Disposicion; anteriores?: string[] }) => {
      if (!persona) return;
      const nuevo = cambios.handle ?? persona.handle;
      const pila = cambios.anteriores ?? (nuevo !== persona.handle ? [...anteriores, persona.handle] : anteriores);
      navegar(rutaArbol(nuevo, cambios.tipo ?? tipo, cambios.generaciones ?? pedidas, cambios.disposicion ?? disposicion), {
        state: { anteriores: pila } satisfies EstadoHistorial,
        // Cambiar tipo, generaciones o disposición no deja un paso más en el
        // historial.
        replace: nuevo === persona.handle,
      });
    },
    [persona, anteriores, tipo, pedidas, disposicion, navegar],
  );

  const centrar = useCallback((h: string) => {
    if (h !== persona?.handle) ir({ handle: h });
  }, [ir, persona]);
  const abrirFicha = useCallback((h: string) => navegar(rutaPersona(h)), [navegar]);
  const etiquetas = useMemo(() => ({
    openPerson: t("grafico.abrirFicha"),
    more: t("grafico.mas"),
    unknownSpouse: t("ficha.conyugeDesconocido"),
    noSurname: t("persona.sinApellidos"),
    noGivenName: t("persona.sinNombrePila"),
  }), []);

  // Fotos de las cajas: la copia pequeña.
  const urlFoto = useCallback((h: string) => urlMultimedia(h, "pequena"), []);
  const dibujoPdf = useMemo(() => ({ labels: etiquetas, photoUrl: urlFoto }), [etiquetas, urlFoto]);

  if (!persona || !datos) return handle ? <NoExiste /> : <Text c="dimmed">{t("inicio.sinPersonaInicio")}</Text>;

  const nombre = arbol.nombre(persona);
  const titulo = t(`grafico.titulo.${tipo}` as Clave, { nombre });
  const inicio = personaInicio;
  const anterior = arbol.persona(anteriores.at(-1));

  return (
    <Stack gap="xs" h="100%">
      <div style={{ minWidth: 0 }}>
        <Title order={1} lineClamp={2}>{titulo}</Title>
        <Anchor component={Link} to={rutaPersona(persona.handle)} size="sm">{t("grafico.ficha")}</Anchor>
      </div>
      <Group justify="space-between" align="flex-end" gap="sm">
        {/* Qué se dibuja: tipo de árbol, generaciones y disposición. */}
        <Paper withBorder px="sm" py={6} bg={color("superficie-hundida")} role="group" aria-label={t("grafico.controles")}>
          <Group gap="md" align="flex-end">
            <div>
              <Text size="xs" fw={600} mb={2} id="tipo-arbol">{t("grafico.tipo")}</Text>
              <SegmentedControl
                size="xs"
                aria-labelledby="tipo-arbol"
                value={tipo}
                onChange={(v) => ir({ tipo: v as TipoGrafico })}
                data={TIPOS_GRAFICO.map((v) => ({ value: v, label: t(`grafico.tipo.${v}` as Clave) }))}
              />
            </div>
            <div>
              <Text size="xs" fw={600} mb={2} component="label" htmlFor="generaciones" display="block">{t("grafico.generaciones")}</Text>
              <Select
                id="generaciones"
                size="xs"
                w={90}
                allowDeselect={false}
                value={pedidas === "todas" ? "todas" : String(generaciones)}
                onChange={(v) => v && ir({ generaciones: v === "todas" ? "todas" : Number(v) })}
                data={opcionesGeneraciones(hay).map((v) => ({ value: v, label: v === "todas" ? t("generaciones.todas") : v }))}
              />
            </div>
            <div>
              <Text size="xs" fw={600} mb={2} id="disposicion-arbol">{t("grafico.disposicion")}</Text>
              <SegmentedControl
                size="xs"
                aria-labelledby="disposicion-arbol"
                value={disposicion}
                onChange={(v) => ir({ disposicion: v as Disposicion })}
                data={DISPOSICIONES.map((d) => ({ value: d, label: t(`grafico.disposicion.${d}` as Clave) }))}
              />
            </div>
          </Group>
        </Paper>
        {/* Moverse por el árbol y descargarlo. */}
        <Group gap="xs" wrap="wrap" align="stretch" w={movil ? "100%" : undefined} role="group" aria-label={t("grafico.acciones")}>
          <BotonConAyuda
            ayuda={anterior ? t("grafico.anteriorAyuda", { nombre: arbol.nombre(anterior) }) : t("grafico.anteriorNinguna")}
            icono={<IconoAtras />}
            disabled={!anterior}
            movil={movil}
            onClick={() => ir({ handle: anteriores.at(-1), anteriores: anteriores.slice(0, -1) })}
          >
            {t("grafico.anterior")}
          </BotonConAyuda>
          <BotonConAyuda
            ayuda={!inicio
              ? t("inicio.sinPersonaInicio")
              : t(inicio.handle === persona.handle ? "grafico.inicioYa" : "grafico.inicioAyuda", { nombre: arbol.nombre(inicio) })}
            icono={<IconoInicio />}
            disabled={!inicio || inicio.handle === persona.handle}
            movil={movil}
            onClick={() => inicio && ir({ handle: inicio.handle })}
          >
            {t("grafico.inicio")}
          </BotonConAyuda>
          {/* El único botón principal: un menú con el árbol y el libro;
              cada opción abre su diálogo. */}
          <Menu position="bottom-end" width={340}>
            <Menu.Target>
              <Button leftSection={<IconoDescargar />} rightSection={<IconoDesplegar />} fullWidth={movil} style={movil ? { flex: "1 1 100%" } : undefined}>
                {t("grafico.descargar")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconoArbol />} onClick={() => setPdfAbierto(true)} styles={{ itemSection: { alignSelf: "flex-start", marginTop: 4 } }}>
                <OpcionDescarga nombre={t("grafico.pdf")} que={t("grafico.pdfQue")} eliges={t("grafico.pdfEliges")} />
              </Menu.Item>
              <Menu.Item leftSection={<IconoLibro />} onClick={() => setLibroAbierto(true)} styles={{ itemSection: { alignSelf: "flex-start", marginTop: 4 } }}>
                <OpcionDescarga nombre={t("grafico.libro")} que={t("grafico.libroQue")} eliges={t("grafico.libroEliges")} />
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {aviso && (
        <Alert color="blue" withCloseButton closeButtonLabel={t("simbolos.cerrar")} onClose={() => setAviso("")}>
          <Text size="sm">{aviso}</Text>
        </Alert>
      )}
      <Paper withBorder pos="relative" bg={color("papel")} style={{ flex: 1, minHeight: 320, overflow: "hidden" }}>
        <TreeChart
          ref={grafico}
          ancestorTree={datos.ascendientes}
          descendantTree={datos.descendientes}
          layout={disposicion}
          selectedHandle={persona.handle}
          onSelectPerson={centrar}
          onOpenPerson={abrirFicha}
          photoUrl={urlFoto}
          labels={etiquetas}
        />
        <Group gap={4} pos="absolute" bottom={8} right={8}>
          <ActionIcon variant="default" size="lg" aria-label={t("grafico.ampliar")} title={t("grafico.ampliar")} onClick={() => grafico.current?.zoomIn()}>+</ActionIcon>
          <ActionIcon variant="default" size="lg" aria-label={t("grafico.reducir")} title={t("grafico.reducir")} onClick={() => grafico.current?.zoomOut()}>−</ActionIcon>
          <Button variant="default" size="xs" h={34} onClick={() => grafico.current?.fit()}>{t("grafico.verTodo")}</Button>
        </Group>
      </Paper>
      <Text size="xs" c="dimmed">{t("grafico.ayuda")}</Text>
      <AvisoAjustes texto={t("avisoAjustes.arbol")} seccion="generaciones" size="xs" />
      <ExportarPdf
        abierto={pdfAbierto}
        alCerrar={() => setPdfAbierto(false)}
        arbol={arbol}
        persona={persona}
        tipo={tipo}
        generaciones={pedidas}
        disposicion={disposicion}
        presentacion={presentacion}
        labels={etiquetas}
        photoUrl={urlFoto}
        subtitulo={nombreArbol}
        alAvisar={setAviso}
      />
      <ExportarLibro
        abierto={libroAbierto}
        alCerrar={() => setLibroAbierto(false)}
        alAvisar={setAviso}
        arbol={arbol}
        persona={persona}
        tipo={tipo}
        generaciones={pedidas}
        disposicion={disposicion}
        dibujo={dibujoPdf}
      />
    </Stack>
  );
}
