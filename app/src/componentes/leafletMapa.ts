// Piezas de Leaflet comunes al mapa de lugares (/mapa) y al mapa pequeño de
// la ficha de lugar (docs/mapa.md): las teselas de OpenStreetMap con su
// atribución, los marcadores por tipo de lugar y los círculos de los
// grupos de marcadores. Solo lo importan módulos que se cargan aparte.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./mapa.css";
import type { ClaseLugar } from "../arbol/mapa";
import { formatoNumero, t } from "../i18n";

/** Teselas de OpenStreetMap (política de uso:
 * https://operations.osmfoundation.org/policies/tiles/). El navegador manda
 * el origen de la web como Referer (Referrer-Policy de firebase.json). */
export const TESELAS = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const ZOOM_MAXIMO = 19;
const TAM_MARCADOR = 28;

/** Un mapa en `caja` con las teselas, su atribución y los colores del tema. */
export function nuevoMapa(caja: HTMLElement, opciones: L.MapOptions = {}): L.Map {
  const m = L.map(caja, { worldCopyJump: true, ...opciones });
  m.getContainer().classList.add("mapa-lugares");
  L.tileLayer(TESELAS, { maxZoom: ZOOM_MAXIMO, attribution: t("mapa.atribucion") }).addTo(m);
  return m;
}

/** Símbolos neutros (líneas de 24 × 24, en el color del texto del
 * marcador): bandera, edificios, lápida y punto. */
const SIMBOLOS: Record<ClaseLugar, string> = {
  pais: '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
  ciudad: '<path d="M3 21h18M5 21V9l6-3v15M11 21V11h8v10M14 14h2M14 17h2"/>',
  cementerio: '<path d="M7 20V10a5 5 0 0 1 10 0v10M5 20h14M10 12h4"/>',
  resto: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
};

export function htmlMarcador(clase: ClaseLugar, aproximado: boolean): string {
  return `<span class="simbolo${aproximado ? " aproximado" : ""}">`
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SIMBOLOS[clase]}</svg></span>`;
}

export const iconoLugar = (clase: ClaseLugar, aproximado: boolean) => L.divIcon({
  className: "marcador-mapa",
  html: htmlMarcador(clase, aproximado),
  iconSize: [TAM_MARCADOR, TAM_MARCADOR],
  iconAnchor: [TAM_MARCADOR / 2, TAM_MARCADOR / 2],
  popupAnchor: [0, -TAM_MARCADOR / 2],
});

/** Círculo de un grupo de marcadores cercanos, con el número de lugares;
 * algo mayor cuantos más tiene. */
export function iconoGrupo(lugares: number): L.DivIcon {
  const tam = lugares < 10 ? 34 : lugares < 100 ? 40 : 46;
  return L.divIcon({
    className: "grupo-mapa",
    html: `<span class="circulo">${formatoNumero(lugares)}</span>`,
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2],
  });
}
