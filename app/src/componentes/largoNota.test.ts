import { describe, expect, it } from "vitest";
import { MAXIMO_TEXTO_NOTA } from "../../../comun/esquema.ts";
import { avisoLargo } from "./largoNota";

describe("largo del texto de una nota (50.000 caracteres como mucho)", () => {
  it("el límite es el del servidor", () => {
    expect(MAXIMO_TEXTO_NOTA).toBe(50_000);
  });
  it("sin aviso por debajo del 90 %", () => {
    expect(avisoLargo(0)).toEqual({});
    expect(avisoLargo(44_999)).toEqual({});
  });
  it("desde el 90 %, la cuenta", () => {
    expect(avisoLargo(45_000)).toEqual({ ayuda: "45.000 de 50.000 caracteres como mucho." });
  });
  it("justo en el máximo, un aviso; se puede guardar", () => {
    const a = avisoLargo(50_000);
    expect(a.aviso).toBe("Has llegado al máximo: 50.000 caracteres. No cabe nada más.");
    expect(a.error).toBeUndefined();
  });
  it("por encima, un error que no deja guardar", () => {
    expect(avisoLargo(50_001).error).toBe("La nota tiene 50.001 caracteres y el máximo es 50.000. Acórtala (o pártela en varias notas) para poder guardarla.");
  });
});
