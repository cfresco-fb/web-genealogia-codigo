// Fotos que se están subiendo desde los formularios (fase 3, paso 11 b;
// docs/edicion.md, «Subir fotos»). Al elegir el fichero empieza todo:
// prepararla (dos copias, sin datos de ubicación) y subirla a la carpeta de
// paso. Mientras, se rellenan la descripción y la fecha y se guarda la ficha
// cuando ha terminado. El estado vive aquí, fuera de los formularios, porque
// cambia solo (el avance de la subida).

import { useSyncExternalStore } from "react";
import { nuevoHandle } from "../../comun/gramps.ts";
import { ErrorFoto, prepararFoto, type FotoPreparada } from "./arbol/prepararFoto";
import { descargarApartada, fotoLocal, subirFoto } from "./firebase";

export interface EstadoSubida {
  estado: "preparando" | "subiendo" | "lista" | "error";
  /** De 0 a 1, mientras sube. */
  progreso: number;
  /** Por qué ha fallado: el fichero no sirve, o la subida. */
  error?: "tipo" | "ilegible" | "subida";
  foto?: FotoPreparada;
  /** Las dos copias, ya en el navegador, para verlas sin descargarlas. */
  urlPequena?: string;
  urlGrande?: string;
}

interface Subida extends EstadoSubida {
  /** El fichero elegido; ninguno si es una foto apartada de una solicitud
   * (`usarApartada`), que ya está subida. */
  fichero?: File;
  correo: string;
  /** El Media al que va: para verla con su handle en cuanto está lista. */
  handle: string;
}

const subidas = new Map<string, Subida>();
const oyentes = new Set<() => void>();
const avisar = () => { for (const o of oyentes) o(); };

function cambiar(id: string, cambios: Partial<Subida>) {
  const s = subidas.get(id);
  if (!s) return;
  subidas.set(id, { ...s, ...cambios });
  avisar();
}

async function ejecutar(id: string) {
  const s = subidas.get(id)!;
  let foto = s.foto;
  try {
    if (!foto) {
      cambiar(id, { estado: "preparando", progreso: 0, error: undefined });
      foto = await prepararFoto(s.fichero!);
      const urls = { urlGrande: URL.createObjectURL(foto.grande), urlPequena: URL.createObjectURL(foto.pequena) };
      fotoLocal(s.handle, urls.urlGrande, urls.urlPequena);
      cambiar(id, urls);
    }
    cambiar(id, { estado: "subiendo", foto, progreso: 0, error: undefined });
    await subirFoto(s.correo, id, foto.grande, foto.pequena, (progreso) => cambiar(id, { progreso }));
    cambiar(id, { estado: "lista", progreso: 1 });
  } catch (e) {
    cambiar(id, { estado: "error", error: e instanceof ErrorFoto ? e.motivo : "subida", foto });
  }
}

/** Empieza a preparar y subir una foto para el Media `handle`. Devuelve el
 * identificador de la subida. */
export function empezarSubida(fichero: File, correo: string, handle: string): string {
  // El handle nuevo sirve de identificador: letras y números, sin repetir.
  const id = nuevoHandle().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  subidas.set(id, { fichero, correo, handle, estado: "preparando", progreso: 0 });
  avisar();
  void ejecutar(id);
  return id;
}

/** Vuelve a intentar una subida que ha fallado al subir (si el fichero no
 * sirve, no hay nada que hacer). */
export function reintentarSubida(id: string) {
  const s = subidas.get(id);
  if (s?.estado === "error" && s.error === "subida") void (s.fichero ? ejecutar(id) : descargar(id));
}

/** Una foto apartada con la solicitud `correo` que el administrador añade
 * al «Modificar y aplicar» (paso 14): ya está subida (con el mismo
 * identificador); solo se descarga para verla. El servidor la coloca desde
 * su carpeta al guardar. */
export function usarApartada(id: string, correo: string, handle: string) {
  if (subidas.has(id)) return;
  subidas.set(id, { correo, handle, estado: "preparando", progreso: 0 });
  avisar();
  void descargar(id);
}

async function descargar(id: string) {
  const s = subidas.get(id)!;
  try {
    cambiar(id, { estado: "preparando", error: undefined });
    const [grande, pequena] = await Promise.all([descargarApartada(s.correo, id, "grande"), descargarApartada(s.correo, id, "pequena")]);
    const urls = { urlGrande: URL.createObjectURL(grande), urlPequena: URL.createObjectURL(pequena) };
    fotoLocal(s.handle, urls.urlGrande, urls.urlPequena);
    cambiar(id, { ...urls, estado: "lista", progreso: 1 });
  } catch {
    cambiar(id, { estado: "error", error: "subida" });
  }
}

export function estadoSubida(id: string): EstadoSubida | undefined {
  return subidas.get(id);
}

/** El estado de una subida, al día. */
export function useSubida(id: string | null | undefined): EstadoSubida | undefined {
  return useSyncExternalStore(
    (o) => { oyentes.add(o); return () => { oyentes.delete(o); }; },
    () => (id ? subidas.get(id) : undefined),
  );
}

/** Si todas estas subidas han terminado bien (para dejar guardar). */
export function useSubidasListas(ids: string[]): boolean {
  return useSyncExternalStore(
    (o) => { oyentes.add(o); return () => { oyentes.delete(o); }; },
    () => ids.every((id) => subidas.get(id)?.estado === "lista"),
  );
}
