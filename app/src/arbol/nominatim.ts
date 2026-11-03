// Buscar las coordenadas de un lugar por su nombre en Nominatim, el
// buscador de OpenStreetMap (añadido 5 del mapa, 02/11/2026;
// docs/mapa.md, «Buscar coordenadas»). Desde el navegador y cumpliendo su
// política de uso (https://operations.osmfoundation.org/policies/nominatim/):
// una consulta solo al pulsar, como mucho una por segundo (Limitador), sin
// sugerencias mientras se escribe; el navegador manda el origen de la web
// como Referer (no se puede poner un User-Agent propio).

export const URL_NOMINATIM = "https://nominatim.openstreetmap.org/search";
export const MAXIMO_RESULTADOS = 5;
/** Una consulta por segundo como mucho (política de Nominatim). */
export const INTERVALO_MS = 1000;

export interface ResultadoNominatim {
  /** El nombre completo («Madrid, Comunidad de Madrid, España»). */
  nombre: string;
  /** En decimal, como los da Nominatim y como los guarda Gramps. */
  lat: string;
  long: string;
}

/** Deja pasar una consulta y cierra el paso hasta que pase el intervalo. */
export class Limitador {
  private ultima = -Infinity;
  constructor(private readonly intervalo = INTERVALO_MS, private readonly ahora: () => number = () => Date.now()) {}

  /** Milisegundos que faltan para poder consultar (0: ya se puede). */
  espera(): number {
    return Math.max(0, this.ultima + this.intervalo - this.ahora());
  }

  /** Si se puede, anota la consulta y devuelve true; si no, false. */
  pasar(): boolean {
    if (this.espera() > 0) return false;
    this.ultima = this.ahora();
    return true;
  }
}

/** La dirección de la consulta: hasta 5 resultados, en el idioma de la web. */
export function urlBusqueda(texto: string, idioma: string): string {
  const q = new URLSearchParams({ q: texto.trim(), format: "jsonv2", limit: String(MAXIMO_RESULTADOS), "accept-language": idioma });
  return `${URL_NOMINATIM}?${q}`;
}

/** Los resultados de Nominatim que traen nombre y coordenadas, hasta 5. */
export function leerResultados(datos: unknown): ResultadoNominatim[] {
  if (!Array.isArray(datos)) return [];
  const out: ResultadoNominatim[] = [];
  for (const d of datos as Record<string, unknown>[]) {
    const { display_name: nombre, lat, lon } = d ?? {};
    if (typeof nombre === "string" && typeof lat === "string" && typeof lon === "string" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
      out.push({ nombre, lat, long: lon });
    }
    if (out.length === MAXIMO_RESULTADOS) break;
  }
  return out;
}

/** Consulta Nominatim (sin pasar por el limitador: lo pone quien llama). */
export async function buscarEnNominatim(texto: string, idioma: string, pedir: typeof fetch = fetch): Promise<ResultadoNominatim[]> {
  const r = await pedir(urlBusqueda(texto, idioma), { headers: { Accept: "application/json" }, referrerPolicy: "strict-origin-when-cross-origin" });
  if (!r.ok) throw new Error(`Nominatim: ${r.status}`);
  return leerResultados(await r.json());
}
