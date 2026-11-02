// Tipos propios como códigos en la web (docs/idiomas.md, apartado 3;
// decisiones del 31/10/2026): se muestran en el idioma de la web y, al
// escribirlos en un formulario, se guarda el código.

import { describe, expect, it } from "vitest";
import { nombreTipo } from "../i18n";
import { tipoDe } from "./tipoDe";

const tipo = (_class: string, value: number, string = "") => ({ _class, value, string });

describe("tipos propios", () => {
  it("nombreTipo: los códigos del catálogo, en el idioma de la web; los textos libres, tal cual", () => {
    expect(nombreTipo(tipo("EventType", 0, "@separacion"))).toBe("Separación");
    expect(nombreTipo(tipo("FamilyRelType", 4, "@sin_relacion"))).toBe("Sin relación de pareja");
    expect(nombreTipo(tipo("AttributeType", 0, "@id_fusionados"))).toBe("ID de Gramps fusionados");
    expect(nombreTipo(tipo("AttributeType", 0, "RIN"))).toBe("RIN");
    // Un código que no está en el catálogo (no debería llegar), sin la «@».
    expect(nombreTipo(tipo("EventType", 0, "@inventado"))).toBe("inventado");
  });

  it("tipoDe: de serie, del catálogo (texto o sinónimo: el código) o texto libre", () => {
    const antes = tipo("EventType", 12);
    expect(tipoDe("EventType", "Nacimiento", antes)).toBe(antes);
    expect(tipoDe("EventType", "Defunción", antes)).toEqual(tipo("EventType", 13));
    expect(tipoDe("EventType", " separación ", antes)).toEqual(tipo("EventType", 0, "@separacion"));
    expect(tipoDe("EventType", "Deported", antes)).toEqual(tipo("EventType", 0, "@deportacion"));
    expect(tipoDe("FamilyRelType", "Sin relación de pareja", tipo("FamilyRelType", 0))).toEqual(tipo("FamilyRelType", 4, "@sin_relacion"));
    expect(tipoDe("EventType", "Mudanza", antes)).toEqual(tipo("EventType", 0, "Mudanza"));
    // Escrito con «@» delante: nunca un código inventado.
    expect(tipoDe("EventType", "@mudanza", antes)).toEqual(tipo("EventType", 0, "mudanza"));
    expect(tipoDe("EventType", "@separacion", antes)).toEqual(tipo("EventType", 0, "@separacion"));
    // El mismo de antes, sin cambios.
    const sep = tipo("EventType", 0, "@separacion");
    expect(tipoDe("EventType", "Separación", sep)).toBe(sep);
  });
});
