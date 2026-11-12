import { describe, expect, it } from "vitest";
import { camposPreferencias, SIN_PROPIAS, sinPersonaQueNoExiste } from "./propias";

const existe = (h: string) => h === "p1";

describe("preferencias propias que se escriben", () => {
  it("solo los campos elegidos", () => {
    const { campos } = camposPreferencias({ ...SIN_PROPIAS, personaInicio: "p1", region: "es-419", generaciones: "todas", aniversarios: "semanal", aniversariosTipos: ["cumpleanos"], aniversariosDe: "arbol" }, existe);
    expect(campos).toEqual({ personaInicio: "p1", region: "es-419", generaciones: "todas", aniversarios: "semanal", aniversariosTipos: ["cumpleanos"], aniversariosDe: "arbol" });
  });

  it("de los símbolos, solo lo que admiten las reglas", () => {
    expect(camposPreferencias({ ...SIN_PROPIAS, simbolos: { juego: "david", nacimiento: "*", defuncion: "+" } }, existe).campos)
      .toEqual({ simbolos: { juego: "david" } });
  });

  it("una persona de inicio que ya no está en el árbol no se escribe y queda sin elegir", () => {
    const { campos, propias } = camposPreferencias({ ...SIN_PROPIAS, personaInicio: "p9", modoColor: "oscuro" }, existe);
    expect(campos).toEqual({ modoColor: "oscuro" });
    expect(propias.personaInicio).toBeNull();
    expect(propias.modoColor).toBe("oscuro");
  });

  it("sin nada elegido, ningún campo (se borra el documento)", () => {
    expect(camposPreferencias({ ...SIN_PROPIAS, personaInicio: "p9" }, existe).campos).toEqual({});
  });

  it("al leer, la persona que no existe vale como «sin elegir»", () => {
    const p = { ...SIN_PROPIAS, personaInicio: "p9" };
    expect(sinPersonaQueNoExiste(p, existe).personaInicio).toBeNull();
    expect(sinPersonaQueNoExiste({ ...p, personaInicio: "p1" }, existe).personaInicio).toBe("p1");
  });
});
