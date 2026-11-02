import { describe, expect, it } from "vitest";
import { orientacionJpeg, quitarMetadatosJpeg } from "./prepararFoto";

const seg = (marca: number, datos: number[]) => [0xff, marca, ((datos.length + 2) >> 8) & 0xff, (datos.length + 2) & 0xff, ...datos];
const texto = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Exif con la orientación y un puntero al GPS, en orden Intel o Motorola. */
function exif(orientacion: number, intel: boolean): number[] {
  const u16 = (v: number) => (intel ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (intel ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const tiff = [
    ...(intel ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8),
    ...u16(2),
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientacion), 0, 0,
    ...u16(0x8825), ...u16(4), ...u32(1), ...u32(38),
    ...u32(0),
    ...texto("GPS 40.4168 -3.7038"),
  ];
  return [...texto("Exif"), 0, 0, ...tiff];
}

/** Un JPEG de juguete: cabeceras y unos «datos de imagen» reconocibles. */
function jpeg(orientacion: number, intel = true): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, texto("JFIF\0")),
    ...seg(0xe1, exif(orientacion, intel)),
    ...seg(0xe1, texto("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")),
    ...seg(0xe2, texto("ICC_PROFILE\0perfil")),
    ...seg(0xed, texto("Photoshop 3.0\0iptc")),
    ...seg(0xfe, texto("comentario")),
    ...seg(0xdb, [0, 1, 2, 3]),
    ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0,
    0x12, 0x34, 0xff, 0x00, 0x56,
    0xff, 0xd9,
  ]);
}

const contiene = (b: Uint8Array, s: string) => new TextDecoder("latin1").decode(b).includes(s);

describe("fotos: JPEG sin metadatos", () => {
  it("lee la orientación en los dos órdenes de bytes", () => {
    expect(orientacionJpeg(jpeg(1))).toBe(1);
    expect(orientacionJpeg(jpeg(6))).toBe(6);
    expect(orientacionJpeg(jpeg(8, false))).toBe(8);
  });

  it("sin Exif, orientación normal; lo que no es JPEG, también", () => {
    const sinExif = quitarMetadatosJpeg(jpeg(6))!;
    expect(orientacionJpeg(sinExif)).toBe(1);
    expect(orientacionJpeg(new Uint8Array([1, 2, 3, 4]))).toBe(1);
  });

  it("quita Exif (con el GPS), XMP, IPTC y comentarios, y deja lo demás igual", () => {
    const original = jpeg(1);
    const limpio = quitarMetadatosJpeg(original)!;
    for (const s of ["Exif", "GPS", "xmpmeta", "Photoshop", "comentario"]) expect(contiene(limpio, s)).toBe(false);
    for (const s of ["JFIF", "ICC_PROFILE"]) expect(contiene(limpio, s)).toBe(true);
    // La imagen (desde SOS) y su final, byte a byte.
    const desde = (b: Uint8Array) => b.subarray(b.findIndex((x, i) => x === 0xff && b[i + 1] === 0xda));
    expect([...desde(limpio)]).toEqual([...desde(original)]);
    expect([...limpio.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it("lo que no es un JPEG, null", () => {
    expect(quitarMetadatosJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(quitarMetadatosJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull();
  });
});
