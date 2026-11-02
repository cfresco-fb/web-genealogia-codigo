// Símbolos de nacimiento y defunción: juegos y validación (la misma que
// las reglas de Firestore, probadas en reglas/reglas.test.ts).

import { describe, expect, it } from "vitest";
import { PREFERENCIA_POR_DEFECTO, simbolosDe, validarPreferencia } from "./simbolos";

describe("símbolos", () => {
  it("por defecto, abreviaturas neutras", () => {
    expect(simbolosDe(PREFERENCIA_POR_DEFECTO)).toEqual({ nacimiento: "n.", defuncion: "f." });
  });

  it("cada juego", () => {
    expect(simbolosDe({ juego: "asterisco" })).toEqual({ nacimiento: "*", defuncion: "†" });
    expect(simbolosDe({ juego: "david" })).toEqual({ nacimiento: "*", defuncion: "\u2721\uFE0E" });
    expect(simbolosDe({ juego: "personalizado", nacimiento: "nac.", defuncion: "def." })).toEqual({ nacimiento: "nac.", defuncion: "def." });
  });

  it("valida como las reglas de Firestore", () => {
    expect(validarPreferencia({ juego: "asterisco" })).toEqual({ juego: "asterisco" });
    // Un juego fijo no guarda símbolos propios aunque vengan.
    expect(validarPreferencia({ juego: "asterisco", nacimiento: "x", defuncion: "y" })).toEqual({ juego: "asterisco" });
    expect(validarPreferencia({ juego: "personalizado", nacimiento: "n", defuncion: "1234" }))
      .toEqual({ juego: "personalizado", nacimiento: "n", defuncion: "1234" });
    // Como en las reglas de Firestore, un carácter que ocupa dos unidades de
    // UTF-16 cuenta por dos.
    expect(validarPreferencia({ juego: "personalizado", nacimiento: "𝄞abc", defuncion: "f." })).toBeNull();
    expect(validarPreferencia({ juego: "personalizado", nacimiento: "𝄞ab", defuncion: "f." })).not.toBeNull();
    expect(validarPreferencia({ juego: "personalizado", nacimiento: "", defuncion: "f." })).toBeNull();
    expect(validarPreferencia({ juego: "personalizado", nacimiento: "12345", defuncion: "f." })).toBeNull();
    expect(validarPreferencia({ juego: "personalizado", nacimiento: "n." })).toBeNull();
    expect(validarPreferencia({ juego: "runas" })).toBeNull();
    expect(validarPreferencia(null)).toBeNull();
    expect(validarPreferencia("abreviaturas")).toBeNull();
  });
});
