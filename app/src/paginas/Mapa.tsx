// Mapa de lugares (/mapa; encargos del 02/11/2026, docs/encargo-mapa-basico.md
// y docs/encargo-mapa-anadidos.md; cómo funciona: docs/mapa.md). Leaflet con
// las teselas de OpenStreetMap; se carga aparte, solo al abrir la página
// (App.tsx). Qué lugares salen y dónde: app/src/arbol/mapa.ts.
//
// - Filtros: grupos de eventos y años; los marcadores y sus ventanas solo
//   con los eventos que pasan.
// - Marcadores cercanos agrupados (supercluster) en un círculo con el
//   número de lugares; al pulsarlo o acercarse, se separan.
// - Una persona (?persona=…, desde su ficha: sus lugares y la línea de su
//   recorrido) o una rama (?rama=…&tipo=…&gen=…: ascendientes,
//   descendientes o ambos, con el selector de generaciones del árbol). Aviso
//   «Mapa de X» con una × para volver a verlo todo. Abrir «Mapa» desde el
//   menú lo enseña todo.
// - ?lugar=…: centrado en ese lugar (desde su ficha).
//
// Al pulsar un marcador, su ventana muestra los lugares del punto y sus
// eventos por fecha, con enlaces; el contenido es de React (un portal
// dentro de la ventana de Leaflet). Debajo del mapa, solo para el
// administrador, los lugares con eventos que no se pueden poner por falta de
// coordenadas, con «Editar» para ponérselas.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Box, Button, Checkbox, CloseButton, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Text, Title, Tooltip } from "@mantine/core";
import { Link, useSearchParams } from "react-router";
import L from "leaflet";
import Supercluster from "supercluster";
import { usePreferencias } from "../acceso/preferencias";
import { useSesion } from "../acceso/sesion";
import { useArbol } from "../arbol/contexto";
import { textoFecha } from "../arbol/fechas";
import { generacionesEfectivas, generacionesQueHay, leerGeneraciones, opcionesGeneraciones } from "../arbol/grafico";
import {
  datosMapa, eventosDePersonas, filtrarEventos, GRUPOS_EVENTO, personasRama, recorrido, situarLugar,
  TIPOS_RAMA, type ClaseLugar, type GrupoEvento, type Punto, type TipoRama,
} from "../arbol/mapa";
import type { Familia, Lugar, Persona } from "../arbol/tipos";
import { EnlaceFamilia, EnlaceLugar, EnlacePersona } from "../componentes/Enlaces";
import { FormularioLugar } from "../componentes/FormularioLugar";
import { htmlMarcador, iconoGrupo, iconoLugar, nuevoMapa } from "../componentes/leafletMapa";
import { RecordPicker } from "../gramps-connect/formularios/RecordPicker";
import { formatoNumero, nombreTipo, t, type Clave } from "../i18n";

const ANCHO_VENTANA = 360;
/** Zoom al abrir el mapa centrado en un lugar (desde su ficha). */
const ZOOM_LUGAR = 13;
/** Agrupación: radio en píxeles y zoom desde el que ya no se agrupa. */
const RADIO_GRUPO = 48;
const ZOOM_SIN_GRUPOS = 15;

const LEYENDA: [ClaseLugar, boolean, Clave][] = [
  ["pais", false, "mapa.leyenda.pais"],
  ["ciudad", false, "mapa.leyenda.ciudad"],
  ["cementerio", false, "mapa.leyenda.cementerio"],
  ["resto", false, "mapa.leyenda.resto"],
  ["resto", true, "mapa.leyenda.aproximado"],
];

type Anio = number | string;
const anioDe = (a: Anio) => (a === "" ? null : Number(a));

export function Mapa() {
  const arbol = useArbol();
  const admin = useSesion().invitacion.rol === "administrador";
  const { generaciones: preferidas } = usePreferencias();
  const [parametros, setParametros] = useSearchParams();

  // Qué se ve: todo, una persona o una rama.
  const persona = arbol.personas.get(parametros.get("persona") ?? "") ?? null;
  const raiz = persona ? null : arbol.personas.get(parametros.get("rama") ?? "") ?? null;
  const tipoRama: TipoRama = TIPOS_RAMA.find((x) => x === parametros.get("tipo")) ?? "ascendientes";
  const pedidas = leerGeneraciones(parametros.get("gen"), preferidas);
  const hay = useMemo(() => (raiz ? generacionesQueHay(arbol, raiz, tipoRama) : 0), [arbol, raiz, tipoRama]);
  const generaciones = generacionesEfectivas(pedidas, hay);
  const lugarCentro = parametros.get("lugar");
  const base = useMemo(() => {
    if (persona) return eventosDePersonas(arbol, [persona]);
    if (raiz) return eventosDePersonas(arbol, personasRama(arbol, raiz, tipoRama, generaciones));
    return [...arbol.eventos.values()];
  }, [arbol, persona, raiz, tipoRama, generaciones]);

  // Filtros (no se recuerdan).
  const [grupos, setGrupos] = useState<GrupoEvento[]>(GRUPOS_EVENTO);
  const [desde, setDesde] = useState<Anio>("");
  const [hasta, setHasta] = useState<Anio>("");
  const filtrado = useMemo(
    () => filtrarEventos(base, { grupos: new Set(grupos), desde: anioDe(desde), hasta: anioDe(hasta) }),
    [base, grupos, desde, hasta],
  );
  const datos = useMemo(() => datosMapa(arbol.lugares, filtrado.eventos), [arbol, filtrado]);
  const linea = useMemo(() => (persona ? recorrido(arbol.lugares, filtrado.eventos) : []), [arbol, persona, filtrado]);
  // Los lugares que faltan en el mapa, de todo el árbol (el administrador).
  const sinCoordenadas = useMemo(() => (admin ? datosMapa(arbol.lugares, arbol.eventos.values()).sinCoordenadas : []), [arbol, admin]);

  // Grupos de marcadores cercanos: cada punto cuenta sus lugares.
  const indice = useMemo(() => {
    const s = new Supercluster<{ i: number; lugares: number }, { lugares: number }>({
      radius: RADIO_GRUPO, maxZoom: ZOOM_SIN_GRUPOS - 1,
      map: (p) => ({ lugares: p.lugares }),
      reduce: (a, b) => { a.lugares += b.lugares; },
    });
    s.load(datos.puntos.map((p, i) => ({
      type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] }, properties: { i, lugares: p.lugares.length },
    })));
    return s;
  }, [datos]);

  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const capaLinea = useRef<L.LayerGroup | null>(null);
  const ventana = useRef<L.Popup | null>(null);
  /** Lo último encuadrado (qué se ve); al cambiar, se vuelve a encuadrar. */
  const encuadrado = useRef<string | null>(null);
  const pintar = useRef<() => void>(() => undefined);
  // El contenido de la ventana del marcador, donde React pinta el detalle.
  const contenido = useMemo(() => document.createElement("div"), []);
  const [elegido, setElegido] = useState<string | null>(null);
  const [editando, setEditando] = useState<Lugar | null>(null);
  const [eligiendoRama, setEligiendoRama] = useState(false);

  useEffect(() => {
    const m = nuevoMapa(caja.current!);
    capaLinea.current = L.layerGroup().addTo(m);
    capa.current = L.layerGroup().addTo(m);
    ventana.current = L.popup({ maxWidth: ANCHO_VENTANA, minWidth: 220, maxHeight: 320, autoPanPadding: [24, 24] }).setContent(contenido);
    m.on("popupclose", () => setElegido(null));
    m.on("moveend", () => pintar.current());
    mapa.current = m;
    // Un mapa nuevo (React puede montar la página dos veces) está sin vista:
    // hay que volver a encuadrarlo.
    encuadrado.current = null;
    // El tamaño del mapa cambia con la ventana y con el menú lateral.
    const observador = new ResizeObserver(() => m.invalidateSize());
    observador.observe(caja.current!);
    return () => {
      observador.disconnect();
      m.remove();
      mapa.current = null;
    };
  }, [contenido]);

  /** Abre la ventana de un punto. */
  const abrir = (p: Punto) => {
    const m = mapa.current!;
    setElegido(p.clave);
    // En el móvil, que la ventana quepa a lo ancho del mapa.
    const ancho = Math.min(ANCHO_VENTANA, m.getSize().x - 56);
    Object.assign(ventana.current!.options, { maxWidth: ancho, minWidth: Math.min(220, ancho) });
    ventana.current!.setLatLng([p.lat, p.lon]).openOn(m);
  };

  // Los marcadores y los grupos de la zona que se ve, al moverse el mapa y
  // al cambiar los datos.
  pintar.current = () => {
    const m = mapa.current;
    if (!m || !capa.current || !encuadrado.current) return;
    capa.current.clearLayers();
    const b = m.getBounds();
    const oeste = b.getWest(), este = b.getEast();
    const caja = este - oeste >= 360 ? [-180, -85, 180, 85] : [Math.max(-180, oeste), Math.max(-85, b.getSouth()), Math.min(180, este), Math.min(85, b.getNorth())];
    for (const g of indice.getClusters(caja as [number, number, number, number], Math.round(m.getZoom()))) {
      const [lon, lat] = g.geometry.coordinates;
      if ("cluster" in g.properties && g.properties.cluster) {
        const id = g.properties.cluster_id;
        const n = g.properties.lugares;
        L.marker([lat, lon], { icon: iconoGrupo(n), title: t("mapa.grupo", { n: formatoNumero(n) }), alt: t("mapa.grupo", { n: formatoNumero(n) }) })
          .on("click", () => m.setView([lat, lon], Math.min(indice.getClusterExpansionZoom(id), ZOOM_SIN_GRUPOS)))
          .addTo(capa.current);
        continue;
      }
      const p = datos.puntos[(g.properties as { i: number }).i];
      const nombres = p.lugares.map((x) => arbol.tituloLugar(x.lugar.handle)).join(" · ");
      L.marker([p.lat, p.lon], { icon: iconoLugar(p.clase, p.aproximado), title: nombres, alt: nombres, riseOnHover: true })
        .on("click", () => abrir(p))
        .addTo(capa.current);
    }
  };

  // Encuadre: al abrir y al cambiar lo que se ve (persona, rama o lugar),
  // no al cambiar los filtros. Con un lugar, centrado en él y con su
  // ventana abierta si sale en el mapa.
  const queSeVe = `${persona?.handle ?? ""}|${raiz?.handle ?? ""}|${tipoRama}|${generaciones}|${lugarCentro ?? ""}`;
  useEffect(() => {
    const m = mapa.current!;
    if (encuadrado.current !== queSeVe) {
      encuadrado.current = queSeVe;
      const centro = lugarCentro ? situarLugar(arbol.lugares, lugarCentro) : null;
      if (centro) m.setView(centro.coordenadas, ZOOM_LUGAR);
      else if (datos.puntos.length) m.fitBounds(L.latLngBounds(datos.puntos.map((p) => [p.lat, p.lon])), { padding: [32, 32], maxZoom: 12 });
      else m.setView([30, 0], 2);
      const suyo = lugarCentro ? datos.puntos.find((p) => p.lugares.some((x) => x.lugar.handle === lugarCentro)) : null;
      if (suyo) abrir(suyo);
    }
    pintar.current();
  }, [datos, indice, queSeVe]); // eslint-disable-line react-hooks/exhaustive-deps

  // La línea del recorrido de la persona.
  useEffect(() => {
    capaLinea.current?.clearLayers();
    if (linea.length > 1) L.polyline(linea, { className: "recorrido-mapa", weight: 3, opacity: 0.85, interactive: false }).addTo(capaLinea.current!);
  }, [linea]);

  const punto = datos.puntos.find((p) => p.clave === elegido) ?? null;
  // Tras pintar el detalle, la ventana se ajusta a su tamaño; si el punto
  // ya no está (filtros o cambios en el árbol), se cierra.
  useEffect(() => {
    if (punto) ventana.current?.update();
    else if (elegido) mapa.current?.closePopup();
  }, [punto, elegido]);

  const cambiarRama = (cambios: { rama?: string; tipo?: TipoRama; gen?: string }) => {
    const q = new URLSearchParams();
    q.set("rama", cambios.rama ?? raiz!.handle);
    q.set("tipo", cambios.tipo ?? tipoRama);
    const gen = cambios.gen ?? parametros.get("gen");
    if (gen) q.set("gen", gen);
    setParametros(q);
  };
  const sinFecha = filtrado.sinFecha;

  return (
    <Stack gap="md">
      <Title order={1}>{t("menu.mapa")}</Title>
      {(persona || raiz) && (
        <Alert variant="light" p="xs">
          <Group gap="xs" wrap="nowrap">
            <Text size="sm">
              {persona
                ? t("mapa.de", { nombre: arbol.nombre(persona) })
                : t("mapa.deRama", {
                  nombre: arbol.nombre(raiz!),
                  tipo: tipoRama === "ambos" ? t("mapa.ramaAmbos") : t(`grafico.tipo.${tipoRama}` as Clave).toLowerCase(),
                })}
            </Text>
            <Tooltip label={t("mapa.verTodos")} withArrow openDelay={300}>
              <CloseButton component={Link} to="/mapa" size="sm" aria-label={t("mapa.verTodos")} />
            </Tooltip>
          </Group>
        </Alert>
      )}

      {/* Filtros y rama. */}
      <Group gap="lg" align="flex-end">
        <div role="group" aria-labelledby="mapa-eventos">
          <Text id="mapa-eventos" size="sm" fw={600} mb={4}>{t("mapa.eventos")}</Text>
          <Group gap="md">
            {GRUPOS_EVENTO.map((g) => (
              <Checkbox
                key={g}
                label={t(`mapa.grupoEvento.${g}` as Clave)}
                checked={grupos.includes(g)}
                onChange={(e) => {
                  const marcado = e.currentTarget.checked;
                  setGrupos((x) => (marcado ? GRUPOS_EVENTO.filter((y) => y === g || x.includes(y)) : x.filter((y) => y !== g)));
                }}
              />
            ))}
          </Group>
        </div>
        <div role="group" aria-labelledby="mapa-anios" title={t("mapa.ayudaAnios")}>
          <Text id="mapa-anios" size="sm" fw={600}>{t("mapa.anios")}</Text>
          <Group gap={6} wrap="nowrap">
            <NumberInput aria-label={t("mapa.aniosDesde")} placeholder={t("lista.desde")} value={desde} onChange={setDesde} w={92} min={-9999} max={9999} allowDecimal={false} hideControls />
            <NumberInput aria-label={t("mapa.aniosHasta")} placeholder={t("lista.hasta")} value={hasta} onChange={setHasta} w={92} min={-9999} max={9999} allowDecimal={false} hideControls />
          </Group>
        </div>
        <Group gap="xs" align="flex-end">
          <Tooltip label={t("mapa.ayudaRama")} multiline w={260} withArrow openDelay={300} events={{ hover: true, focus: true, touch: true }}>
            <Button variant="default" onClick={() => setEligiendoRama(true)} aria-description={t("mapa.ayudaRama")}>{t("mapa.verRama")}</Button>
          </Tooltip>
          {raiz && (
            <>
              <SegmentedControl
                aria-label={t("mapa.tipoRama")}
                value={tipoRama}
                onChange={(v) => cambiarRama({ tipo: v as TipoRama })}
                data={TIPOS_RAMA.map((v) => ({ value: v, label: t(`grafico.tipo.${v}` as Clave) }))}
              />
              <Select
                aria-label={t("grafico.generaciones")}
                w={150}
                maxDropdownHeight={420}
                allowDeselect={false}
                value={pedidas === "todas" ? "todas" : String(generaciones)}
                onChange={(v) => v && cambiarRama({ gen: v })}
                data={opcionesGeneraciones(hay).map((v) => ({ value: v, label: v === "todas" ? t("generaciones.todas") : t("mapa.generaciones", { n: v }) }))}
              />
            </>
          )}
        </Group>
      </Group>

      {/* isolation: la leyenda (z-index 1000, sobre el mapa) no tapa las ventanas de la web. */}
      <Box pos="relative" style={{ isolation: "isolate" }}>
        <div ref={caja} style={{ height: "calc(100dvh - 300px)", minHeight: 360 }} />
        <div className="leyenda-mapa" aria-label={t("mapa.leyenda")}>
          {LEYENDA.map(([clase, aproximado, clave]) => (
            <div key={clave}>
              <span className="marcador-mapa" dangerouslySetInnerHTML={{ __html: htmlMarcador(clase, aproximado) }} /> {t(clave)}
            </div>
          ))}
        </div>
      </Box>
      {!datos.puntos.length && <Text c="dimmed">{t(base.length ? "mapa.vacioFiltros" : "mapa.vacio")}</Text>}
      {sinFecha > 0 && (
        <Text size="sm" c="dimmed">{sinFecha === 1 ? t("mapa.sinFechaUno") : t("mapa.sinFecha", { n: formatoNumero(sinFecha) })}</Text>
      )}
      {createPortal(punto ? <Detalle punto={punto} /> : null, contenido)}

      <Modal opened={eligiendoRama} onClose={() => setEligiendoRama(false)} title={t("mapa.elegirPersona")}>
        <RecordPicker
          tipo="Person"
          placeholder={t("mapa.buscarPersona")}
          rotulo={(o) => arbol.nombre(o as Persona)}
          conIds={admin}
          alElegir={(o) => {
            setEligiendoRama(false);
            cambiarRama({ rama: o.handle, tipo: raiz ? tipoRama : "ascendientes", gen: raiz ? undefined : "" });
          }}
        />
      </Modal>

      {admin && sinCoordenadas.length > 0 && (
        <Stack gap="xs">
          <Title order={2}>
            {sinCoordenadas.length === 1 ? t("mapa.sinCoordenadasUno") : t("mapa.sinCoordenadas", { n: sinCoordenadas.length })}
          </Title>
          <Text size="sm" c="dimmed">{t("mapa.sinCoordenadasAyuda")}</Text>
          {sinCoordenadas.map((l) => (
            <Group key={l.handle} gap="sm" wrap="nowrap">
              <Button size="xs" variant="default" onClick={() => setEditando(l)} aria-label={t("lugar.editarDe", { nombre: l.name.value })}>
                {t("editar.boton")}
              </Button>
              <Text size="sm"><EnlaceLugar handle={l.handle} /></Text>
            </Group>
          ))}
          <FormularioLugar abierto={!!editando} lugar={editando && (arbol.lugares.get(editando.handle) ?? null)} alCerrar={() => setEditando(null)} />
        </Stack>
      )}
    </Stack>
  );
}

/** Lo que sale al pulsar un marcador: los lugares del punto (enlazados a su
 * ficha) y sus eventos, por fecha, con el tipo, la fecha y quién
 * (enlazado). Con varios lugares, cada evento dice el suyo. */
function Detalle({ punto }: { punto: Punto }) {
  const arbol = useArbol();
  const varios = punto.lugares.length > 1;
  return (
    <Stack gap={8}>
      <Stack gap={2}>
        {punto.lugares.map(({ lugar, aproximadoDe }) => (
          <div key={lugar.handle}>
            <Text fw={600} size="sm"><EnlaceLugar handle={lugar.handle} /></Text>
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
