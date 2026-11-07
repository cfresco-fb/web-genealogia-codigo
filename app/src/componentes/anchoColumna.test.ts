import { describe, expect, it } from "vitest";
import { anchoPorTexto } from "./anchoColumna";

describe("ancho inicial de las columnas de nombres", () => {
  it("con textos cortos o sin filas, el mínimo", () => {
    expect(anchoPorTexto(["Ana", "Novio"], 260)).toBe(260);
    expect(anchoPorTexto([], 260)).toBe(260);
  });
  it("crece con el texto más largo", () => {
    expect(anchoPorTexto(["Ana", "x".repeat(40)], 260)).toBe(40 * 8 + 22);
  });
  it("con un tope", () => {
    expect(anchoPorTexto(["x".repeat(200)], 260)).toBe(420);
  });
});
