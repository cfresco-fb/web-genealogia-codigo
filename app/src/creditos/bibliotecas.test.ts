// La lista de bibliotecas de la página de créditos (bibliotecas.json, de
// `npm run creditos`) tiene que estar al día con las dependencias
// instaladas y con licencias revisadas.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import datos from "./bibliotecas.json";
import type { Bibliotecas } from "./tipos";

const BIBLIOTECAS = datos as Bibliotecas;
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAIZ = path.dirname(APP);
const AVISO = "La lista de bibliotecas no está al día: npm run creditos";

/** Licencias revisadas: todas se pueden combinar con la AGPL-3.0. Si sale
 * una nueva, hay que comprobarlo antes de añadirla aquí. */
const REVISADAS = new Set([
  "MIT", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "OFL-1.1",
  "(MIT AND Zlib)", "(MPL-2.0 OR Apache-2.0)", "MIT OR SEE LICENSE IN FEEL-FREE.md",
]);

describe("bibliotecas de la página de créditos", () => {
  it("están todas las dependencias de la web (o constan como no usadas)", () => {
    const deps = Object.keys(JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8")).dependencies);
    const faltan = deps.filter((d) => !BIBLIOTECAS.paquetes.some((p) => p.nombre === d && p.directa) && !BIBLIOTECAS.sinUsar.includes(d));
    expect(faltan, AVISO).toEqual([]);
    const sobran = BIBLIOTECAS.paquetes.filter((p) => p.directa && !deps.includes(p.nombre)).map((p) => p.nombre);
    expect(sobran, AVISO).toEqual([]);
  });

  it("las versiones son las instaladas", () => {
    const instalada = (carpeta: string) => {
      const f = path.join(RAIZ, carpeta, "package.json");
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).version : null;
    };
    const distintas = BIBLIOTECAS.paquetes
      .filter((p) => instalada(p.carpeta) !== p.version)
      .map((p) => `${p.nombre} ${p.version} (instalada: ${instalada(p.carpeta)})`);
    expect(distintas, AVISO).toEqual([]);
  });

  it("cada una tiene enlace, licencia revisada y el texto de su licencia", () => {
    for (const p of BIBLIOTECAS.paquetes) {
      expect(p.enlace, p.nombre).toMatch(/^https?:\/\//);
      expect(REVISADAS.has(p.licencia), `${p.nombre}: licencia ${p.licencia} sin revisar`).toBe(true);
      expect(BIBLIOTECAS.textos[p.texto]?.texto.length, p.nombre).toBeGreaterThan(100);
    }
  });

  it("no hay textos de licencia repetidos ni sin usar", () => {
    const textos = BIBLIOTECAS.textos.map((x) => x.texto);
    expect(new Set(textos).size).toBe(textos.length);
    BIBLIOTECAS.textos.forEach((_, i) => expect(BIBLIOTECAS.paquetes.some((p) => p.texto === i)).toBe(true));
  });
});
