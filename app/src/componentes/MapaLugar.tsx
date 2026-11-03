// Mapa pequeño de la ficha de lugar (añadido 4 del mapa, 02/11/2026;
// docs/mapa.md): centrado en el lugar, con su marcador (aproximado si las
// coordenadas son las del lugar que lo contiene). Con Leaflet; la ficha lo
// carga aparte, solo si el lugar tiene dónde ponerse.

import { useEffect, useRef } from "react";
import L from "leaflet";
import { claseLugar } from "../arbol/mapa";
import type { Lugar } from "../arbol/tipos";
import { iconoLugar, nuevoMapa } from "./leafletMapa";

const ZOOM = 12;

export function MapaLugar({ lugar, coordenadas, aproximado, titulo }: {
  lugar: Lugar;
  coordenadas: [number, number];
  aproximado: boolean;
  titulo: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [lat, lon] = coordenadas;
  const clase = claseLugar(lugar.place_type);
  useEffect(() => {
    // Sin la rueda del ratón, para que la página se pueda desplazar por
    // encima del mapa.
    const m = nuevoMapa(caja.current!, { scrollWheelZoom: false, worldCopyJump: false });
    m.setView([lat, lon], ZOOM);
    L.marker([lat, lon], { icon: iconoLugar(clase, aproximado), title: titulo, alt: titulo, keyboard: false }).addTo(m);
    const observador = new ResizeObserver(() => m.invalidateSize());
    observador.observe(caja.current!);
    return () => {
      observador.disconnect();
      m.remove();
    };
  }, [lat, lon, clase, aproximado, titulo]);
  return <div ref={caja} style={{ height: 260 }} />;
}
