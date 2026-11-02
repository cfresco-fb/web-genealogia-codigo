import { describe, expect, it } from "vitest";
import { moverRect, type Rect } from "./Recorte";

describe("recorte de la cara (DF-3)", () => {
  const r: Rect = [20, 20, 60, 60];
  it("mover: el recuadro entero, sin salirse de la foto", () => {
    expect(moverRect(r, "mover", 10, -5)).toEqual([30, 15, 70, 55]);
    expect(moverRect(r, "mover", 90, 90)).toEqual([60, 60, 100, 100]);
    expect(moverRect(r, "mover", -90, 0)).toEqual([0, 20, 40, 60]);
  });
  it("esquinas: cada una mueve sus dos lados, dentro de la foto y con un tamaño mínimo", () => {
    expect(moverRect(r, "se", 10, 20)).toEqual([20, 20, 70, 80]);
    expect(moverRect(r, "no", -50, -50)).toEqual([0, 0, 60, 60]);
    expect(moverRect(r, "ne", 100, 100)).toEqual([20, 55, 100, 60]);
    expect(moverRect(r, "so", 100, -100)).toEqual([55, 20, 60, 25]);
  });
});
