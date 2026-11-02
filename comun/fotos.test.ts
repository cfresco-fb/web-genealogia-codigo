import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tipoPorCabecera } from "./fotos.ts";

// Ficheros mínimos hechos a mano: solo la cabecera y unos bytes cualesquiera.
const bytes = (...partes: (number[] | string)[]) =>
  Uint8Array.from(partes.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("tipo de las fotos por sus primeros bytes", () => {
  it("JPEG, PNG y WebP", () => {
    assert.equal(tipoPorCabecera(bytes([0xff, 0xd8, 0xff, 0xe0], "resto")), "image/jpeg");
    assert.equal(tipoPorCabecera(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], "IHDR")), "image/png");
    assert.equal(tipoPorCabecera(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ")), "image/webp");
  });

  it("lo demás, null", () => {
    assert.equal(tipoPorCabecera(bytes("texto que dice ser una foto")), null);
    assert.equal(tipoPorCabecera(bytes("GIF89a")), null);
    assert.equal(tipoPorCabecera(bytes("RIFF", [1, 2, 3, 4], "WAVEfmt ")), null);
    assert.equal(tipoPorCabecera(bytes([0xff, 0xd8])), null);
    assert.equal(tipoPorCabecera(bytes("RIFF", [1, 2, 3, 4], "WEB")), null);
    assert.equal(tipoPorCabecera(new Uint8Array()), null);
  });
});
