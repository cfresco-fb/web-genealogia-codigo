// Preparación de una foto en el navegador antes de subirla (fase 3, paso
// 11 b; docs/diseno-fase-3.md, apartado 8 bis; respuestas de Carlos del
// 27/10/2026): dos copias y sin datos de ubicación (DF-4 a).
//
// - Grande: un JPEG que no pasa de LADO_GRANDE y no hay que girar se queda
//   tal cual, sin sus metadatos (Exif, con el GPS; XMP; IPTC; comentarios),
//   que se quitan sin tocar la imagen. Lo demás se dibuja de nuevo: un PNG
//   que cabe, en PNG (sin pérdida); el resto, reducido a LADO_GRANDE en
//   JPEG de calidad alta. Al dibujarla se gira según la cámara y no quedan
//   metadatos.
// - Pequeña: LADO_PEQUENA en JPEG, para la web.

import { BYTES_MAXIMO_GRANDE, LADO_GRANDE, LADO_PEQUENA, TIPOS_FOTO, type TipoFoto } from "../../../comun/fotos.ts";

export interface FotoPreparada {
  grande: Blob;
  pequena: Blob;
  mime: TipoFoto;
  /** Medidas de la imagen ya girada. */
  ancho: number;
  alto: number;
}

/** Por qué no se puede usar un fichero. */
export class ErrorFoto extends Error {
  constructor(readonly motivo: "tipo" | "ilegible") {
    super(motivo);
  }
}

// ---- JPEG: orientación y metadatos ----

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
/** Segmentos que se quitan: APP1 (Exif con el GPS, XMP), APP12, APP13
 * (IPTC) y comentarios. Se conservan APP0 (JFIF), APP2 (perfil de color) y
 * APP14 (Adobe, necesario para los colores). */
const QUITAR = new Set([0xe1, 0xec, 0xed, 0xfe]);

interface Segmento {
  marca: number;
  /** Desde el 0xFF de la marca hasta el final del segmento. */
  inicio: number;
  fin: number;
}

/** Los segmentos de cabecera de un JPEG, hasta el comienzo de la imagen
 * (SOS), o null si no lo parece. */
function segmentos(b: Uint8Array): { lista: Segmento[]; imagen: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return null;
  const lista: Segmento[] = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marca = b[i + 1];
    if (marca === 0xff) { i++; continue; }
    if (marca === SOS || marca === EOI) return { lista, imagen: i };
    const largo = (b[i + 2] << 8) | b[i + 3];
    if (largo < 2 || i + 2 + largo > b.length) return null;
    lista.push({ marca, inicio: i, fin: i + 2 + largo });
    i += 2 + largo;
  }
  return null;
}

/** Orientación Exif de un JPEG (1, la normal, si no la dice). */
export function orientacionJpeg(b: Uint8Array): number {
  const s = segmentos(b);
  if (!s) return 1;
  for (const { marca, inicio, fin } of s.lista) {
    if (marca !== 0xe1) continue;
    const d = inicio + 4;
    // "Exif\0\0"
    if (fin - d < 14 || String.fromCharCode(...b.subarray(d, d + 4)) !== "Exif") continue;
    const t = d + 6;
    const le = b[t] === 0x49;
    const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000 : b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
    const ifd = t + u32(t + 4);
    if (ifd + 2 > fin) continue;
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > fin) break;
      if (u16(e) === 0x0112) {
        const v = u16(e + 8);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
  }
  return 1;
}

/** El JPEG sin sus metadatos (la imagen, igual), o null si no se entiende. */
export function quitarMetadatosJpeg(b: Uint8Array): Uint8Array | null {
  const s = segmentos(b);
  if (!s) return null;
  const partes: Uint8Array[] = [b.subarray(0, 2)];
  for (const g of s.lista) if (!QUITAR.has(g.marca)) partes.push(b.subarray(g.inicio, g.fin));
  partes.push(b.subarray(s.imagen));
  const salida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) {
    salida.set(p, i);
    i += p.length;
  }
  return salida;
}

// ---- En el navegador ----

/** La imagen dibujada en un lienzo con el lado mayor `lado` como mucho. */
function aBlob(imagen: ImageBitmap, lado: number, tipo: "image/jpeg" | "image/png", calidad?: number): Promise<Blob> {
  const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(imagen.width * escala));
  lienzo.height = Math.max(1, Math.round(imagen.height * escala));
  const ctx = lienzo.getContext("2d")!;
  if (tipo === "image/jpeg") {
    // El JPEG no tiene transparencia: fondo blanco, como el papel.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new ErrorFoto("ilegible"))), tipo, calidad));
}

export async function prepararFoto(fichero: File): Promise<FotoPreparada> {
  const tipo = fichero.type as TipoFoto;
  if (!TIPOS_FOTO.includes(tipo)) throw new ErrorFoto("tipo");
  const imagen = await createImageBitmap(fichero, { imageOrientation: "from-image" }).catch(() => {
    throw new ErrorFoto("ilegible");
  });
  try {
    const lado = Math.max(imagen.width, imagen.height);
    let grande: Blob | null = null;
    let mime: TipoFoto = "image/jpeg";
    if (tipo === "image/jpeg" && lado <= LADO_GRANDE) {
      const bytes = new Uint8Array(await fichero.arrayBuffer());
      const limpio = orientacionJpeg(bytes) === 1 ? quitarMetadatosJpeg(bytes) : null;
      if (limpio && limpio.length <= BYTES_MAXIMO_GRANDE) grande = new Blob([limpio as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
    }
    if (!grande && tipo === "image/png" && lado <= LADO_GRANDE) {
      const b = await aBlob(imagen, LADO_GRANDE, "image/png");
      if (b.size <= BYTES_MAXIMO_GRANDE) {
        grande = b;
        mime = "image/png";
      }
    }
    grande ??= await aBlob(imagen, LADO_GRANDE, "image/jpeg", 0.92);
    const pequena = await aBlob(imagen, LADO_PEQUENA, "image/jpeg", 0.85);
    return { grande, pequena, mime, ancho: imagen.width, alto: imagen.height };
  } finally {
    imagen.close();
  }
}
