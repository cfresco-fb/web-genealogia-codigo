// Mapa de lugares (/mapa; encargo del 02/11/2026, docs/encargo-mapa-basico.md;
// cómo funciona: docs/mapa.md). Leaflet con las teselas de OpenStreetMap;
// se carga aparte, solo al abrir la página (App.tsx). Qué lugares salen y
// dónde: app/src/arbol/mapa.ts.
//
// Al pulsar un marcador, su ventana muestra los lugares del punto y sus
// eventos por fecha, con enlaces a las personas y familias; el contenido es
// de React (un portal dentro de la ventana de Leaflet). Debajo del mapa,
// solo para el administrador, los lugares con eventos que no se pueden
// poner por falta de coordenadas, con «Editar» para ponérselas.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Button, Group, Stack, Text, Title } from "@mantine/core";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./mapa.css";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { textoFecha } from "../arbol/fechas";
import { datosMapa, type ClaseLugar, type Punto } from "../arbol/mapa";
import type { Familia, Lugar, Persona } from "../arbol/tipos";
import { EnlaceFamilia, EnlacePersona } from "../componentes/Enlaces";
import { FormularioLugar } from "../componentes/FormularioLugar";
import { nombreTipo, t, type Clave } from "../i18n";

/** Teselas de OpenStreetMap, con su atribución (política de uso:
 * https://operations.osmfoundation.org/policies/tiles/). El navegador manda
 * el origen de la web como Referer (Referrer-Policy de firebase.json). */
const TESELAS = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ZOOM_MAXIMO = 19;
const TAM_MARCADOR = 28;
const ANCHO_VENTANA = 360;

/** Símbolos neutros (líneas de 24 × 24, en el color del texto del
 * marcador): bandera, edificios, lápida y punto. */
const SIMBOLOS: Record<ClaseLugar, string> = {
  pais: '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
  ciudad: '<path d="M3 21h18M5 21V9l6-3v15M11 21V11h8v10M14 14h2M14 17h2"/>',
  cementerio: '<path d="M7 20V10a5 5 0 0 1 10 0v10M5 20h14M10 12h4"/>',
  resto: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
};

function htmlMarcador(clase: ClaseLugar, aproximado: boolean): string {
  return `<span class="simbolo${aproximado ? " aproximado" : ""}">`
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SIMBOLOS[clase]}</svg></span>`;
}

const icono = (clase: ClaseLugar, aproximado: boolean) => L.divIcon({
  className: "marcador-mapa",
  html: htmlMarcador(clase, aproximado),
  iconSize: [TAM_MARCADOR, TAM_MARCADOR],
  iconAnchor: [TAM_MARCADOR / 2, TAM_MARCADOR / 2],
  popupAnchor: [0, -TAM_MARCADOR / 2],
});

const LEYENDA: [ClaseLugar, boolean, Clave][] = [
  ["pais", false, "mapa.leyenda.pais"],
  ["ciudad", false, "mapa.leyenda.ciudad"],
  ["cementerio", false, "mapa.leyenda.cementerio"],
  ["resto", false, "mapa.leyenda.resto"],
  ["resto", true, "mapa.leyenda.aproximado"],
];

export function Mapa() {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const datos = useMemo(() => datosMapa(arbol.lugares, arbol.eventos.values()), [arbol]);

  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const ventana = useRef<L.Popup | null>(null);
  const encuadrado = useRef(false);
  // El contenido de la ventana del marcador, donde React pinta el detalle.
  const contenido = useMemo(() => document.createElement("div"), []);
  const [elegido, setElegido] = useState<string | null>(null);
  const [editando, setEditando] = useState<Lugar | null>(null);

  useEffect(() => {
    const m = L.map(caja.current!, { worldCopyJump: true });
    m.getContainer().classList.add("mapa-lugares");
    L.tileLayer(TESELAS, { maxZoom: ZOOM_MAXIMO, attribution: t("mapa.atribucion") }).addTo(m);
    capa.current = L.layerGroup().addTo(m);
    ventana.current = L.popup({ maxWidth: ANCHO_VENTANA, minWidth: 220, maxHeight: 320, autoPanPadding: [24, 24] }).setContent(contenido);
    m.on("popupclose", () => setElegido(null));
    mapa.current = m;
    // Un mapa nuevo (React puede montar la página dos veces) está sin vista:
    // hay que volver a encuadrarlo.
    encuadrado.current = false;
    // El tamaño del mapa cambia con la ventana y con el menú lateral.
    const observador = new ResizeObserver(() => m.invalidateSize());
    observador.observe(caja.current!);
    return () => {
      observador.disconnect();
      m.remove();
      mapa.current = null;
    };
  }, [contenido]);

  // Marcadores; al abrir, encuadrados para que se vean todos.
  useEffect(() => {
    const m = mapa.current!;
    capa.current!.clearLayers();
    for (const p of datos.puntos) {
      const nombres = p.lugares.map((x) => arbol.tituloLugar(x.lugar.handle)).join(" · ");
      L.marker([p.lat, p.lon], { icon: icono(p.clase, p.aproximado), title: nombres, alt: nombres, riseOnHover: true })
        .on("click", () => {
          setElegido(p.clave);
          // En el móvil, que la ventana quepa a lo ancho del mapa.
          const ancho = Math.min(ANCHO_VENTANA, m.getSize().x - 56);
          Object.assign(ventana.current!.options, { maxWidth: ancho, minWidth: Math.min(220, ancho) });
          ventana.current!.setLatLng([p.lat, p.lon]).openOn(m);
        })
        .addTo(capa.current!);
    }
    if (encuadrado.current) return;
    encuadrado.current = true;
    if (datos.puntos.length) m.fitBounds(L.latLngBounds(datos.puntos.map((p) => [p.lat, p.lon])), { padding: [32, 32], maxZoom: 12 });
    else m.setView([30, 0], 2);
  }, [datos, arbol]);

  const punto = datos.puntos.find((p) => p.clave === elegido) ?? null;
  // Tras pintar el detalle, la ventana se ajusta a su tamaño; si el punto
  // ya no está (se ha editado el árbol), se cierra.
  useEffect(() => {
    if (punto) ventana.current?.update();
    else if (elegido) mapa.current?.closePopup();
  }, [punto, elegido]);

  return (
    <Stack gap="md">
      <Title order={1}>{t("menu.mapa")}</Title>
      {!datos.puntos.length && <Text c="dimmed">{t("mapa.vacio")}</Text>}
      <Box pos="relative">
        <div ref={caja} style={{ height: "calc(100dvh - 190px)", minHeight: 360 }} />
        <div className="leyenda-mapa" aria-label={t("mapa.leyenda")}>
          {LEYENDA.map(([clase, aproximado, clave]) => (
            <div key={clave}>
              <span className="marcador-mapa" dangerouslySetInnerHTML={{ __html: htmlMarcador(clase, aproximado) }} /> {t(clave)}
            </div>
          ))}
        </div>
      </Box>
      {createPortal(punto ? <Detalle punto={punto} /> : null, contenido)}
      {admin && datos.sinCoordenadas.length > 0 && (
        <Stack gap="xs">
          <Title order={2}>
            {datos.sinCoordenadas.length === 1 ? t("mapa.sinCoordenadasUno") : t("mapa.sinCoordenadas", { n: datos.sinCoordenadas.length })}
          </Title>
          <Text size="sm" c="dimmed">{t("mapa.sinCoordenadasAyuda")}</Text>
          {datos.sinCoordenadas.map((l) => (
            <Group key={l.handle} gap="sm" wrap="nowrap">
              <Button size="xs" variant="default" onClick={() => setEditando(l)} aria-label={t("lugar.editarDe", { nombre: l.name.value })}>
                {t("editar.boton")}
              </Button>
              <Text size="sm">{arbol.tituloLugar(l.handle)}</Text>
            </Group>
          ))}
          <FormularioLugar abierto={!!editando} lugar={editando && (arbol.lugares.get(editando.handle) ?? null)} alCerrar={() => setEditando(null)} />
        </Stack>
      )}
    </Stack>
  );
}

/** Lo que sale al pulsar un marcador: los lugares del punto y sus eventos,
 * por fecha, con el tipo, la fecha y quién (enlazado). Con varios lugares,
 * cada evento dice el suyo. */
function Detalle({ punto }: { punto: Punto }) {
  const arbol = useArbol();
  const varios = punto.lugares.length > 1;
  return (
    <Stack gap={8}>
      <Stack gap={2}>
        {punto.lugares.map(({ lugar, aproximadoDe }) => (
          <div key={lugar.handle}>
            <Text fw={600} size="sm">{arbol.tituloLugar(lugar.handle)}</Text>
            {aproximadoDe && <Text size="sm" c="dimmed">{t("mapa.aproximado", { lugar: arbol.tituloLugar(aproximadoDe.handle) })}</Text>}
          </div>
        ))}
      </Stack>
      <Stack gap={4}>
        {punto.eventos.map((e) => {
          const fecha = textoFecha(e.date);
          return (
            <Text key={e.handle} size="sm">
              <Text span fw={600} size="sm">{nombreTipo(e.type)}</Text>
              {fecha && ` · ${fecha}`}
              {varios && ` · ${arbol.lugares.get(e.place)?.name.value ?? ""}`}
              {arbol.participantes(e).map(({ tipo, objeto }) => (
                <span key={objeto.handle}> — {tipo === "Person" ? <EnlacePersona persona={objeto as Persona} /> : <EnlaceFamilia familia={objeto as Familia} />}</span>
              ))}
            </Text>
          );
        })}
      </Stack>
    </Stack>
  );
}
